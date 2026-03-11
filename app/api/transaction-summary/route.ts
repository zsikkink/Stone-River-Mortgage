import fs from "node:fs/promises";
import path from "node:path";
import {
  concatTransformationMatrix,
  PDFDocument,
  PDFFont,
  PDFImage,
  PDFPage,
  popGraphicsState,
  pushGraphicsState,
  StandardFonts,
  rgb
} from "pdf-lib";
import { NextResponse } from "next/server";
import { calculateAprAnnual } from "@/lib/apr/calc";
import { MINNESOTA_ADDRESS_ONLY_MESSAGE } from "@/lib/constants";
import {
  getPricingConfig,
  recordTransactionSummaryGenerated
} from "@/lib/daily-pricing-store";
import { getLoanAmountBoundsMessage } from "@/lib/loanAmount";
import { buildPropertyTaxLabels } from "@/lib/propertyTax/presentation";
import { calculateTitlePremiums } from "@/lib/titlePremium/calc";

export const runtime = "nodejs";

type SummaryPayload = {
  address: string;
  state?: string | null;
  purchasePrice: number;
  downPaymentPercent: number;
  annualPropertyTax?: number;
  propertyTaxSource?:
    | "User Provided"
    | "Estimated Using County Rate"
    | "County Retrieved";
  propertyTaxRequestedYear?: number | null;
  propertyTaxActualYearUsed?: number | null;
  propertyTaxYearMatchStatus?: "matched" | "latest_available_used" | "unknown";
};

type CostRow = {
  label: string;
  value: number;
};

type CostGroup = {
  heading: string;
  rows: CostRow[];
};

type PdfLogoAsset = {
  width: number;
  height: number;
  draw: (params: {
    page: PDFPage;
    x: number;
    y: number;
    width: number;
    height: number;
    wordmarkFont: PDFFont;
  }) => void;
};

type SvgLogoTransform = {
  translateX: number;
  translateY: number;
  scaleX: number;
  scaleY: number;
};

type SvgLogoPath = {
  d: string;
  fill: ReturnType<typeof rgb>;
  transform: SvgLogoTransform;
};

type SvgLogoTextLine = {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  fill: ReturnType<typeof rgb>;
  transform: SvgLogoTransform;
};

type ParsedSvgLogo = {
  width: number;
  height: number;
  paths: SvgLogoPath[];
  textLines: SvgLogoTextLine[];
};

const APPRAISAL_PROMO_END_EXCLUSIVE = new Date("2026-05-01T00:00:00-05:00");
const APPRAISAL_PROMO_DESCRIPTION =
  "Stone River Mortgage will pay up to $600 in appraisal fees";
const FOOTER_DISCLAIMER_HOA =
  "HOA dues, if any, are paid separately";
const FOOTER_COMPANY_NMLS_LINE =
  "Stone River Mortgage LLC nmls# 2090973, Mike Sikkink nmls# 345256";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function normalizePdfText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatPercentLabel(value: number): string {
  if (!Number.isFinite(value)) {
    return "0%";
  }

  const normalized = Number.isInteger(value)
    ? String(Math.trunc(value))
    : value.toFixed(2).replace(/\.?0+$/, "");
  return `${normalized}%`;
}

function calculateMonthlyPrincipalAndInterest(
  loanAmount: number,
  annualRatePercent: number,
  years: number
): number {
  const monthlyRate = annualRatePercent / 100 / 12;
  const totalPayments = years * 12;

  if (monthlyRate === 0) {
    return loanAmount / totalPayments;
  }

  return (
    (loanAmount * monthlyRate) /
    (1 - (1 + monthlyRate) ** -totalPayments)
  );
}

function parseLoanTermMonths(loanTerm: string): number {
  const years = Number.parseInt(loanTerm, 10);
  if (Number.isFinite(years) && years > 0) {
    return years * 12;
  }

  return 360;
}

function getPayloadValidationErrors(input: unknown): string[] {
  if (!input || typeof input !== "object") {
    return ["Payload must be an object."];
  }

  const errors: string[] = [];
  const candidate = input as Partial<SummaryPayload>;
  const hasAddress =
    typeof candidate.address === "string" && candidate.address.trim().length > 0;
  if (!hasAddress) {
    errors.push("Address is required.");
  }

  const hasPrice =
    typeof candidate.purchasePrice === "number" &&
    Number.isFinite(candidate.purchasePrice) &&
    candidate.purchasePrice > 0;
  if (!hasPrice) {
    errors.push("Purchase price must be greater than 0.");
  }

  const hasPercent =
    typeof candidate.downPaymentPercent === "number" &&
    Number.isFinite(candidate.downPaymentPercent) &&
    candidate.downPaymentPercent > 0 &&
    candidate.downPaymentPercent < 100;
  if (!hasPercent) {
    errors.push("Down payment percent must be between 0 and 100.");
  }

  const hasValidAnnualTax =
    typeof candidate.annualPropertyTax === "undefined" ||
    (typeof candidate.annualPropertyTax === "number" &&
      Number.isFinite(candidate.annualPropertyTax) &&
      candidate.annualPropertyTax > 0);
  if (!hasValidAnnualTax) {
    errors.push("Annual property tax must be greater than 0 when provided.");
  }

  const hasValidTaxSource =
    typeof candidate.propertyTaxSource === "undefined" ||
    candidate.propertyTaxSource === "User Provided" ||
    candidate.propertyTaxSource === "Estimated Using County Rate" ||
    candidate.propertyTaxSource === "County Retrieved";
  if (!hasValidTaxSource) {
    errors.push("Property tax source is invalid.");
  }

  const hasValidRequestedTaxYear =
    typeof candidate.propertyTaxRequestedYear === "undefined" ||
    candidate.propertyTaxRequestedYear === null ||
    (typeof candidate.propertyTaxRequestedYear === "number" &&
      Number.isFinite(candidate.propertyTaxRequestedYear) &&
      candidate.propertyTaxRequestedYear > 0);
  if (!hasValidRequestedTaxYear) {
    errors.push("Requested property tax year is invalid.");
  }

  const hasValidActualTaxYearUsed =
    typeof candidate.propertyTaxActualYearUsed === "undefined" ||
    candidate.propertyTaxActualYearUsed === null ||
    (typeof candidate.propertyTaxActualYearUsed === "number" &&
      Number.isFinite(candidate.propertyTaxActualYearUsed) &&
      candidate.propertyTaxActualYearUsed > 0);
  if (!hasValidActualTaxYearUsed) {
    errors.push("Actual property tax year is invalid.");
  }

  const hasValidTaxYearMatchStatus =
    typeof candidate.propertyTaxYearMatchStatus === "undefined" ||
    candidate.propertyTaxYearMatchStatus === "matched" ||
    candidate.propertyTaxYearMatchStatus === "latest_available_used" ||
    candidate.propertyTaxYearMatchStatus === "unknown";
  if (!hasValidTaxYearMatchStatus) {
    errors.push("Property tax year match status is invalid.");
  }

  const hasValidState =
    typeof candidate.state === "undefined" ||
    candidate.state === null ||
    (typeof candidate.state === "string" && candidate.state.trim().length > 0);
  if (!hasValidState) {
    errors.push("State is invalid.");
  }

  return errors;
}

