import { MINNESOTA_ADDRESS_ONLY_MESSAGE } from "../constants";
import { MN_COUNTY_EFFECTIVE_RATES } from "./mnRates";
import { getMetroCountyProvider } from "./providers/metro";
import { classifyMetroProviderFailure } from "./providers/metro/providerError";
import {
  getCountyStrategy,
  normalizeCountyName
} from "./strategyRegistry";
import {
  CountyTaxProviderRequest,
  NormalizedAddressForPropertyTax,
  PropertyTaxResult,
  PropertyTaxSourceKind,
  PropertyTaxValuationBasis
} from "./types";

export type PropertyTaxComputationArgs = {
  purchasePrice: number;
  county?: string | null;
  state?: string | null;
  formattedAddress?: string | null;
  lat?: number | null;
  lng?: number | null;
  taxYear?: number | null;
  actualAnnualTax?: number | null;
};

export type PropertyTaxComputationResult = {
  annualTax: number;
  source:
    | "User Provided"
    | "Estimated Using County Rate"
    | "County Retrieved";
  rateUsed?: number;
  countyUsed?: string;
  warnings: string[];
  details?: PropertyTaxResult;
};

const DEFAULT_WARNING = "County not recognized; used statewide average rate.";
const MISSING_COUNTY_WARNING =
  "County is missing from the normalized address and could not be resolved.";
const MISSING_VALUATION_WARNING =
  "Unable to estimate annual property tax because purchase price is missing.";
const NON_MINNESOTA_WARNING =
  "Property tax estimation is limited to Minnesota properties.";

const SOURCE_NAME_COUNTY_RATE_TABLE =
  "MN county effective tax rate table (internal estimate)";
const SOURCE_NAME_DEFAULT_FALLBACK =
  "MN county effective tax rate table default fallback (internal estimate)";
const SOURCE_NAME_UNRESOLVED =
  "MN property tax estimate could not be resolved";

const ESTIMATE_CACHE_TTL_MS = 1000 * 60 * 10;
const RESULT_CACHE_TTL_MS = 1000 * 60 * 30;
const resultCache = new Map<
  string,
  { expiresAt: number; value: PropertyTaxResult }
>();

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeState(state: string | null | undefined): string | null {
  if (!state) {
    return null;
  }

  const normalized = state.trim().toUpperCase();
  return normalized || null;
}

function isMinnesota(state: string | null | undefined): boolean {
  const normalized = normalizeState(state);
  return normalized === "MN" || normalized === "MINNESOTA";
}

function getTaxYear(taxYear: number | null | undefined): number {
  if (typeof taxYear === "number" && Number.isFinite(taxYear) && taxYear > 0) {
    return Math.floor(taxYear);
  }

  return new Date().getFullYear();
}

function buildCacheKey(input: {
  normalizedAddress: string | null;
  county: string | null;
  state: string | null;
  taxYear: number;
  purchasePrice: number | null;
  strategyKey: string;
  lat: number | null;
  lng: number | null;
}): string {
  return JSON.stringify({
    normalizedAddress: input.normalizedAddress ?? null,
    county: input.county ?? null,
    state: input.state ?? null,
    taxYear: input.taxYear,
    purchasePrice: input.purchasePrice ?? null,
    strategyKey: input.strategyKey,
    lat: input.lat ?? null,
    lng: input.lng ?? null
  });
}

function cloneResult(result: PropertyTaxResult): PropertyTaxResult {
  return {
    ...result,
    matching_notes: [...result.matching_notes],
    estimation_notes: [...result.estimation_notes],
    retrieval_notes: result.retrieval_notes
      ? [...result.retrieval_notes]
      : undefined,
    raw_evidence: { ...result.raw_evidence },
    valuation_basis: result.valuation_basis
      ? { ...result.valuation_basis }
      : result.valuation_basis,
    audit_metadata: result.audit_metadata
      ? { ...result.audit_metadata }
      : result.audit_metadata,
    cache_metadata: result.cache_metadata
      ? { ...result.cache_metadata }
      : result.cache_metadata
  };
}

function readFromCache(cacheKey: string): PropertyTaxResult | null {
  const cached = resultCache.get(cacheKey);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    resultCache.delete(cacheKey);
    return null;
  }

  return cloneResult(cached.value);
}

