import { CountyTaxObservation, CountyTaxProvider, ParcelMatch } from "../../types";
import { createMetroArcGisCountyProvider } from "./arcGisProvider";
import {
  getParcelLookupCandidates,
  normalizeParcelId,
  parseCurrency,
  stripTags
} from "./authoritativeCountyUtils";
import { MetroProviderError, classifyMetroProviderFailure } from "./providerError";
import { fetchWithTimeout } from "../../../server/fetch-timeout";

const RAMSEY_BEACON_BASE_URL = "https://beacon.schneidercorp.com/Application.aspx";
const RAMSEY_BEACON_SEARCH_REFERER =
  "https://beacon.schneidercorp.com/application.aspx?app=RamseyCountyMN&PageType=Search";
const RAMSEY_BEACON_APP_ID = "959";
const RAMSEY_BEACON_LAYER_ID = "18852";
const RAMSEY_BEACON_PAGE_TYPE_ID = "4";
const RAMSEY_BEACON_PAGE_ID = "8397";
const RAMSEY_EGOV_BASE_URL = "https://ramsey.egovpayments.com/egov/apps/bill/pay.egov";
const RAMSEY_EGOV_ITEM_ID = "30";
const RAMSEY_COUNTY_API_BASE_URL =
  "https://maps.co.ramsey.mn.us/arcgis/rest/services/ParcelData/AttributedData/MapServer/0";
const RAMSEY_SEARCH_RADII_METERS = [80, 150, 250];
const RAMSEY_COUNTY_API_FIELDS = "ParcelID,TaxYear,TotalTax,SiteAddress,SiteCityNameUSPS,SiteZIP5";

type RamseyCountyApiResponse = {
  features?: Array<{
    attributes?: Record<string, unknown>;
  }>;
  error?: {
    code?: number;
    message?: string;
    details?: string[];
  };
};

const STREET_NORMALIZATION_MAP: Record<string, string> = {
  STREET: "ST",
  AVENUE: "AVE",
  DRIVE: "DR",
  ROAD: "RD",
  LANE: "LN",
  COURT: "CT",
  PLACE: "PL",
  BOULEVARD: "BLVD",
  CIRCLE: "CIR",
  TERRACE: "TER",
  PARKWAY: "PKWY",
  NORTH: "N",
  SOUTH: "S",
  EAST: "E",
  WEST: "W"
};

const STREET_SUFFIXES = new Set([
  "ST",
  "AVE",
  "DR",
  "RD",
  "LN",
  "CT",
  "PL",
  "BLVD",
  "CIR",
  "TER",
  "PKWY",
  "WAY",
  "TRL"
]);

const CARDINAL_DIRECTIONS = new Set(["N", "S", "E", "W"]);

export function normalizeRamseyParcelId(parcelId: string | null | undefined): string | null {
  const normalized = normalizeParcelId(parcelId);
  if (normalized.digits && normalized.digits.length >= 10) {
    return normalized.digits;
  }

  return normalized.compact;
}

export function isCloudflareChallengeResponse(response: Response, html: string): boolean {
  const cfMitigated = response.headers.get("cf-mitigated");
  if (cfMitigated) {
    return true;
  }

  return /Just a moment/i.test(html) || /__cf_chl_opt/i.test(html);
}