function isValidPayload(input: unknown): input is SummaryPayload {
  return getPayloadValidationErrors(input).length === 0;
}

function drawLeaderRow(params: {
  page: import("pdf-lib").PDFPage;
  x: number;
  y: number;
  width: number;
  label: string;
  value: string;
  labelFont: import("pdf-lib").PDFFont;
  valueFont: import("pdf-lib").PDFFont;
  size: number;
  textColor: ReturnType<typeof rgb>;
  dotColor?: ReturnType<typeof rgb>;
}) {
  const {
    page,
    x,
    y,
    width,
    label,
    value,
    labelFont,
    valueFont,
    size,
    textColor,
    dotColor = rgb(0.42, 0.42, 0.42)
  } = params;

  const leftX = x + 4;
  const valueWidth = valueFont.widthOfTextAtSize(value, size);
  const valueX = x + width - 4 - valueWidth;
  const maxLabelWidth = Math.max(0, width - valueWidth - 16);

  let fittedLabel = label;
  if (labelFont.widthOfTextAtSize(fittedLabel, size) > maxLabelWidth) {
    const ellipsis = "...";
    while (
      fittedLabel.length > 0 &&
      labelFont.widthOfTextAtSize(`${fittedLabel}${ellipsis}`, size) > maxLabelWidth
    ) {
      fittedLabel = fittedLabel.slice(0, -1);
    }
    fittedLabel = `${fittedLabel}${ellipsis}`;
  }

  page.drawText(fittedLabel, {
    x: leftX,
    y,
    size,
    font: labelFont,
    color: textColor
  });

  const labelWidth = labelFont.widthOfTextAtSize(fittedLabel, size);
  const dotStart = leftX + labelWidth + 4;
  const dotEnd = valueX - 4;

  if (dotEnd > dotStart + 4) {
    const dotWidth = labelFont.widthOfTextAtSize(".", size);
    const dotCount = Math.max(2, Math.floor((dotEnd - dotStart) / dotWidth));
    page.drawText(".".repeat(dotCount), {
      x: dotStart,
      y,
      size,
      font: labelFont,
      color: dotColor
    });
  }

  page.drawText(value, {
    x: valueX,
    y,
    size,
    font: valueFont,
    color: textColor
  });
}

function drawSectionHeader(params: {
  page: import("pdf-lib").PDFPage;
  x: number;
  y: number;
  width: number;
  heading: string;
  fontBold: import("pdf-lib").PDFFont;
  size?: number;
}) {
  const { page, x, y, width, heading, fontBold, size = 10 } = params;

  page.drawRectangle({
    x,
    y,
    width,
    height: 13,
    color: rgb(0.84, 0.84, 0.84)
  });

  page.drawText(heading, {
    x: x + 4,
    y: y + 3,
    size,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.1)
  });
}

function toUsd(value: number): string {
  return formatCurrency(Math.max(0, value));
}

function wrapTextToWidth(params: {
  text: string;
  font: import("pdf-lib").PDFFont;
  fontSize: number;
  maxWidth: number;
  maxLines?: number;
}): string[] {
  const { text, font, fontSize, maxWidth, maxLines } = params;
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [""];
  }

  const words = normalized.split(" ");
  const lines: string[] = [];
  let currentLine = words[0];

  for (let index = 1; index < words.length; index += 1) {
    const word = words[index];
    const candidate = `${currentLine} ${word}`;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      currentLine = candidate;
      continue;
    }

    lines.push(currentLine);
    currentLine = word;
  }

  lines.push(currentLine);

  if (!maxLines || lines.length <= maxLines) {
    return lines;
  }

  const truncated = lines.slice(0, maxLines);
  const overflowText = lines.slice(maxLines - 1).join(" ");
  const ellipsis = "...";
  let fitted = overflowText;
  while (
    fitted.length > 0 &&
    font.widthOfTextAtSize(`${fitted}${ellipsis}`, fontSize) > maxWidth
  ) {
    fitted = fitted.slice(0, -1);
  }
  truncated[maxLines - 1] = `${fitted}${ellipsis}`;

  return truncated;
}

function roundDownToNearest(value: number, increment: number): number {
  if (increment <= 0) {
    return value;
  }
  return Math.floor(value / increment) * increment;
}

