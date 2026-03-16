import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { isMetroPriorityCounty } from "./propertyTax/strategyRegistry";

export const DAILY_PRICING_AUTH_COOKIE = "srm_dailypricing_session";

const DEFAULT_LOCAL_DATA_DIR = path.join(process.cwd(), ".data");
const DEFAULT_SERVERLESS_DATA_DIR = "/tmp/stone-river-mortgage";
const ALLOW_DEFAULT_SEEDED_CREDENTIALS_ENV =
  "DAILY_PRICING_ALLOW_DEFAULT_SEEDED_CREDENTIALS";
const DAILY_PRICING_KV_REST_URL =
  process.env.DAILY_PRICING_KV_REST_URL ||
  process.env.KV_REST_API_URL ||
  process.env.UPSTASH_REDIS_REST_URL ||
  "";
const DAILY_PRICING_KV_REST_TOKEN =
  process.env.DAILY_PRICING_KV_REST_TOKEN ||
  process.env.KV_REST_API_TOKEN ||
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  "";
const DAILY_PRICING_KV_KEY =
  process.env.DAILY_PRICING_KV_KEY || "stone-river-mortgage:daily-pricing:v1";
const DAILY_PRICING_ANALYTICS_V2_KV_KEY =
  process.env.DAILY_PRICING_ANALYTICS_V2_KV_KEY ||
  `${DAILY_PRICING_KV_KEY}:analytics:v2`;
type EnvMap = Record<string, string | undefined>;

export function resolveDailyPricingDataDir(
  env: EnvMap = process.env
): string {
  const configuredDir = env.DAILY_PRICING_DATA_DIR?.trim();
  if (configuredDir) {
    return path.isAbsolute(configuredDir)
      ? configuredDir
      : path.resolve(process.cwd(), configuredDir);
  }

  if (env.VERCEL || env.AWS_LAMBDA_FUNCTION_NAME || env.NODE_ENV === "production") {
    return DEFAULT_SERVERLESS_DATA_DIR;
  }

  return DEFAULT_LOCAL_DATA_DIR;
}

const DATA_DIR = resolveDailyPricingDataDir();
const STORE_PATH = path.join(DATA_DIR, "daily-pricing.json");
const ANALYTICS_V2_PATH = path.join(DATA_DIR, "daily-pricing-analytics-v2.json");
const SESSION_DURATION_MS = 1000 * 60 * 60 * 12;

const DEFAULT_SEEDED_EMAIL = "mikesikkink99@gmail.com";
const DEFAULT_SEEDED_PASSWORD = "Lending1!";
const SEEDED_EMAIL = normalizeEmail(
  process.env.DAILY_PRICING_SEEDED_EMAIL || DEFAULT_SEEDED_EMAIL
);
const SEEDED_PASSWORD =
  process.env.DAILY_PRICING_SEEDED_PASSWORD || DEFAULT_SEEDED_PASSWORD;

type UserRecord = {
  email: string;
  salt: string;
  passwordHash: string;
};

type SessionRecord = {
  token: string;
  email: string;
  expiresAt: string;
};

export type PricingFees = {
  underwritingFee: number;
  appraisalFee: number;
  creditReportFee: number;
  mersFee: number;
  floodCertFee: number;
  taxServiceFee: number;
  settlementFee: number;
  titlePrepFee: number;
  lenderTitlePolicy: number;
  ownerTitlePolicy: number;
  countyRecording: number;
  conservationFee: number;
  brokerageAdminFee: number;
};

export type PricingFooter = {
  estimatedChargesLine: string;
  interestAvailabilityPrefix: string;
  companyLine: string;
  pricingUpdatedPrefix: string;
  contactLine: string;
};

export type EditablePricingConfig = {
  interestRate: number;
  discountPointFactor: number;
  aprSpread: number;
  loanTerm: string;
  propertyTaxAnnualRate: number;
  homeownersInsuranceRate: number;
  homeownersInsuranceRoundDownTo: number;
  mortgageInsuranceMonthly: number;
  hoaMonthly: number;
  mortgageRegistrationTaxRate: number;
  monthEndInterestDays: number;
  fees: PricingFees;
  footer: PricingFooter;
};

export type PricingConfig = EditablePricingConfig & {
  lastUpdatedAt: string | null;
  lastUpdatedBy: string | null;
};

export type PricingRateHistoryRecord = {
  id: string;
  interestRate: number;
  discountPointFactor: number;
  changedAt: string;
  changedBy: string | null;
};

type LegacyDailyPricingAnalytics = {
  pdfGeneratedCount: number;
  propertyTaxLookupOutcomesByCounty: Record<string, PropertyTaxLookupOutcomeCounts>;
  propertyTaxLookupNonMetroCount: number;
  propertyTaxCurrentOrPreviousYearRecordFoundCount: number;
};

export type DailyPricingTrackedAddressRecord = {
  address: string;
  county: string;
  isMetroCounty: boolean;
  firstPdfGeneratedAt: string;
  lastPdfGeneratedAt: string;
  pdfGeneratedCount: number;
  firstPdfPropertyTaxOutcome: PropertyTaxLookupOutcomeCategory;
};

export type DailyPricingAnalytics = {
  pdfGeneratedCount: number;
  addressesByKey: Record<string, DailyPricingTrackedAddressRecord>;
};

export type PropertyTaxLookupOutcomeCounts = {
  currentYear: number;
  previousYear: number;
  olderYear: number;
  failed: number;
};

type PropertyTaxLookupRecordInput = {
  resultType: "county_retrieved" | "estimated" | "unresolved";
  actualTaxYearUsed: number | null | undefined;
  currentYear?: number;
};

type TransactionSummaryAnalyticsRecordInput = {
  address: string;
  county: string | null | undefined;
  propertyTaxSource:
    | "User Provided"
    | "Estimated Using County Rate"
    | "County Retrieved"
    | null
    | undefined;
  propertyTaxActualYearUsed: number | null | undefined;
  currentYear?: number;
  generatedAt?: string;
};

