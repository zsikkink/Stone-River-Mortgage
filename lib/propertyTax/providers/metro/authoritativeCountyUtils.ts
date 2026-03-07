import { ParcelMatch } from "../../types";
import { fetchWithTimeout } from "../../../server/fetch-timeout";

export type CookieJar = Map<string, string>;
export type CookieAwareFetchResult = {
  response: Response;
  finalUrl: string;
  setCookies: string[];
  transport?: string;
};
export type CookieAwareFetch = (
  url: string,
  init: RequestInit
) => Promise<CookieAwareFetchResult>;

export type YearAmountCandidate = {
  year: number;
  amount: number;
  rowText: string;
  rowHtml?: string;
};

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

export function normalizeWhitespace(value: string): string {
  return decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
}

export function stripTags(value: string): string {
  return normalizeWhitespace(value.replace(/<[^>]+>/g, " "));
}

export function parseCurrency(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/[^0-9.\-]/g, "");
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

export function normalizeParcelId(value: string | null | undefined): {
  compact: string | null;
  digits: string | null;
} {
  if (!value) {
    return { compact: null, digits: null };
  }

  const compact = value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const digits = value.replace(/\D/g, "");

  return {
    compact: compact || null,
    digits: digits || null
  };
}

export function getParcelLookupCandidates(parcel: ParcelMatch): string[] {
  const candidates = new Set<string>();

  const add = (value: unknown) => {
    if (typeof value !== "string") {
      return;
    }

    const normalized = normalizeParcelId(value);
    if (normalized.compact) {
      candidates.add(normalized.compact);
    }
    if (normalized.digits) {
      candidates.add(normalized.digits);
    }
  };

  add(parcel.parcelId);
  if (parcel.raw.attributes && typeof parcel.raw.attributes === "object") {
    const attrs = parcel.raw.attributes as Record<string, unknown>;
    add(attrs.COUNTY_PIN);
    add(attrs.STATE_PIN);
  }

  return Array.from(candidates.values());
}

function readSetCookies(headers: Headers): string[] {
  const extended = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof extended.getSetCookie === "function") {
    return extended.getSetCookie();
  }

  const singleHeader = headers.get("set-cookie");
  return singleHeader ? [singleHeader] : [];
}

function upsertCookie(jar: CookieJar, rawCookie: string): void {
  const keyValue = rawCookie.split(";")[0]?.trim();
  if (!keyValue) {
    return;
  }

  const separatorIndex = keyValue.indexOf("=");
  if (separatorIndex <= 0) {
    return;
  }

  const name = keyValue.slice(0, separatorIndex).trim();
  const value = keyValue.slice(separatorIndex + 1).trim();
  if (!name) {
    return;
  }

  jar.set(name, value);
}

export function createCookieJar(): CookieJar {
  return new Map<string, string>();
}

export function cookieHeaderValue(jar: CookieJar): string | null {
  const parts = Array.from(jar.entries()).map(([name, value]) => `${name}=${value}`);
  return parts.length ? parts.join("; ") : null;
}

export async function fetchWithCookies(
  url: string,
  init: RequestInit,
  jar: CookieJar,
  fetchImpl?: CookieAwareFetch
): Promise<CookieAwareFetchResult> {
  const headers = new Headers(init.headers ?? {});
  const cookieHeader = cookieHeaderValue(jar);
  if (cookieHeader && !headers.has("Cookie")) {
    headers.set("Cookie", cookieHeader);
  }

  const resolvedFetch: CookieAwareFetch =
    fetchImpl ??
    (async (requestUrl, requestInit) => {
      const response = await fetchWithTimeout(requestUrl, {
        ...requestInit,
        redirect: "follow",
        cache: "no-store"
      }, { timeoutMs: 12000 });
      return {
        response,
        finalUrl: response.url || requestUrl,
        setCookies: readSetCookies(response.headers),
        transport: "default_fetch"
      };
    });

  const result = await resolvedFetch(url, {
    ...init,
    headers
  });
  const setCookies = result.setCookies.length
    ? result.setCookies
    : readSetCookies(result.response.headers);
  for (const setCookie of setCookies) {
    upsertCookie(jar, setCookie);
  }

  return {
    ...result,
    finalUrl: result.finalUrl || url
  };
}

