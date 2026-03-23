import { inflateRawSync, inflateSync } from "node:zlib";
import { CountyTaxObservation, CountyTaxProvider, ParcelMatch } from "../../types";
import { createMetroArcGisCountyProvider } from "./arcGisProvider";
import {
  getParcelLookupCandidates,
  normalizeParcelId,
  parseCurrency
} from "./authoritativeCountyUtils";
import { fetchWithTimeout } from "../../../server/fetch-timeout";

const DAKOTA_BASE_URL = "https://propertysearch.co.dakota.mn.us/PropertyInformationOnline";
const DAKOTA_HISTORY_PATH = "TaxStatementHistory.aspx";
const DAKOTA_STATEMENT_PDF_PATH = "TaxStatement_PDF.aspx";

export type DakotaStatementLink = {
  year: number;
  url: string;
};

export function parseDakotaStatementLinks(html: string, baseUrl = DAKOTA_BASE_URL): DakotaStatementLink[] {
  const links: DakotaStatementLink[] = [];

  for (const match of html.matchAll(/href=['"]([^'"]*TaxStatement_PDF\.aspx\?[^'"]+)['"]/gi)) {
    const href = match[1].replace(/&amp;/g, "&");
    const absoluteUrl = new URL(href, `${baseUrl}/`).toString();
    const yearMatch = absoluteUrl.match(/[?&]Year=(\d{4})/i);
    if (!yearMatch) {
      continue;
    }

    const year = Number.parseInt(yearMatch[1], 10);
    if (!Number.isFinite(year) || year <= 0) {
      continue;
    }

    links.push({
      year,
      url: absoluteUrl
    });
  }

  return links;
}

function extractPdfTextCandidates(pdfBytes: Uint8Array): string[] {
  const fullText = Buffer.from(pdfBytes).toString("latin1");
  const candidates: string[] = [];
  const seen = new Set<string>();

  for (const streamMatch of fullText.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    const rawBuffer = Buffer.from(streamMatch[1], "latin1");
    const streamVariants: Buffer[] = [rawBuffer];

    for (const inflate of [inflateSync, inflateRawSync]) {
      try {
        streamVariants.push(inflate(rawBuffer));
      } catch {
        // ignore non-flate streams
      }
    }

    for (const variant of streamVariants) {
      const text = variant.toString("latin1");
      if (!text || seen.has(text)) {
        continue;
      }

      seen.add(text);
      if (/Tax Statement|Payable\s+20\d{2}|Total Property Tax|special assessments/i.test(text)) {
        candidates.push(text);
      }
    }
  }

  return candidates;
}

function unescapePdfToken(value: string): string {
  return value
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\\");
}

export function parseDakotaAnnualTaxFromPdf(pdfBytes: Uint8Array): {
  payableYear: number | null;
  annualTax: number | null;
  evidenceLine: string | null;
} {
  const textCandidates = extractPdfTextCandidates(pdfBytes);
  const joinedTextParts: string[] = [];

  for (const candidate of textCandidates) {
    for (const tokenMatch of candidate.matchAll(/\(([^)]*)\)\s*Tj/g)) {
      const token = unescapePdfToken(tokenMatch[1]);
      if (token.trim()) {
        joinedTextParts.push(token.trim());
      }
    }

    if (/Tj/.test(candidate)) {
      continue;
    }

    joinedTextParts.push(candidate);
  }

  const joinedText = joinedTextParts.join(" ");

  const statementYearMatch = joinedText.match(/\b(20\d{2})\s+Property\s+Tax\s+Statement\b/i);
  const statementYear = statementYearMatch
    ? Number.parseInt(statementYearMatch[1], 10)
    : null;
  const payableYears = Array.from(joinedText.matchAll(/Payable\s+(20\d{2})/gi))
    .map((match) => Number.parseInt(match[1], 10))
    .filter((year) => Number.isFinite(year));
  const payableYear = statementYear ?? payableYears.sort((left, right) => right - left)[0] ?? null;

  let evidenceLine: string | null = null;

  const line14Match = joinedText.match(
    /14\.\s*Your Total Property Tax and Special Assessments[^$]*\$([0-9,]+\.\d{2})(?:[^$]*\$([0-9,]+\.\d{2}))?/i
  );

  if (line14Match) {
    const firstAmount = parseCurrency(line14Match[1]);
    const secondAmount = parseCurrency(line14Match[2]);
    const annualTax = secondAmount ?? firstAmount;
    evidenceLine = line14Match[0];
    if (annualTax !== null && annualTax > 0) {
      return {
        payableYear,
        annualTax,
        evidenceLine: line14Match[0]
      };
    }
  }

  const totalTaxMatch = joinedText.match(
    /Total\s+Property\s+Tax[^$]*\$([0-9,]+\.\d{2})/i
  );
  const annualTax = parseCurrency(totalTaxMatch?.[1]);
  if (totalTaxMatch) {
    evidenceLine = totalTaxMatch[0];
  }

  if (annualTax !== null && annualTax > 0) {
    return {
      payableYear,
      annualTax,
      evidenceLine: totalTaxMatch?.[0] ?? evidenceLine
    };
  }

  const mnRefundLineMatch = joinedText.match(
    /2\.\s*Use this amount for the special property tax refund on schedule 1 on Form M1PR\.[^$]*\$([0-9,]+\.\d{2})/i
  );
  const mnRefundAmount = parseCurrency(mnRefundLineMatch?.[1]);
  if (mnRefundLineMatch) {
    evidenceLine = evidenceLine ?? mnRefundLineMatch[0];
  }

  if (mnRefundAmount !== null && mnRefundAmount > 0) {
    return {
      payableYear,
      annualTax: mnRefundAmount,
      evidenceLine: mnRefundLineMatch?.[0] ?? evidenceLine
    };
  }

  return {
    payableYear,
    annualTax: null,
    evidenceLine
  };
}

