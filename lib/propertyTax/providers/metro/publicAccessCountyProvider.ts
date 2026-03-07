import { CountyTaxObservation, CountyTaxProvider } from "../../types";
import { createMetroArcGisCountyProvider } from "./arcGisProvider";
import {
  CookieAwareFetch,
  extractYearAmountCandidatesFromRows,
  fetchPublicAccessDataletHtml,
  getParcelLookupCandidates,
  selectLatestYearAmount
} from "./authoritativeCountyUtils";
import {
  classifyMetroProviderFailure,
  MetroProviderError
} from "./providerError";

type PublicAccessProviderParams = {
  county: string;
  baseUrl: string;
  sourceName: string;
  providerKey: string;
  preferredDataletModes: string[];
  fetchImpl?: CookieAwareFetch;
  getRuntimeDiagnostics?: () => Record<string, unknown>;
};

function getParcelQueryFromCandidates(candidates: string[]): string | null {
  for (const candidate of candidates) {
    const digits = candidate.replace(/\D/g, "");
    if (digits.length >= 8) {
      return digits;
    }
  }

  return candidates[0] ?? null;
}

export function createPublicAccessCountyProvider(
  params: PublicAccessProviderParams
): CountyTaxProvider {
  const baseProvider = createMetroArcGisCountyProvider({
    county: params.county
  });

  return {
    ...baseProvider,
    providerKey: params.providerKey,
    sourceName: params.sourceName,
    sourceRootUrl: params.baseUrl,
    async fetchTaxObservation(parcel, request) {
      const parcelCandidates = getParcelLookupCandidates(parcel);
      const parcelQuery = getParcelQueryFromCandidates(parcelCandidates);
      if (!parcelQuery) {
        return null;
      }

      let datalet:
        | { dataletUrl: string; dataletHtml: string; requestTransport: string }
        | null = null;
      const runtimeDiagnostics = params.getRuntimeDiagnostics?.() ?? {};
      try {
        datalet = await fetchPublicAccessDataletHtml({
          baseUrl: params.baseUrl,
          parcelQuery,
          preferredModes: params.preferredDataletModes,
          fetchImpl: params.fetchImpl
        });
      } catch (error) {
        const failure = classifyMetroProviderFailure(error);
        throw new MetroProviderError({
          kind:
            failure.kind === "tls_certificate_validation"
              ? "tls_certificate_validation"
              : "network_error",
          code: failure.code,
          message: `County request failed for ${params.county}: ${failure.message}`,
          cause: error
        });
      }

      if (!datalet) {
        throw new MetroProviderError({
          kind: "response_error",
          message: `County response for ${params.county} did not include a tax datalet result.`,
          code: null
        });
      }

      const yearCandidates = extractYearAmountCandidatesFromRows(datalet.dataletHtml);
      const selected = selectLatestYearAmount(yearCandidates);
      if (!selected) {
        throw new MetroProviderError({
          kind: "parse_error",
          message: `County tax page for ${params.county} did not contain a parseable annual tax row.`,
          code: null
        });
      }

      const yearMatched = selected.year === request.taxYear;
      const observation: CountyTaxObservation = {
        county: params.county,
        parcel_id: parcelQuery,
        tax_year: selected.year,
        annual_property_tax: selected.amount,
        source_kind: "county_page",
        source_name: params.sourceName,
        source_url: datalet.dataletUrl,
        raw_evidence: {
          parcel_query: parcelQuery,
          parcel_candidates: parcelCandidates,
          selected_row_text: selected.rowText,
          candidate_count: yearCandidates.length,
          preferred_modes: params.preferredDataletModes,
          request_transport: datalet.requestTransport,
          runtime_diagnostics: runtimeDiagnostics
        },
        retrieval_notes: [
          "Parcel discovered using MetroGIS parcel layer, then verified against county property tax page.",
          `County page returned ${selected.year} annual tax ${selected.amount.toFixed(2)}.`,
          `County request transport: ${datalet.requestTransport}.`,
          yearMatched
            ? `Requested tax year ${request.taxYear} matched county tax year ${selected.year}.`
            : `Requested tax year ${request.taxYear}; county page latest available year is ${selected.year}.`
        ],
        matched_address: parcel.situsAddress || request.formattedAddress,
        confidence_inputs: {
          confidence: yearMatched ? "high" : "medium",
          authoritative_source_used: true,
          county_source_url: datalet.dataletUrl
        }
      };

      return observation;
    }
  };
}
