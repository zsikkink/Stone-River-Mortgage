import { CountyTaxObservation, CountyTaxProvider, CountyTaxProviderRequest, ParcelMatch } from "../../types";
import { normalizeCountyName } from "../../strategyRegistry";
import {
  createCookieJar,
  extractHiddenInputs,
  fetchPublicAccessDataletHtml,
  fetchWithCookies,
  getParcelLookupCandidates,
  normalizeWhitespace,
  parseCurrency,
  stripTags
} from "./authoritativeCountyUtils";
import {
  classifyMetroProviderFailure,
  MetroProviderError
} from "./providerError";
import { fetchWithTimeout } from "../../../server/fetch-timeout";

const WRIGHT_BASE_URL = "https://propertyaccess.co.wright.mn.us";
const WRIGHT_SEARCH_PATH = "/search/commonsearch.aspx?mode=combined";
const WRIGHT_DISCLAIMER_PATH =
  "/search/Disclaimer.aspx?FromUrl=%2Fsearch%2Fcommonsearch.aspx%3Fmode%3Dcombined";
const WRIGHT_PARCEL_ARCGIS_QUERY_URL =
  "https://web.co.wright.mn.us/arcgisserver/rest/services/Wright_County_Parcels/MapServer/1/query";
const WRIGHT_ARCGIS_SEARCH_RADII_METERS = [30, 80, 150];
const WRIGHT_SEARCH_PAGE_SIZE = "50";

const STREET_SUFFIXES = new Set([
  "ALY",
  "AVE",
  "AV",
  "BLVD",
  "CIR",
  "CT",
  "DR",
  "HWY",
  "LN",
  "PKWY",
  "PL",
  "RD",
  "RUN",
  "ST",
  "TER",
  "TRL",
  "WAY"
]);

const STREET_DIRECTIONS = new Set([
  "N",
  "S",
  "E",
  "W",
  "NE",
  "NW",
  "SE",
  "SW"
]);

type WrightAddressParts = {
  streetNumber: string;
  streetName: string;
  suffix: string | null;
  direction: string | null;
  zip: string | null;
};

type WrightSearchResultRow = {
  parcelId: string | null;
  situsAddressLine: string | null;
  city: string | null;
  zip: string | null;
  taxpayer: string | null;
  dataletUrl: string | null;
  taxYear: number | null;
  rowText: string;
};

type WrightAddressSearchStrategy = {
  fields: Record<string, string>;
};

type WrightTaxDataletParseResult = {
  latestTaxYear: number | null;
  totalPayable: number | null;
  evidenceLine: string | null;
  extractionMethod: "tax_statement_total" | "payment_history_row" | "unknown";
};

type WrightArcGisQueryResponse = {
  features?: Array<{
    attributes?: Record<string, unknown>;
    geometry?: {
      x?: number;
      y?: number;
    };
  }>;
};

function normalizeAddressToken(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function toNullableNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371000 * c;
}