export type PropertyTaxLookupOutcomeCategory =
  | "current_year"
  | "previous_year"
  | "older_year"
  | "failed";

type PricingStore = {
  users: UserRecord[];
  sessions: SessionRecord[];
  pricing: PricingConfig;
  pricingRateHistory: PricingRateHistoryRecord[];
  analytics: LegacyDailyPricingAnalytics;
};

let inMemoryStoreFallback: PricingStore | null = null;
let hasLoggedInMemoryStoreFallback = false;
let inMemoryAnalyticsFallback: DailyPricingAnalytics | null = null;
let hasLoggedInMemoryAnalyticsFallback = false;

const DEFAULT_PRICING: EditablePricingConfig = {
  interestRate: 5.625,
  // Percent style entry (0.933 => 0.933%).
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
  }
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString("hex");
}

function createSeedUser(): UserRecord {
  const salt = randomBytes(16).toString("hex");
  return {
    email: SEEDED_EMAIL,
    salt,
    passwordHash: hashPassword(SEEDED_PASSWORD, salt)
  };
}

export function seededCredentialsUsingDefaults(): boolean {
  return (
    SEEDED_EMAIL === normalizeEmail(DEFAULT_SEEDED_EMAIL) &&
    SEEDED_PASSWORD === DEFAULT_SEEDED_PASSWORD
  );
}

export function getDailyPricingAuthWarning(
  env: EnvMap = process.env
): string | null {
  const isProduction = env.NODE_ENV === "production";
  const allowDefaultCredentials =
    env[ALLOW_DEFAULT_SEEDED_CREDENTIALS_ENV] === "true";
  if (
    isProduction &&
    !allowDefaultCredentials &&
    seededCredentialsUsingDefaults()
  ) {
    return `Daily Pricing login is disabled in production until DAILY_PRICING_SEEDED_EMAIL and DAILY_PRICING_SEEDED_PASSWORD are configured (or set ${ALLOW_DEFAULT_SEEDED_CREDENTIALS_ENV}=true to override).`;
  }

  return null;
}

export function getDailyPricingStorageDiagnostics(): {
  dataDir: string;
  storageMode: "filesystem" | "memory_fallback" | "kv_rest";
  serverlessFilesystemRisk: boolean;
  kvConfigured: boolean;
} {
  const kvConfigured = isDailyPricingKvConfigured();
  return {
    dataDir: DATA_DIR,
    storageMode: kvConfigured
      ? "kv_rest"
      : inMemoryStoreFallback
        ? "memory_fallback"
        : "filesystem",
    serverlessFilesystemRisk:
      !kvConfigured && isServerlessRuntime(process.env) && !inMemoryStoreFallback,
    kvConfigured
  };
}

function assertDailyPricingAuthConfiguredForProduction(): void {
  const warning = getDailyPricingAuthWarning();
  if (warning) {
    throw new Error(warning);
  }
}

function defaultStore(): PricingStore {
  return {
    users: [createSeedUser()],
    sessions: [],
    pricing: {
      ...DEFAULT_PRICING,
      lastUpdatedAt: null,
      lastUpdatedBy: null
    },
    pricingRateHistory: [],
    analytics: createDefaultLegacyAnalytics()
  };
}

function isDailyPricingKvConfigured(): boolean {
  return Boolean(
    DAILY_PRICING_KV_REST_URL.trim() && DAILY_PRICING_KV_REST_TOKEN.trim()
  );
}

function isServerlessRuntime(env: EnvMap = process.env): boolean {
  return Boolean(env.VERCEL || env.AWS_LAMBDA_FUNCTION_NAME);
}

function createDefaultLegacyAnalytics(): LegacyDailyPricingAnalytics {
  return {
    pdfGeneratedCount: 0,
    propertyTaxLookupOutcomesByCounty: {},
    propertyTaxLookupNonMetroCount: 0,
    propertyTaxCurrentOrPreviousYearRecordFoundCount: 0
  };
}