export function parseRamseyTaxFromHtml(html: string): {
  latestTaxYear: number | null;
  totalPayable: number | null;
  evidence: string | null;
} {
  const text = stripTags(html);

  const yearMatches = Array.from(text.matchAll(/\b(?:Payable\s+)?(20\d{2})\b/gi))
    .map((match) => Number.parseInt(match[1], 10))
    .filter((year) => Number.isFinite(year));
  const latestTaxYear = yearMatches.sort((left, right) => right - left)[0] ?? null;

  const priorityPatterns = [
    /(Total\s+payable[^$]*\$[0-9,]+\.\d{2})/i,
    /(Total\s+due[^$]*\$[0-9,]+\.\d{2})/i,
    /(Total\s+tax(?:es)?[^$]*\$[0-9,]+\.\d{2})/i
  ];

  for (const pattern of priorityPatterns) {
    const match = text.match(pattern);
    if (!match) {
      continue;
    }

    const amountMatch = match[0].match(/\$([0-9,]+\.\d{2})/);
    const amount = parseCurrency(amountMatch?.[1]);
    if (typeof amount === "number") {
      return {
        latestTaxYear,
        totalPayable: amount,
        evidence: match[0]
      };
    }
  }

  const genericAmountMatch = text.match(/\$([0-9,]+\.\d{2})/);
  return {
    latestTaxYear,
    totalPayable: parseCurrency(genericAmountMatch?.[1]),
    evidence: genericAmountMatch?.[0] ?? null
  };
}

export function parseRamseyEgovTaxFromHtml(html: string): {
  latestTaxYear: number | null;
  totalPayable: number | null;
  evidence: string | null;
} {
  const text = stripTags(html);

  const payableYearMatches = Array.from(text.matchAll(/\b(20\d{2})\s+Payable\b/gi))
    .map((match) => Number.parseInt(match[1], 10))
    .filter((year) => Number.isFinite(year));
  const latestPayableYear = payableYearMatches.sort((left, right) => right - left)[0] ?? null;

  const currentYearHintMatch = text.match(/Current\s+Year\s+Taxes[\s\S]{0,240}\b(20\d{2})\b/i);
  const currentYearHint = currentYearHintMatch
    ? Number.parseInt(currentYearHintMatch[1], 10)
    : null;

  const latestTaxYear = latestPayableYear ?? currentYearHint ?? null;

  const totalDueMatch =
    text.match(/Total\s+Amount\s+Due:\s*\$([0-9,]+\.\d{2})/i) ||
    text.match(/Total\s+Due[^$]*\$([0-9,]+\.\d{2})/i);
  const totalPayable = parseCurrency(totalDueMatch?.[1]);

  return {
    latestTaxYear,
    totalPayable,
    evidence: totalDueMatch?.[0] ?? null
  };
}