function writeToCache(cacheKey: string, result: PropertyTaxResult): void {
  const existing = resultCache.get(cacheKey);
  if (
    existing &&
    existing.expiresAt > Date.now() &&
    existing.value.result_type === "county_retrieved" &&
    result.result_type !== "county_retrieved"
  ) {
    return;
  }

  const ttlMs =
    result.result_type === "estimated" ? ESTIMATE_CACHE_TTL_MS : RESULT_CACHE_TTL_MS;
  resultCache.set(cacheKey, {
    expiresAt: Date.now() + ttlMs,
    value: cloneResult(result)
  });
}

function resolveCountyRate(county: string): {
  rate: number;
  sourceKind: PropertyTaxSourceKind;
  sourceName: string;
  usedDefaultRate: boolean;
  countyUsed: string;
} {
  const countyRate =
    MN_COUNTY_EFFECTIVE_RATES[
      county as keyof typeof MN_COUNTY_EFFECTIVE_RATES
    ];

  if (typeof countyRate === "number") {
    return {
      rate: countyRate,
      sourceKind: "county_rate_table",
      sourceName: SOURCE_NAME_COUNTY_RATE_TABLE,
      usedDefaultRate: false,
      countyUsed: county
    };
  }

  return {
    rate: MN_COUNTY_EFFECTIVE_RATES._DEFAULT,
    sourceKind: "fallback",
    sourceName: SOURCE_NAME_DEFAULT_FALLBACK,
    usedDefaultRate: true,
    countyUsed: county
  };
}

function buildUnresolvedResult(args: {
  normalizedAddress: string | null;
  county: string | null;
  state: string | null;
  requestedTaxYear: number;
  strategyKey: string;
  matchingNotes: string[];
  estimationNotes: string[];
  reason: string;
  valuationBasis: PropertyTaxValuationBasis | null;
  fallbackReason?: string | null;
  retrievalNotes?: string[];
  rawEvidence?: Record<string, unknown>;
}): PropertyTaxResult {
  return {
    normalized_address: args.normalizedAddress,
    county: args.county,
    state: args.state,
    parcel_id: null,
    requested_tax_year: args.requestedTaxYear,
    actual_tax_year_used: null,
    year_match_status: "unknown",
    tax_year: args.requestedTaxYear,
    annual_property_tax: null,
    result_type: "unresolved",
    confidence: "low",
    source_kind: "fallback",
    source_name: SOURCE_NAME_UNRESOLVED,
    source_url: null,
    matching_notes: args.matchingNotes,
    estimation_notes: [...args.estimationNotes, args.reason],
    retrieval_notes: args.retrievalNotes,
    raw_evidence: args.rawEvidence ?? {
      reason: args.reason,
      county: args.county,
      state: args.state
    },
    fetched_at: new Date().toISOString(),
    strategy_key: args.strategyKey,
    fallback_reason: args.fallbackReason ?? null,
    valuation_basis: args.valuationBasis,
    audit_metadata: {
      unresolved_reason: args.reason
    }
  };
}