function createDefaultAnalytics(): DailyPricingAnalytics {
  return {
    pdfGeneratedCount: 0,
    addressesByKey: {}
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toNumberWithFallback(params: {
  value: unknown;
  fallback: number;
  min?: number;
  max?: number;
  allowZero?: boolean;
}): number {
  const { value, fallback, min, max, allowZero = true } = params;
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  if (!allowZero && parsed === 0) {
    return fallback;
  }

  if (typeof min === "number" && parsed < min) {
    return fallback;
  }

  if (typeof max === "number" && parsed > max) {
    return fallback;
  }

  return parsed;
}

function toStringWithFallback(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : fallback;
}

function normalizeStoredLegacyAnalytics(
  input: unknown
): LegacyDailyPricingAnalytics {
  const source = isObject(input) ? input : {};
  const byCountySource = isObject(source.propertyTaxLookupCountByCounty)
    ? source.propertyTaxLookupCountByCounty
    : {};
  const byCountyOutcomesSource = isObject(source.propertyTaxLookupOutcomesByCounty)
    ? source.propertyTaxLookupOutcomesByCounty
    : {};

  const byCounty: Record<string, number> = {};
  for (const [key, value] of Object.entries(byCountySource)) {
    const county = key.trim();
    if (!county) {
      continue;
    }

    const count = Number(value);
    if (!Number.isFinite(count) || count < 0) {
      continue;
    }

    byCounty[county] = Math.floor(count);
  }

  const byCountyOutcomes: Record<string, PropertyTaxLookupOutcomeCounts> = {};
  for (const [key, value] of Object.entries(byCountyOutcomesSource)) {
    const county = key.trim();
    if (!county || !isObject(value)) {
      continue;
    }

    byCountyOutcomes[county] = {
      currentYear: Math.floor(
        toNumberWithFallback({
          value: value.currentYear,
          fallback: 0,
          min: 0
        })
      ),
      previousYear: Math.floor(
        toNumberWithFallback({
          value: value.previousYear,
          fallback: 0,
          min: 0
        })
      ),
      olderYear: Math.floor(
        toNumberWithFallback({
          value: value.olderYear,
          fallback: 0,
          min: 0
        })
      ),
      failed: Math.floor(
        toNumberWithFallback({
          value: value.failed,
          fallback: 0,
          min: 0
        })
      )
    };
  }

  for (const [county, count] of Object.entries(byCounty)) {
    if (!byCountyOutcomes[county]) {
      byCountyOutcomes[county] = {
        currentYear: 0,
        previousYear: 0,
        olderYear: 0,
        failed: count
      };
      continue;
    }

    const outcomeTotal = Object.values(byCountyOutcomes[county]).reduce(
      (sum, value) => sum + value,
      0
    );
    if (outcomeTotal < count) {
      byCountyOutcomes[county].failed += count - outcomeTotal;
    }
  }

  return {
    pdfGeneratedCount: Math.floor(
      toNumberWithFallback({
        value: source.pdfGeneratedCount,
        fallback: 0,
        min: 0
      })
    ),
    propertyTaxLookupOutcomesByCounty: byCountyOutcomes,
    propertyTaxLookupNonMetroCount: Math.floor(
      toNumberWithFallback({
        value: source.propertyTaxLookupNonMetroCount,
        fallback: 0,
        min: 0
      })
    ),
    propertyTaxCurrentOrPreviousYearRecordFoundCount: Math.floor(
      toNumberWithFallback({
        value: source.propertyTaxCurrentOrPreviousYearRecordFoundCount,
        fallback: 0,
        min: 0
      })
    )
  };
}

function normalizeStoredTrackedAddressRecord(
  input: unknown
): DailyPricingTrackedAddressRecord | null {
  if (!isObject(input)) {
    return null;
  }

  const address = normalizeAnalyticsAddressDisplay(
    typeof input.address === "string" ? input.address : ""
  );
  if (!address) {
    return null;
  }

  const county = normalizeAnalyticsCounty(
    typeof input.county === "string" ? input.county : null
  );
  const pdfGeneratedCount = Math.floor(
    toNumberWithFallback({
      value: input.pdfGeneratedCount,
      fallback: 0,
      min: 0
    })
  );
  const firstPdfGeneratedAt =
    typeof input.firstPdfGeneratedAt === "string" &&
    input.firstPdfGeneratedAt.trim()
      ? input.firstPdfGeneratedAt
      : new Date(0).toISOString();
  const lastPdfGeneratedAt =
    typeof input.lastPdfGeneratedAt === "string" &&
    input.lastPdfGeneratedAt.trim()
      ? input.lastPdfGeneratedAt
      : firstPdfGeneratedAt;
  const outcome = classifyStoredPropertyTaxOutcome(input.firstPdfPropertyTaxOutcome);
  const isMetroCounty =
    typeof input.isMetroCounty === "boolean"
      ? input.isMetroCounty
      : isMetroPriorityCounty(county);

  return {
    address,
    county,
    isMetroCounty,
    firstPdfGeneratedAt,
    lastPdfGeneratedAt,
    pdfGeneratedCount,
    firstPdfPropertyTaxOutcome: outcome
  };
}

function normalizeStoredAnalytics(input: unknown): DailyPricingAnalytics {
  const source = isObject(input) ? input : {};
  const addressesByKeySource = isObject(source.addressesByKey)
    ? source.addressesByKey
    : {};

  const addressesByKey: Record<string, DailyPricingTrackedAddressRecord> = {};
  for (const [rawKey, value] of Object.entries(addressesByKeySource)) {
    const record = normalizeStoredTrackedAddressRecord(value);
    if (!record) {
      continue;
    }

    const normalizedKey = normalizeAnalyticsAddressKey(rawKey || record.address);
    addressesByKey[normalizedKey] = record;
  }

  return {
    pdfGeneratedCount: Math.floor(
      toNumberWithFallback({
        value: source.pdfGeneratedCount,
        fallback: 0,
        min: 0
      })
    ),
    addressesByKey
  };
}

function normalizeStoredPricingRateHistory(
  input: unknown
): PricingRateHistoryRecord[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const normalized: PricingRateHistoryRecord[] = [];
  for (const entry of input) {
    if (!isObject(entry)) {
      continue;
    }

    const id =
      typeof entry.id === "string" && entry.id.trim()
        ? entry.id.trim()
        : randomBytes(8).toString("hex");
    const interestRate = Number(entry.interestRate);
    const discountPointFactor = Number(entry.discountPointFactor);
    const changedAt =
      typeof entry.changedAt === "string" && entry.changedAt.trim()
        ? entry.changedAt
        : new Date(0).toISOString();
    const changedBy =
      typeof entry.changedBy === "string" && entry.changedBy.trim()
        ? normalizeEmail(entry.changedBy)
        : null;

    if (!Number.isFinite(interestRate) || !Number.isFinite(discountPointFactor)) {
      continue;
    }

    normalized.push({
      id,
      interestRate,
      discountPointFactor,
      changedAt,
      changedBy
    });
  }

  return normalized.sort((left, right) =>
    left.changedAt < right.changedAt ? 1 : -1
  );
}

function normalizeStoredPricing(input: unknown): PricingConfig {
  const source = isObject(input) ? input : {};
  const feesSource = isObject(source.fees) ? source.fees : {};
  const footerSource = isObject(source.footer) ? source.footer : {};

  return {
    interestRate: toNumberWithFallback({
      value: source.interestRate,
      fallback: DEFAULT_PRICING.interestRate,
      min: 0.0001,
      allowZero: false
    }),
    discountPointFactor: toNumberWithFallback({
      value: source.discountPointFactor,
      fallback: DEFAULT_PRICING.discountPointFactor,
      min: -5,
      max: 5
    }),
    aprSpread: toNumberWithFallback({
      value: source.aprSpread,
      fallback: DEFAULT_PRICING.aprSpread,
      min: 0
    }),
    loanTerm: toStringWithFallback(source.loanTerm, DEFAULT_PRICING.loanTerm),
    propertyTaxAnnualRate: toNumberWithFallback({
      value: source.propertyTaxAnnualRate,
      fallback: DEFAULT_PRICING.propertyTaxAnnualRate,
      min: 0
    }),
    homeownersInsuranceRate: toNumberWithFallback({
      value: source.homeownersInsuranceRate,
      fallback: DEFAULT_PRICING.homeownersInsuranceRate,
      min: 0
    }),
    homeownersInsuranceRoundDownTo: toNumberWithFallback({
      value: source.homeownersInsuranceRoundDownTo,
      fallback: DEFAULT_PRICING.homeownersInsuranceRoundDownTo,
      min: 1,
      allowZero: false
    }),
    mortgageInsuranceMonthly: toNumberWithFallback({
      value: source.mortgageInsuranceMonthly,
      fallback: DEFAULT_PRICING.mortgageInsuranceMonthly,
      min: 0
    }),
    hoaMonthly: toNumberWithFallback({
      value: source.hoaMonthly,
      fallback: DEFAULT_PRICING.hoaMonthly,
      min: 0
    }),
    mortgageRegistrationTaxRate: toNumberWithFallback({
      value: source.mortgageRegistrationTaxRate,
      fallback: DEFAULT_PRICING.mortgageRegistrationTaxRate,
      min: 0
    }),
    monthEndInterestDays: toNumberWithFallback({
      value: source.monthEndInterestDays,
      fallback: DEFAULT_PRICING.monthEndInterestDays,
      min: 0
    }),
    fees: {
      underwritingFee: toNumberWithFallback({
        value: feesSource.underwritingFee,
        fallback: DEFAULT_PRICING.fees.underwritingFee,
        min: 0
      }),
      appraisalFee: toNumberWithFallback({
        value: feesSource.appraisalFee,
        fallback: DEFAULT_PRICING.fees.appraisalFee,
        min: 0
      }),
      creditReportFee: toNumberWithFallback({
        value: feesSource.creditReportFee,
        fallback: DEFAULT_PRICING.fees.creditReportFee,
        min: 0
      }),
      mersFee: toNumberWithFallback({
        value: feesSource.mersFee,
        fallback: DEFAULT_PRICING.fees.mersFee,
        min: 0
      }),
      floodCertFee: toNumberWithFallback({
        value: feesSource.floodCertFee,
        fallback: DEFAULT_PRICING.fees.floodCertFee,
        min: 0
      }),
      taxServiceFee: toNumberWithFallback({
        value: feesSource.taxServiceFee,
        fallback: DEFAULT_PRICING.fees.taxServiceFee,
        min: 0
      }),
      settlementFee: toNumberWithFallback({
        value: feesSource.settlementFee,
        fallback: DEFAULT_PRICING.fees.settlementFee,
        min: 0
      }),
      titlePrepFee: toNumberWithFallback({
        value: feesSource.titlePrepFee,
        fallback: DEFAULT_PRICING.fees.titlePrepFee,
        min: 0
      }),
      lenderTitlePolicy: toNumberWithFallback({
        value: feesSource.lenderTitlePolicy,
        fallback: DEFAULT_PRICING.fees.lenderTitlePolicy,
        min: 0
      }),
      ownerTitlePolicy: toNumberWithFallback({
        value: feesSource.ownerTitlePolicy,
        fallback: DEFAULT_PRICING.fees.ownerTitlePolicy,
        min: 0
      }),
      countyRecording: toNumberWithFallback({
        value: feesSource.countyRecording,
        fallback: DEFAULT_PRICING.fees.countyRecording,
        min: 0
      }),
      conservationFee: toNumberWithFallback({
        value: feesSource.conservationFee,
        fallback: DEFAULT_PRICING.fees.conservationFee,
        min: 0
      }),
      brokerageAdminFee: toNumberWithFallback({
        value: feesSource.brokerageAdminFee,
        fallback: DEFAULT_PRICING.fees.brokerageAdminFee,
        min: 0
      })
    },
    footer: {
      estimatedChargesLine: toStringWithFallback(
        footerSource.estimatedChargesLine,
        DEFAULT_PRICING.footer.estimatedChargesLine
      ),
      interestAvailabilityPrefix: toStringWithFallback(
        footerSource.interestAvailabilityPrefix,
        DEFAULT_PRICING.footer.interestAvailabilityPrefix
      ),
      companyLine: toStringWithFallback(
        footerSource.companyLine,
        DEFAULT_PRICING.footer.companyLine
      ),
      pricingUpdatedPrefix: toStringWithFallback(
        footerSource.pricingUpdatedPrefix,
        DEFAULT_PRICING.footer.pricingUpdatedPrefix
      ),
      contactLine: toStringWithFallback(
        footerSource.contactLine,
        DEFAULT_PRICING.footer.contactLine
      )
    },
    lastUpdatedAt:
      typeof source.lastUpdatedAt === "string" ? source.lastUpdatedAt : null,
    lastUpdatedBy:
      typeof source.lastUpdatedBy === "string" ? source.lastUpdatedBy : null
  };
}

function isPricingStore(value: unknown): value is PricingStore {
  if (!isObject(value)) {
    return false;
  }

  return Array.isArray(value.users) && Array.isArray(value.sessions);
}

function verifyPassword(password: string, user: UserRecord): boolean {
  const attempted = Buffer.from(hashPassword(password, user.salt), "hex");
  const expected = Buffer.from(user.passwordHash, "hex");

  if (attempted.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(attempted, expected);
}

function pruneExpiredSessions(store: PricingStore): boolean {
  const now = Date.now();
  const beforeCount = store.sessions.length;
  store.sessions = store.sessions.filter((session) => {
    const expiresAt = new Date(session.expiresAt).getTime();
    return Number.isFinite(expiresAt) && expiresAt > now;
  });

  return beforeCount !== store.sessions.length;
}

async function writeStore(store: PricingStore): Promise<void> {
  if (isDailyPricingKvConfigured()) {
    try {
      await writeStoreToKv(store);
      inMemoryStoreFallback = null;
      return;
    } catch (error) {
      console.warn("Daily pricing store failed to write to KV REST backend.", {
        error: error instanceof Error ? error.message : "unknown"
      });
    }
  }

  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
    inMemoryStoreFallback = null;
    return;
  } catch (error) {
    inMemoryStoreFallback = store;
    if (!hasLoggedInMemoryStoreFallback) {
      hasLoggedInMemoryStoreFallback = true;
      console.warn(
        "Daily pricing store is using in-memory fallback because filesystem writes are unavailable.",
        {
          dataDir: DATA_DIR,
          error: error instanceof Error ? error.message : "unknown"
        }
      );
    }
  }
}

function getDailyPricingKvBaseUrl(): string {
  return DAILY_PRICING_KV_REST_URL.replace(/\/+$/g, "");
}

function getDailyPricingKvHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${DAILY_PRICING_KV_REST_TOKEN}`,
    "Content-Type": "text/plain; charset=utf-8"
  };
}

async function kvGetValue(key: string): Promise<string | null> {
  const baseUrl = getDailyPricingKvBaseUrl();
  const response = await fetch(`${baseUrl}/get/${encodeURIComponent(key)}`, {
    method: "GET",
    headers: getDailyPricingKvHeaders(),
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`KV GET failed with status ${response.status}.`);
  }

  const payload: unknown = await response.json();
  if (!isObject(payload)) {
    return null;
  }

  return typeof payload.result === "string" ? payload.result : null;
}

async function kvSetValue(key: string, value: string): Promise<void> {
  const baseUrl = getDailyPricingKvBaseUrl();
  const response = await fetch(`${baseUrl}/set/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: getDailyPricingKvHeaders(),
    body: value,
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`KV SET failed with status ${response.status}.`);
  }
}

