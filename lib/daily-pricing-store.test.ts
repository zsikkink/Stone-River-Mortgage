import { describe, expect, it } from "vitest";
import {
  classifyPropertyTaxLookupOutcome,
  getDailyPricingAuthWarning,
  resolveDailyPricingDataDir,
  wasCurrentOrPreviousYearRecordFound
} from "./daily-pricing-store";

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