function estimateAnnualPropertyTaxDetailed(args: {
  normalizedAddress: string | null;
  county: string | null;
  state: string | null;
  requestedTaxYear: number;
  strategyKey: string;
  purchasePrice: number | null;
  valuationBasis: PropertyTaxValuationBasis | null;
  matchingNotes: string[];
  fallbackReason?: string | null;
  retrievalNotes?: string[];
  rawEvidence?: Record<string, unknown>;
}): PropertyTaxResult {
  const {
    normalizedAddress,
    county,
    state,
    requestedTaxYear,
    strategyKey,
    purchasePrice,
    valuationBasis,
    matchingNotes
  } = args;

  if (!isMinnesota(state)) {
    return buildUnresolvedResult({
      normalizedAddress,
      county,
      state,
      requestedTaxYear,
      strategyKey,
      matchingNotes,
      estimationNotes: [],
      reason: NON_MINNESOTA_WARNING,
      valuationBasis,
      fallbackReason: args.fallbackReason,
      retrievalNotes: args.retrievalNotes,
      rawEvidence: args.rawEvidence
    });
  }

  if (!county) {
    return buildUnresolvedResult({
      normalizedAddress,
      county,
      state,
      requestedTaxYear,
      strategyKey,
      matchingNotes,
      estimationNotes: [],
      reason: MISSING_COUNTY_WARNING,
      valuationBasis,
      fallbackReason: args.fallbackReason,
      retrievalNotes: args.retrievalNotes,
      rawEvidence: args.rawEvidence
    });
  }

  if (!purchasePrice) {
    return buildUnresolvedResult({
      normalizedAddress,
      county,
      state,
      requestedTaxYear,
      strategyKey,
      matchingNotes,
      estimationNotes: [],
      reason: MISSING_VALUATION_WARNING,
      valuationBasis,
      fallbackReason: args.fallbackReason,
      retrievalNotes: args.retrievalNotes,
      rawEvidence: args.rawEvidence
    });
  }

  const countyRateResolution = resolveCountyRate(county);
  const annualPropertyTax = roundCurrency(
    purchasePrice * countyRateResolution.rate
  );

  if (!Number.isFinite(annualPropertyTax) || annualPropertyTax < 0) {
    return buildUnresolvedResult({
      normalizedAddress,
      county,
      state,
      requestedTaxYear,
      strategyKey,
      matchingNotes,
      estimationNotes: [],
      reason: "Failed to compute a finite non-negative annual property tax estimate.",
      valuationBasis,
      fallbackReason: args.fallbackReason,
      retrievalNotes: args.retrievalNotes,
      rawEvidence: args.rawEvidence
    });
  }

  const estimationNotes = [
    `Valuation basis: purchase price ${purchasePrice.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}.`,
    countyRateResolution.usedDefaultRate
      ? `County rate unavailable for ${county}; used statewide fallback rate (${(
          countyRateResolution.rate * 100
        ).toFixed(2)}%).`
      : `County-specific effective rate for ${county} used (${(
          countyRateResolution.rate * 100
        ).toFixed(2)}%).`,
    `Formula: annual_property_tax = purchase_price * rate = ${purchasePrice} * ${countyRateResolution.rate}.`
  ];
  if (args.fallbackReason) {
    estimationNotes.unshift(`Fallback reason: ${args.fallbackReason}`);
  }

  const notes = [...matchingNotes];
  if (countyRateResolution.usedDefaultRate) {
    notes.push(
      `County ${county} is not present in the current county rate table; default fallback rate applied.`
    );
  }

  return {
    normalized_address: normalizedAddress,
    county,
    state: "MN",
    parcel_id: null,
    requested_tax_year: requestedTaxYear,
    actual_tax_year_used: requestedTaxYear,
    year_match_status: "matched",
    tax_year: requestedTaxYear,
    annual_property_tax: annualPropertyTax,
    result_type: "estimated",
    confidence: countyRateResolution.usedDefaultRate ? "low" : "medium",
    source_kind: countyRateResolution.sourceKind,
    source_name: countyRateResolution.sourceName,
    source_url: null,
    matching_notes: notes,
    estimation_notes: estimationNotes,
    retrieval_notes: args.retrievalNotes,
    raw_evidence: {
      ...(args.rawEvidence ?? {}),
      county_input: county,
      county_resolved: county,
      strategy_key: strategyKey,
      rate_used: countyRateResolution.rate,
      used_default_rate: countyRateResolution.usedDefaultRate,
      valuation_basis_kind: "purchase_price",
      valuation_basis_amount: purchasePrice,
      formula: "annual_property_tax = purchase_price * rate"
    },
    fetched_at: new Date().toISOString(),
    strategy_key: strategyKey,
    fallback_reason: args.fallbackReason ?? null,
    valuation_basis: valuationBasis,
    audit_metadata: {
      strategy_key: strategyKey,
      source_kind: countyRateResolution.sourceKind
    }
  };
}