async function writeStoreToKv(store: PricingStore): Promise<void> {
  await kvSetValue(DAILY_PRICING_KV_KEY, JSON.stringify(store));
}

async function writeAnalyticsToKv(
  analytics: DailyPricingAnalytics
): Promise<void> {
  await kvSetValue(DAILY_PRICING_ANALYTICS_V2_KV_KEY, JSON.stringify(analytics));
}

async function readAnalyticsFromKv(): Promise<DailyPricingAnalytics | null> {
  const raw = await kvGetValue(DAILY_PRICING_ANALYTICS_V2_KV_KEY);
  if (!raw) {
    return null;
  }

  const parsed: unknown = JSON.parse(raw);
  return normalizeStoredAnalytics(parsed);
}

async function readAnalyticsFromFile(): Promise<DailyPricingAnalytics | null> {
  if (inMemoryAnalyticsFallback) {
    return inMemoryAnalyticsFallback;
  }

  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const raw = await fs.readFile(ANALYTICS_V2_PATH, "utf8");
    const parsed: unknown = JSON.parse(raw);
    return normalizeStoredAnalytics(parsed);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return null;
    }

    throw error;
  }
}

async function writeAnalyticsToFile(
  analytics: DailyPricingAnalytics
): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(ANALYTICS_V2_PATH, JSON.stringify(analytics, null, 2), "utf8");
    inMemoryAnalyticsFallback = null;
  } catch (error) {
    inMemoryAnalyticsFallback = analytics;
    if (!hasLoggedInMemoryAnalyticsFallback) {
      hasLoggedInMemoryAnalyticsFallback = true;
      console.warn(
        "Daily pricing analytics are using in-memory fallback because filesystem writes are unavailable.",
        {
          dataDir: DATA_DIR,
          error: error instanceof Error ? error.message : "unknown"
        }
      );
    }
  }
}