function roundUpToNearest(value: number, increment: number): number {
  if (increment <= 0) {
    return value;
  }
  return Math.ceil(value / increment) * increment;
}

function roundToCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function getAttributeValue(source: string, attribute: string): string | null {
  const pattern = new RegExp(`${attribute}="([^"]*)"`);
  const match = source.match(pattern);
  return match?.[1] ?? null;
}

function getStyleValue(style: string | null, property: string): string | null {
  if (!style) {
    return null;
  }

  const segments = style.split(";");
  for (const segment of segments) {
    const [rawKey, rawValue] = segment.split(":");
    if (rawKey?.trim() === property) {
      return rawValue?.trim() ?? null;
    }
  }

  return null;
}

function parseColorValue(value: string | null): ReturnType<typeof rgb> | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "none") {
    return null;
  }

  const hexMatch = normalized.match(/^#([0-9a-f]{6})$/i);
  if (!hexMatch) {
    if (normalized === "#000" || normalized === "black") {
      return rgb(0, 0, 0);
    }
    if (normalized === "#fff" || normalized === "white") {
      return rgb(1, 1, 1);
    }
    return null;
  }

  const hex = hexMatch[1];
  const red = Number.parseInt(hex.slice(0, 2), 16) / 255;
  const green = Number.parseInt(hex.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(hex.slice(4, 6), 16) / 255;
  return rgb(red, green, blue);
}

function parseTransformValue(value: string | null): SvgLogoTransform {
  const fallback: SvgLogoTransform = {
    translateX: 0,
    translateY: 0,
    scaleX: 1,
    scaleY: 1
  };

  if (!value) {
    return fallback;
  }

  const translateMatch = value.match(
    /translate\(\s*([-\d.]+)(?:[\s,]+([-\d.]+))?\s*\)/i
  );
  const scaleMatch = value.match(
    /scale\(\s*([-\d.]+)(?:[\s,]+([-\d.]+))?\s*\)/i
  );

  return {
    translateX: translateMatch ? Number.parseFloat(translateMatch[1]) : 0,
    translateY: translateMatch?.[2]
      ? Number.parseFloat(translateMatch[2])
      : 0,
    scaleX: scaleMatch ? Number.parseFloat(scaleMatch[1]) : 1,
    scaleY: scaleMatch?.[2] ? Number.parseFloat(scaleMatch[2]) : scaleMatch
      ? Number.parseFloat(scaleMatch[1])
      : 1
  };
}

function parseSimpleLogoSvg(svgMarkup: string): ParsedSvgLogo {
  const width = Number.parseFloat(getAttributeValue(svgMarkup, "width") || "");
  const height = Number.parseFloat(getAttributeValue(svgMarkup, "height") || "");

  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error("Simple logo SVG is missing width/height attributes.");
  }

  const groupMatches = Array.from(
    svgMarkup.matchAll(/<g\b([^>]*)>([\s\S]*?)<\/g>/gi)
  );
  const paths: SvgLogoPath[] = [];
  const textLines: SvgLogoTextLine[] = [];

  for (const groupMatch of groupMatches) {
    const groupAttributes = groupMatch[1] ?? "";
    const groupBody = groupMatch[2] ?? "";
    const groupTransform = parseTransformValue(
      getAttributeValue(groupAttributes, "transform")
    );

    const pathMatches = Array.from(groupBody.matchAll(/<path\b([^>]*)\/>/gi));
    for (const pathMatch of pathMatches) {
      const pathAttributes = pathMatch[1] ?? "";
      const d = getAttributeValue(pathAttributes, "d");
      if (!d) {
        continue;
      }

      const fill =
        parseColorValue(
          getStyleValue(getAttributeValue(pathAttributes, "style"), "fill")
        ) ??
        parseColorValue(getAttributeValue(pathAttributes, "fill")) ??
        rgb(0, 0, 0);

      paths.push({
        d,
        fill,
        transform: groupTransform
      });
    }

    const textMatch = groupBody.match(/<text\b([^>]*)>([\s\S]*?)<\/text>/i);
    if (!textMatch) {
      continue;
    }

    const textAttributes = textMatch[1] ?? "";
    const textBody = textMatch[2] ?? "";
    const fontSize = Number.parseFloat(
      getAttributeValue(textAttributes, "font-size") || "12"
    );
    const defaultFill =
      parseColorValue(
        getStyleValue(getAttributeValue(textAttributes, "style"), "fill")
      ) ?? rgb(0, 0, 0);

    const lineMap = new Map<
      string,
      { y: number; x: number; text: string; fill: ReturnType<typeof rgb> }
    >();
    const tspanMatches = Array.from(textBody.matchAll(/<tspan\b([^>]*)>([\s\S]*?)<\/tspan>/gi));

    for (const tspanMatch of tspanMatches) {
      const tspanAttributes = tspanMatch[1] ?? "";
      const text = (tspanMatch[2] ?? "").replace(/\s+/g, " ");
      const x = Number.parseFloat(getAttributeValue(tspanAttributes, "x") || "0");
      const y = Number.parseFloat(getAttributeValue(tspanAttributes, "y") || "0");
      const fill =
        parseColorValue(
          getStyleValue(getAttributeValue(tspanAttributes, "style"), "fill")
        ) ?? defaultFill;
      const lineKey = y.toFixed(2);
      const existing = lineMap.get(lineKey);

      if (!existing) {
        lineMap.set(lineKey, { x, y, text, fill });
        continue;
      }

      lineMap.set(lineKey, {
        x: Math.min(existing.x, x),
        y,
        text: `${existing.text}${text}`,
        fill: existing.fill
      });
    }

    for (const line of lineMap.values()) {
      textLines.push({
        text: line.text.trim(),
        x: line.x,
        y: line.y,
        fontSize,
        fill: line.fill,
        transform: groupTransform
      });
    }
  }

  if (paths.length === 0) {
    throw new Error("Simple logo SVG did not contain any parseable paths.");
  }

  return {
    width,
    height,
    paths,
    textLines: textLines.sort((left, right) => left.y - right.y)
  };
}

