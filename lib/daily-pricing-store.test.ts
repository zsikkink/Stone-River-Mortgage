import { describe, expect, it } from "vitest";
import {
  classifyPropertyTaxLookupOutcome,
  type DailyPricingAnalytics,
  getDailyPricingAuthWarning,
  parsePricingConfigUpdate,
  recordTransactionSummaryGeneratedForAnalytics,
  resolveDailyPricingDataDir,
  summarizeDailyPricingAnalytics,
  wasCurrentOrPreviousYearRecordFound
} from "./daily-pricing-store";

function createValidPricingUpdateInput(overrides: Record<string, unknown> = {}) {
  return {
    interestRate: 5.625,
    discountPointFactor: 0.933,
    aprSpread: 0.118,
    loanTerm: "30-YR Fixed",
    propertyTaxAnnualRate: 0.0139,
    homeownersInsuranceRate: 0.008,
    homeownersInsuranceRoundDownTo: 25,
    mortgageInsuranceMonthly: 0,
    hoaMonthly: 0,
    mortgageRegistrationTaxRate: 0.0024,
    monthEndInterestDays: 1,
    fees: {
      underwritingFee: 1250,
      appraisalFee: 550,
      creditReportFee: 219,
      mersFee: 25,
      floodCertFee: 8,
      taxServiceFee: 85,
      settlementFee: 345,
      titlePrepFee: 750,
      lenderTitlePolicy: 972,
      ownerTitlePolicy: 487,
      countyRecording: 92,
      conservationFee: 5,
      brokerageAdminFee: 695
    },
    footer: {
      estimatedChargesLine:
        "Information provided is an illustration of estimated charges and is subject to change",
      interestAvailabilityPrefix:
        "Interest rate assumes 780+ credit score, available as of 10AM",
      companyLine:
        "Stone River Mortgage LLC nmls# 2090973. StoneRiverMortgage.com",
      pricingUpdatedPrefix: "Rates and points last updated:",
      contactLine: "Contact: 612.850.2018"
    },
    ...overrides
  };
}

describe("resolveDailyPricingDataDir", () => {
  it("uses explicit DAILY_PRICING_DATA_DIR when provided", () => {
    const resolved = resolveDailyPricingDataDir({
      DAILY_PRICING_DATA_DIR: "./custom-data"
    });

    expect(resolved.endsWith("/custom-data")).toBe(true);
  });

  it("uses /tmp default on serverless environments", () => {
    const resolved = resolveDailyPricingDataDir({
      VERCEL: "1"
    });

    expect(resolved).toBe("/tmp/stone-river-mortgage");
  });
});

describe("getDailyPricingAuthWarning", () => {
  it("returns warning in production when default credentials are active", () => {
    const warning = getDailyPricingAuthWarning({
      NODE_ENV: "production"
    });

    expect(warning).toContain("Daily Pricing login is disabled");
  });

  it("supports explicit override in production", () => {
    const warning = getDailyPricingAuthWarning({
      NODE_ENV: "production",
      DAILY_PRICING_ALLOW_DEFAULT_SEEDED_CREDENTIALS: "true"
    });

    expect(warning).toBeNull();
  });
});

describe("wasCurrentOrPreviousYearRecordFound", () => {
  it("returns true for county-retrieved current year", () => {
    expect(
      wasCurrentOrPreviousYearRecordFound({
        resultType: "county_retrieved",
        actualTaxYearUsed: 2026,
        currentYear: 2026
      })
    ).toBe(true);
  });

  it("returns true for county-retrieved previous year", () => {
    expect(
      wasCurrentOrPreviousYearRecordFound({
        resultType: "county_retrieved",
        actualTaxYearUsed: 2025,
        currentYear: 2026
      })
    ).toBe(true);
  });

  it("returns false for estimated results", () => {
    expect(
      wasCurrentOrPreviousYearRecordFound({
        resultType: "estimated",
        actualTaxYearUsed: 2026,
        currentYear: 2026
      })
    ).toBe(false);
  });
});

describe("classifyPropertyTaxLookupOutcome", () => {
  it("classifies current year records", () => {
    expect(
      classifyPropertyTaxLookupOutcome({
        resultType: "county_retrieved",
        actualTaxYearUsed: 2026,
        currentYear: 2026
      })
    ).toBe("current_year");
  });

  it("classifies previous year records", () => {
    expect(
      classifyPropertyTaxLookupOutcome({
        resultType: "county_retrieved",
        actualTaxYearUsed: 2025,
        currentYear: 2026
      })
    ).toBe("previous_year");
  });

  it("classifies older year records", () => {
    expect(
      classifyPropertyTaxLookupOutcome({
        resultType: "county_retrieved",
        actualTaxYearUsed: 2024,
        currentYear: 2026
      })
    ).toBe("older_year");
  });

  it("classifies non-county-retrieved records as failures", () => {
    expect(
      classifyPropertyTaxLookupOutcome({
        resultType: "estimated",
        actualTaxYearUsed: 2026,
        currentYear: 2026
      })
    ).toBe("failed");
  });
});

