export type PropertyTaxResultType =
  | "county_retrieved"
  | "estimated"
  | "unresolved";
export type PropertyTaxConfidence = "high" | "medium" | "low";
export type PropertyTaxYearMatchStatus =
  | "matched"
  | "latest_available_used"
  | "unknown";
export type PropertyTaxSourceKind =
  | "official_county"
  | "county_page"
  | "county_statement"
  | "county_api"
  | "county_rate_table"
  | "fallback";

export type PropertyTaxValuationBasis = {
  kind: "purchase_price";
  amount: number;
  currency: "USD";
};

export type NormalizedAddressForPropertyTax = {
  formattedAddress?: string | null;
  county?: string | null;
  state?: string | null;
  lat?: number | null;
  lng?: number | null;
  purchasePrice?: number | null;
  taxYear?: number | null;
};

export type CountyStrategyPriority = "metro" | "statewide";

export type CountyTaxStrategy = {
  key: string;
  priority: CountyStrategyPriority;
  county: string | null;
  mode: "county_provider_with_fallback" | "estimate_rate_table";
  notes: string[];
};

export type CountyTaxProviderRequest = {
  formattedAddress: string | null;
  county: string;
  state: string;
  lat: number | null;
  lng: number | null;
  taxYear: number;
};

export type ParcelMatch = {
  parcelId: string | null;
  objectId: number | null;
  situsAddress: string | null;
  annualPropertyTax: number | null;
  taxYear: number | null;
  distanceMeters: number | null;
  sourceUrl: string;
  raw: Record<string, unknown>;
};

export type CountyTaxObservation = {
  county: string;
  parcel_id: string | null;
  tax_year: number;
  annual_property_tax: number;
  source_kind: "official_county" | "county_page" | "county_statement" | "county_api";
  source_name: string;
  source_url: string;
  raw_evidence: Record<string, unknown>;
  retrieval_notes: string[];
  matched_address: string | null;
  confidence_inputs: Record<string, unknown>;
};

export type CountyTaxProvider = {
  county: string;
  providerKey: string;
  sourceName: string;
  sourceRootUrl: string;
  canHandle: (county: string | null | undefined) => boolean;
  searchProperty: (
    request: CountyTaxProviderRequest
  ) => Promise<ParcelMatch[]>;
  chooseBestParcel: (
    matches: ParcelMatch[],
    request: CountyTaxProviderRequest
  ) => ParcelMatch | null;
  fetchTaxObservation: (
    parcel: ParcelMatch,
    request: CountyTaxProviderRequest
  ) => Promise<CountyTaxObservation | null>;
};

export type PropertyTaxResult = {
  normalized_address: string | null;
  county: string | null;
  state: string | null;
  parcel_id: string | null;
  requested_tax_year: number | null;
  actual_tax_year_used: number | null;
  year_match_status: PropertyTaxYearMatchStatus;
  tax_year: number;
  annual_property_tax: number | null;
  result_type: PropertyTaxResultType;
  confidence: PropertyTaxConfidence;
  source_kind: PropertyTaxSourceKind;
  source_name: string;
  source_url: string | null;
  matching_notes: string[];
  estimation_notes: string[];
  retrieval_notes?: string[];
  raw_evidence: Record<string, unknown>;
  fetched_at: string;
  strategy_key: string;
  fallback_reason?: string | null;
  valuation_basis?: PropertyTaxValuationBasis | null;
  audit_metadata?: Record<string, unknown>;
  cache_metadata?: {
    key: string;
    hit: boolean;
    ttl_ms: number;
  };
};
