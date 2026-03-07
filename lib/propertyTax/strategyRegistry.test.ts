import { describe, expect, it } from "vitest";
import {
  getCountyStrategy,
  normalizeCountyName
} from "./strategyRegistry";

describe("property tax county strategy registry", () => {
  it("maps metro counties to metro-priority strategies", () => {
    const strategy = getCountyStrategy("Hennepin");

    expect(strategy.priority).toBe("metro");
    expect(strategy.county).toBe("Hennepin");
    expect(strategy.key).toContain("mn-metro-hennepin");
    expect(strategy.mode).toBe("county_provider_with_fallback");
  });

  it("routes Wright County to provider-first strategy", () => {
    const strategy = getCountyStrategy("Wright County");

    expect(strategy.priority).toBe("metro");
    expect(strategy.county).toBe("Wright");
    expect(strategy.key).toContain("mn-metro-wright");
    expect(strategy.mode).toBe("county_provider_with_fallback");
  });

  it("maps non-metro counties to statewide strategy", () => {
    const strategy = getCountyStrategy("Olmsted");

    expect(strategy.priority).toBe("statewide");
    expect(strategy.county).toBeNull();
    expect(strategy.key).toBe("mn-statewide-estimate-v1");
  });

  it("uses statewide strategy for unknown counties", () => {
    const strategy = getCountyStrategy("Unknown");

    expect(strategy.priority).toBe("statewide");
    expect(strategy.key).toBe("mn-statewide-estimate-v1");
  });

  it("normalizes county names with County suffix", () => {
    expect(normalizeCountyName("Hennepin County")).toBe("Hennepin");
  });
});