async function retrieveMetroCountyTax(args: {
  normalizedAddress: string | null;
  county: string;
  state: string;
  requestedTaxYear: number;
  lat: number | null;
  lng: number | null;
  strategyKey: string;
}): Promise<PropertyTaxResult | null> {
  const provider = getMetroCountyProvider(args.county);
  if (!provider) {
    return null;
  }

  const request: CountyTaxProviderRequest = {
    formattedAddress: args.normalizedAddress,
    county: args.county,
    state: args.state,
    lat: args.lat,
    lng: args.lng,
    taxYear: args.requestedTaxYear
  };

  console.info("Property tax metro provider selected", {
    strategyKey: args.strategyKey,
    county: args.county,
    providerKey: provider.providerKey
  });

  const matches = await provider.searchProperty(request);
  if (!matches.length) {
    console.warn("Property tax metro provider found no parcel matches", {
      providerKey: provider.providerKey,
      county: args.county
    });
    return null;
  }

  const bestParcel = provider.chooseBestParcel(matches, request);
  if (!bestParcel) {
    console.warn("Property tax metro provider could not choose best parcel", {
      providerKey: provider.providerKey,
      county: args.county,
      matchCount: matches.length
    });
    return null;
  }

  const observation = await provider.fetchTaxObservation(bestParcel, request);
  if (!observation) {
    console.warn("Property tax metro provider failed to fetch tax observation", {
      providerKey: provider.providerKey,
      county: args.county,
      parcelId: bestParcel.parcelId
    });
    return null;
  }

  const confidence = (
    observation.confidence_inputs?.confidence as PropertyTaxResult["confidence"] | undefined
  ) || "medium";
  const yearMatchStatus =
    observation.tax_year === args.requestedTaxYear
      ? "matched"
      : "latest_available_used";
  const yearHandlingNote =
    yearMatchStatus === "latest_available_used"
      ? `Requested tax year ${args.requestedTaxYear}, county source returned latest available year ${observation.tax_year}.`
      : `County source tax year matched requested year ${args.requestedTaxYear}.`;

  const retrievalResult: PropertyTaxResult = {
    normalized_address: args.normalizedAddress,
    county: observation.county,
    state: "MN",
    parcel_id: observation.parcel_id,
    requested_tax_year: args.requestedTaxYear,
    actual_tax_year_used: observation.tax_year,
    year_match_status: yearMatchStatus,
    tax_year: observation.tax_year,
    annual_property_tax: observation.annual_property_tax,
    result_type: "county_retrieved",
    confidence,
    source_kind: observation.source_kind,
    source_name: observation.source_name,
    source_url: observation.source_url,
    matching_notes: [
      `Metro provider ${provider.providerKey} selected best parcel from ${matches.length} candidates.`
    ],
    estimation_notes: [],
    retrieval_notes: [...observation.retrieval_notes, yearHandlingNote],
    raw_evidence: {
      provider_key: provider.providerKey,
      source_root_url: provider.sourceRootUrl,
      ...observation.raw_evidence
    },
    fetched_at: new Date().toISOString(),
    strategy_key: args.strategyKey,
    fallback_reason: null,
    valuation_basis: null,
    audit_metadata: {
      provider_key: provider.providerKey,
      provider_source: provider.sourceName
    }
  };

  return retrievalResult;
}