function parseWrightAddressParts(
  formattedAddress: string | null | undefined
): WrightAddressParts | null {
  if (!formattedAddress) {
    return null;
  }

  const line = formattedAddress.split(",")[0]?.trim() || "";
  const zipMatch = formattedAddress.match(/\b(\d{5})(?:-\d{4})?\b/);
  const unitTrimmed = line
    .replace(/\b(APT|UNIT|STE|SUITE|#)\b.*$/i, "")
    .trim();
  const match = unitTrimmed.match(/^(\d+)\s+(.+)$/);
  if (!match) {
    return null;
  }

  const streetNumber = match[1];
  const tokens = normalizeAddressToken(match[2]).split(" ").filter(Boolean);
  if (!tokens.length) {
    return null;
  }

  let direction: string | null = null;
  if (tokens.length > 1 && STREET_DIRECTIONS.has(tokens[tokens.length - 1])) {
    direction = tokens.pop() ?? null;
  } else if (tokens.length > 1 && STREET_DIRECTIONS.has(tokens[0])) {
    direction = tokens.shift() ?? null;
  }

  let suffix: string | null = null;
  if (tokens.length > 1 && STREET_SUFFIXES.has(tokens[tokens.length - 1])) {
    suffix = tokens.pop() ?? null;
  }

  const streetName = tokens.join(" ").trim();
  if (!streetName) {
    return null;
  }

  return {
    streetNumber,
    streetName,
    suffix,
    direction,
    zip: zipMatch?.[1] ?? null
  };
}

async function queryWrightParcelArcGisByPoint(args: {
  lat: number;
  lng: number;
  radiusMeters: number;
}): Promise<ParcelMatch[]> {
  const endpoint = new URL(WRIGHT_PARCEL_ARCGIS_QUERY_URL);
  endpoint.searchParams.set("f", "json");
  endpoint.searchParams.set("where", "1=1");
  endpoint.searchParams.set(
    "geometry",
    JSON.stringify({
      x: args.lng,
      y: args.lat,
      spatialReference: { wkid: 4326 }
    })
  );
  endpoint.searchParams.set("geometryType", "esriGeometryPoint");
  endpoint.searchParams.set("inSR", "4326");
  endpoint.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  endpoint.searchParams.set("distance", String(args.radiusMeters));
  endpoint.searchParams.set("units", "esriSRUnit_Meter");
  endpoint.searchParams.set("outFields", "PID,PHYSADDR,PHYSCITY,PHYSZIP,TPYEAR,OWNNAME");
  endpoint.searchParams.set("returnGeometry", "true");
  endpoint.searchParams.set("outSR", "4326");
  endpoint.searchParams.set("resultRecordCount", "50");

  const response = await fetchWithTimeout(endpoint.toString(), {
    method: "GET",
    cache: "no-store"
  }, { timeoutMs: 12000 });
  if (!response.ok) {
    throw new MetroProviderError({
      kind: "response_error",
      code: String(response.status),
      message: `Wright County parcel ArcGIS query responded with HTTP ${response.status}`
    });
  }

  const payload = (await response.json()) as WrightArcGisQueryResponse;
  const features = Array.isArray(payload.features) ? payload.features : [];
  const matches: ParcelMatch[] = [];

  for (const [index, feature] of features.entries()) {
    const attributes = feature.attributes ?? {};
    const geometry = feature.geometry ?? {};
    const parcelId = toNullableString(attributes.PID);
    if (!parcelId) {
      continue;
    }

    const addressLine = toNullableString(attributes.PHYSADDR);
    const city = toNullableString(attributes.PHYSCITY);
    const zipRaw = toNullableNumber(attributes.PHYSZIP);
    const zip = typeof zipRaw === "number" ? String(Math.trunc(zipRaw)) : null;
    const cityZip = [city, zip].filter(Boolean).join(" ");
    const situsAddress = addressLine
      ? cityZip
        ? `${addressLine}, ${cityZip}`
        : addressLine
      : null;

    const geometryX = toNullableNumber(geometry.x);
    const geometryY = toNullableNumber(geometry.y);
    const distanceMeters =
      typeof geometryX === "number" && typeof geometryY === "number"
        ? haversineMeters(args.lat, args.lng, geometryY, geometryX)
        : null;

    const taxYearRaw = toNullableNumber(attributes.TPYEAR);
    const taxYear =
      typeof taxYearRaw === "number" && taxYearRaw > 0
        ? Math.floor(taxYearRaw)
        : null;

    matches.push({
      parcelId,
      objectId: index + 1,
      situsAddress,
      annualPropertyTax: null,
      taxYear,
      distanceMeters,
      sourceUrl: endpoint.toString(),
      raw: {
        attributes,
        geometry,
        discovery_source: "wright_arcgis_point_query"
      }
    });
  }

  return matches;
}

function requiresDisclaimer(html: string, responseUrl: string): boolean {
  return /disclaimer\.aspx/i.test(responseUrl) || /\bbtagree\b/i.test(html);
}

async function loadWrightSearchPage(jar: ReturnType<typeof createCookieJar>): Promise<string> {
  const combinedSearchUrl = new URL(WRIGHT_SEARCH_PATH, WRIGHT_BASE_URL).toString();
  let responseResult = await fetchWithCookies(
    combinedSearchUrl,
    { method: "GET" },
    jar
  );
  let response = responseResult.response;
  let html = await response.text();

  if (!requiresDisclaimer(html, responseResult.finalUrl)) {
    return html;
  }

  const disclaimerUrl = new URL(WRIGHT_DISCLAIMER_PATH, WRIGHT_BASE_URL).toString();
  const disclaimerFields = extractHiddenInputs(html);
  const disclaimerBody = new URLSearchParams(disclaimerFields);
  disclaimerBody.set("btAgree", "Agree");
  if (!disclaimerBody.get("hdURL")) {
    disclaimerBody.set("hdURL", "/search/commonsearch.aspx?mode=combined");
  }

  await fetchWithCookies(
    disclaimerUrl,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: disclaimerBody.toString()
    },
    jar
  );

  responseResult = await fetchWithCookies(
    combinedSearchUrl,
    { method: "GET" },
    jar
  );
  response = responseResult.response;
  if (!response.ok) {
    throw new MetroProviderError({
      kind: "response_error",
      code: String(response.status),
      message: `Wright County address search page responded with HTTP ${response.status}`
    });
  }
  return response.text();
}

function parseWrightSearchResultRows(html: string): WrightSearchResultRow[] {
  const rows: WrightSearchResultRow[] = [];

  for (const rowMatch of html.matchAll(
    /<tr\b[^>]*onclick="javascript:selectSearchRow\('([^']+)'\)"[\s\S]*?<\/tr>/gi
  )) {
    const rowHtml = rowMatch[0];
    const relativeDataletPath = normalizeWhitespace(rowMatch[1].replace(/&amp;/g, "&"));
    const dataletUrl = relativeDataletPath
      ? new URL(relativeDataletPath, `${WRIGHT_BASE_URL}/`).toString()
      : null;

    const cells = Array.from(rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi))
      .map((cell) => stripTags(cell[1]))
      .map((cell) => normalizeWhitespace(cell));

    const parcelId = cells[1] || null;
    const taxpayer = cells[2] || null;
    const situsAddressLine = cells[3] || null;
    const city = cells[4] || null;
    const zip = cells[5] || null;

    const checkboxValueMatch = rowHtml.match(/value='[^:]*:([^:']+):(\d{4})'/i);
    const checkboxParcelId = checkboxValueMatch?.[1]?.trim() || null;
    const checkboxTaxYear = checkboxValueMatch?.[2]
      ? Number.parseInt(checkboxValueMatch[2], 10)
      : null;

    rows.push({
      parcelId: parcelId || checkboxParcelId,
      situsAddressLine,
      city,
      zip,
      taxpayer,
      dataletUrl,
      taxYear:
        typeof checkboxTaxYear === "number" && Number.isFinite(checkboxTaxYear)
          ? checkboxTaxYear
          : null,
      rowText: stripTags(rowHtml)
    });
  }

  return rows;
}