async function readStoreFromKv(): Promise<PricingStore | null> {
  const raw = await kvGetValue(DAILY_PRICING_KV_KEY);
  if (!raw) {
    return null;
  }

  const parsed: unknown = JSON.parse(raw);
  if (!isPricingStore(parsed)) {
    return null;
  }

  const store: PricingStore = {
    users: parsed.users,
    sessions: parsed.sessions,
    pricing: normalizeStoredPricing(parsed.pricing),
    pricingRateHistory: normalizeStoredPricingRateHistory(
      (parsed as Record<string, unknown>).pricingRateHistory
    ),
    analytics: normalizeStoredLegacyAnalytics(parsed.analytics)
  };

  const seededEmail = normalizeEmail(SEEDED_EMAIL);
  const hasSeededUser = store.users.some(
    (user) => normalizeEmail(user.email) === seededEmail
  );
  if (!hasSeededUser) {
    store.users.push(createSeedUser());
  }

  pruneExpiredSessions(store);
  return store;
}

async function ensureStore(): Promise<PricingStore> {
  if (isDailyPricingKvConfigured()) {
    try {
      const existingStore = await readStoreFromKv();
      if (existingStore) {
        return existingStore;
      }

      const seededStore = defaultStore();
      await writeStoreToKv(seededStore);
      return seededStore;
    } catch (error) {
      console.warn("Daily pricing store failed to read from KV REST backend.", {
        error: error instanceof Error ? error.message : "unknown"
      });
      const seededStore = defaultStore();
      await writeStore(seededStore);
      return seededStore;
    }
  }

  if (inMemoryStoreFallback) {
    return inMemoryStoreFallback;
  }

  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed: unknown = JSON.parse(raw);

    if (!isPricingStore(parsed)) {
      const reset = defaultStore();
      await writeStore(reset);
      return inMemoryStoreFallback ?? reset;
    }

    const store: PricingStore = {
      users: parsed.users,
      sessions: parsed.sessions,
      pricing: normalizeStoredPricing(parsed.pricing),
      pricingRateHistory: normalizeStoredPricingRateHistory(
        (parsed as Record<string, unknown>).pricingRateHistory
      ),
      analytics: normalizeStoredLegacyAnalytics(parsed.analytics)
    };

    const seededEmail = normalizeEmail(SEEDED_EMAIL);
    const hasSeededUser = store.users.some(
      (user) => normalizeEmail(user.email) === seededEmail
    );

    let mutated = pruneExpiredSessions(store);

    if (!hasSeededUser) {
      store.users.push(createSeedUser());
      mutated = true;
    }

    if (mutated) {
      await writeStore(store);
    }

    return inMemoryStoreFallback ?? store;
  } catch {
    const seeded = defaultStore();
    await writeStore(seeded);
    return inMemoryStoreFallback ?? seeded;
  }
}