function extractRamseyParcelQuery(parcel: ParcelMatch): string | null {
  const candidates = getParcelLookupCandidates(parcel);
  for (const candidate of candidates) {
    const normalized = normalizeRamseyParcelId(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function extractRamseyParcelQueries(parcel: ParcelMatch): string[] {
  const candidates = getParcelLookupCandidates(parcel);
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const normalized = normalizeRamseyParcelId(candidate);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
  }

  return Array.from(seen.values());
}

function normalizeSiteAddress(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const line = value.split(",")[0]?.trim() || "";
  if (!line) {
    return null;
  }

  const normalized = line
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((part) => STREET_NORMALIZATION_MAP[part] || part)
    .join(" ");

  return normalized || null;
}

type StructuredStreetQuery = {
  buildingNumber: string;
  streetName: string;
  streetSuffixType: string | null;
  streetSuffixDirection: string | null;
};

function parseStructuredStreetQuery(
  value: string | null | undefined
): StructuredStreetQuery | null {
  if (!value) {
    return null;
  }

  const line = normalizeSiteAddress(value);
  if (!line) {
    return null;
  }

  const unitTrimmed = line
    .replace(/\b(APT|UNIT|STE|SUITE|#)\b.*$/i, "")
    .trim();
  const match = unitTrimmed.match(/^(\d+)\s+(.+)$/);
  if (!match) {
    return null;
  }

  const buildingNumber = match[1];
  const tokens = match[2].split(" ").filter(Boolean);
  if (!tokens.length) {
    return null;
  }

  let suffixDirection: string | null = null;
  if (tokens.length > 1 && CARDINAL_DIRECTIONS.has(tokens[tokens.length - 1])) {
    suffixDirection = tokens.pop() || null;
  }

  let suffixType: string | null = null;
  if (tokens.length > 1 && STREET_SUFFIXES.has(tokens[tokens.length - 1])) {
    suffixType = tokens.pop() || null;
  }

  const streetName = tokens.join(" ").trim();
  if (!streetName) {
    return null;
  }

  return {
    buildingNumber,
    streetName,
    streetSuffixType: suffixType,
    streetSuffixDirection: suffixDirection
  };
}

function getParcelCentroid(parcel: ParcelMatch): { lat: number; lng: number } | null {
  const rawGeometry = (parcel.raw.geometry || {}) as Record<string, unknown>;
  const x = asFiniteNumber(rawGeometry.x);
  const y = asFiniteNumber(rawGeometry.y);
  if (
    typeof x !== "number" ||
    !Number.isFinite(x) ||
    typeof y !== "number" ||
    !Number.isFinite(y)
  ) {
    return null;
  }

  return {
    lat: y,
    lng: x
  };
}

function asFiniteNumber(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return numeric;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseRamseyApiRecord(attributes: Record<string, unknown>): {
  parcelId: string | null;
  taxYear: number | null;
  totalTax: number | null;
  matchedAddress: string | null;
} {
  const parcelId = normalizeRamseyParcelId(asNonEmptyString(attributes.ParcelID));
  const taxYearRaw = asFiniteNumber(attributes.TaxYear);
  const totalTaxRaw = asFiniteNumber(attributes.TotalTax);
  const taxYear =
    typeof taxYearRaw === "number" && taxYearRaw > 0
      ? Math.floor(taxYearRaw)
      : null;
  const totalTax =
    typeof totalTaxRaw === "number" && totalTaxRaw >= 0
      ? Math.round((totalTaxRaw + Number.EPSILON) * 100) / 100
      : null;

  const siteAddress = asNonEmptyString(attributes.SiteAddress);
  const siteCity = asNonEmptyString(attributes.SiteCityNameUSPS);
  const siteZip = asNonEmptyString(attributes.SiteZIP5);
  const cityZip = [siteCity, siteZip].filter(Boolean).join(" ");
  const matchedAddress = siteAddress
    ? cityZip
      ? `${siteAddress}, ${cityZip}`
      : siteAddress
    : null;

  return {
    parcelId,
    taxYear,
    totalTax,
    matchedAddress
  };
}

function hasDefensibleTaxRecord(record: {
  taxYear: number | null;
  totalTax: number | null;
}): record is {
  taxYear: number;
  totalTax: number;
} {
  return (
    typeof record.taxYear === "number" &&
    Number.isFinite(record.taxYear) &&
    record.taxYear > 0 &&
    typeof record.totalTax === "number" &&
    Number.isFinite(record.totalTax)
  );
}

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

async function fetchRamseyCountyApi(params: {
  where?: string;
  lat?: number | null;
  lng?: number | null;
  radiusMeters?: number;
}): Promise<{
  records: Array<{
    parcelId: string | null;
    taxYear: number | null;
    totalTax: number | null;
    matchedAddress: string | null;
    rawAttributes: Record<string, unknown>;
  }>;
  sourceUrl: string;
}> {
  const endpoint = new URL(`${RAMSEY_COUNTY_API_BASE_URL}/query`);
  endpoint.searchParams.set("f", "json");
  endpoint.searchParams.set("outFields", RAMSEY_COUNTY_API_FIELDS);
  endpoint.searchParams.set("returnGeometry", "false");
  endpoint.searchParams.set("resultRecordCount", "20");

  if (params.where) {
    endpoint.searchParams.set("where", params.where);
  } else {
    endpoint.searchParams.set("where", "1=1");
  }

  if (
    typeof params.lat === "number" &&
    Number.isFinite(params.lat) &&
    typeof params.lng === "number" &&
    Number.isFinite(params.lng)
  ) {
    endpoint.searchParams.set(
      "geometry",
      JSON.stringify({
        x: params.lng,
        y: params.lat,
        spatialReference: { wkid: 4326 }
      })
    );
    endpoint.searchParams.set("geometryType", "esriGeometryPoint");
    endpoint.searchParams.set("inSR", "4326");
    endpoint.searchParams.set("spatialRel", "esriSpatialRelIntersects");
    endpoint.searchParams.set("distance", String(params.radiusMeters ?? 100));
    endpoint.searchParams.set("units", "esriSRUnit_Meter");
    endpoint.searchParams.set("outSR", "4326");
  }

  const sourceUrl = endpoint.toString();

  let response: Response;
  try {
    response = await fetchWithTimeout(sourceUrl, {
      method: "GET",
      cache: "no-store"
    }, { timeoutMs: 12000 });
  } catch (error) {
    const failure = classifyMetroProviderFailure(error);
    throw new MetroProviderError({
      kind: failure.kind,
      code: failure.code,
      message: `Ramsey county API request failed: ${failure.message}`,
      cause: error
    });
  }

  if (!response.ok) {
    throw new MetroProviderError({
      kind: "response_error",
      code: String(response.status),
      message: `Ramsey county API responded with HTTP ${response.status}`
    });
  }

  let payload: RamseyCountyApiResponse;
  try {
    payload = (await response.json()) as RamseyCountyApiResponse;
  } catch (error) {
    throw new MetroProviderError({
      kind: "parse_error",
      message: "Ramsey county API returned invalid JSON payload.",
      cause: error
    });
  }

  if (payload.error) {
    throw new MetroProviderError({
      kind: "response_error",
      code: payload.error.code ? String(payload.error.code) : null,
      message: payload.error.message || "Ramsey county API returned an error."
    });
  }

  const records = (payload.features || [])
    .map((feature) => {
      const attributes = feature.attributes || {};
      const parsed = parseRamseyApiRecord(attributes);
      return {
        ...parsed,
        rawAttributes: attributes
      };
    })
    .filter((record) => record.parcelId || record.totalTax !== null);

  return {
    records,
    sourceUrl
  };
}

async function fetchRamseyBeaconFallback(parcelQuery: string): Promise<{
  latestTaxYear: number;
  totalPayable: number;
  evidence: string | null;
  sourceUrl: string;
} | null> {
  const sourceUrl = new URL(RAMSEY_BEACON_BASE_URL);
  sourceUrl.searchParams.set("AppID", RAMSEY_BEACON_APP_ID);
  sourceUrl.searchParams.set("LayerID", RAMSEY_BEACON_LAYER_ID);
  sourceUrl.searchParams.set("PageTypeID", RAMSEY_BEACON_PAGE_TYPE_ID);
  sourceUrl.searchParams.set("PageID", RAMSEY_BEACON_PAGE_ID);
  sourceUrl.searchParams.set("KeyValue", parcelQuery);

  let response: Response;
  try {
    response = await fetchWithTimeout(sourceUrl.toString(), {
      method: "GET",
      cache: "no-store",
      headers: {
        // Ramsey Beacon frequently returns HTTP 403 challenge responses for
        // undici defaults, so we send browser-like headers.
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": RAMSEY_BEACON_SEARCH_REFERER,
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      }
    }, { timeoutMs: 12000 });
  } catch (error) {
    const failure = classifyMetroProviderFailure(error);
    throw new MetroProviderError({
      kind: failure.kind,
      code: failure.code,
      message: `Ramsey Beacon request failed: ${failure.message}`,
      cause: error
    });
  }

  if (!response.ok) {
    throw new MetroProviderError({
      kind: "response_error",
      code: String(response.status),
      message: `Ramsey Beacon responded with HTTP ${response.status}`
    });
  }

  const html = await response.text();
  if (isCloudflareChallengeResponse(response, html)) {
    throw new MetroProviderError({
      kind: "response_error",
      code: "CLOUDFLARE_CHALLENGE",
      message: "Ramsey Beacon returned a Cloudflare challenge page."
    });
  }

  const parsed = parseRamseyTaxFromHtml(html);
  if (
    typeof parsed.latestTaxYear !== "number" ||
    !Number.isFinite(parsed.latestTaxYear) ||
    parsed.latestTaxYear <= 0 ||
    typeof parsed.totalPayable !== "number" ||
    !Number.isFinite(parsed.totalPayable)
  ) {
    return null;
  }

  return {
    latestTaxYear: parsed.latestTaxYear,
    totalPayable: parsed.totalPayable,
    evidence: parsed.evidence,
    sourceUrl: sourceUrl.toString()
  };
}

async function fetchRamseyEgovCurrentTax(parcelQuery: string): Promise<{
  latestTaxYear: number;
  totalPayable: number;
  evidence: string | null;
  sourceUrl: string;
} | null> {
  const sourceUrl = new URL(RAMSEY_EGOV_BASE_URL);
  sourceUrl.searchParams.set("view", "search");
  sourceUrl.searchParams.set("itemid", RAMSEY_EGOV_ITEM_ID);
  sourceUrl.searchParams.set("account", parcelQuery);

  let response: Response;
  try {
    response = await fetchWithTimeout(sourceUrl.toString(), {
      method: "GET",
      cache: "no-store",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      }
    }, { timeoutMs: 12000 });
  } catch (error) {
    const failure = classifyMetroProviderFailure(error);
    throw new MetroProviderError({
      kind: failure.kind,
      code: failure.code,
      message: `Ramsey eGov request failed: ${failure.message}`,
      cause: error
    });
  }

  if (!response.ok) {
    throw new MetroProviderError({
      kind: "response_error",
      code: String(response.status),
      message: `Ramsey eGov responded with HTTP ${response.status}`
    });
  }

  const html = await response.text();
  const parsed = parseRamseyEgovTaxFromHtml(html);
  if (
    typeof parsed.latestTaxYear !== "number" ||
    !Number.isFinite(parsed.latestTaxYear) ||
    parsed.latestTaxYear <= 0 ||
    typeof parsed.totalPayable !== "number" ||
    !Number.isFinite(parsed.totalPayable)
  ) {
    return null;
  }

  return {
    latestTaxYear: parsed.latestTaxYear,
    totalPayable: parsed.totalPayable,
    evidence: parsed.evidence,
    sourceUrl: sourceUrl.toString()
  };
}

async function fetchRamseyTaxObservation(args: {
  parcel: ParcelMatch;
  requestTaxYear: number;
  requestFormattedAddress: string | null;
  requestLat: number | null;
  requestLng: number | null;
}): Promise<CountyTaxObservation | null> {
  const parcelQueries = extractRamseyParcelQueries(args.parcel);
  const parcelQuery = extractRamseyParcelQuery(args.parcel);

  if (parcelQuery) {
    const egovResult = await fetchRamseyEgovCurrentTax(parcelQuery);
    if (egovResult) {
      const yearMatched = egovResult.latestTaxYear === args.requestTaxYear;
      return {
        county: "Ramsey",
        parcel_id: parcelQuery,
        tax_year: egovResult.latestTaxYear,
        annual_property_tax: egovResult.totalPayable,
        source_kind: "official_county",
        source_name: "Ramsey County eGov Property Tax Search",
        source_url: egovResult.sourceUrl,
        raw_evidence: {
          lookup_mode: "ramsey_egov_current_tax",
          parcel_query: parcelQuery,
          parsed_latest_tax_year: egovResult.latestTaxYear,
          parsed_total_payable: egovResult.totalPayable,
          parsed_evidence: egovResult.evidence
        },
        retrieval_notes: [
          "Parcel discovered using MetroGIS parcel layer, then verified against Ramsey County property tax payment records.",
          `Ramsey source returned ${egovResult.latestTaxYear} annual tax ${egovResult.totalPayable.toFixed(2)}.`,
          yearMatched
            ? `Requested tax year ${args.requestTaxYear} matched county tax year ${egovResult.latestTaxYear}.`
            : `Requested tax year ${args.requestTaxYear}; county source latest available year is ${egovResult.latestTaxYear}.`
        ],
        matched_address: args.parcel.situsAddress,
        confidence_inputs: {
          confidence: yearMatched ? "high" : "medium",
          authoritative_source_used: true
        }
      };
    }
  }

  for (const candidate of parcelQueries) {
    const where = `ParcelID='${escapeSqlLiteral(candidate)}'`;
    const byParcel = await fetchRamseyCountyApi({ where });
    const record = byParcel.records.find(
      (item) =>
        normalizeRamseyParcelId(item.parcelId) === normalizeRamseyParcelId(candidate)
    );

    if (record && hasDefensibleTaxRecord(record)) {
      const yearMatched = record.taxYear === args.requestTaxYear;
      return {
        county: "Ramsey",
        parcel_id: record.parcelId ?? candidate,
        tax_year: record.taxYear,
        annual_property_tax: record.totalTax,
        source_kind: "county_api",
        source_name: "Ramsey County ParcelData AttributedData API",
        source_url: byParcel.sourceUrl,
        raw_evidence: {
          lookup_mode: "parcel_id",
          parcel_query: candidate,
          parsed_latest_tax_year: record.taxYear,
          parsed_total_payable: record.totalTax
        },
        retrieval_notes: [
          "Parcel discovered using MetroGIS parcel layer, then verified against Ramsey County API data.",
          `Ramsey source returned ${record.taxYear} annual tax ${record.totalTax.toFixed(2)}.`,
          yearMatched
            ? `Requested tax year ${args.requestTaxYear} matched county tax year ${record.taxYear}.`
            : `Requested tax year ${args.requestTaxYear}; county source latest available year is ${record.taxYear}.`
        ],
        matched_address: record.matchedAddress || args.parcel.situsAddress,
        confidence_inputs: {
          confidence: yearMatched ? "high" : "medium",
          authoritative_source_used: true
        }
      };
    }
  }

  const centroid = getParcelCentroid(args.parcel);
  const geometryCandidates: Array<{ lat: number; lng: number; source: string }> = [];
  if (centroid) {
    geometryCandidates.push({ ...centroid, source: "metrogis_parcel_centroid" });
  }
  if (
    typeof args.requestLat === "number" &&
    Number.isFinite(args.requestLat) &&
    typeof args.requestLng === "number" &&
    Number.isFinite(args.requestLng)
  ) {
    const alreadyAdded = geometryCandidates.some(
      (candidate) =>
        Math.abs(candidate.lat - args.requestLat!) < 0.000001 &&
        Math.abs(candidate.lng - args.requestLng!) < 0.000001
    );
    if (!alreadyAdded) {
      geometryCandidates.push({
        lat: args.requestLat,
        lng: args.requestLng,
        source: "request_coordinates"
      });
    }
  }

  for (const geometryCandidate of geometryCandidates) {
    for (const radiusMeters of RAMSEY_SEARCH_RADII_METERS) {
      const nearby = await fetchRamseyCountyApi({
        lat: geometryCandidate.lat,
        lng: geometryCandidate.lng,
        radiusMeters
      });

      const record = nearby.records.find((item) => hasDefensibleTaxRecord(item));

      if (!record) {
        continue;
      }

      const yearMatched = record.taxYear === args.requestTaxYear;
      return {
        county: "Ramsey",
        parcel_id: record.parcelId ?? parcelQuery,
        tax_year: record.taxYear,
        annual_property_tax: record.totalTax,
        source_kind: "county_api",
        source_name: "Ramsey County ParcelData AttributedData API",
        source_url: nearby.sourceUrl,
        raw_evidence: {
          lookup_mode: "geometry",
          geometry_source: geometryCandidate.source,
          search_radius_meters: radiusMeters,
          parcel_query: parcelQuery,
          parsed_latest_tax_year: record.taxYear,
          parsed_total_payable: record.totalTax
        },
        retrieval_notes: [
          "Parcel discovered using MetroGIS parcel layer, then verified against Ramsey County API data.",
          `Ramsey source returned ${record.taxYear} annual tax ${record.totalTax.toFixed(2)}.`,
          yearMatched
            ? `Requested tax year ${args.requestTaxYear} matched county tax year ${record.taxYear}.`
            : `Requested tax year ${args.requestTaxYear}; county source latest available year is ${record.taxYear}.`
        ],
        matched_address: record.matchedAddress || args.parcel.situsAddress,
        confidence_inputs: {
          confidence: yearMatched ? "high" : "medium",
          authoritative_source_used: true
        }
      };
    }
  }

  const siteAddressCandidates = new Set<string>();
  const parsedRequestLine = normalizeSiteAddress(args.requestFormattedAddress);
  const parsedSitusLine = normalizeSiteAddress(args.parcel.situsAddress);
  if (parsedRequestLine) {
    siteAddressCandidates.add(parsedRequestLine);
  }
  if (parsedSitusLine) {
    siteAddressCandidates.add(parsedSitusLine);
  }

  for (const siteAddressLine of siteAddressCandidates) {
    const where = `SiteAddress='${escapeSqlLiteral(siteAddressLine)}'`;
    const byAddress = await fetchRamseyCountyApi({ where });
    const record = byAddress.records.find((item) => hasDefensibleTaxRecord(item));
    if (!record) {
      continue;
    }

    const yearMatched = record.taxYear === args.requestTaxYear;
    return {
      county: "Ramsey",
      parcel_id: record.parcelId ?? parcelQuery,
      tax_year: record.taxYear,
      annual_property_tax: record.totalTax,
      source_kind: "county_api",
      source_name: "Ramsey County ParcelData AttributedData API",
      source_url: byAddress.sourceUrl,
      raw_evidence: {
        lookup_mode: "site_address",
        site_address_query: siteAddressLine,
        parcel_query: parcelQuery,
        parsed_latest_tax_year: record.taxYear,
        parsed_total_payable: record.totalTax
      },
      retrieval_notes: [
        "Parcel discovered using MetroGIS parcel layer, then verified against Ramsey County API data.",
        `Ramsey source returned ${record.taxYear} annual tax ${record.totalTax.toFixed(2)}.`,
        yearMatched
          ? `Requested tax year ${args.requestTaxYear} matched county tax year ${record.taxYear}.`
          : `Requested tax year ${args.requestTaxYear}; county source latest available year is ${record.taxYear}.`
      ],
      matched_address: record.matchedAddress || args.parcel.situsAddress,
      confidence_inputs: {
        confidence: yearMatched ? "high" : "medium",
        authoritative_source_used: true
      }
    };
  }

  const structuredCandidates = [
    parseStructuredStreetQuery(args.requestFormattedAddress),
    parseStructuredStreetQuery(args.parcel.situsAddress)
  ].filter((candidate): candidate is StructuredStreetQuery => Boolean(candidate));

  for (const structured of structuredCandidates) {
    const whereParts = [
      `BuildingNumber='${escapeSqlLiteral(structured.buildingNumber)}'`,
      `StreetName='${escapeSqlLiteral(structured.streetName)}'`
    ];

    if (structured.streetSuffixType) {
      whereParts.push(
        `StreetSuffixType='${escapeSqlLiteral(structured.streetSuffixType)}'`
      );
    }

    if (structured.streetSuffixDirection) {
      whereParts.push(
        `StreetSuffixDirection='${escapeSqlLiteral(structured.streetSuffixDirection)}'`
      );
    }

    const where = whereParts.join(" AND ");
    const byStreet = await fetchRamseyCountyApi({ where });
    const record = byStreet.records.find((item) => hasDefensibleTaxRecord(item));
    if (!record) {
      continue;
    }

    const yearMatched = record.taxYear === args.requestTaxYear;
    return {
      county: "Ramsey",
      parcel_id: record.parcelId ?? parcelQuery,
      tax_year: record.taxYear,
      annual_property_tax: record.totalTax,
      source_kind: "county_api",
      source_name: "Ramsey County ParcelData AttributedData API",
      source_url: byStreet.sourceUrl,
      raw_evidence: {
        lookup_mode: "structured_street",
        street_query: structured,
        parcel_query: parcelQuery,
        parsed_latest_tax_year: record.taxYear,
        parsed_total_payable: record.totalTax
      },
      retrieval_notes: [
        "Parcel discovered using MetroGIS parcel layer, then verified against Ramsey County API data.",
        `Ramsey source returned ${record.taxYear} annual tax ${record.totalTax.toFixed(2)}.`,
        yearMatched
          ? `Requested tax year ${args.requestTaxYear} matched county tax year ${record.taxYear}.`
          : `Requested tax year ${args.requestTaxYear}; county source latest available year is ${record.taxYear}.`
      ],
      matched_address: record.matchedAddress || args.parcel.situsAddress,
      confidence_inputs: {
        confidence: yearMatched ? "high" : "medium",
        authoritative_source_used: true
      }
    };
  }

  if (parcelQuery) {
    const beaconResult = await fetchRamseyBeaconFallback(parcelQuery);
    if (beaconResult) {
      const yearMatched = beaconResult.latestTaxYear === args.requestTaxYear;
      return {
        county: "Ramsey",
        parcel_id: parcelQuery,
        tax_year: beaconResult.latestTaxYear,
        annual_property_tax: beaconResult.totalPayable,
        source_kind: "official_county",
        source_name: "Ramsey County Property Tax & Value Lookup",
        source_url: beaconResult.sourceUrl,
        raw_evidence: {
          lookup_mode: "beacon_fallback",
          parcel_query: parcelQuery,
          parsed_latest_tax_year: beaconResult.latestTaxYear,
          parsed_total_payable: beaconResult.totalPayable,
          parsed_evidence: beaconResult.evidence
        },
        retrieval_notes: [
          "Parcel discovered using MetroGIS parcel layer, then verified against Ramsey County property tax lookup.",
          `Ramsey source returned ${beaconResult.latestTaxYear} annual tax ${beaconResult.totalPayable.toFixed(2)}.`,
          yearMatched
            ? `Requested tax year ${args.requestTaxYear} matched county tax year ${beaconResult.latestTaxYear}.`
            : `Requested tax year ${args.requestTaxYear}; county source latest available year is ${beaconResult.latestTaxYear}.`
        ],
        matched_address: args.parcel.situsAddress,
        confidence_inputs: {
          confidence: yearMatched ? "high" : "medium",
          authoritative_source_used: true
        }
      };
    }
  }

  return null;
}

const baseProvider = createMetroArcGisCountyProvider({
  county: "Ramsey"
});

export const ramseyCountyTaxProvider: CountyTaxProvider = {
  ...baseProvider,
  providerKey: "mn-ramsey-authoritative-tax-provider-v2",
  sourceName: "Ramsey County ParcelData AttributedData API",
  sourceRootUrl: RAMSEY_COUNTY_API_BASE_URL,
  async fetchTaxObservation(parcel, request) {
    return fetchRamseyTaxObservation({
      parcel,
      requestTaxYear: request.taxYear,
      requestFormattedAddress: request.formattedAddress,
      requestLat: request.lat,
      requestLng: request.lng
    });
  }
};
