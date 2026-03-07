import { describe, expect, it } from "vitest";
import {
  getDailyPricingAuthWarning,
  resolveDailyPricingDataDir
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
