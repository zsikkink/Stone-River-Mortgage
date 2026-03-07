import { CountyTaxObservation, CountyTaxProvider, ParcelMatch } from "../../types";
import { createMetroArcGisCountyProvider } from "./arcGisProvider";
import {
  getParcelLookupCandidates,
  normalizeParcelId,
  parseCurrency
} from "./authoritativeCountyUtils";
import { fetchWithTimeout } from "../../../server/fetch-timeout";

const WASHINGTON_BASE_URL = "https://mn-washington.publicaccessnow.com";
const QUICK_SEARCH_PATH = "/DesktopModules/QuickSearch/API/Module/GetData";

type WashingtonSearchItem = {
  quickSearchKey?: string;
  fields?: Record<string, unknown>;
};

type WashingtonBillReference = {
  taxYear: number;
  billUrl: string;
  y: string;
  n: string;
  b: string;
};

function normalizeParcelForComparison(value: string | null | undefined): string {
  return (value || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export function formatWashingtonParcelId(value: string): string {
  const normalized = normalizeParcelId(value);
  if (normalized.compact && normalized.compact.includes(".")) {
    return normalized.compact;
  }

  const digits = normalized.digits || "";
  if (digits.length === 13) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 7)}.${digits.slice(
      7,
      9
    )}.${digits.slice(9, 13)}`;
  }

  return value;
}

function parseVerificationToken(html: string): string | null {
  const tokenMatch = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/i);
  return tokenMatch?.[1] ?? null;
}

function parseTabId(html: string): string | null {
  const tabMatch = html.match(/sf_tabId`:\`(\d+)\`/i);
  return tabMatch?.[1] ?? null;
}

function readSetCookies(headers: Headers): string[] {
  const extended = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof extended.getSetCookie === "function") {
    return extended.getSetCookie();
  }

  const cookieHeader = headers.get("set-cookie");
  return cookieHeader ? [cookieHeader] : [];
}

function mergeCookies(existing: string, setCookies: string[]): string {
  const map = new Map<string, string>();

  if (existing) {
    for (const part of existing.split(";")) {
      const trimmed = part.trim();
      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }
      map.set(trimmed.slice(0, separatorIndex), trimmed.slice(separatorIndex + 1));
    }
  }

  for (const rawCookie of setCookies) {
    const keyValue = rawCookie.split(";")[0]?.trim();
    if (!keyValue) {
      continue;
    }

    const separatorIndex = keyValue.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    map.set(keyValue.slice(0, separatorIndex), keyValue.slice(separatorIndex + 1));
  }

  return Array.from(map.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

export function extractWashingtonBillReferences(payload: unknown): WashingtonBillReference[] {
  const references: WashingtonBillReference[] = [];

  if (!payload || typeof payload !== "object") {
    return references;
  }

  const payloadRecord = payload as Record<string, unknown>;
  const groups = Array.isArray(payloadRecord.groups)
    ? payloadRecord.groups
    : [];

  for (const group of groups) {
    if (!group || typeof group !== "object") {
      continue;
    }

    const rows = Array.isArray((group as Record<string, unknown>).rows)
      ? ((group as Record<string, unknown>).rows as Array<Record<string, unknown>>)
      : [];

    for (const row of rows) {
      const values = Array.isArray(row.values)
        ? (row.values as Array<Record<string, unknown>>)
        : [];

      const taxYearValue = values.find((value) => value.column === "TaxYear")?.value;
      const taxYear = Number.parseInt(String(taxYearValue ?? ""), 10);
      if (!Number.isFinite(taxYear) || taxYear <= 0) {
        continue;
      }

      const hyperlinkValue = values.find(
        (value) => typeof value.hyperlink === "string" && /BillDetail\.aspx/i.test(String(value.hyperlink))
      )?.hyperlink;
      if (typeof hyperlinkValue !== "string") {
        continue;
      }

      const billUrl = new URL(hyperlinkValue, WASHINGTON_BASE_URL).toString();
      const params = new URL(billUrl).searchParams;
      const y = params.get("y");
      const n = params.get("n");
      const b = params.get("b");

      if (!y || !n || !b) {
        continue;
      }

      references.push({
        taxYear,
        billUrl,
        y,
        n,
        b
      });
    }
  }

  return references;
}

export function extractWashingtonNetTax(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const payloadRecord = payload as Record<string, unknown>;

  const totalRows = Array.isArray(payloadRecord.grandTotals)
    ? payloadRecord.grandTotals
    : Array.isArray(payloadRecord.totals)
      ? payloadRecord.totals
      : [];

  for (const row of totalRows) {
    if (!row || typeof row !== "object") {
      continue;
    }

    const rowRecord = row as Record<string, unknown>;
    if (String(rowRecord.column) !== "NetTaxAmount") {
      continue;
    }

    const parsed = parseCurrency(String(rowRecord.value ?? ""));
    if (typeof parsed === "number") {
      return parsed;
    }
  }

  return null;
}

function resolveWashingtonParcelIds(parcel: ParcelMatch): string[] {
  const parcelCandidates = getParcelLookupCandidates(parcel);
  const formatted = parcelCandidates.map((candidate) => formatWashingtonParcelId(candidate));
  return Array.from(new Set([...formatted, ...parcelCandidates]));
}

function selectWashingtonSearchItem(payload: unknown, parcelCandidates: string[]): WashingtonSearchItem | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const payloadRecord = payload as Record<string, unknown>;
  const items = Array.isArray(payloadRecord.items)
    ? (payloadRecord.items as WashingtonSearchItem[])
    : [];

  if (!items.length) {
    return null;
  }

  const normalizedCandidates = parcelCandidates.map((candidate) =>
    normalizeParcelForComparison(candidate)
  );

  const matchingItem = items.find((item) => {
    const parcelId = String(item.fields?.ParcelID ?? item.quickSearchKey ?? "");
    const normalizedParcel = normalizeParcelForComparison(parcelId);
    return normalizedCandidates.some((candidate) =>
      normalizedParcel.includes(candidate) || candidate.includes(normalizedParcel)
    );
  });

  return matchingItem ?? items[0] ?? null;
}

async function fetchWashingtonTaxObservation(args: {
  parcel: ParcelMatch;
  requestTaxYear: number;
  requestFormattedAddress: string | null;
}): Promise<CountyTaxObservation | null> {
  const parcelCandidates = resolveWashingtonParcelIds(args.parcel);
  const searchKeyword = parcelCandidates[0];
  if (!searchKeyword) {
    return null;
  }

  const quickSearchUrl = new URL(QUICK_SEARCH_PATH, WASHINGTON_BASE_URL);
  quickSearchUrl.searchParams.set("keywords", searchKeyword);
  quickSearchUrl.searchParams.set("page", "1");

  const quickSearchResponse = await fetchWithTimeout(quickSearchUrl.toString(), {
    method: "GET",
    headers: {
      ModuleId: "438",
      TabId: "49"
    },
    cache: "no-store"
  }, { timeoutMs: 12000 });

  if (!quickSearchResponse.ok) {
    return null;
  }

  const quickSearchPayload = (await quickSearchResponse.json()) as unknown;
  const selectedItem = selectWashingtonSearchItem(quickSearchPayload, parcelCandidates);
  if (!selectedItem) {
    return null;
  }

  const parcelId = String(
    selectedItem.fields?.ParcelID ??
      selectedItem.fields?.PrimaryKey ??
      selectedItem.quickSearchKey ??
      ""
  ).trim();
  const alternateKey = String(selectedItem.fields?.AlternateKey ?? "").trim();
  if (!parcelId || !alternateKey) {
    return null;
  }

  let cookieHeader = "";

  const accountUrl = new URL("/TaxSearch/Account.aspx", WASHINGTON_BASE_URL);
  accountUrl.searchParams.set("p", parcelId);
  accountUrl.searchParams.set("a", alternateKey);

  const accountResponse = await fetchWithTimeout(accountUrl.toString(), {
    method: "GET",
    cache: "no-store"
  }, { timeoutMs: 12000 });
  cookieHeader = mergeCookies(cookieHeader, readSetCookies(accountResponse.headers));
  if (!accountResponse.ok) {
    return null;
  }

  const accountHtml = await accountResponse.text();
  const accountToken = parseVerificationToken(accountHtml);
  const accountTabId = parseTabId(accountHtml);
  if (!accountToken || !accountTabId) {
    return null;
  }

  const historyUrl = new URL("/API/DataDisplay/DataSources/GetData", WASHINGTON_BASE_URL);
  historyUrl.searchParams.set("_m", "449");
  historyUrl.searchParams.set("p", parcelId);
  historyUrl.searchParams.set("a", alternateKey);

  const historyResponse = await fetchWithTimeout(historyUrl.toString(), {
    method: "GET",
    headers: {
      ModuleId: "449",
      TabId: accountTabId,
      __RequestVerificationToken: accountToken,
      ...(cookieHeader ? { Cookie: cookieHeader } : {})
    },
    cache: "no-store"
  }, { timeoutMs: 12000 });
  cookieHeader = mergeCookies(cookieHeader, readSetCookies(historyResponse.headers));
  if (!historyResponse.ok) {
    return null;
  }

  const historyPayload = (await historyResponse.json()) as unknown;
  const billReferences = extractWashingtonBillReferences(historyPayload);
  if (!billReferences.length) {
    return null;
  }

  const latestBill = [...billReferences].sort((left, right) => right.taxYear - left.taxYear)[0];
  const billDetailResponse = await fetchWithTimeout(latestBill.billUrl, {
    method: "GET",
    headers: cookieHeader ? { Cookie: cookieHeader } : undefined,
    cache: "no-store"
  }, { timeoutMs: 12000 });
  cookieHeader = mergeCookies(cookieHeader, readSetCookies(billDetailResponse.headers));
  if (!billDetailResponse.ok) {
    return null;
  }

  const billDetailHtml = await billDetailResponse.text();
  const billToken = parseVerificationToken(billDetailHtml) ?? accountToken;
  const billTabId = parseTabId(billDetailHtml) ?? accountTabId;

  const amountUrl = new URL("/API/DataDisplay/DataSources/GetData", WASHINGTON_BASE_URL);
  amountUrl.searchParams.set("_m", "471");
  amountUrl.searchParams.set("p", parcelId);
  amountUrl.searchParams.set("a", alternateKey);
  amountUrl.searchParams.set("y", latestBill.y);
  amountUrl.searchParams.set("n", latestBill.n);
  amountUrl.searchParams.set("b", latestBill.b);

  const amountResponse = await fetchWithTimeout(amountUrl.toString(), {
    method: "GET",
    headers: {
      ModuleId: "471",
      TabId: billTabId,
      __RequestVerificationToken: billToken,
      ...(cookieHeader ? { Cookie: cookieHeader } : {})
    },
    cache: "no-store"
  }, { timeoutMs: 12000 });

  if (!amountResponse.ok) {
    return null;
  }

  const amountPayload = (await amountResponse.json()) as unknown;
  const annualTax = extractWashingtonNetTax(amountPayload);
  if (typeof annualTax !== "number") {
    return null;
  }

  const yearMatched = latestBill.taxYear === args.requestTaxYear;
  return {
    county: "Washington",
    parcel_id: parcelId,
    tax_year: latestBill.taxYear,
    annual_property_tax: annualTax,
    source_kind: "county_api",
    source_name: "Washington County Property Tax Search",
    source_url: latestBill.billUrl,
    raw_evidence: {
      quick_search_url: quickSearchUrl.toString(),
      selected_parcel_id: parcelId,
      selected_alternate_key: alternateKey,
      payment_history_url: historyUrl.toString(),
      bill_detail_url: latestBill.billUrl,
      amount_url: amountUrl.toString()
    },
    retrieval_notes: [
      "Parcel discovered using MetroGIS parcel layer, then verified through Washington County tax workflow.",
      `Washington County returned ${latestBill.taxYear} annual tax ${annualTax.toFixed(2)}.`,
      yearMatched
        ? `Requested tax year ${args.requestTaxYear} matched county tax year ${latestBill.taxYear}.`
        : `Requested tax year ${args.requestTaxYear}; county source latest available year is ${latestBill.taxYear}.`
    ],
    matched_address: args.parcel.situsAddress || args.requestFormattedAddress,
    confidence_inputs: {
      confidence: yearMatched ? "high" : "medium",
      authoritative_source_used: true,
      bill_reference_count: billReferences.length
    }
  };
}

const baseProvider = createMetroArcGisCountyProvider({
  county: "Washington"
});

export const washingtonCountyTaxProvider: CountyTaxProvider = {
  ...baseProvider,
  providerKey: "mn-washington-authoritative-tax-provider-v2",
  sourceName: "Washington County Property Tax Search",
  sourceRootUrl: WASHINGTON_BASE_URL,
  async fetchTaxObservation(parcel, request) {
    return fetchWashingtonTaxObservation({
      parcel,
      requestTaxYear: request.taxYear,
      requestFormattedAddress: request.formattedAddress
    });
  }
};