function requireObject(value: unknown, fieldName: string): Record<string, unknown> {
  if (!isObject(value)) {
    throw new Error(`${fieldName} must be an object.`);
  }
  return value;
}

function requireNumber(params: {
  name: string;
  value: unknown;
  min?: number;
  max?: number;
  allowZero?: boolean;
}): number {
  const { name, value, min, max, allowZero = true } = params;
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a valid number.`);
  }

  if (!allowZero && parsed === 0) {
    throw new Error(`${name} must be greater than 0.`);
  }

  if (typeof min === "number" && parsed < min) {
    throw new Error(`${name} must be at least ${min}.`);
  }

  if (typeof max === "number" && parsed > max) {
    throw new Error(`${name} must be at most ${max}.`);
  }

  return parsed;
}

function requireString(name: string, value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} is required.`);
  }
  return value.trim();
}

export function parsePricingConfigUpdate(input: unknown): EditablePricingConfig {
  const source = requireObject(input, "pricing");
  const fees = requireObject(source.fees, "pricing.fees");
  const footer = requireObject(source.footer, "pricing.footer");

  return {
    interestRate: requireNumber({
      name: "interestRate",
      value: source.interestRate,
      min: 0.0001,
      allowZero: false
    }),
    discountPointFactor: requireNumber({
      name: "discountPointFactor",
      value: source.discountPointFactor,
      min: -5,
      max: 5
    }),
    aprSpread: requireNumber({
      name: "aprSpread",
      value: source.aprSpread,
      min: 0
    }),
    loanTerm: requireString("loanTerm", source.loanTerm),
    propertyTaxAnnualRate: requireNumber({
      name: "propertyTaxAnnualRate",
      value: source.propertyTaxAnnualRate,
      min: 0
    }),
    homeownersInsuranceRate: requireNumber({
      name: "homeownersInsuranceRate",
      value: source.homeownersInsuranceRate,
      min: 0
    }),
    homeownersInsuranceRoundDownTo: requireNumber({
      name: "homeownersInsuranceRoundDownTo",
      value: source.homeownersInsuranceRoundDownTo,
      min: 1,
      allowZero: false
    }),
    mortgageInsuranceMonthly: requireNumber({
      name: "mortgageInsuranceMonthly",
      value: source.mortgageInsuranceMonthly,
      min: 0
    }),
    hoaMonthly: requireNumber({
      name: "hoaMonthly",
      value: source.hoaMonthly,
      min: 0
    }),
    mortgageRegistrationTaxRate: requireNumber({
      name: "mortgageRegistrationTaxRate",
      value: source.mortgageRegistrationTaxRate,
      min: 0
    }),
    monthEndInterestDays: requireNumber({
      name: "monthEndInterestDays",
      value: source.monthEndInterestDays,
      min: 0
    }),
    fees: {
      underwritingFee: requireNumber({
        name: "fees.underwritingFee",
        value: fees.underwritingFee,
        min: 0
      }),
      appraisalFee: requireNumber({
        name: "fees.appraisalFee",
        value: fees.appraisalFee,
        min: 0
      }),
      creditReportFee: requireNumber({
        name: "fees.creditReportFee",
        value: fees.creditReportFee,
        min: 0
      }),
      mersFee: requireNumber({
        name: "fees.mersFee",
        value: fees.mersFee,
        min: 0
      }),
      floodCertFee: requireNumber({
        name: "fees.floodCertFee",
        value: fees.floodCertFee,
        min: 0
      }),
      taxServiceFee: requireNumber({
        name: "fees.taxServiceFee",
        value: fees.taxServiceFee,
        min: 0
      }),
      settlementFee: requireNumber({
        name: "fees.settlementFee",
        value: fees.settlementFee,
        min: 0
      }),
      titlePrepFee: requireNumber({
        name: "fees.titlePrepFee",
        value: fees.titlePrepFee,
        min: 0
      }),
      lenderTitlePolicy: requireNumber({
        name: "fees.lenderTitlePolicy",
        value: fees.lenderTitlePolicy,
        min: 0
      }),
      ownerTitlePolicy: requireNumber({
        name: "fees.ownerTitlePolicy",
        value: fees.ownerTitlePolicy,
        min: 0
      }),
      countyRecording: requireNumber({
        name: "fees.countyRecording",
        value: fees.countyRecording,
        min: 0
      }),
      conservationFee: requireNumber({
        name: "fees.conservationFee",
        value: fees.conservationFee,
        min: 0
      }),
      brokerageAdminFee: requireNumber({
        name: "fees.brokerageAdminFee",
        value: fees.brokerageAdminFee,
        min: 0
      })
    },
    footer: {
      estimatedChargesLine: requireString(
        "footer.estimatedChargesLine",
        footer.estimatedChargesLine
      ),
      interestAvailabilityPrefix: requireString(
        "footer.interestAvailabilityPrefix",
        footer.interestAvailabilityPrefix
      ),
      companyLine: requireString("footer.companyLine", footer.companyLine),
      pricingUpdatedPrefix: requireString(
        "footer.pricingUpdatedPrefix",
        footer.pricingUpdatedPrefix
      ),
      contactLine: requireString("footer.contactLine", footer.contactLine)
    }
  };
}

export async function getPricingConfig(): Promise<PricingConfig> {
  const store = await ensureStore();
  return store.pricing;
}