function buildWrightParcelMatches(rows: WrightSearchResultRow[]): ParcelMatch[] {
  return rows
    .filter((row) => row.parcelId && row.dataletUrl)
    .map((row, index) => {
      const cityZip = [row.city, row.zip].filter(Boolean).join(" ");
      const situsAddress = row.situsAddressLine
        ? cityZip
          ? `${row.situsAddressLine}, ${cityZip}`
          : row.situsAddressLine
        : null;

      return {
        parcelId: row.parcelId,
        objectId: index + 1,
        situsAddress,
        annualPropertyTax: null,
        taxYear: row.taxYear,
        distanceMeters: null,
        sourceUrl: row.dataletUrl as string,
        raw: {
          attributes: {
            COUNTY_PIN: row.parcelId,
            POSTCOMM: row.city,
            ZIP: row.zip,
            OWNER: row.taxpayer
          },
          datalet_url: row.dataletUrl,
          row_text: row.rowText
        }
      } satisfies ParcelMatch;
    });
}

function buildWrightDirectDataletMatch(args: {
  html: string;
  finalUrl: string;
  fallbackSitusAddress: string | null | undefined;
}): ParcelMatch | null {
  const hiddenFields = extractHiddenInputs(args.html);
  const parcelId = hiddenFields.hdPin || hiddenFields.hdXPin || null;
  const looksLikeDatalet =
    /datalet\.aspx/i.test(args.finalUrl) ||
    Boolean(hiddenFields.hdMode) ||
    Boolean(hiddenFields["DTLNavigator$hdRecCount"]);

  if (!parcelId || !looksLikeDatalet) {
    return null;
  }

  const taxYearValue = hiddenFields.hdTaxYear || hiddenFields.hdXTaxYr || null;
  const parsedTaxYear = taxYearValue ? Number.parseInt(taxYearValue, 10) : null;
  const taxYear =
    typeof parsedTaxYear === "number" && Number.isFinite(parsedTaxYear) && parsedTaxYear > 0
      ? parsedTaxYear
      : null;

  return {
    parcelId,
    objectId: 1,
    situsAddress: args.fallbackSitusAddress?.trim() || null,
    annualPropertyTax: null,
    taxYear,
    distanceMeters: null,
    sourceUrl: args.finalUrl,
    raw: {
      attributes: {
        COUNTY_PIN: parcelId,
        JURISDICTION: hiddenFields.hdJur || hiddenFields.hdXJur || null
      },
      datalet_url: args.finalUrl,
      discovery_source: "wright_direct_datalet_redirect"
    }
  };
}

