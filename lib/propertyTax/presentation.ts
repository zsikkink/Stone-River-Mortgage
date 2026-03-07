import { PropertyTaxResult } from "./types";

type PropertyTaxSource =
  | "User Provided"
  | "Estimated Using County Rate"
  | "County Retrieved";

type PropertyTaxYearMatchStatus = "matched" | "latest_available_used" | "unknown";

function buildPropertyTaxWarnings(detailedEstimate: PropertyTaxResult): string[] {
  const warnings: string[] = [];

  if (detailedEstimate.fallback_reason) {
    warnings.push(detailedEstimate.fallback_reason);
  }

  const providerAttempted =
    detailedEstimate.raw_evidence.provider_attempted === true;
  if (detailedEstimate.source_kind === "fallback") {
    const hasSpecificFallbackReason =
      typeof detailedEstimate.fallback_reason === "string" &&
      /county tax lookup/i.test(detailedEstimate.fallback_reason);
    if (providerAttempted) {
      if (!hasSpecificFallbackReason) {
        warnings.push(
          `County tax lookup for ${detailedEstimate.county || "the selected county"} was unavailable; used statewide average rate estimate.`
        );
      }
    } else {
      warnings.push("County not recognized; used statewide average rate.");
    }
  }

  if (
    detailedEstimate.year_match_status === "latest_available_used" &&
    typeof detailedEstimate.actual_tax_year_used === "number"
  ) {
    warnings.push(
      `Requested tax year ${detailedEstimate.requested_tax_year}; using latest available county data for ${detailedEstimate.actual_tax_year_used}.`
    );
  }

  return Array.from(new Set(warnings));
}

export function buildPropertyTaxApiResponse(detailedEstimate: PropertyTaxResult): {
  annualTax: number;
  source: "Estimated Using County Rate" | "County Retrieved";
  requestedTaxYear?: number;
  actualTaxYearUsed?: number;
  yearMatchStatus: PropertyTaxYearMatchStatus;
  rateUsed?: number;
  countyUsed?: string;
  warnings: string[];
  details: PropertyTaxResult;
} {
  return {
    annualTax: detailedEstimate.annual_property_tax || 0,
    source:
      detailedEstimate.result_type === "county_retrieved"
        ? "County Retrieved"
        : "Estimated Using County Rate",
    requestedTaxYear: detailedEstimate.requested_tax_year ?? undefined,
    actualTaxYearUsed: detailedEstimate.actual_tax_year_used ?? undefined,
    yearMatchStatus: detailedEstimate.year_match_status,
    rateUsed:
      typeof detailedEstimate.raw_evidence.rate_used === "number"
        ? (detailedEstimate.raw_evidence.rate_used as number)
        : undefined,
    countyUsed: detailedEstimate.county ?? undefined,
    warnings: buildPropertyTaxWarnings(detailedEstimate),
    details: detailedEstimate
  };
}

export function buildPropertyTaxLabels(args: {
  source: PropertyTaxSource | undefined;
  estimated: boolean;
  actualYearUsed: number | null;
  yearMatchStatus: PropertyTaxYearMatchStatus;
}): { summaryLabel: string; escrowLabel: string } {
  if (args.estimated) {
    return {
      summaryLabel: "Property Tax (est.)",
      escrowLabel: "Property Tax (6 months)"
    };
  }

  if (args.source === "County Retrieved") {
    if (args.actualYearUsed) {
      const yearSuffix =
        args.yearMatchStatus === "latest_available_used"
          ? `${args.actualYearUsed} data`
          : `${args.actualYearUsed}`;

      return {
        summaryLabel: `Property Tax (County Retrieved, ${yearSuffix})`,
        escrowLabel: `Property Tax (6 months, ${yearSuffix})`
      };
    }

    return {
      summaryLabel: "Property Tax (County Retrieved)",
      escrowLabel: "Property Tax (6 months)"
    };
  }

  return {
    summaryLabel: "Property Tax",
    escrowLabel: "Property Tax (6 months)"
  };
}
