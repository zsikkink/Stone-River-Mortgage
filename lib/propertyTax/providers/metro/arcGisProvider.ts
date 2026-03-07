import {
  CountyTaxObservation,
  CountyTaxProvider,
  CountyTaxProviderRequest,
  ParcelMatch
} from "../../types";
import { normalizeCountyName } from "../../strategyRegistry";
import { fetchWithTimeout } from "../../../server/fetch-timeout";

type ArcGisQueryResponse = {
  features?: Array<{
    attributes?: Record<string, unknown>;
    geometry?: {
      x?: number;
      y?: number;
    };
  }>;
  error?: {
    code?: number;
    message?: string;
    details?: string[];
  };
};

const ARC_GIS_BASE =
  "https://arcgis.metc.state.mn.us/ds1/rest/services/GISParcels";
const ARC_GIS_DATASET_YEAR = 2025;
const SEARCH_RADII_METERS = [80, 150, 250];
const OUT_FIELDS =
  "OBJECTID,COUNTY_PIN,STATE_PIN,TAX_YEAR,TOTAL_TAX,ANUMBER,ST_PRE_DIR,ST_NAME,ST_POS_TYP,ST_POS_DIR,POSTCOMM,ZIP,CO_NAME";

function toNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function toNullableText(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }

  return toNullableString(value);
}