export function extractHiddenInputs(html: string): Record<string, string> {
  const hiddenFields: Record<string, string> = {};
  const inputPattern = /<input\b[^>]*>/gi;

  for (const inputMatch of html.matchAll(inputPattern)) {
    const inputTag = inputMatch[0];
    const nameMatch = inputTag.match(/\bname=(?:"([^"]*)"|'([^']*)')/i);
    if (!nameMatch) {
      continue;
    }

    const name = nameMatch[1] || nameMatch[2] || "";
    if (!name) {
      continue;
    }

    const valueMatch = inputTag.match(/\bvalue=(?:"([^"]*)"|'([^']*)')/i);
    const value = valueMatch ? valueMatch[1] || valueMatch[2] || "" : "";
    hiddenFields[name] = decodeHtmlEntities(value);
  }

  return hiddenFields;
}

function resolveUrl(baseUrl: string, href: string): string {
  return new URL(href, baseUrl).toString();
}

export function findDataletLink(params: {
  html: string;
  baseUrl: string;
  preferredModes: string[];
}): string | null {
  const modePriority = params.preferredModes.map((mode) => mode.toLowerCase());
  const links: Array<{ href: string; mode: string | null }> = [];

  for (const match of params.html.matchAll(/href=(?:"([^"]+)"|'([^']+)')/gi)) {
    const hrefRaw = match[1] || match[2] || "";
    if (!/datalet\.aspx\?/i.test(hrefRaw)) {
      continue;
    }

    const href = decodeHtmlEntities(hrefRaw);
    const lowerHref = href.toLowerCase();
    const modeMatch = lowerHref.match(/[?&]mode=([^&]+)/i);
    links.push({
      href: resolveUrl(params.baseUrl, href),
      mode: modeMatch ? modeMatch[1].toLowerCase() : null
    });
  }

  for (const preferredMode of modePriority) {
    const preferred = links.find((link) => link.mode === preferredMode);
    if (preferred) {
      return preferred.href;
    }
  }

  return links[0]?.href ?? null;
}

export function extractYearAmountCandidatesFromRows(html: string): YearAmountCandidate[] {
  const candidates: YearAmountCandidate[] = [];

  for (const rowMatch of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rowHtml = rowMatch[1] || "";
    const rowText = stripTags(rowHtml);

    const yearMatch = rowText.match(/\b(20\d{2})\b/);
    if (!yearMatch) {
      continue;
    }

    const year = Number.parseInt(yearMatch[1], 10);
    if (!Number.isFinite(year) || year <= 0) {
      continue;
    }

    const amountMatches = Array.from(
      rowText.matchAll(/\$?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.\d{2}))/g)
    )
      .map((amountMatch) => parseCurrency(amountMatch[1]))
      .filter((amount): amount is number => typeof amount === "number");

    if (!amountMatches.length) {
      continue;
    }

    const amount = amountMatches[amountMatches.length - 1];
    candidates.push({
      year,
      amount,
      rowText,
      rowHtml
    });
  }

  return candidates;
}

function scoreYearAmountCandidate(candidate: YearAmountCandidate): number {
  const text = candidate.rowText.toLowerCase();
  let score = candidate.year * 10;

  if (/total\s+payable/.test(text) || /total\s+due/.test(text)) {
    score += 200;
  }

  if (/total\s+tax/.test(text) || /net\s+tax/.test(text)) {
    score += 100;
  }

  if (/pay\s*year/.test(text) || /payable/.test(text)) {
    score += 50;
  }

  score += Math.round(candidate.amount);
  return score;
}

export function selectLatestYearAmount(
  candidates: YearAmountCandidate[]
): YearAmountCandidate | null {
  if (!candidates.length) {
    return null;
  }

  const sorted = [...candidates].sort((left, right) => {
    const scoreDelta = scoreYearAmountCandidate(right) - scoreYearAmountCandidate(left);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    if (right.year !== left.year) {
      return right.year - left.year;
    }

    return right.amount - left.amount;
  });

  return sorted[0] ?? null;
}

function requiresDisclaimer(html: string, finalUrl: string): boolean {
  return /disclaimer\.aspx/i.test(finalUrl) || /\bbtagree\b/i.test(html);
}

