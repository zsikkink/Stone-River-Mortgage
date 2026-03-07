import { CountyTaxProvider, CountyTaxObservation, ParcelMatch } from "../../types";
import { createMetroArcGisCountyProvider } from "./arcGisProvider";
import { fetchWithTimeout } from "../../../server/fetch-timeout";

const HENNEPIN_TAX_DUE_URL =
  "https://www16.co.hennepin.mn.us/taxpayments/taxesdue.jsp";

type ParsedHennepinTaxDue = {
  parcelIdDisplay: string | null;
  latestTaxYear: number | null;
  totalPayable: number | null;
  updateNote: string | null;
};

function parseCurrencyValue(value: string): number | null {
  const normalized = value.replace(/[^0-9.]/g, "");
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

function formatHennepinParcelIdFromDigits(digits: string): string {
  return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(
    5,
    7
  )}-${digits.slice(7, 9)}-${digits.slice(9, 13)}`;
}

export function normalizeHennepinParcelId(parcelId: string | null | undefined): {
  canonicalDigits: string | null;
  displayParcelId: string | null;
} {
  if (!parcelId) {
    return {
      canonicalDigits: null,
      displayParcelId: null
    };
  }

  const digits = parcelId.replace(/\D/g, "");
  if (digits.length !== 13) {
    return {
      canonicalDigits: null,
      displayParcelId: null
    };
  }

  return {
    canonicalDigits: digits,
    displayParcelId: formatHennepinParcelIdFromDigits(digits)
  };
}

export function parseHennepinTaxDueHtml(html: string): ParsedHennepinTaxDue {
  const parcelIdMatch = html.match(/\b\d{2}-\d{3}-\d{2}-\d{2}-\d{4}\b/);
  const taxYearMatches = Array.from(html.matchAll(/>\s*(\d{4})\s+taxes\s*</gi));
  const latestTaxYear = taxYearMatches
    .map((match) => Number.parseInt(match[1], 10))
    .filter((year) => Number.isFinite(year))
    .sort((a, b) => b - a)[0] ?? null;

  const totalPayableMatch = html.match(
    /Total payable[\s\S]*?\$([0-9,]+\.\d{2})/i
  );
  const totalDueMatch = html.match(/Total Due[\s\S]*?\$([0-9,]+\.\d{2})/i);
  const totalPayable =
    parseCurrencyValue(totalPayableMatch?.[1] ?? "") ??
    parseCurrencyValue(totalDueMatch?.[1] ?? "");

  const updateNoteMatch = html.match(
    /This database is updated daily[\s\S]*?approximately\s*([^<]+)</i
  );

  return {
    parcelIdDisplay: parcelIdMatch?.[0] ?? null,
    latestTaxYear,
    totalPayable,
    updateNote: updateNoteMatch?.[0]?.replace(/<[^>]+>/g, " ").trim() ?? null
  };
}

function extractParcelIdFromMatch(parcel: ParcelMatch): string | null {
  const normalized = normalizeHennepinParcelId(parcel.parcelId);
  if (normalized.canonicalDigits) {
    return normalized.canonicalDigits;
  }

  if (parcel.raw.attributes && typeof parcel.raw.attributes === "object") {
    const attributes = parcel.raw.attributes as Record<string, unknown>;
    for (const candidate of [attributes.COUNTY_PIN, attributes.STATE_PIN]) {
      if (typeof candidate === "string") {
        const candidateNormalized = normalizeHennepinParcelId(candidate);
        if (candidateNormalized.canonicalDigits) {
          return candidateNormalized.canonicalDigits;
        }
      }
    }
  }

  return null;
}

async function fetchHennepinTaxObservation(args: {
  requestTaxYear: number;
  parcel: ParcelMatch;
}): Promise<CountyTaxObservation | null> {
  const parcelDigits = extractParcelIdFromMatch(args.parcel);
  if (!parcelDigits) {
    return null;
  }

  const sourceUrl = `${HENNEPIN_TAX_DUE_URL}?pid=${encodeURIComponent(parcelDigits)}`;
  const response = await fetchWithTimeout(sourceUrl, {
    method: "GET",
    cache: "no-store"
  }, { timeoutMs: 12000 });

  if (!response.ok) {
    return null;
  }

  const html = await response.text();
  const parsed = parseHennepinTaxDueHtml(html);
  if (
    typeof parsed.latestTaxYear !== "number" ||
    !Number.isFinite(parsed.latestTaxYear) ||
    parsed.latestTaxYear <= 0 ||
    typeof parsed.totalPayable !== "number" ||
    !Number.isFinite(parsed.totalPayable) ||
    parsed.totalPayable < 0
  ) {
    return null;
  }

  const parcelIdDisplay =
    parsed.parcelIdDisplay ||
    normalizeHennepinParcelId(parcelDigits).displayParcelId ||
    null;
  const yearMatched = parsed.latestTaxYear === args.requestTaxYear;

  return {
    county: "Hennepin",
    parcel_id: parcelDigits,
    tax_year: parsed.latestTaxYear,
    annual_property_tax: parsed.totalPayable,
    source_kind: "official_county",
    source_name: "Hennepin County Treasurer Property Tax Information",
    source_url: sourceUrl,
    raw_evidence: {
      parcel_id_lookup: parcelDigits,
      parcel_id_display: parcelIdDisplay,
      parsed_latest_tax_year: parsed.latestTaxYear,
      parsed_total_payable: parsed.totalPayable,
      update_note: parsed.updateNote
    },
    retrieval_notes: [
      "Parcel discovered using MetroGIS parcel layer, then verified against Hennepin tax-due page.",
      `Hennepin property tax page returned ${parsed.latestTaxYear} total payable ${parsed.totalPayable.toFixed(
        2
      )}.`,
      yearMatched
        ? `Requested tax year ${args.requestTaxYear} matched county tax year ${parsed.latestTaxYear}.`
        : `Requested tax year ${args.requestTaxYear}; county page latest available year is ${parsed.latestTaxYear}.`
    ],
    matched_address: args.parcel.situsAddress,
    confidence_inputs: {
      confidence: yearMatched ? "high" : "medium",
      parcel_id_display: parcelIdDisplay,
      authoritative_source_used: true
    }
  };
}

const baseProvider = createMetroArcGisCountyProvider({
  county: "Hennepin"
});

export const hennepinCountyTaxProvider: CountyTaxProvider = {
  ...baseProvider,
  providerKey: "mn-hennepin-authoritative-tax-provider-v2",
  sourceName: "Hennepin County Treasurer Property Tax Information",
  sourceRootUrl: HENNEPIN_TAX_DUE_URL,
  async fetchTaxObservation(parcel, request) {
    return fetchHennepinTaxObservation({
      requestTaxYear: request.taxYear,
      parcel
    });
  }
};