function scoreWrightAddressMatch(parcel: ParcelMatch, request: CountyTaxProviderRequest): number {
  const requestAddress = parseWrightAddressParts(request.formattedAddress);
  const parcelAddress = parseWrightAddressParts(parcel.situsAddress);
  if (!requestAddress || !parcelAddress) {
    return 0;
  }

  let score = 0;
  if (requestAddress.streetNumber === parcelAddress.streetNumber) {
    score += 120;
  }
  if (requestAddress.zip && parcelAddress.zip && requestAddress.zip === parcelAddress.zip) {
    score += 24;
  }

  const requestStreet = normalizeAddressToken(requestAddress.streetName);
  const parcelStreet = normalizeAddressToken(parcelAddress.streetName);
  if (requestStreet === parcelStreet) {
    score += 80;
  } else {
    const overlap = requestStreet
      .split(" ")
      .filter((token) => token.length > 1 && parcelStreet.includes(token)).length;
    score += overlap * 12;
  }

  if (requestAddress.suffix && parcelAddress.suffix && requestAddress.suffix === parcelAddress.suffix) {
    score += 12;
  }
  if (
    requestAddress.direction &&
    parcelAddress.direction &&
    requestAddress.direction === parcelAddress.direction
  ) {
    score += 8;
  }

  return score;
}

function buildWrightAddressSearchStrategies(
  addressParts: WrightAddressParts
): WrightAddressSearchStrategy[] {
  const rawStrategies: Array<Record<string, string | null>> = [
    {
      inpNumber: addressParts.streetNumber,
      inpStreet: addressParts.streetName,
      inpSuffix: addressParts.suffix,
      inpDirection: addressParts.direction,
      inpZip: addressParts.zip
    },
    {
      inpNumber: addressParts.streetNumber
    },
    {
      inpStreet: addressParts.streetName,
      inpSuffix: addressParts.suffix,
      inpDirection: addressParts.direction,
      inpZip: addressParts.zip
    },
    {
      inpStreet: addressParts.streetName,
      inpZip: addressParts.zip
    }
  ];

  const strategies: WrightAddressSearchStrategy[] = [];
  const seen = new Set<string>();

  for (const rawStrategy of rawStrategies) {
    const fields = Object.fromEntries(
      Object.entries(rawStrategy).filter((entry): entry is [string, string] => {
        const value = entry[1];
        return typeof value === "string" && value.trim().length > 0;
      })
    );
    const key = JSON.stringify(fields);
    if (!key || seen.has(key) || Object.keys(fields).length === 0) {
      continue;
    }

    seen.add(key);
    strategies.push({ fields });
  }

  return strategies;
}