describe("recordTransactionSummaryGeneratedForAnalytics", () => {
  it("tracks repeated successful PDFs for the same normalized address", () => {
    const analytics: DailyPricingAnalytics = {
      pdfGeneratedCount: 0,
      addressesByKey: {}
    };

    recordTransactionSummaryGeneratedForAnalytics(analytics, {
      address: "123 Main St, Minneapolis, MN, USA",
      county: "Hennepin",
      propertyTaxSource: "County Retrieved",
      propertyTaxActualYearUsed: 2026,
      currentYear: 2026,
      generatedAt: "2026-03-16T12:00:00.000Z"
    });
    recordTransactionSummaryGeneratedForAnalytics(analytics, {
      address: " 123 MAIN ST, MINNEAPOLIS, MN ",
      county: "Hennepin County",
      propertyTaxSource: "Estimated Using County Rate",
      propertyTaxActualYearUsed: null,
      currentYear: 2026,
      generatedAt: "2026-03-16T13:00:00.000Z"
    });

    expect(analytics.pdfGeneratedCount).toBe(2);
    expect(Object.keys(analytics.addressesByKey)).toHaveLength(1);

    const trackedAddress = analytics.addressesByKey["123 main st, minneapolis, mn"];
    expect(trackedAddress).toMatchObject({
      address: "123 Main St, Minneapolis, MN",
      county: "Hennepin",
      pdfGeneratedCount: 2,
      firstPdfGeneratedAt: "2026-03-16T12:00:00.000Z",
      lastPdfGeneratedAt: "2026-03-16T13:00:00.000Z",
      firstPdfPropertyTaxOutcome: "current_year"
    });
  });
});

describe("summarizeDailyPricingAnalytics", () => {
  it("uses unique successful PDF addresses as county denominators", () => {
    const analytics: DailyPricingAnalytics = {
      pdfGeneratedCount: 0,
      addressesByKey: {}
    };

    recordTransactionSummaryGeneratedForAnalytics(analytics, {
      address: "123 Main St, Minneapolis, MN, USA",
      county: "Hennepin",
      propertyTaxSource: "County Retrieved",
      propertyTaxActualYearUsed: 2026,
      currentYear: 2026,
      generatedAt: "2026-03-16T12:00:00.000Z"
    });
    recordTransactionSummaryGeneratedForAnalytics(analytics, {
      address: "123 MAIN ST, MINNEAPOLIS, MN",
      county: "Hennepin County",
      propertyTaxSource: "County Retrieved",
      propertyTaxActualYearUsed: 2026,
      currentYear: 2026,
      generatedAt: "2026-03-16T12:30:00.000Z"
    });
    recordTransactionSummaryGeneratedForAnalytics(analytics, {
      address: "500 Lake Rd, Minneapolis, MN",
      county: "Hennepin County",
      propertyTaxSource: "Estimated Using County Rate",
      propertyTaxActualYearUsed: null,
      currentYear: 2026,
      generatedAt: "2026-03-16T13:00:00.000Z"
    });
    recordTransactionSummaryGeneratedForAnalytics(analytics, {
      address: "42 River Ave, Mankato, MN",
      county: "Blue Earth County",
      propertyTaxSource: "County Retrieved",
      propertyTaxActualYearUsed: 2025,
      currentYear: 2026,
      generatedAt: "2026-03-16T14:00:00.000Z"
    });

    const summary = summarizeDailyPricingAnalytics({
      analytics,
      currentYear: 2026
    });

    expect(summary.uniqueAddressCount).toBe(3);
    expect(summary.nonMetroUniqueAddressCount).toBe(1);
    expect(summary.currentOrPreviousYearSuccessfulAddressCount).toBe(2);
    expect(summary.currentOrPreviousYearSuccessRate).toBeCloseTo(2 / 3);
    expect(summary.trackedAddresses.map((record) => record.address)).toEqual([
      "42 River Ave, Mankato, MN",
      "500 Lake Rd, Minneapolis, MN",
      "123 Main St, Minneapolis, MN"
    ]);
    expect(summary.trackedAddresses[2]?.pdfGeneratedCount).toBe(2);
    expect(summary.countyPerformanceByUniqueAddress.Hennepin).toMatchObject({
      totalUniqueAddresses: 2,
      currentYearCount: 1,
      previousYearCount: 0,
      olderYearCount: 0,
      failedCount: 1,
      currentYearRate: 0.5,
      failedRate: 0.5
    });
    expect(summary.countyPerformanceByUniqueAddress["Blue Earth"]).toMatchObject({
      totalUniqueAddresses: 1,
      currentYearCount: 0,
      previousYearCount: 1,
      olderYearCount: 0,
      failedCount: 0,
      previousYearRate: 1
    });
  });
});

describe("parsePricingConfigUpdate", () => {
  it("accepts discount point factor boundaries", () => {
    const low = parsePricingConfigUpdate(
      createValidPricingUpdateInput({ discountPointFactor: -5 })
    );
    const high = parsePricingConfigUpdate(
      createValidPricingUpdateInput({ discountPointFactor: 5 })
    );

    expect(low.discountPointFactor).toBe(-5);
    expect(high.discountPointFactor).toBe(5);
  });

  it("rejects discount point factor below minimum", () => {
    expect(() =>
      parsePricingConfigUpdate(
        createValidPricingUpdateInput({ discountPointFactor: -5.01 })
      )
    ).toThrow("discountPointFactor must be at least -5.");
  });

  it("rejects discount point factor above maximum", () => {
    expect(() =>
      parsePricingConfigUpdate(
        createValidPricingUpdateInput({ discountPointFactor: 5.01 })
      )
    ).toThrow("discountPointFactor must be at most 5.");
  });
});