function getMortgageInsuranceFactor(downPaymentPercent: number): number {
  if (!Number.isFinite(downPaymentPercent) || downPaymentPercent <= 0) {
    return 0;
  }

  if (downPaymentPercent >= 20) {
    return 0;
  }

  if (downPaymentPercent >= 15) {
    return 0.00008333333;
  }

  if (downPaymentPercent >= 10) {
    return 0.000125;
  }

  return 0.000158333333;
}

function calculateHomeownersInsuranceMonthly(params: {
  purchasePrice: number;
  homeownersInsuranceRate: number;
}): number {
  const { purchasePrice, homeownersInsuranceRate } = params;
  const monthlyBase = (purchasePrice * homeownersInsuranceRate) / 12;

  if (purchasePrice <= 300000) {
    return roundUpToNearest(monthlyBase, 25);
  }

  if (purchasePrice <= 550000) {
    return roundDownToNearest(monthlyBase, 25);
  }

  return roundDownToNearest(monthlyBase, 50);
}

function getLastWeekdayOfMonth(referenceDate: Date): Date {
  const lastDayOfMonth = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth() + 1,
    0
  );
  const weekday = lastDayOfMonth.getDay();

  if (weekday === 0) {
    lastDayOfMonth.setDate(lastDayOfMonth.getDate() - 2);
  } else if (weekday === 6) {
    lastDayOfMonth.setDate(lastDayOfMonth.getDate() - 1);
  }

  return lastDayOfMonth;
}

function getFridayImmediatelyAfterThirtyDays(referenceDate: Date): Date {
  const afterThirtyDays = new Date(referenceDate);
  afterThirtyDays.setDate(afterThirtyDays.getDate() + 30);

  const weekday = afterThirtyDays.getDay();
  let daysToAdd = (5 - weekday + 7) % 7;

  // "Immediately after 30 days from today" implies the next Friday,
  // not the same day when day 30 itself lands on Friday.
  if (daysToAdd === 0) {
    daysToAdd = 7;
  }

  afterThirtyDays.setDate(afterThirtyDays.getDate() + daysToAdd);
  return afterThirtyDays;
}

function determineClosingDate(referenceDate: Date): Date {
  if (referenceDate.getDate() <= 12) {
    return getLastWeekdayOfMonth(referenceDate);
  }

  return getFridayImmediatelyAfterThirtyDays(referenceDate);
}

function calculateDaysThroughMonthEnd(closingDate: Date): number {
  const monthEnd = new Date(
    closingDate.getFullYear(),
    closingDate.getMonth() + 1,
    0
  );
  return Math.max(1, monthEnd.getDate() - closingDate.getDate() + 1);
}

async function maybeLoadLogo(pdfDoc: PDFDocument) {
  try {
    const svgPath = path.join(process.cwd(), "public", "simple-logo.svg");
    const svgMarkup = await fs.readFile(svgPath, "utf8");
    const parsedLogo = parseSimpleLogoSvg(svgMarkup);

    return {
      width: parsedLogo.width,
      height: parsedLogo.height,
      draw: ({ page, x, y, width, height, wordmarkFont }) => {
        const scale = Math.min(width / parsedLogo.width, height / parsedLogo.height);
        const renderedHeight = parsedLogo.height * scale;

        // Draw vector icon paths in a flipped coordinate system so SVG path data
        // keeps its original orientation in PDF space.
        page.pushOperators(
          pushGraphicsState(),
          concatTransformationMatrix(scale, 0, 0, -scale, x, y + renderedHeight)
        );

        for (const pathEntry of parsedLogo.paths) {
          page.drawSvgPath(pathEntry.d, {
            x: pathEntry.transform.translateX,
            y: pathEntry.transform.translateY,
            scale: pathEntry.transform.scaleX,
            color: pathEntry.fill
          });
        }

        page.pushOperators(popGraphicsState());

        for (const line of parsedLogo.textLines) {
          const lineFontSize = line.fontSize * line.transform.scaleY * scale;
          const lineX = x + (line.transform.translateX + line.x * line.transform.scaleX) * scale;
          const lineY =
            y +
            renderedHeight -
            (line.transform.translateY + line.y * line.transform.scaleY) * scale;

          page.drawText(line.text, {
            x: lineX,
            y: lineY,
            size: lineFontSize,
            font: wordmarkFont,
            color: line.fill
          });
        }
      }
    } satisfies PdfLogoAsset;
  } catch {
    try {
      const logoPath = path.join(process.cwd(), "public", "logo.png");
      const bytes = await fs.readFile(logoPath);
      const pngImage = await pdfDoc.embedPng(bytes);

      return {
        width: pngImage.width,
        height: pngImage.height,
        draw: ({ page, x, y, width, height }) => {
          page.drawImage(pngImage, {
            x,
            y,
            width,
            height
          });
        }
      } satisfies PdfLogoAsset;
    } catch {
      return null;
    }
  }
}