function resolveDakotaParcelQuery(parcel: ParcelMatch): string | null {
  const candidates = getParcelLookupCandidates(parcel);
  for (const candidate of candidates) {
    const normalized = normalizeParcelId(candidate);
    if (normalized.digits && normalized.digits.length >= 10) {
      return normalized.digits;
    }
    if (normalized.compact && normalized.compact.length >= 10) {
      return normalized.compact;
    }
  }

  return null;
}

async function fetchDakotaTaxObservation(args: {
  parcel: ParcelMatch;
  requestTaxYear: number;
}): Promise<CountyTaxObservation | null> {
  const parcelQuery = resolveDakotaParcelQuery(args.parcel);
  if (!parcelQuery) {
    return null;
  }

  const currentStatementUrl = new URL(DAKOTA_STATEMENT_PDF_PATH, `${DAKOTA_BASE_URL}/`);
  currentStatementUrl.searchParams.set("Id", parcelQuery);
  const currentStatementResponse = await fetchWithTimeout(currentStatementUrl.toString(), {
    method: "GET",
    cache: "no-store"
  }, { timeoutMs: 12000 });
  if (currentStatementResponse.ok) {
    const pdfBytes = new Uint8Array(await currentStatementResponse.arrayBuffer());
    const parsed = parseDakotaAnnualTaxFromPdf(pdfBytes);
    if (
      typeof parsed.annualTax === "number" &&
      Number.isFinite(parsed.annualTax) &&
      parsed.annualTax > 0
    ) {
      const taxYear = parsed.payableYear ?? args.requestTaxYear;
      const yearMatched = taxYear === args.requestTaxYear;

      return {
        county: "Dakota",
        parcel_id: parcelQuery,
        tax_year: taxYear,
        annual_property_tax: parsed.annualTax,
        source_kind: "county_statement",
        source_name: "Dakota County Tax Statement Lookup",
        source_url: currentStatementUrl.toString(),
        raw_evidence: {
          lookup_mode: "direct_current_statement",
          parsed_payable_year: parsed.payableYear,
          parsed_evidence_line: parsed.evidenceLine
        },
        retrieval_notes: [
          "Parcel discovered using MetroGIS parcel layer, then verified against the Dakota County current tax statement PDF.",
          `Dakota statement returned ${taxYear} annual tax ${parsed.annualTax.toFixed(2)}.`,
          yearMatched
            ? `Requested tax year ${args.requestTaxYear} matched county tax year ${taxYear}.`
            : `Requested tax year ${args.requestTaxYear}; county statement latest available year is ${taxYear}.`
        ],
        matched_address: args.parcel.situsAddress,
        confidence_inputs: {
          confidence: yearMatched ? "high" : "medium",
          authoritative_source_used: true,
          statement_url: currentStatementUrl.toString()
        }
      };
    }
  }

  const historyUrl = new URL(DAKOTA_HISTORY_PATH, `${DAKOTA_BASE_URL}/`);
  historyUrl.searchParams.set("Id", parcelQuery);
  const historyResponse = await fetchWithTimeout(historyUrl.toString(), {
    method: "GET",
    cache: "no-store"
  }, { timeoutMs: 12000 });

  if (!historyResponse.ok) {
    return null;
  }

  const historyHtml = await historyResponse.text();
  const statementLinks = parseDakotaStatementLinks(historyHtml, DAKOTA_BASE_URL);
  if (!statementLinks.length) {
    return null;
  }

  const latestStatement = [...statementLinks].sort((left, right) => right.year - left.year)[0];
  const pdfResponse = await fetchWithTimeout(latestStatement.url, {
    method: "GET",
    cache: "no-store"
  }, { timeoutMs: 12000 });

  if (!pdfResponse.ok) {
    return null;
  }

  const pdfBytes = new Uint8Array(await pdfResponse.arrayBuffer());
  const parsed = parseDakotaAnnualTaxFromPdf(pdfBytes);
  if (
    typeof parsed.annualTax !== "number" ||
    !Number.isFinite(parsed.annualTax) ||
    parsed.annualTax <= 0
  ) {
    return null;
  }

  const taxYear = parsed.payableYear ?? latestStatement.year;
  const yearMatched = taxYear === args.requestTaxYear;

  return {
    county: "Dakota",
    parcel_id: parcelQuery,
    tax_year: taxYear,
    annual_property_tax: parsed.annualTax,
    source_kind: "county_statement",
    source_name: "Dakota County Tax Statement Lookup",
    source_url: latestStatement.url,
    raw_evidence: {
      lookup_mode: "history_statement_fallback",
      history_url: historyUrl.toString(),
      statement_links_found: statementLinks.length,
      selected_statement_year: latestStatement.year,
      parsed_payable_year: parsed.payableYear,
      parsed_evidence_line: parsed.evidenceLine
    },
    retrieval_notes: [
      "Parcel discovered using MetroGIS parcel layer, then verified against Dakota County tax statement history.",
      `Dakota statement returned ${taxYear} annual tax ${parsed.annualTax.toFixed(2)}.`,
      yearMatched
        ? `Requested tax year ${args.requestTaxYear} matched county tax year ${taxYear}.`
        : `Requested tax year ${args.requestTaxYear}; county statement latest available year is ${taxYear}.`
    ],
    matched_address: args.parcel.situsAddress,
    confidence_inputs: {
      confidence: yearMatched ? "high" : "medium",
      authoritative_source_used: true,
      statement_url: latestStatement.url
    }
  };
}

const baseProvider = createMetroArcGisCountyProvider({
  county: "Dakota"
});

export const dakotaCountyTaxProvider: CountyTaxProvider = {
  ...baseProvider,
  providerKey: "mn-dakota-authoritative-tax-provider-v2",
  sourceName: "Dakota County Tax Statement Lookup",
  sourceRootUrl: DAKOTA_BASE_URL,
  async fetchTaxObservation(parcel, request) {
    return fetchDakotaTaxObservation({
      parcel,
      requestTaxYear: request.taxYear
    });
  }
};