export async function getPricingRateHistory(): Promise<PricingRateHistoryRecord[]> {
  const store = await ensureStore();
  return [...store.pricingRateHistory].sort((left, right) =>
    left.changedAt < right.changedAt ? 1 : -1
  );
}

export async function getDailyPricingAnalytics(): Promise<DailyPricingAnalytics> {
  if (isDailyPricingKvConfigured()) {
    return (await readAnalyticsFromKv()) ?? createDefaultAnalytics();
  }

  return (await readAnalyticsFromFile()) ?? createDefaultAnalytics();
}

function normalizeAnalyticsCounty(county: string | null | undefined): string {
  if (!county || !county.trim()) {
    return "Unknown";
  }

  return county
    .trim()
    .replace(/\s+County$/i, "")
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function normalizeAnalyticsAddressDisplay(address: string): string {
  return address
    .replace(/,\s*USA\s*$/i, "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAnalyticsAddressKey(address: string): string {
  const normalizedDisplayAddress = normalizeAnalyticsAddressDisplay(address);
  return normalizedDisplayAddress.toLowerCase();
}

function classifyStoredPropertyTaxOutcome(
  value: unknown
): PropertyTaxLookupOutcomeCategory {
  if (
    value === "current_year" ||
    value === "previous_year" ||
    value === "older_year" ||
    value === "failed"
  ) {
    return value;
  }

  return "failed";
}

export function wasCurrentOrPreviousYearRecordFound(
  input: Pick<
    PropertyTaxLookupRecordInput,
    "resultType" | "actualTaxYearUsed" | "currentYear"
  >
): boolean {
  const outcome = classifyPropertyTaxLookupOutcome(input);
  return outcome === "current_year" || outcome === "previous_year";
}

function createDefaultCountyOutcomeCounts(): PropertyTaxLookupOutcomeCounts {
  return {
    currentYear: 0,
    previousYear: 0,
    olderYear: 0,
    failed: 0
  };
}

function countPropertyTaxLookupOutcomeCounts(
  outcomes: PropertyTaxLookupOutcomeCounts
): number {
  return (
    outcomes.currentYear +
    outcomes.previousYear +
    outcomes.olderYear +
    outcomes.failed
  );
}

export function classifyPropertyTaxLookupOutcome(
  input: Pick<
    PropertyTaxLookupRecordInput,
    "resultType" | "actualTaxYearUsed" | "currentYear"
  >
): PropertyTaxLookupOutcomeCategory {
  if (input.resultType !== "county_retrieved") {
    return "failed";
  }

  if (
    typeof input.actualTaxYearUsed !== "number" ||
    !Number.isFinite(input.actualTaxYearUsed)
  ) {
    return "failed";
  }

  const currentYear = input.currentYear ?? new Date().getFullYear();
  const year = Math.floor(input.actualTaxYearUsed);
  if (year >= currentYear) {
    return "current_year";
  }

  if (year === currentYear - 1) {
    return "previous_year";
  }

  return "older_year";
}

function classifyTransactionSummaryPropertyTaxOutcome(
  input: Pick<
    TransactionSummaryAnalyticsRecordInput,
    "propertyTaxSource" | "propertyTaxActualYearUsed" | "currentYear"
  >
): PropertyTaxLookupOutcomeCategory {
  return classifyPropertyTaxLookupOutcome({
    resultType:
      input.propertyTaxSource === "County Retrieved"
        ? "county_retrieved"
        : "unresolved",
    actualTaxYearUsed: input.propertyTaxActualYearUsed,
    currentYear: input.currentYear
  });
}

export function recordTransactionSummaryGeneratedForAnalytics(
  analytics: DailyPricingAnalytics,
  input: TransactionSummaryAnalyticsRecordInput
): DailyPricingAnalytics {
  const normalizedAddress = normalizeAnalyticsAddressDisplay(input.address);
  if (!normalizedAddress) {
    return analytics;
  }

  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const addressKey = normalizeAnalyticsAddressKey(normalizedAddress);
  analytics.pdfGeneratedCount += 1;

  const existingRecord = analytics.addressesByKey[addressKey];
  if (existingRecord) {
    existingRecord.pdfGeneratedCount += 1;
    existingRecord.lastPdfGeneratedAt = generatedAt;
    return analytics;
  }

  const county = normalizeAnalyticsCounty(input.county);
  analytics.addressesByKey[addressKey] = {
    address: normalizedAddress,
    county,
    isMetroCounty: isMetroPriorityCounty(county),
    firstPdfGeneratedAt: generatedAt,
    lastPdfGeneratedAt: generatedAt,
    pdfGeneratedCount: 1,
    firstPdfPropertyTaxOutcome: classifyTransactionSummaryPropertyTaxOutcome(input)
  };

  return analytics;
}

export type DailyPricingTrackedAddress = {
  address: string;
  county: string;
  firstPdfGeneratedAt: string;
  lastPdfGeneratedAt: string;
  pdfGeneratedCount: number;
};

export type DailyPricingCountyPerformance = {
  totalUniqueAddresses: number;
  currentYearCount: number;
  previousYearCount: number;
  olderYearCount: number;
  failedCount: number;
  currentYearRate: number;
  previousYearRate: number;
  olderYearRate: number;
  failedRate: number;
};

export function summarizeDailyPricingAnalytics(params: {
  analytics: DailyPricingAnalytics;
  currentYear?: number;
}): {
  trackedAddresses: DailyPricingTrackedAddress[];
  uniqueAddressCount: number;
  nonMetroUniqueAddressCount: number;
  currentYear: number;
  previousYear: number;
  currentOrPreviousYearSuccessfulAddressCount: number;
  currentOrPreviousYearSuccessRate: number | null;
  countyPerformanceByUniqueAddress: Record<string, DailyPricingCountyPerformance>;
} {
  const currentYear = params.currentYear ?? new Date().getFullYear();
  const previousYear = currentYear - 1;
  const trackedAddressRecords = Object.values(params.analytics.addressesByKey).sort(
    (left, right) => {
      if (left.firstPdfGeneratedAt === right.firstPdfGeneratedAt) {
        return left.address.localeCompare(right.address);
      }

      return left.firstPdfGeneratedAt < right.firstPdfGeneratedAt ? 1 : -1;
    }
  );
  const uniqueAddressCount = trackedAddressRecords.length;
  const nonMetroUniqueAddressCount = trackedAddressRecords.reduce(
    (count, record) => count + (record.isMetroCounty ? 0 : 1),
    0
  );
  const currentOrPreviousYearSuccessfulAddressCount = trackedAddressRecords.reduce(
    (count, record) =>
      count +
      (record.firstPdfPropertyTaxOutcome === "current_year" ||
      record.firstPdfPropertyTaxOutcome === "previous_year"
        ? 1
        : 0),
    0
  );
  const countyCounts = trackedAddressRecords.reduce<
    Record<string, PropertyTaxLookupOutcomeCounts>
  >((result, record) => {
    const county = record.county;
    const existing = result[county] ?? createDefaultCountyOutcomeCounts();
    if (record.firstPdfPropertyTaxOutcome === "current_year") {
      existing.currentYear += 1;
    } else if (record.firstPdfPropertyTaxOutcome === "previous_year") {
      existing.previousYear += 1;
    } else if (record.firstPdfPropertyTaxOutcome === "older_year") {
      existing.olderYear += 1;
    } else {
      existing.failed += 1;
    }
    result[county] = existing;
    return result;
  }, {});

  const countyPerformanceByUniqueAddress = Object.fromEntries(
    Object.entries(countyCounts).map(([county, outcomes]) => {
      const totalUniqueAddresses = countPropertyTaxLookupOutcomeCounts(outcomes);
      const toRate = (value: number): number =>
        totalUniqueAddresses > 0 ? value / totalUniqueAddresses : 0;

      return [
        county,
        {
          totalUniqueAddresses,
          currentYearCount: outcomes.currentYear,
          previousYearCount: outcomes.previousYear,
          olderYearCount: outcomes.olderYear,
          failedCount: outcomes.failed,
          currentYearRate: toRate(outcomes.currentYear),
          previousYearRate: toRate(outcomes.previousYear),
          olderYearRate: toRate(outcomes.olderYear),
          failedRate: toRate(outcomes.failed)
        }
      ];
    })
  );

  return {
    trackedAddresses: trackedAddressRecords.map((record) => ({
      address: record.address,
      county: record.county,
      firstPdfGeneratedAt: record.firstPdfGeneratedAt,
      lastPdfGeneratedAt: record.lastPdfGeneratedAt,
      pdfGeneratedCount: record.pdfGeneratedCount
    })),
    uniqueAddressCount,
    nonMetroUniqueAddressCount,
    currentYear,
    previousYear,
    currentOrPreviousYearSuccessfulAddressCount,
    currentOrPreviousYearSuccessRate:
      uniqueAddressCount > 0
        ? currentOrPreviousYearSuccessfulAddressCount / uniqueAddressCount
        : null,
    countyPerformanceByUniqueAddress
  };
}

export async function recordTransactionSummaryGenerated(
  input: TransactionSummaryAnalyticsRecordInput
): Promise<void> {
  if (isDailyPricingKvConfigured()) {
    const analytics = (await readAnalyticsFromKv()) ?? createDefaultAnalytics();
    recordTransactionSummaryGeneratedForAnalytics(analytics, input);
    await writeAnalyticsToKv(analytics);
    return;
  }

  const analytics = (await readAnalyticsFromFile()) ?? createDefaultAnalytics();
  recordTransactionSummaryGeneratedForAnalytics(analytics, input);
  await writeAnalyticsToFile(analytics);
}

export async function loginWithCredentials(
  email: string,
  password: string
): Promise<{ token: string; email: string } | null> {
  assertDailyPricingAuthConfiguredForProduction();

  const normalizedEmail = normalizeEmail(email);
  const store = await ensureStore();
  const user = store.users.find(
    (candidate) => normalizeEmail(candidate.email) === normalizedEmail
  );

  if (!user || !verifyPassword(password, user)) {
    return null;
  }

  pruneExpiredSessions(store);

  const token = randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
  store.sessions.push({
    token,
    email: normalizedEmail,
    expiresAt
  });

  await writeStore(store);
  return { token, email: normalizedEmail };
}

export async function getSessionEmail(token: string): Promise<string | null> {
  if (!token) {
    return null;
  }

  const store = await ensureStore();
  const hadExpired = pruneExpiredSessions(store);

  const session = store.sessions.find((candidate) => candidate.token === token);
  if (hadExpired) {
    await writeStore(store);
  }

  return session ? normalizeEmail(session.email) : null;
}

export async function logoutSession(token: string): Promise<void> {
  if (!token) {
    return;
  }

  const store = await ensureStore();
  const beforeCount = store.sessions.length;
  store.sessions = store.sessions.filter((session) => session.token !== token);

  if (beforeCount !== store.sessions.length) {
    await writeStore(store);
  }
}

export async function updatePricingConfig(params: {
  pricing: EditablePricingConfig;
  updatedBy: string;
}): Promise<PricingConfig> {
  assertDailyPricingAuthConfiguredForProduction();

  const store = await ensureStore();
  const normalizedUpdatedBy = normalizeEmail(params.updatedBy);
  const now = new Date().toISOString();
  const ratesChanged =
    store.pricing.interestRate !== params.pricing.interestRate ||
    store.pricing.discountPointFactor !== params.pricing.discountPointFactor;

  if (ratesChanged) {
    store.pricingRateHistory.unshift({
      id: randomBytes(12).toString("hex"),
      interestRate: params.pricing.interestRate,
      discountPointFactor: params.pricing.discountPointFactor,
      changedAt: now,
      changedBy: normalizedUpdatedBy
    });
  }

  store.pricing = {
    ...params.pricing,
    lastUpdatedAt: now,
    lastUpdatedBy: normalizedUpdatedBy
  };

  await writeStore(store);
  return store.pricing;
}
