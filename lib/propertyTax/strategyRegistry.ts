import { CountyTaxStrategy } from "./types";

export const METRO_PRIORITY_COUNTIES = [
  "Hennepin",
  "Ramsey",
  "Dakota",
  "Anoka",
  "Washington",
  "Scott",
  "Carver",
  "Wright"
] as const;

export type MetroPriorityCounty = (typeof METRO_PRIORITY_COUNTIES)[number];

function toStrategySlug(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

export function normalizeCountyName(
  county: string | null | undefined
): string | null {
  if (!county) {
    return null;
  }

  const normalized = county
    .trim()
    .replace(/\s+County$/i, "")
    .trim();

  if (!normalized) {
    return null;
  }

  return normalized
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

const METRO_COUNTY_STRATEGY_REGISTRY: Record<MetroPriorityCounty, CountyTaxStrategy> =
  METRO_PRIORITY_COUNTIES.reduce((registry, county) => {
    registry[county] = {
      key: `mn-metro-${toStrategySlug(county)}-provider-v1`,
      priority: "metro",
      county,
      mode: "county_provider_with_fallback",
      notes: [
        `Metro priority county strategy for ${county} County.`,
        "Primary path uses county-specific retrieval provider with estimate fallback."
      ]
    };
    return registry;
  }, {} as Record<MetroPriorityCounty, CountyTaxStrategy>);

const STATEWIDE_FALLBACK_STRATEGY: CountyTaxStrategy = {
  key: "mn-statewide-estimate-v1",
  priority: "statewide",
  county: null,
  mode: "estimate_rate_table",
  notes: [
    "Statewide Minnesota fallback strategy.",
    "Uses county effective tax-rate table with default fallback when county rate is unavailable."
  ]
};

export function getCountyStrategy(
  county: string | null | undefined
): CountyTaxStrategy {
  const normalizedCounty = normalizeCountyName(county);
  if (!normalizedCounty) {
    return STATEWIDE_FALLBACK_STRATEGY;
  }

  const metroStrategy =
    METRO_COUNTY_STRATEGY_REGISTRY[
      normalizedCounty as MetroPriorityCounty
    ];

  if (metroStrategy) {
    return metroStrategy;
  }

  return STATEWIDE_FALLBACK_STRATEGY;
}

export function isMetroPriorityCounty(
  county: string | null | undefined
): county is MetroPriorityCounty {
  const normalizedCounty = normalizeCountyName(county);
  return Boolean(
    normalizedCounty &&
      METRO_COUNTY_STRATEGY_REGISTRY[
        normalizedCounty as MetroPriorityCounty
      ]
  );
}