function toNullableNumber(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

function toUpperNoPunctuation(value: string | null): string {
  if (!value) {
    return "";
  }

  return value.replace(/[^a-zA-Z0-9\s]/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
}

function parseStreetAddress(address: string | null): {
  houseNumber: number | null;
  streetRemainder: string | null;
} {
  if (!address) {
    return { houseNumber: null, streetRemainder: null };
  }

  const line = address.split(",")[0]?.trim() || "";
  const match = line.match(/^(\d+)\s+(.+)$/);
  if (!match) {
    return { houseNumber: null, streetRemainder: toUpperNoPunctuation(line) || null };
  }

  return {
    houseNumber: Number.parseInt(match[1], 10),
    streetRemainder: toUpperNoPunctuation(match[2]) || null
  };
}

function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371000 * c;
}

function buildSitusAddress(attributes: Record<string, unknown>): string | null {
  const parts = [
    toNullableText(attributes.ANUMBER),
    toNullableString(attributes.ST_PRE_DIR),
    toNullableString(attributes.ST_NAME),
    toNullableString(attributes.ST_POS_TYP),
    toNullableString(attributes.ST_POS_DIR)
  ].filter((part): part is string => Boolean(part));

  if (parts.length === 0) {
    return null;
  }

  const city = toNullableString(attributes.POSTCOMM);
  const zip = toNullableString(attributes.ZIP);
  const local = parts.join(" ");
  const cityZip = [city, zip].filter(Boolean).join(" ");

  return cityZip ? `${local}, ${cityZip}` : local;
}

async function queryArcGis(params: {
  serviceUrl: string;
  request: CountyTaxProviderRequest;
  radiusMeters: number;
}): Promise<ParcelMatch[]> {
  const { serviceUrl, request, radiusMeters } = params;
  if (
    typeof request.lat !== "number" ||
    typeof request.lng !== "number" ||
    !Number.isFinite(request.lat) ||
    !Number.isFinite(request.lng)
  ) {
    return [];
  }

  const endpoint = new URL(`${serviceUrl}/0/query`);
  endpoint.searchParams.set("f", "json");
  endpoint.searchParams.set("where", "1=1");
  endpoint.searchParams.set(
    "geometry",
    JSON.stringify({
      x: request.lng,
      y: request.lat,
      spatialReference: { wkid: 4326 }
    })
  );
  endpoint.searchParams.set("geometryType", "esriGeometryPoint");
  endpoint.searchParams.set("inSR", "4326");
  endpoint.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  endpoint.searchParams.set("distance", String(radiusMeters));
  endpoint.searchParams.set("units", "esriSRUnit_Meter");
  endpoint.searchParams.set("outFields", OUT_FIELDS);
  endpoint.searchParams.set("returnGeometry", "true");
  endpoint.searchParams.set("outSR", "4326");
  endpoint.searchParams.set("resultRecordCount", "50");

  const response = await fetchWithTimeout(endpoint.toString(), {
    method: "GET",
    cache: "no-store"
  }, { timeoutMs: 10000 });

  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as ArcGisQueryResponse;
  if (payload.error || !Array.isArray(payload.features)) {
    return [];
  }

  return payload.features
    .map((feature) => {
      const attributes = feature.attributes || {};
      const geometry = feature.geometry || {};
      const annualTax = toNullableNumber(attributes.TOTAL_TAX);
      const taxYear = toNullableNumber(attributes.TAX_YEAR);
      const parcelId =
        toNullableString(attributes.COUNTY_PIN) ||
        toNullableString(attributes.STATE_PIN);
      const objectId = toNullableNumber(attributes.OBJECTID);

      const distanceMeters =
        typeof geometry.x === "number" &&
        typeof geometry.y === "number" &&
        typeof request.lat === "number" &&
        typeof request.lng === "number"
          ? haversineMeters(request.lat, request.lng, geometry.y, geometry.x)
          : null;

      return {
        parcelId,
        objectId,
        situsAddress: buildSitusAddress(attributes),
        annualPropertyTax:
          typeof annualTax === "number" && annualTax >= 0
            ? Math.round(annualTax)
            : null,
        taxYear:
          typeof taxYear === "number" && taxYear > 0 ? Math.floor(taxYear) : null,
        distanceMeters,
        sourceUrl: endpoint.toString(),
        raw: {
          attributes,
          geometry
        }
      } satisfies ParcelMatch;
    })
    .filter((match) => match.parcelId || match.objectId);
}

async function fetchParcelObservation(params: {
  serviceUrl: string;
  sourceName: string;
  county: string;
  request: CountyTaxProviderRequest;
  parcel: ParcelMatch;
}): Promise<CountyTaxObservation | null> {
  const { serviceUrl, sourceName, county, request, parcel } = params;
  if (typeof parcel.objectId !== "number") {
    return null;
  }

  const endpoint = new URL(`${serviceUrl}/0/query`);
  endpoint.searchParams.set("f", "json");
  endpoint.searchParams.set("where", `OBJECTID=${parcel.objectId}`);
  endpoint.searchParams.set("outFields", OUT_FIELDS);
  endpoint.searchParams.set("returnGeometry", "false");
  endpoint.searchParams.set("resultRecordCount", "1");

  const response = await fetchWithTimeout(endpoint.toString(), {
    method: "GET",
    cache: "no-store"
  }, { timeoutMs: 10000 });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as ArcGisQueryResponse;
  const feature = payload.features?.[0];
  const attributes = feature?.attributes || {};
  const annualTaxRaw = toNullableNumber(attributes.TOTAL_TAX);
  const annualTax =
    typeof annualTaxRaw === "number" && annualTaxRaw >= 0
      ? Math.round(annualTaxRaw)
      : null;
  if (annualTax === null) {
    return null;
  }

  const taxYearRaw = toNullableNumber(attributes.TAX_YEAR);
  const observedTaxYear =
    typeof taxYearRaw === "number" && taxYearRaw > 0
      ? Math.floor(taxYearRaw)
      : ARC_GIS_DATASET_YEAR;

  const matchedAddress = buildSitusAddress(attributes) || parcel.situsAddress;
  const countyFromRecord = normalizeCountyName(toNullableString(attributes.CO_NAME));
  const countyMatches =
    !countyFromRecord || countyFromRecord.toUpperCase() === county.toUpperCase();
  const confidence: "high" | "medium" = countyMatches ? "high" : "medium";

  return {
    county,
    parcel_id:
      toNullableString(attributes.COUNTY_PIN) ||
      toNullableString(attributes.STATE_PIN) ||
      parcel.parcelId,
    tax_year: observedTaxYear,
    annual_property_tax: annualTax,
    source_kind: "county_api",
    source_name: sourceName,
    source_url: endpoint.toString(),
    raw_evidence: {
      endpoint: serviceUrl,
      dataset_year: ARC_GIS_DATASET_YEAR,
      object_id: parcel.objectId,
      attributes
    },
    retrieval_notes: [
      `Retrieved from MetroGIS county parcel layer (${county} County).`,
      `Dataset year basis: ${ARC_GIS_DATASET_YEAR}.`,
      observedTaxYear !== request.taxYear
        ? `Requested tax year ${request.taxYear}, provider returned ${observedTaxYear}.`
        : `Provider tax year matched requested year ${request.taxYear}.`,
      countyMatches
        ? "County field matches requested county."
        : "County field mismatch detected; confidence downgraded."
    ],
    matched_address: matchedAddress || request.formattedAddress,
    confidence_inputs: {
      confidence,
      distance_meters: parcel.distanceMeters,
      county_matches: countyMatches
    }
  };
}

function scoreParcelMatch(
  parcel: ParcelMatch,
  request: CountyTaxProviderRequest
): number {
  let score = 0;
  const requestAddress = parseStreetAddress(request.formattedAddress);
  const parcelAddress = parseStreetAddress(parcel.situsAddress);

  if (
    requestAddress.houseNumber !== null &&
    parcelAddress.houseNumber !== null &&
    requestAddress.houseNumber === parcelAddress.houseNumber
  ) {
    score += 100;
  }

  if (requestAddress.streetRemainder && parcelAddress.streetRemainder) {
    const requestStreet = requestAddress.streetRemainder;
    const parcelStreet = parcelAddress.streetRemainder;
    if (parcelStreet.includes(requestStreet) || requestStreet.includes(parcelStreet)) {
      score += 45;
    } else {
      const overlap = requestStreet
        .split(" ")
        .filter((token) => token.length > 2 && parcelStreet.includes(token)).length;
      score += overlap * 6;
    }
  }

  if (typeof parcel.annualPropertyTax === "number") {
    score += 20;
  }

  if (typeof parcel.distanceMeters === "number") {
    score -= parcel.distanceMeters / 12;
  }

  return score;
}

export function createMetroArcGisCountyProvider(params: {
  county: string;
}): CountyTaxProvider {
  const county = normalizeCountyName(params.county) || params.county;
  const serviceUrl = `${ARC_GIS_BASE}/Parcels${ARC_GIS_DATASET_YEAR}${county}Points/FeatureServer`;
  const sourceName = `MetroGIS Parcels (${county} County)`;

  return {
    county,
    providerKey: `mn-${county.toLowerCase()}-arcgis-provider-v1`,
    sourceName,
    sourceRootUrl: serviceUrl,
    canHandle: (candidateCounty) =>
      normalizeCountyName(candidateCounty)?.toUpperCase() === county.toUpperCase(),
    async searchProperty(request) {
      const uniqueByObjectId = new Map<number, ParcelMatch>();
      for (const radiusMeters of SEARCH_RADII_METERS) {
        const matches = await queryArcGis({ serviceUrl, request, radiusMeters });
        for (const match of matches) {
          if (typeof match.objectId === "number" && !uniqueByObjectId.has(match.objectId)) {
            uniqueByObjectId.set(match.objectId, match);
          }
        }
        if (uniqueByObjectId.size >= 8) {
          break;
        }
      }

      return Array.from(uniqueByObjectId.values());
    },
    chooseBestParcel(matches, request) {
      if (!matches.length) {
        return null;
      }

      const ranked = [...matches].sort((left, right) => {
        const scoreDelta = scoreParcelMatch(right, request) - scoreParcelMatch(left, request);
        if (scoreDelta !== 0) {
          return scoreDelta;
        }

        const leftDistance =
          typeof left.distanceMeters === "number" ? left.distanceMeters : Number.POSITIVE_INFINITY;
        const rightDistance =
          typeof right.distanceMeters === "number" ? right.distanceMeters : Number.POSITIVE_INFINITY;
        return leftDistance - rightDistance;
      });

      return ranked[0] ?? null;
    },
    async fetchTaxObservation(parcel, request) {
      return fetchParcelObservation({
        serviceUrl,
        sourceName,
        county,
        request,
        parcel
      });
    }
  };
}
