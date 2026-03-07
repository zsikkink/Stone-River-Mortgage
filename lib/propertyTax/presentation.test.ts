import { describe, expect, it } from "vitest";
import {
  buildPropertyTaxApiResponse,
  buildPropertyTaxLabels
} from "./presentation";
import { PropertyTaxResult } from "./types";

function createBaseResult(partial: Partial<PropertyTaxResult>): PropertyTaxResult {
  return {
    normalized_address: "11836 Thornhill Rd, Eden Prairie, MN 55344",
    county: "Hennepin",
    state: "MN",
    parcel_id: "0211622120025",
    requested_tax_year: 2026,
    actual_tax_year_used: 2026,
    year_match_status: "matched",
    tax_year: 2026,
    annual_property_tax: 8250.28,
    result_type: "county_retrieved",
    confidence: "high",
    source_kind: "official_county",
    source_name: "Hennepin County Treasurer Property Tax Information",
    source_url:
      "https://www16.co.hennepin.mn.us/taxpayments/taxesdue.jsp?pid=0211622120025",
    matching_notes: [],
    estimation_notes: [],
    retrieval_notes: [],
    raw_evidence: {},
    fetched_at: new Date("2026-03-06T00:00:00Z").toISOString(),
    strategy_key: "mn-metro-hennepin-provider-v1",
    fallback_reason: null,
    valuation_basis: null,
    ...partial
  };
}

describe("property tax presentation", () => {
  it("returns API response metadata with actual tax year used", () => {
    const response = buildPropertyTaxApiResponse(createBaseResult({}));

    expect(response.annualTax).toBe(8250.28);
    expect(response.source).toBe("County Retrieved");
    expect(response.requestedTaxYear).toBe(2026);
    expect(response.actualTaxYearUsed).toBe(2026);
    expect(response.yearMatchStatus).toBe("matched");
  });

  it("adds year mismatch warning when latest available county year is used", () => {
    const response = buildPropertyTaxApiResponse(
      createBaseResult({
        requested_tax_year: 2027,
        actual_tax_year_used: 2026,
        year_match_status: "latest_available_used"
      })
    );

    expect(response.warnings.join(" ")).toContain("Requested tax year 2027");
    expect(response.warnings.join(" ")).toContain("2026");
  });

  it("uses provider-fallback warning text when county lookup failed after provider attempt", () => {
    const response = buildPropertyTaxApiResponse(
      createBaseResult({
        county: "Carver",
        result_type: "estimated",
        source_kind: "fallback",
        source_name: "MN county effective tax rate table default fallback (internal estimate)",
        fallback_reason:
          "County tax lookup for Carver is temporarily unavailable due to a secure connection issue; used estimate fallback.",
        raw_evidence: {
          provider_attempted: true
        }
      })
    );

    expect(response.warnings.join(" ")).toContain(
      "County tax lookup for Carver is temporarily unavailable due to a secure connection issue"
    );
    expect(response.warnings.join(" ")).not.toContain("County not recognized");
  });

  it("builds transaction summary labels with explicit county tax year", () => {
    expect(
      buildPropertyTaxLabels({
        source: "County Retrieved",
        estimated: false,
        actualYearUsed: 2026,
        yearMatchStatus: "matched"
      })
    ).toEqual({
      summaryLabel: "Property Tax (County Retrieved, 2026)",
      escrowLabel: "Property Tax (6 months, 2026)"
    });

    expect(
      buildPropertyTaxLabels({
        source: "County Retrieved",
        estimated: false,
        actualYearUsed: 2025,
        yearMatchStatus: "latest_available_used"
      })
    ).toEqual({
      summaryLabel: "Property Tax (County Retrieved, 2025 data)",
      escrowLabel: "Property Tax (6 months, 2025 data)"
    });
  });
});