async function maybeLoadEqualHousingLogo(pdfDoc: PDFDocument) {
  try {
    const logoPath = path.join(
      process.cwd(),
      "public",
      "equal-housing-lender-logo-png-transparent.png"
    );
    const bytes = await fs.readFile(logoPath);
    return await pdfDoc.embedPng(bytes);
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const payload: unknown = await request.json();

    if (!isValidPayload(payload)) {
      const issues = getPayloadValidationErrors(payload);
      return NextResponse.json(
        {
          error:
            "Invalid payload. Address is required, purchase price must be greater than 0, and down payment percent must be between 0 and 100.",
          issues
        },
        { status: 400 }
      );
    }

    const address = payload.address.trim();
    const normalizedState =
      typeof payload.state === "string" ? payload.state.trim().toUpperCase() : null;

    if (normalizedState !== "MN") {
      return NextResponse.json(
        {
          error: MINNESOTA_ADDRESS_ONLY_MESSAGE
        },
        { status: 400 }
      );
    }

    const addressForPdf = normalizePdfText(
      address.replace(/,\s*USA\s*$/i, "").trim()
    );
    const purchasePrice = payload.purchasePrice;
    const downPaymentAmount =
      (purchasePrice * payload.downPaymentPercent) / 100;
    const downPaymentPercentLabel = formatPercentLabel(payload.downPaymentPercent);
    const loanAmount = purchasePrice - downPaymentAmount;
    const loanBoundsMessage = getLoanAmountBoundsMessage(loanAmount);

    if (loanBoundsMessage) {
      return NextResponse.json({ error: loanBoundsMessage }, { status: 400 });
    }

    const pricingConfig = await getPricingConfig();
    const contactLine = "Contact: Mike Sikkink 612.850.2018";
    const interestRate = pricingConfig.interestRate;
    const loanTerm = pricingConfig.loanTerm;

    const monthlyPrincipalAndInterest = calculateMonthlyPrincipalAndInterest(
      loanAmount,
      interestRate,
      30
    );
    const annualPropertyTax =
      typeof payload.annualPropertyTax === "number"
        ? payload.annualPropertyTax
        : purchasePrice * pricingConfig.propertyTaxAnnualRate;
    const propertyTaxMonthly = annualPropertyTax / 12;
    const propertyTaxEstimated =
      payload.propertyTaxSource === "Estimated Using County Rate";
    const propertyTaxActualYearUsed =
      typeof payload.propertyTaxActualYearUsed === "number" &&
      Number.isFinite(payload.propertyTaxActualYearUsed)
        ? Math.floor(payload.propertyTaxActualYearUsed)
        : null;
    const propertyTaxYearMatchStatus = payload.propertyTaxYearMatchStatus ?? "unknown";
    const propertyTaxLabels = buildPropertyTaxLabels({
      source: payload.propertyTaxSource,
      estimated: propertyTaxEstimated,
      actualYearUsed: propertyTaxActualYearUsed,
      yearMatchStatus: propertyTaxYearMatchStatus
    });
    const homeownersInsuranceMonthly = Math.max(
      0,
      calculateHomeownersInsuranceMonthly({
        purchasePrice,
        homeownersInsuranceRate: pricingConfig.homeownersInsuranceRate
      })
    );
    const mortgageInsuranceFactor = getMortgageInsuranceFactor(
      payload.downPaymentPercent
    );
    const mortgageInsuranceMonthly = roundToCents(
      loanAmount * mortgageInsuranceFactor
    );
    const hoaMonthly = pricingConfig.hoaMonthly;
    const totalMonthlyPayment =
      monthlyPrincipalAndInterest +
      propertyTaxMonthly +
      homeownersInsuranceMonthly +
      mortgageInsuranceMonthly +
      hoaMonthly;

    // discountPointFactor is entered as a percent value (e.g. 0.933 => 0.933%).
    const discountPointFactor = pricingConfig.discountPointFactor;
    const discountPoints = (loanAmount * discountPointFactor) / 100;
    const underwritingFee = pricingConfig.fees.underwritingFee;
    const appraisalPromoActive = new Date() < APPRAISAL_PROMO_END_EXCLUSIVE;
    const appraisalFee = appraisalPromoActive ? 0 : pricingConfig.fees.appraisalFee;
    const appraisalLabel = appraisalPromoActive
      ? `Appraisal Fee (${APPRAISAL_PROMO_DESCRIPTION})`
      : "Appraisal Fee";
    const creditReportFee = pricingConfig.fees.creditReportFee;
    const mersFee = pricingConfig.fees.mersFee;
    const floodCertFee = pricingConfig.fees.floodCertFee;
    const taxServiceFee = pricingConfig.fees.taxServiceFee;

    const settlementFee = pricingConfig.fees.settlementFee;
    const titlePrepFee = pricingConfig.fees.titlePrepFee;
    let lenderTitlePolicy = pricingConfig.fees.lenderTitlePolicy;
    let ownerTitlePolicy = pricingConfig.fees.ownerTitlePolicy;
    try {
      const titlePremiums = calculateTitlePremiums({
        purchasePrice,
        loanAmount,
        expandedOwnersCoverage: false,
        refinance: false,
        simultaneousIssue: false
      });
      lenderTitlePolicy = titlePremiums.lenderPremium;
      ownerTitlePolicy = titlePremiums.ownerPremium;
    } catch (titleError) {
      console.error(
        "Title premium calculation failed; using configured fallback fee values.",
        {
          error: titleError instanceof Error ? titleError.message : "unknown"
        }
      );
    }

    const countyRecording = pricingConfig.fees.countyRecording;
    const mortgageRegistrationTax =
      loanAmount * pricingConfig.mortgageRegistrationTaxRate;
    const conservationFee = pricingConfig.fees.conservationFee;

    const firstYearInsurance = homeownersInsuranceMonthly * 12;
    const closingDate = determineClosingDate(new Date());
    const closingDateLabel = closingDate.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
    const monthEndInterestDays = calculateDaysThroughMonthEnd(closingDate);
    const monthEndInterest =
      ((loanAmount * (interestRate / 100)) / 365) *
      monthEndInterestDays;
    let apr = interestRate;
    try {
      const aprCalculation = calculateAprAnnual({
        termMonths: parseLoanTermMonths(loanTerm),
        noteRateAnnual: interestRate / 100,
        loanAmount,
        discountPointFactor,
        underwritingFee,
        prePaidInterest: monthEndInterest,
        principalAndInterest: monthlyPrincipalAndInterest
      });
      apr = aprCalculation.aprAnnual * 100;
    } catch (aprError) {
      console.error("APR calculation failed; using interest rate as APR fallback.", {
        error: aprError instanceof Error ? aprError.message : "unknown",
        interestRate,
        discountPointFactor,
        loanAmount,
        underwritingFee,
        monthEndInterest
      });
    }

    const escrowInsurance = homeownersInsuranceMonthly * 3;
    const escrowTax = propertyTaxMonthly * 6;

    const closingCostGroups: CostGroup[] = [
      {
        heading: "Lender Charges",
        rows: [
          {
            label: "Discount Points",
            value: discountPoints
          },
          { label: "Underwriting Fee", value: underwritingFee },
          { label: appraisalLabel, value: appraisalFee },
          { label: "Credit Report", value: creditReportFee },
          {
            label: "Mortgage Electronic Registration System Fee (MERS)",
            value: mersFee
          },
          { label: "Flood Certification", value: floodCertFee },
          { label: "Tax Service Fee", value: taxServiceFee }
        ]
      },
      {
        heading: "Title Company Charges",
        rows: [
          { label: "Settlement Closing Fee", value: settlementFee },
          {
            label: "Title Preparation & Examination Services",
            value: titlePrepFee
          },
          {
            label: "Lender's Title Insurance Policy",
            value: lenderTitlePolicy
          },
          { label: "Owner's Title Policy - Optional", value: ownerTitlePolicy }
        ]
      },
      {
        heading: "Government Fees & Taxes",
        rows: [
          { label: "County Recording Fee", value: countyRecording },
          {
            label: "Mortgage Registration Tax",
            value: mortgageRegistrationTax
          },
          { label: "Conservation Fee", value: conservationFee }
        ]
      },
      {
        heading: "Pre-Paid Expenses",
        rows: [
          {
            label: "Homeowners Insurance (1st Year)",
            value: firstYearInsurance
          },
          {
            label: `Interest From Closing Date on ${closingDateLabel} Through Month End`,
            value: monthEndInterest
          }
        ]
      },
      {
        heading: "Escrow Account Funding",
        rows: [
          { label: "Homeowners Insurance (3 Months)", value: escrowInsurance },
          { label: propertyTaxLabels.escrowLabel, value: escrowTax }
        ]
      }
    ];

    const totalClosingCosts = closingCostGroups
      .flatMap((group) => group.rows)
      .reduce((sum, row) => sum + row.value, 0);

    const brokerageAdminFee = pricingConfig.fees.brokerageAdminFee;
    const totalFundsNeeded =
      downPaymentAmount + totalClosingCosts + brokerageAdminFee;

    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([612, 792]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontBoldItalic = await pdfDoc.embedFont(StandardFonts.HelveticaBoldOblique);
    const logoWordmarkFont = await pdfDoc.embedFont(StandardFonts.TimesRoman);
    const logoImage = await maybeLoadLogo(pdfDoc);
    const equalHousingLogo = await maybeLoadEqualHousingLogo(pdfDoc);

    const pageWidth = 612;
    const pageHeight = 792;
    const margin = 38;
    const contentWidth = pageWidth - margin * 2;
    const contentRightEdgeX = margin + contentWidth;
    const topOffset = 12;

    const textColor = rgb(0.11, 0.11, 0.11);
    const greenFill = rgb(0.73, 0.84, 0.66);
    let summaryTitleY = pageHeight - 82 + topOffset;
    const headerTextX = margin;

    if (logoImage) {
      const maxLogoWidth = 186;
      const maxLogoHeight = 62;
      const logoScale = Math.min(
        maxLogoWidth / logoImage.width,
        maxLogoHeight / logoImage.height
      );
      const logoWidth = logoImage.width * logoScale;
      const logoHeight = logoImage.height * logoScale;
      const logoY = pageHeight - 97 + topOffset;
      const logoX = contentRightEdgeX - logoWidth;
      const logoTopY = logoY + logoHeight;
      summaryTitleY = logoTopY - 16;

      logoImage.draw({
        page,
        x: logoX,
        y: logoY,
        width: logoWidth,
        height: logoHeight,
        wordmarkFont: logoWordmarkFont
      });
    } else {
      const fallbackLogoText = "Stone River Mortgage";
      const fallbackLogoSize = 13;
      const fallbackLogoWidth = fontBold.widthOfTextAtSize(
        fallbackLogoText,
        fallbackLogoSize
      );

      page.drawText(fallbackLogoText, {
        x: contentRightEdgeX - fallbackLogoWidth,
        y: pageHeight - 78 + topOffset,
        size: fallbackLogoSize,
        font: fontBold,
        color: textColor
      });
    }

    page.drawText("Transaction Summary Estimate", {
      x: headerTextX,
      y: summaryTitleY,
      size: 16,
      font: fontBold,
      color: textColor
    });

    page.drawText("Created at StoneRiverMortgage.com", {
      x: headerTextX,
      y: summaryTitleY - 17,
      size: 13,
      font: font,
      color: textColor
    });

    const contactLineY = summaryTitleY - 32;
    page.drawText(contactLine, {
      x: headerTextX,
      y: contactLineY,
      size: 13,
      font: font,
      color: textColor
    });

    const loanBoxX = margin;
    const headerToAddressGap = 43.2; // ~0.6 inch
    const addressTextX = margin + 62;
    const addressFontSize = 13;
    const addressLineHeight = 15;
    const addressMaxWidth = contentWidth - (addressTextX - margin);
    const addressLines = wrapTextToWidth({
      text: addressForPdf,
      font: fontBoldItalic,
      fontSize: addressFontSize,
      maxWidth: addressMaxWidth,
      maxLines: 2
    });
    const addressLabelY = contactLineY - headerToAddressGap;
    const addressLastLineY =
      addressLabelY - (addressLines.length - 1) * addressLineHeight;
    const loanBoxTop = addressLastLineY - 8;
    const loanBoxHeight = 107;
    const loanBoxWidth = contentWidth;
    const halfWidth = loanBoxWidth / 2;
    const loanBoxBottomInset = 5.2;
    const loanBoxBottom = loanBoxTop - loanBoxHeight + loanBoxBottomInset;
    const sectionTitleGapFromPriorBox = 24 + loanBoxBottomInset;
    page.drawText("Address:", {
      x: margin,
      y: addressLabelY,
      size: 13,
      font: fontBold,
      color: textColor
    });

    addressLines.forEach((line, index) => {
      page.drawText(line, {
        x: addressTextX,
        y: addressLabelY - index * addressLineHeight,
        size: addressFontSize,
        font: fontBoldItalic,
        color: textColor
      });
    });

    page.drawRectangle({
      x: loanBoxX,
      y: loanBoxBottom,
      width: loanBoxWidth,
      height: loanBoxHeight - loanBoxBottomInset,
      borderColor: rgb(0.15, 0.15, 0.15),
      borderWidth: 1.2
    });

    drawSectionHeader({
      page,
      x: loanBoxX + 1,
      y: loanBoxTop - 14,
      width: halfWidth - 2,
      heading: "Loan Details",
      fontBold,
      size: 10
    });

    drawSectionHeader({
      page,
      x: loanBoxX + halfWidth + 1,
      y: loanBoxTop - 14,
      width: halfWidth - 2,
      heading: "Estimated Monthly Payment",
      fontBold,
      size: 10
    });

    const leftLoanRows: Array<[string, string]> = [
      ["Purchase Price", toUsd(purchasePrice)],
      [`Down Payment (${downPaymentPercentLabel})`, toUsd(downPaymentAmount)],
      ["Loan Amount", toUsd(loanAmount)],
      ["Interest Rate", `${interestRate.toFixed(3)}%`],
      ["APR", `${apr.toFixed(3)}%`],
      ["Conventional Loan Term", loanTerm]
    ];

    const rightLoanRows: Array<[string, string]> = [
      ["Principal and Interest", toUsd(monthlyPrincipalAndInterest)],
      [propertyTaxLabels.summaryLabel, toUsd(propertyTaxMonthly)],
      ["Homeowners Insurance (est.)", toUsd(homeownersInsuranceMonthly)],
      ["Mortgage Insurance", toUsd(mortgageInsuranceMonthly)],
      ["HOA", toUsd(hoaMonthly)]
    ];

    let loanLeftY = loanBoxTop - 27;
    for (const [label, value] of leftLoanRows) {
      drawLeaderRow({
        page,
        x: loanBoxX,
        y: loanLeftY,
        width: halfWidth,
        label,
        value,
        labelFont: font,
        valueFont: font,
        size: 8.5,
        textColor
      });
      loanLeftY -= 14;
    }

    let loanRightY = loanBoxTop - 27;
    for (const [label, value] of rightLoanRows) {
      drawLeaderRow({
        page,
        x: loanBoxX + halfWidth,
        y: loanRightY,
        width: halfWidth,
        label,
        value,
        labelFont: font,
        valueFont: font,
        size: 8.5,
        textColor
      });
      loanRightY -= 14;
    }

    const totalMonthlyRowY = loanBoxTop - loanBoxHeight + 8;
    page.drawRectangle({
      x: loanBoxX + halfWidth + 1,
      y: totalMonthlyRowY - 2,
      width: halfWidth - 2,
      height: 14,
      color: greenFill
    });

    drawLeaderRow({
      page,
      x: loanBoxX + halfWidth,
      y: totalMonthlyRowY,
      width: halfWidth,
      label: "Total Monthly Payment",
      value: toUsd(totalMonthlyPayment),
      labelFont: fontBold,
      valueFont: fontBold,
      size: 10,
      textColor
    });

    const closingTitleY = loanBoxBottom - sectionTitleGapFromPriorBox;
    page.drawText("Closing Costs", {
      x: margin,
      y: closingTitleY,
      size: 13,
      font: fontBold,
      color: textColor
    });

    const closingBoxTop = closingTitleY - 8;
    const sectionHeaderHeight = 13;
    const sectionHeaderGapAbove = 8;
    const sectionHeaderGapBelow = 11;
    const sectionRowStep = 11;

    let closingCursorY = closingBoxTop - sectionHeaderHeight;
    for (let groupIndex = 0; groupIndex < closingCostGroups.length; groupIndex += 1) {
      const group = closingCostGroups[groupIndex];
      if (groupIndex > 0) {
        closingCursorY -= sectionHeaderGapAbove;
      }

      drawSectionHeader({
        page,
        x: margin + 1,
        y: closingCursorY,
        width: contentWidth - 2,
        heading: group.heading,
        fontBold,
        size: 9
      });
      closingCursorY -= sectionHeaderGapBelow;

      for (const row of group.rows) {
        const isPropertyTaxLine = row.label.includes("Property Tax");
        const isHomeownersInsuranceLine = row.label.includes("Homeowners Insurance");
        const isEscrowHomeownersInsuranceLine = row.label.includes(
          "Homeowners Insurance (3 Months)"
        );
        const isEstimatedLine =
          (isHomeownersInsuranceLine && !isEscrowHomeownersInsuranceLine) ||
          (isPropertyTaxLine && propertyTaxEstimated);
        const label = isEstimatedLine ? `${row.label} (est.)` : row.label;

        drawLeaderRow({
          page,
          x: margin,
          y: closingCursorY,
          width: contentWidth,
          label,
          value: toUsd(row.value),
          labelFont: font,
          valueFont: font,
          size: 8.3,
          textColor
        });
        closingCursorY -= sectionRowStep;
      }
    }
    closingCursorY -= 6;

    page.drawRectangle({
      x: margin + 1,
      y: closingCursorY - 2,
      width: contentWidth - 2,
      height: 15,
      color: greenFill
    });

    drawLeaderRow({
      page,
      x: margin,
      y: closingCursorY + 1,
      width: contentWidth,
      label: "Total Closing Costs",
      value: toUsd(totalClosingCosts),
      labelFont: fontBold,
      valueFont: fontBold,
      size: 10,
      textColor
    });

    const closingBoxBottom = closingCursorY - 2;
    page.drawRectangle({
      x: margin,
      y: closingBoxBottom,
      width: contentWidth,
      height: closingBoxTop - closingBoxBottom,
      borderColor: rgb(0.15, 0.15, 0.15),
      borderWidth: 1.2
    });

    const fundsTitleY = closingBoxBottom - sectionTitleGapFromPriorBox;
    page.drawText("Funds Required To Close", {
      x: margin,
      y: fundsTitleY,
      size: 13,
      font: fontBold,
      color: textColor
    });

    const fundsBoxTop = fundsTitleY - 8;
    const fundsHeaderY = fundsBoxTop - sectionHeaderHeight;

    drawSectionHeader({
      page,
      x: margin + 1,
      y: fundsHeaderY,
      width: contentWidth - 2,
      heading: "Charges",
      fontBold,
      size: 9
    });

    const fundsRows: Array<[string, string]> = [
      [`Down Payment (${downPaymentPercentLabel})`, toUsd(downPaymentAmount)],
      ["Closing Costs", toUsd(totalClosingCosts)],
      ["Real Estate Brokerage Admin Fee", toUsd(brokerageAdminFee)]
    ];

    let fundsCursorY = fundsHeaderY - sectionHeaderGapBelow;
    for (const [label, value] of fundsRows) {
      drawLeaderRow({
        page,
        x: margin,
        y: fundsCursorY,
        width: contentWidth,
        label,
        value,
        labelFont: font,
        valueFont: font,
        size: 8.4,
        textColor
      });
      fundsCursorY -= sectionRowStep;
    }
    fundsCursorY -= 6;

    page.drawRectangle({
      x: margin + 1,
      y: fundsCursorY - 2,
      width: contentWidth - 2,
      height: 15,
      color: greenFill
    });

    drawLeaderRow({
      page,
      x: margin,
      y: fundsCursorY + 1,
      width: contentWidth,
      label: "Total Estimated Funds Needed For Closing",
      value: toUsd(totalFundsNeeded),
      labelFont: fontBold,
      valueFont: fontBold,
      size: 10,
      textColor
    });

    const fundsBoxBottom = fundsCursorY - 2;
    page.drawRectangle({
      x: margin,
      y: fundsBoxBottom,
      width: contentWidth,
      height: fundsBoxTop - fundsBoxBottom,
      borderColor: rgb(0.15, 0.15, 0.15),
      borderWidth: 1.2
    });

    const pricingLastUpdatedText = pricingConfig.lastUpdatedAt
      ? new Date(pricingConfig.lastUpdatedAt).toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric"
        })
      : "Not updated yet";

    // Keep footer text clear of the "Funds Required To Close" box above.
    const footerTopY = Math.min(74, fundsBoxBottom - 16);
    const footerLineGap = 11;

    page.drawText(pricingConfig.footer.estimatedChargesLine, {
      x: margin,
      y: footerTopY,
      size: 8.4,
      font: fontBold,
      color: textColor
    });

    page.drawText(
      "Estimate assumes: 780+ credit score, single family residence, and owner occupied",
      {
        x: margin,
        y: footerTopY - footerLineGap,
        size: 8.4,
        font: fontBold,
        color: textColor
      }
    );

    page.drawText(FOOTER_COMPANY_NMLS_LINE, {
      x: margin,
      y: footerTopY - footerLineGap * 2,
      size: 8.4,
      font: fontBold,
      color: textColor
    });

    page.drawText(FOOTER_DISCLAIMER_HOA, {
      x: margin,
      y: footerTopY - footerLineGap * 3,
      size: 8.2,
      font,
      color: textColor
    });

    page.drawText(
      `${pricingConfig.footer.pricingUpdatedPrefix} ${pricingLastUpdatedText}`,
      {
        x: margin,
        y: footerTopY - footerLineGap * 4,
        size: 8.2,
        font,
        color: textColor
      }
    );

    if (equalHousingLogo) {
      const maxLogoWidth = 98;
      const maxLogoHeight = 49;
      const logoScale = Math.min(
        maxLogoWidth / equalHousingLogo.width,
        maxLogoHeight / equalHousingLogo.height
      );
      const logoWidth = equalHousingLogo.width * logoScale;
      const logoHeight = equalHousingLogo.height * logoScale;
      const ratesUpdatedLineY = footerTopY - footerLineGap * 4;
      const ratesUpdatedLineBottomY = ratesUpdatedLineY - 1.5;

      page.drawImage(equalHousingLogo, {
        x: pageWidth - margin - logoWidth,
        y: ratesUpdatedLineBottomY,
        width: logoWidth,
        height: logoHeight
      });
    }

    const pdfBytes = await pdfDoc.save();

    try {
      await recordTransactionSummaryGenerated();
    } catch (analyticsError) {
      console.warn("Transaction summary analytics update failed", {
        error:
          analyticsError instanceof Error ? analyticsError.message : "unknown"
      });
    }

    return new NextResponse(pdfBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="transaction-summary.pdf"',
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    console.error("Transaction summary generation failed", error);

    return NextResponse.json(
      {
        error: "Unable to generate PDF at this time. Please try again."
      },
      { status: 500 }
    );
  }
}