async function executeWrightAddressSearch(args: {
  jar: ReturnType<typeof createCookieJar>;
  formFields: Record<string, string>;
  searchFields: Record<string, string>;
  fallbackSitusAddress: string | null | undefined;
}): Promise<{ matches: ParcelMatch[]; nextFormFields: Record<string, string> }> {
  const body = new URLSearchParams(args.formFields);

  body.set("mode", "COMBINED");
  body.set("hdAction", "Search");
  body.set("btSearch", "Search");
  body.set("selSortBy", "FULLADD");
  body.set("SortBy", "FULLADD");
  body.set("selSortDir", " asc");
  body.set("SortDir", " asc");
  body.set("selPageSize", WRIGHT_SEARCH_PAGE_SIZE);
  body.set("PageSize", WRIGHT_SEARCH_PAGE_SIZE);

  body.set("inpParid", "");
  body.set("inpNumber", "");
  body.set("inpStreet", "");
  body.set("inpSuffix", "");
  body.set("inpDirection", "");
  body.set("inpZip", "");

  for (const [key, value] of Object.entries(args.searchFields)) {
    body.set(key, value);
  }

  const searchUrl = new URL(WRIGHT_SEARCH_PATH, WRIGHT_BASE_URL).toString();
  const responseResult = await fetchWithCookies(
    searchUrl,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: body.toString()
    },
    args.jar
  );
  const response = responseResult.response;

  if (!response.ok) {
    throw new MetroProviderError({
      kind: "response_error",
      code: String(response.status),
      message: `Wright County search responded with HTTP ${response.status}`
    });
  }

  const resultsHtml = await response.text();
  const directDataletMatch = buildWrightDirectDataletMatch({
    html: resultsHtml,
    finalUrl: responseResult.finalUrl,
    fallbackSitusAddress: args.fallbackSitusAddress
  });
  if (directDataletMatch) {
    return {
      matches: [directDataletMatch],
      nextFormFields: args.formFields
    };
  }

  const rows = parseWrightSearchResultRows(resultsHtml);
  const nextFormFields = extractHiddenInputs(resultsHtml);

  return {
    matches: buildWrightParcelMatches(rows),
    nextFormFields:
      Object.keys(nextFormFields).length > 0 ? nextFormFields : args.formFields
  };
}

function extractWrightParcelQuery(parcel: ParcelMatch): string | null {
  const candidates = getParcelLookupCandidates(parcel);
  for (const candidate of candidates) {
    const compact = candidate.replace(/[^A-Za-z0-9]/g, "");
    if (compact.length >= 8) {
      return compact;
    }
  }

  return null;
}

export function parseWrightTaxDataletHtml(
  html: string
): WrightTaxDataletParseResult {
  const text = stripTags(html);
  const payYearMatch = text.match(/Pay Year:\s*(20\d{2})/i);
  const payYear = payYearMatch ? Number.parseInt(payYearMatch[1], 10) : null;

  const totalTaxIncludingSpecialsMatch = text.match(
    /Total Tax In(?:cluding|cuding) Specials:\s*\$?\s*([0-9,]+\.\d{2})/i
  );
  const totalTaxIncludingSpecials = parseCurrency(
    totalTaxIncludingSpecialsMatch?.[1]
  );

  if (
    typeof payYear === "number" &&
    Number.isFinite(payYear) &&
    payYear > 0 &&
    typeof totalTaxIncludingSpecials === "number" &&
    Number.isFinite(totalTaxIncludingSpecials)
  ) {
    return {
      latestTaxYear: payYear,
      totalPayable: totalTaxIncludingSpecials,
      evidenceLine: totalTaxIncludingSpecialsMatch?.[0] ?? null,
      extractionMethod: "tax_statement_total"
    };
  }

  const rowCandidates: Array<{
    year: number;
    amount: number;
    rowText: string;
  }> = [];

  for (const rowMatch of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rowText = stripTags(rowMatch[1]);
    const yearMatch = rowText.match(/\b(20\d{2})\b/);
    if (!yearMatch) {
      continue;
    }

    const year = Number.parseInt(yearMatch[1], 10);
    if (!Number.isFinite(year) || year <= 0) {
      continue;
    }

    const amountMatches = Array.from(
      rowText.matchAll(/([0-9]{1,3}(?:,[0-9]{3})*(?:\.\d{2}))/g)
    )
      .map((match) => parseCurrency(match[1]))
      .filter((amount): amount is number => typeof amount === "number");
    if (!amountMatches.length) {
      continue;
    }

    rowCandidates.push({
      year,
      amount: amountMatches[amountMatches.length - 1],
      rowText
    });
  }

  const selected = rowCandidates.sort((left, right) => {
    if (right.year !== left.year) {
      return right.year - left.year;
    }
    return right.amount - left.amount;
  })[0];

  if (!selected) {
    return {
      latestTaxYear: null,
      totalPayable: null,
      evidenceLine: null,
      extractionMethod: "unknown"
    };
  }

  return {
    latestTaxYear: selected.year,
    totalPayable: selected.amount,
    evidenceLine: selected.rowText,
    extractionMethod: "payment_history_row"
  };
}