export async function getAnnualPropertyTax(
  normalizedAddress: NormalizedAddressForPropertyTax
): Promise<PropertyTaxResult> {
  const normalizedCounty = normalizeCountyName(normalizedAddress.county);
  const normalizedState = normalizeState(normalizedAddress.state);
  const normalizedAddressText = normalizedAddress.formattedAddress?.trim() || null;
  const requestedTaxYear = getTaxYear(normalizedAddress.taxYear);
  const countyStrategy = getCountyStrategy(normalizedCounty);
  const purchasePrice =
    typeof normalizedAddress.purchasePrice === "number" &&
    Number.isFinite(normalizedAddress.purchasePrice) &&
    normalizedAddress.purchasePrice > 0
      ? normalizedAddress.purchasePrice
      : null;
  const valuationBasis: PropertyTaxValuationBasis | null = purchasePrice
    ? {
        kind: "purchase_price",
        amount: roundCurrency(purchasePrice),
        currency: "USD"
      }
    : null;
  const lat =
    typeof normalizedAddress.lat === "number" && Number.isFinite(normalizedAddress.lat)
      ? normalizedAddress.lat
      : null;
  const lng =
    typeof normalizedAddress.lng === "number" && Number.isFinite(normalizedAddress.lng)
      ? normalizedAddress.lng
      : null;

  const cacheKey = buildCacheKey({
    normalizedAddress: normalizedAddressText,
    county: normalizedCounty,
    state: normalizedState,
    taxYear: requestedTaxYear,
    purchasePrice,
    strategyKey: countyStrategy.key,
    lat,
    lng
  });
  const cachedResult = readFromCache(cacheKey);
  if (cachedResult) {
    cachedResult.cache_metadata = {
      key: cacheKey,
      hit: true,
      ttl_ms:
        cachedResult.result_type === "estimated"
          ? ESTIMATE_CACHE_TTL_MS
          : RESULT_CACHE_TTL_MS
    };
    return cachedResult;
  }

  const matchingNotes = [
    `Strategy selected: ${countyStrategy.key}`,
    ...countyStrategy.notes
  ];
  if (normalizedCounty) {
    matchingNotes.push(`County resolved from normalized address: ${normalizedCounty}.`);
  }

  if (!isMinnesota(normalizedState)) {
    const result = buildUnresolvedResult({
      normalizedAddress: normalizedAddressText,
      county: normalizedCounty,
      state: normalizedState,
      requestedTaxYear,
      strategyKey: countyStrategy.key,
      matchingNotes,
      estimationNotes: [],
      reason: NON_MINNESOTA_WARNING,
      valuationBasis
    });
    writeToCache(cacheKey, result);
    return result;
  }

  if (
    countyStrategy.mode === "county_provider_with_fallback" &&
    normalizedCounty
  ) {
    let fallbackReason =
      "County provider did not return a defensible annual tax; used estimate fallback.";
    let retrievalNotes = [
      `Metro county provider attempted for ${normalizedCounty} and did not return a resolved annual tax.`
    ];
    const fallbackRawEvidence: Record<string, unknown> = {
      provider_attempted: true,
      provider_county: normalizedCounty
    };

    try {
      const retrieved = await retrieveMetroCountyTax({
        normalizedAddress: normalizedAddressText,
        county: normalizedCounty,
        state: "MN",
        requestedTaxYear,
        lat,
        lng,
        strategyKey: countyStrategy.key
      });

      if (
        retrieved &&
        typeof retrieved.annual_property_tax === "number" &&
        Number.isFinite(retrieved.annual_property_tax) &&
        retrieved.annual_property_tax >= 0
      ) {
        const resultWithCache = {
          ...retrieved,
          cache_metadata: {
            key: cacheKey,
            hit: false,
            ttl_ms: RESULT_CACHE_TTL_MS
          }
        };
        writeToCache(cacheKey, resultWithCache);
        return resultWithCache;
      }
    } catch (error) {
      const failure = classifyMetroProviderFailure(error);
      const extraCaConfigured = Boolean(process.env.NODE_EXTRA_CA_CERTS);
      const carverCaPemConfigured = Boolean(
        process.env.CARVER_CA_PEM && process.env.CARVER_CA_PEM.trim()
      );
      const isCarverCounty = normalizedCounty.toUpperCase() === "CARVER";
      const tlsRecommendedAction = isCarverCounty
        ? carverCaPemConfigured
          ? "Verify CARVER_CA_PEM contains a valid PEM certificate chain for Carver county. For local startup trust bundles, also verify NODE_EXTRA_CA_CERTS if used."
          : "Set CARVER_CA_PEM with the intermediate certificate chain (preferred for Vercel), or configure NODE_EXTRA_CA_CERTS before Node starts for local development."
        : extraCaConfigured
          ? "Verify NODE_EXTRA_CA_CERTS points to a valid PEM bundle containing the required intermediate CA certificates."
          : "Set NODE_EXTRA_CA_CERTS to a PEM bundle with the required intermediate CA certificates, then restart Node.";
      const fallbackReasonByKind: Record<
        (typeof failure)["kind"],
        string
      > = {
        tls_certificate_validation: `County tax lookup for ${normalizedCounty} is temporarily unavailable due to a secure connection issue; used estimate fallback.`,
        network_error: `County tax lookup for ${normalizedCounty} is temporarily unavailable due to a network request issue; used estimate fallback.`,
        response_error: `County tax lookup for ${normalizedCounty} did not return usable tax records; used estimate fallback.`,
        parse_error: `County tax lookup for ${normalizedCounty} returned data that could not be parsed; used estimate fallback.`,
        unknown: `County tax lookup for ${normalizedCounty} failed; used estimate fallback.`
      };
      fallbackReason = fallbackReasonByKind[failure.kind];
      if (
        failure.kind === "response_error" &&
        failure.code === "CLOUDFLARE_CHALLENGE"
      ) {
        fallbackReason = `County tax lookup for ${normalizedCounty} was blocked by an anti-bot challenge page; used estimate fallback.`;
      }
      retrievalNotes = [
        `Metro county provider attempted for ${normalizedCounty} but failed: ${failure.message}`,
        failure.kind === "tls_certificate_validation"
          ? isCarverCounty
            ? `TLS certificate chain validation failed for county source. CARVER_CA_PEM configured: ${
                carverCaPemConfigured ? "yes" : "no"
              }. NODE_EXTRA_CA_CERTS configured: ${
                extraCaConfigured ? "yes" : "no"
              }.`
            : `TLS certificate chain validation failed for county source. NODE_EXTRA_CA_CERTS configured: ${
                extraCaConfigured ? "yes" : "no"
              }.`
          : `Provider failure classification: ${failure.kind}.`
      ];
      if (failure.kind === "tls_certificate_validation") {
        retrievalNotes.push(tlsRecommendedAction);
      }
      fallbackRawEvidence.provider_error_message = failure.message;
      fallbackRawEvidence.provider_error_code = failure.code;
      fallbackRawEvidence.provider_error_type = failure.kind;
      fallbackRawEvidence.node_extra_ca_certs_configured = extraCaConfigured;
      fallbackRawEvidence.carver_ca_pem_configured = carverCaPemConfigured;
      fallbackRawEvidence.provider_recommended_action =
        failure.kind === "tls_certificate_validation"
          ? tlsRecommendedAction
          : "Retry county lookup or review provider diagnostics.";

      console.warn("Property tax metro provider request failed", {
        strategyKey: countyStrategy.key,
        county: normalizedCounty,
        error: failure.message,
        providerErrorType: failure.kind,
        providerErrorCode: failure.code,
        carverCaPemConfigured,
        nodeExtraCaCertsConfigured: extraCaConfigured,
        recommendedAction:
          failure.kind === "tls_certificate_validation"
            ? tlsRecommendedAction
            : "Retry county lookup and review provider diagnostics."
      });
    }

    const estimatedFallback = estimateAnnualPropertyTaxDetailed({
      normalizedAddress: normalizedAddressText,
      county: normalizedCounty,
      state: normalizedState,
      requestedTaxYear,
      strategyKey: countyStrategy.key,
      purchasePrice,
      valuationBasis,
      matchingNotes,
      fallbackReason,
      retrievalNotes,
      rawEvidence: fallbackRawEvidence
    });
    estimatedFallback.cache_metadata = {
      key: cacheKey,
      hit: false,
      ttl_ms:
        estimatedFallback.result_type === "estimated"
          ? ESTIMATE_CACHE_TTL_MS
          : RESULT_CACHE_TTL_MS
    };
    writeToCache(cacheKey, estimatedFallback);
    return estimatedFallback;
  }

  const result = estimateAnnualPropertyTaxDetailed({
    normalizedAddress: normalizedAddressText,
    county: normalizedCounty,
    state: normalizedState,
    requestedTaxYear,
    strategyKey: countyStrategy.key,
    purchasePrice,
    valuationBasis,
    matchingNotes
  });
  result.cache_metadata = {
    key: cacheKey,
    hit: false,
    ttl_ms:
      result.result_type === "estimated" ? ESTIMATE_CACHE_TTL_MS : RESULT_CACHE_TTL_MS
  };
  writeToCache(cacheKey, result);
  return result;
}

export function computeAnnualPropertyTax(
  args: PropertyTaxComputationArgs
): PropertyTaxComputationResult {
  if (!Number.isFinite(args.purchasePrice) || args.purchasePrice <= 0) {
    throw new Error("Purchase price must be greater than 0.");
  }

  if (
    typeof args.actualAnnualTax === "number" &&
    Number.isFinite(args.actualAnnualTax) &&
    args.actualAnnualTax > 0
  ) {
    return {
      annualTax: roundCurrency(args.actualAnnualTax),
      source: "User Provided",
      warnings: []
    };
  }

  if (!isMinnesota(args.state ?? null)) {
    throw new Error(MINNESOTA_ADDRESS_ONLY_MESSAGE);
  }

  const county = normalizeCountyName(args.county);
  if (!county) {
    throw new Error(MISSING_COUNTY_WARNING);
  }

  const resolution = resolveCountyRate(county);
  const annualTax = roundCurrency(args.purchasePrice * resolution.rate);

  return {
    annualTax,
    source: "Estimated Using County Rate",
    rateUsed: resolution.rate,
    countyUsed: county,
    warnings: resolution.usedDefaultRate ? [DEFAULT_WARNING] : []
  };
}