export async function fetchPublicAccessDataletHtml(params: {
  baseUrl: string;
  parcelQuery: string;
  preferredModes: string[];
  modeOverride?: string;
  fetchImpl?: CookieAwareFetch;
}): Promise<{ dataletUrl: string; dataletHtml: string; requestTransport: string } | null> {
  const jar = createCookieJar();
  const combinedSearchUrl = new URL(
    "/search/commonsearch.aspx?mode=combined",
    params.baseUrl
  ).toString();
  const disclaimerUrl = new URL(
    "/search/Disclaimer.aspx?FromUrl=%2Fsearch%2Fcommonsearch.aspx%3Fmode%3Dcombined",
    params.baseUrl
  ).toString();

  let requestTransport = "default_fetch";
  let responseResult = await fetchWithCookies(
    combinedSearchUrl,
    { method: "GET" },
    jar,
    params.fetchImpl
  );
  let response = responseResult.response;
  requestTransport = responseResult.transport || requestTransport;
  let html = await response.text();

  if (requiresDisclaimer(html, responseResult.finalUrl)) {
    const disclaimerFields = extractHiddenInputs(html);
    const disclaimerBody = new URLSearchParams(disclaimerFields);
    disclaimerBody.set("btAgree", "Agree");
    if (!disclaimerBody.get("hdURL")) {
      disclaimerBody.set("hdURL", "/search/commonsearch.aspx?mode=combined");
    }

    const disclaimerResult = await fetchWithCookies(
      disclaimerUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: disclaimerBody.toString()
      },
      jar,
      params.fetchImpl
    );
    requestTransport = disclaimerResult.transport || requestTransport;

    responseResult = await fetchWithCookies(
      combinedSearchUrl,
      { method: "GET" },
      jar,
      params.fetchImpl
    );
    requestTransport = responseResult.transport || requestTransport;
    response = responseResult.response;
    html = await response.text();
  }

  const searchFields = extractHiddenInputs(html);
  const searchBody = new URLSearchParams(searchFields);
  searchBody.set("mode", "PARID");
  searchBody.set("inpParid", params.parcelQuery);
  searchBody.set("btSearch", "Search");

  const searchResult = await fetchWithCookies(
    combinedSearchUrl,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: searchBody.toString()
    },
    jar,
    params.fetchImpl
  );
  requestTransport = searchResult.transport || requestTransport;
  const searchResponse = searchResult.response;

  if (!searchResponse.ok) {
    return null;
  }

  const searchHtml = await searchResponse.text();
  const responseUrl = searchResult.finalUrl || combinedSearchUrl;
  const modeOverride =
    typeof params.modeOverride === "string" && params.modeOverride.trim()
      ? params.modeOverride.trim()
      : null;

  let dataletUrl: string | null = null;
  if (/\/datalets\/datalet\.aspx\?/i.test(responseUrl)) {
    dataletUrl = responseUrl;
  }

  const objectMovedLinkMatch = searchHtml.match(
    /href=(?:"([^"]*datalets\/datalet\.aspx\?[^"]*)"|'([^']*datalets\/datalet\.aspx\?[^']*)')/i
  );
  if (!dataletUrl && objectMovedLinkMatch) {
    const href = decodeHtmlEntities(
      objectMovedLinkMatch[1] || objectMovedLinkMatch[2] || ""
    );
    if (href) {
      dataletUrl = resolveUrl(params.baseUrl, href);
    }
  }

  const preferredDataletUrl = findDataletLink({
    html: searchHtml,
    baseUrl: params.baseUrl,
    preferredModes: params.preferredModes
  });
  if (preferredDataletUrl) {
    dataletUrl = preferredDataletUrl;
  }

  if (!dataletUrl) {
    return null;
  }

  if (modeOverride) {
    const modeUrl = new URL(dataletUrl);
    modeUrl.searchParams.set("mode", modeOverride);
    dataletUrl = modeUrl.toString();
  }

  const dataletResult = await fetchWithCookies(
    dataletUrl,
    { method: "GET" },
    jar,
    params.fetchImpl
  );
  requestTransport = dataletResult.transport || requestTransport;
  const dataletResponse = dataletResult.response;
  if (!dataletResponse.ok) {
    return null;
  }

  const dataletHtml = await dataletResponse.text();
  return {
    dataletUrl,
    dataletHtml,
    requestTransport
  };
}