async function searchWrightByAddress(
  request: CountyTaxProviderRequest
): Promise<ParcelMatch[]> {
  const addressParts = parseWrightAddressParts(request.formattedAddress);
  if (!addressParts) {
    return [];
  }

  const jar = createCookieJar();
  const searchPageHtml = await loadWrightSearchPage(jar);
  let formFields = extractHiddenInputs(searchPageHtml);
  const strategies = buildWrightAddressSearchStrategies(addressParts);

  const exactStrategy = strategies[0];
  if (exactStrategy) {
    const exactSearch = await executeWrightAddressSearch({
      jar,
      formFields,
      searchFields: exactStrategy.fields,
      fallbackSitusAddress: request.formattedAddress
    });
    if (exactSearch.matches.length > 0) {
      return exactSearch.matches;
    }
    formFields = exactSearch.nextFormFields;
  }

  const byParcel = new Map<string, ParcelMatch>();
  for (const strategy of strategies.slice(1)) {
    const searchResult = await executeWrightAddressSearch({
      jar,
      formFields,
      searchFields: strategy.fields,
      fallbackSitusAddress: request.formattedAddress
    });
    formFields = searchResult.nextFormFields;

    for (const match of searchResult.matches) {
      const key = match.parcelId || `${match.objectId}`;
      if (!key || byParcel.has(key)) {
        continue;
      }
      byParcel.set(key, match);
    }
  }

  return Array.from(byParcel.values());
}

async function searchWrightByLocation(
  request: CountyTaxProviderRequest
): Promise<ParcelMatch[]> {
  if (
    typeof request.lat !== "number" ||
    !Number.isFinite(request.lat) ||
    typeof request.lng !== "number" ||
    !Number.isFinite(request.lng)
  ) {
    return [];
  }

  const byParcel = new Map<string, ParcelMatch>();
  for (const radiusMeters of WRIGHT_ARCGIS_SEARCH_RADII_METERS) {
    const matches = await queryWrightParcelArcGisByPoint({
      lat: request.lat,
      lng: request.lng,
      radiusMeters
    });
    for (const match of matches) {
      const key = match.parcelId || `${match.objectId}`;
      if (!key || byParcel.has(key)) {
        continue;
      }
      byParcel.set(key, match);
    }

    if (byParcel.size > 0) {
      break;
    }
  }

  return Array.from(byParcel.values());
}

async function fetchWrightTaxObservation(args: {
  parcel: ParcelMatch;
  requestTaxYear: number;
}): Promise<CountyTaxObservation | null> {
  const parcelQuery = extractWrightParcelQuery(args.parcel);
  if (!parcelQuery) {
    return null;
  }

  const datalet = await fetchPublicAccessDataletHtml({
    baseUrl: WRIGHT_BASE_URL,
    parcelQuery,
    preferredModes: ["tax_statement_1", "tax_collection", "tax_statement_link"],
    modeOverride: "tax_statement_1"
  });

  if (!datalet) {
    throw new MetroProviderError({
      kind: "response_error",
      message: "Wright County response did not include a tax datalet result.",
      code: null
    });
  }

  const parsed = parseWrightTaxDataletHtml(datalet.dataletHtml);
  if (
    typeof parsed.latestTaxYear !== "number" ||
    !Number.isFinite(parsed.latestTaxYear) ||
    parsed.latestTaxYear <= 0 ||
    typeof parsed.totalPayable !== "number" ||
    !Number.isFinite(parsed.totalPayable) ||
    parsed.totalPayable < 0
  ) {
    throw new MetroProviderError({
      kind: "parse_error",
      message: "Wright County tax datalet did not contain a parseable annual tax amount.",
      code: null
    });
  }

  const yearMatched = parsed.latestTaxYear === args.requestTaxYear;

  return {
    county: "Wright",
    parcel_id: parcelQuery,
    tax_year: parsed.latestTaxYear,
    annual_property_tax: parsed.totalPayable,
    source_kind: "county_page",
    source_name: "Wright County Property Tax Search",
    source_url: datalet.dataletUrl,
    raw_evidence: {
      parcel_query: parcelQuery,
      parsed_latest_tax_year: parsed.latestTaxYear,
      parsed_total_payable: parsed.totalPayable,
      parsed_evidence_line: parsed.evidenceLine,
      extraction_method: parsed.extractionMethod
    },
    retrieval_notes: [
      "Parcel discovered using Wright County property search results.",
      `Wright County tax page returned ${parsed.latestTaxYear} annual tax ${parsed.totalPayable.toFixed(
        2
      )}.`,
      yearMatched
        ? `Requested tax year ${args.requestTaxYear} matched county tax year ${parsed.latestTaxYear}.`
        : `Requested tax year ${args.requestTaxYear}; county page latest available year is ${parsed.latestTaxYear}.`
    ],
    matched_address: args.parcel.situsAddress,
    confidence_inputs: {
      confidence: yearMatched ? "high" : "medium",
      authoritative_source_used: true,
      county_source_url: datalet.dataletUrl
    }
  };
}

export const wrightCountyTaxProvider: CountyTaxProvider = {
  county: "Wright",
  providerKey: "mn-wright-authoritative-tax-provider-v1",
  sourceName: "Wright County Property Tax Search",
  sourceRootUrl: WRIGHT_BASE_URL,
  canHandle: (county) =>
    normalizeCountyName(county)?.toUpperCase() === "WRIGHT",
  async searchProperty(request) {
    let locationSearchError: unknown = null;

    try {
      const locationMatches = await searchWrightByLocation(request);
      if (locationMatches.length > 0) {
        return locationMatches;
      }
    } catch (error) {
      locationSearchError = error;
    }

    try {
      return await searchWrightByAddress(request);
    } catch (error) {
      const failure = classifyMetroProviderFailure(error ?? locationSearchError);
      throw new MetroProviderError({
        kind:
          failure.kind === "tls_certificate_validation"
            ? "tls_certificate_validation"
            : failure.kind === "response_error"
              ? "response_error"
              : "network_error",
        code: failure.code,
        message: `County request failed for Wright: ${failure.message}`,
        cause: error ?? locationSearchError
      });
    }
  },
  chooseBestParcel(matches, request) {
    const ranked = [...matches].sort((left, right) => {
      const scoreDelta =
        scoreWrightAddressMatch(right, request) -
        scoreWrightAddressMatch(left, request);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }

      const leftAddress = left.situsAddress || "";
      const rightAddress = right.situsAddress || "";
      return leftAddress.localeCompare(rightAddress);
    });

    return ranked[0] ?? null;
  },
  async fetchTaxObservation(parcel, request) {
    try {
      return await fetchWrightTaxObservation({
        parcel,
        requestTaxYear: request.taxYear
      });
    } catch (error) {
      const failure = classifyMetroProviderFailure(error);
      if (failure.kind === "response_error" || failure.kind === "parse_error") {
        throw new MetroProviderError({
          kind: failure.kind,
          code: failure.code,
          message: failure.message,
          cause: error
        });
      }

      throw new MetroProviderError({
        kind:
          failure.kind === "tls_certificate_validation"
            ? "tls_certificate_validation"
            : "network_error",
        code: failure.code,
        message: `County request failed for Wright: ${failure.message}`,
        cause: error
      });
    }
  }
};
