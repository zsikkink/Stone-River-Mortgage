"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { AddressAutocomplete } from "@/components/address-autocomplete";
import { MINNESOTA_ADDRESS_ONLY_MESSAGE } from "@/lib/constants";
import { getLoanAmountBoundsMessage } from "@/lib/loanAmount";

const APPLY_URL =
  "https://www.blink.mortgage/app/signup/p/stonerivermortgagellc/mikesikkink?campaign=StoneRiverMortgage";
const PHONE_DISPLAY = "612.850.2018";
const PHONE_LINK = "tel:+16128502018";
const DEFAULT_TRANSACTION_SUMMARY_PDF_FILENAME =
  "Stone River Mortgage Transaction Summary.pdf";
const PDF_PREVIEW_WIDTH = 612;
const PDF_PREVIEW_HEIGHT = 792;
const DESKTOP_PDF_PREVIEW_BREAKPOINT = 1024;
const MOBILE_PDF_PREVIEW_BOTTOM_MARGIN = 16;
const STREET_SUFFIX_ABBREVIATIONS = new Set([
  "RD",
  "ST",
  "AVE",
  "BLVD",
  "DR",
  "LN",
  "CT",
  "PL",
  "PKWY",
  "TER",
  "CIR",
  "TRL",
  "HWY"
]);

type DownPaymentOption = "5" | "10" | "15" | "20" | "25" | "custom";
type CustomDownPaymentMode = "percent" | "amount";

type FormErrors = {
  address?: string;
  purchasePrice?: string;
  downPaymentPercent?: string;
  loanAmount?: string;
};

type VerifiedAddress = {
  formattedAddress: string;
  county: string | null;
  state: string | null;
  zip: string | null;
  lat: number;
  lng: number;
};

type PropertyTaxResult = {
  annualTax: number;
  source:
    | "User Provided"
    | "Estimated Using County Rate"
    | "County Retrieved";
  requestedTaxYear?: number;
  actualTaxYearUsed?: number;
  yearMatchStatus?: "matched" | "latest_available_used" | "unknown";
  rateUsed?: number;
  countyUsed?: string;
  warnings: string[];
  details?: {
    result_type?: "county_retrieved" | "estimated" | "unresolved";
    requested_tax_year?: number | null;
    actual_tax_year_used?: number | null;
    year_match_status?: "matched" | "latest_available_used" | "unknown";
    estimation_notes?: string[];
  };
};

type ShareCapableNavigator = Navigator & {
  canShare?: (data?: ShareData) => boolean;
  share?: (data: ShareData) => Promise<void>;
};

type PdfJsModule = typeof import("pdfjs-dist/build/pdf.mjs");
type PdfDocumentLoadingTask = ReturnType<PdfJsModule["getDocument"]>;
type PdfDocumentProxy = Awaited<PdfDocumentLoadingTask["promise"]>;
type PdfPageProxy = Awaited<ReturnType<PdfDocumentProxy["getPage"]>>;
type PdfRenderTask = ReturnType<PdfPageProxy["render"]>;

const DOWN_PAYMENT_BUTTONS: Array<{ value: DownPaymentOption; label: string }> = [
  { value: "5", label: "5%" },
  { value: "10", label: "10%" },
  { value: "15", label: "15%" },
  { value: "20", label: "20%" },
  { value: "25", label: "25%" },
  { value: "custom", label: "Custom" }
];

let pdfJsModulePromise: Promise<PdfJsModule> | null = null;

const PDF_PREVIEW_STANDARD_FONT_DATA_URL = "/pdfjs/standard_fonts/";

function getPdfJsModule() {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = import("pdfjs-dist/build/pdf.mjs").then((module) => {
      module.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url
      ).toString();

      return module;
    });
  }

  return pdfJsModulePromise;
}

function isPdfPreviewCancellationError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.name === "AbortException" ||
    error.name === "RenderingCancelledException" ||
    /worker was destroyed/i.test(error.message) ||
    /transport destroyed/i.test(error.message)
  );
}

function PdfPreviewCanvas({
  previewBlob,
  scale
}: {
  previewBlob: Blob;
  scale: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const loadingTaskRef = useRef<PdfDocumentLoadingTask | null>(null);
  const pdfDocumentRef = useRef<PdfDocumentProxy | null>(null);
  const renderTaskRef = useRef<PdfRenderTask | null>(null);
  const [pdfDocument, setPdfDocument] = useState<PdfDocumentProxy | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(true);

  useEffect(() => {
    let disposed = false;

    const loadDocument = async () => {
      setRenderError(null);
      setIsRendering(true);
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
      setPdfDocument(null);

      if (loadingTaskRef.current) {
        void loadingTaskRef.current.destroy();
        loadingTaskRef.current = null;
      }

      if (pdfDocumentRef.current) {
        void pdfDocumentRef.current.destroy();
        pdfDocumentRef.current = null;
      }

      try {
        const pdfjs = await getPdfJsModule().catch((error) => {
          console.error("Failed to initialize PDF.js preview module.", error);
          throw error;
        });
        const data = new Uint8Array(await previewBlob.arrayBuffer());
        if (disposed) {
          return;
        }

        const loadingTask = pdfjs.getDocument({
          data,
          standardFontDataUrl: PDF_PREVIEW_STANDARD_FONT_DATA_URL,
          useWorkerFetch: false
        });
        loadingTaskRef.current = loadingTask;
        const pdfDocument = await loadingTask.promise;

        if (disposed) {
          void pdfDocument.destroy();
          return;
        }

        pdfDocumentRef.current = pdfDocument;
        setPdfDocument(pdfDocument);
      } catch (error) {
        if (disposed || isPdfPreviewCancellationError(error)) {
          return;
        }

        console.error("Failed to load PDF.js document preview.", error);
        setRenderError("Unable to render the PDF preview.");
        setIsRendering(false);
      }
    };

    void loadDocument();

    return () => {
      disposed = true;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;

      if (loadingTaskRef.current) {
        void loadingTaskRef.current.destroy();
        loadingTaskRef.current = null;
      }

      if (pdfDocumentRef.current) {
        void pdfDocumentRef.current.destroy();
        pdfDocumentRef.current = null;
      }
    };
  }, [previewBlob]);

  useEffect(() => {
    let disposed = false;

    const renderFirstPage = async () => {
      const canvas = canvasRef.current;
      if (!pdfDocument || !canvas) {
        return;
      }

      setRenderError(null);
      setIsRendering(true);
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;

      try {
        const page = await pdfDocument.getPage(1);
        if (disposed) {
          return;
        }

        const deviceScale = Math.max(window.devicePixelRatio || 1, 1);
        const cssViewport = page.getViewport({ scale });
        const renderViewport = page.getViewport({ scale: scale * deviceScale });
        const context = canvas.getContext("2d", { alpha: false });

        if (!context) {
          throw new Error("Unable to acquire a canvas context for the PDF preview.");
        }

        canvas.width = Math.ceil(renderViewport.width);
        canvas.height = Math.ceil(renderViewport.height);
        canvas.style.width = `${cssViewport.width}px`;
        canvas.style.height = `${cssViewport.height}px`;
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, canvas.width, canvas.height);

        const renderTask = page.render({
          canvasContext: context,
          viewport: renderViewport
        });
        renderTaskRef.current = renderTask;
        await renderTask.promise;

        if (!disposed) {
          setIsRendering(false);
        }
      } catch (error) {
        if (disposed || isPdfPreviewCancellationError(error)) {
          return;
        }

        console.error("Failed to render PDF.js page preview.", error);
        if (!disposed) {
          setRenderError("Unable to render the PDF preview.");
          setIsRendering(false);
        }
      }
    };

    void renderFirstPage();

    return () => {
      disposed = true;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
    };
  }, [pdfDocument, scale]);

  return (
    <>
      <canvas
        ref={canvasRef}
        aria-label="Transaction Summary PDF Preview"
        className="absolute left-0 top-0 block bg-white"
      />
      {isRendering ? (
        <div className="absolute inset-0 flex items-center justify-center bg-white text-sm text-slate-500">
          Rendering preview...
        </div>
      ) : null}
      {renderError ? (
        <div className="absolute inset-0 flex items-center justify-center bg-white px-4 text-center text-sm text-red-700">
          {renderError}
        </div>
      ) : null}
    </>
  );
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function parseNumericInput(value: string): number {
  const sanitized = value.replace(/[^\d.]/g, "");
  if (!sanitized) {
    return 0;
  }

  const parsed = Number.parseFloat(sanitized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatNumericInputWithCommas(value: string): string {
  const sanitized = value.replace(/[^\d.]/g, "");
  if (!sanitized) {
    return "";
  }

  const dotIndex = sanitized.indexOf(".");
  const hasDot = dotIndex >= 0;
  const integerRaw = (hasDot ? sanitized.slice(0, dotIndex) : sanitized).replace(
    /^0+(?=\d)/,
    ""
  );
  const decimalRaw = hasDot ? sanitized.slice(dotIndex + 1).replace(/\./g, "") : "";
  const decimalPart = decimalRaw.slice(0, 2);

  const integerValue = Number.parseInt(integerRaw || "0", 10);
  const formattedInteger = Number.isFinite(integerValue)
    ? new Intl.NumberFormat("en-US", {
        maximumFractionDigits: 0
      }).format(integerValue)
    : "0";

  if (hasDot) {
    return `${formattedInteger}.${decimalPart}`;
  }

  return formattedInteger;
}

function formatDownPaymentForFilename(percent: number): string {
  const roundedToTwo = Math.round(percent * 100) / 100;
  const valueText = Number.isInteger(roundedToTwo)
    ? String(Math.trunc(roundedToTwo))
    : roundedToTwo.toFixed(2).replace(/\.?0+$/, "");
  return `${valueText}%`;
}

function trimTrailingStreetSuffix(streetLine: string): string {
  const parts = streetLine.trim().split(/\s+/);
  if (parts.length < 2) {
    return streetLine.trim();
  }

  const lastPart = parts[parts.length - 1]?.replace(/\./g, "").toUpperCase();
  if (lastPart && STREET_SUFFIX_ABBREVIATIONS.has(lastPart)) {
    return parts.slice(0, -1).join(" ");
  }

  return streetLine.trim();
}

function sanitizeFilenameSegment(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildTransactionSummaryFilename(params: {
  formattedAddress: string;
  downPaymentPercent: number;
}): string {
  const normalizedAddress = params.formattedAddress.replace(/,\s*USA\s*$/i, "").trim();
  const streetLine = normalizedAddress.split(",")[0]?.trim() ?? "";
  const streetForFilename = sanitizeFilenameSegment(
    trimTrailingStreetSuffix(streetLine)
  );
  const safeStreet = streetForFilename || "Transaction Summary";
  const downPaymentLabel = formatDownPaymentForFilename(params.downPaymentPercent);
  return `${safeStreet} - ${downPaymentLabel} Down.pdf`;
}

export function MarketingPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [address, setAddress] = useState("");
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [isVerifyingAddress, setIsVerifyingAddress] = useState(false);
  const [verifiedAddress, setVerifiedAddress] = useState<VerifiedAddress | null>(
    null
  );
  const [addressVerificationError, setAddressVerificationError] = useState<
    string | null
  >(null);
  const [suppressAddressSuggestions, setSuppressAddressSuggestions] =
    useState(false);
  const [purchasePrice, setPurchasePrice] = useState("");
  const [downPaymentOption, setDownPaymentOption] =
    useState<DownPaymentOption>("20");
  const [customDownPaymentMode, setCustomDownPaymentMode] =
    useState<CustomDownPaymentMode>("percent");
  const [customDownPaymentPercent, setCustomDownPaymentPercent] = useState("");
  const [customDownPaymentAmount, setCustomDownPaymentAmount] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [requestError, setRequestError] = useState<string | null>(null);
  const [propertyTaxResult, setPropertyTaxResult] =
    useState<PropertyTaxResult | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [previewFilename, setPreviewFilename] = useState(
    DEFAULT_TRANSACTION_SUMMARY_PDF_FILENAME
  );
  const [shareError, setShareError] = useState<string | null>(null);
  const previewRef = useRef<HTMLElement | null>(null);
  const pdfPreviewViewportRef = useRef<HTMLDivElement | null>(null);
  const pdfPreviewLastWidthRef = useRef<number | null>(null);
  const pdfPreviewLastIsDesktopRef = useRef<boolean | null>(null);
  const pdfPreviewMobileScaleLockedRef = useRef(false);
  const [pdfPreviewScale, setPdfPreviewScale] = useState<number | null>(null);
  const [isDesktopPdfPreview, setIsDesktopPdfPreview] = useState(true);
  const [mobilePdfPreviewHeight, setMobilePdfPreviewHeight] = useState<number | null>(
    null
  );

  const downPaymentPercent = useMemo(() => {
    if (downPaymentOption === "custom") {
      if (customDownPaymentMode === "amount") {
        const parsedPurchasePrice = parseNumericInput(purchasePrice);
        const parsedCustomAmount = parseNumericInput(customDownPaymentAmount);
        if (parsedPurchasePrice <= 0) {
          return Number.NaN;
        }
        return (parsedCustomAmount / parsedPurchasePrice) * 100;
      }

      return Number.parseFloat(customDownPaymentPercent);
    }

    return Number.parseFloat(downPaymentOption);
  }, [
    customDownPaymentAmount,
    customDownPaymentMode,
    customDownPaymentPercent,
    downPaymentOption,
    purchasePrice
  ]);

  const estimatedDownPaymentAmount = useMemo(() => {
    if (downPaymentOption === "custom" && customDownPaymentMode === "amount") {
      return parseNumericInput(customDownPaymentAmount);
    }

    const parsedPurchasePrice = parseNumericInput(purchasePrice);
    return (
      (parsedPurchasePrice *
        (Number.isFinite(downPaymentPercent) ? downPaymentPercent : 0)) /
      100
    );
  }, [
    customDownPaymentAmount,
    customDownPaymentMode,
    downPaymentOption,
    downPaymentPercent,
    purchasePrice
  ]);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  useEffect(() => {
    setPdfPreviewScale(null);
    setMobilePdfPreviewHeight(null);
    pdfPreviewLastWidthRef.current = null;
    pdfPreviewLastIsDesktopRef.current = null;
    pdfPreviewMobileScaleLockedRef.current = false;
  }, [previewUrl]);

  useEffect(() => {
    const node = pdfPreviewViewportRef.current;
    if (!node) {
      return;
    }

    let frameId = 0;

    const updateScale = () => {
      const availableWidth = node.clientWidth;
      const widthScale = availableWidth / PDF_PREVIEW_WIDTH;
      const roundedWidth = Math.round(availableWidth);
      const isDesktopViewport =
        window.innerWidth >= DESKTOP_PDF_PREVIEW_BREAKPOINT;
      const previousWidth = pdfPreviewLastWidthRef.current;
      const previousIsDesktop = pdfPreviewLastIsDesktopRef.current;
      setIsDesktopPdfPreview(isDesktopViewport);

      if (isDesktopViewport) {
        pdfPreviewLastWidthRef.current = roundedWidth;
        pdfPreviewLastIsDesktopRef.current = true;
        setMobilePdfPreviewHeight(null);
        setPdfPreviewScale(
          Number.isFinite(widthScale) && widthScale > 0 ? widthScale : 1
        );
        return;
      }

      const shouldSkipHeightOnlyMobileUpdate =
        pdfPreviewMobileScaleLockedRef.current &&
        previousIsDesktop === false &&
        previousWidth === roundedWidth;

      if (shouldSkipHeightOnlyMobileUpdate) {
        return;
      }

      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const rect = node.getBoundingClientRect();
      const rawAvailableHeight =
        viewportHeight - rect.top - MOBILE_PDF_PREVIEW_BOTTOM_MARGIN;
      const availableHeight =
        Number.isFinite(rawAvailableHeight) && rawAvailableHeight > 0
          ? rawAvailableHeight
          : viewportHeight * 0.6;
      const heightScale = availableHeight / PDF_PREVIEW_HEIGHT;
      const nextScale = Math.min(widthScale, heightScale, 1);

      pdfPreviewLastWidthRef.current = roundedWidth;
      pdfPreviewLastIsDesktopRef.current = false;
      setMobilePdfPreviewHeight(
        Number.isFinite(availableHeight) && availableHeight > 0
          ? availableHeight
          : null
      );
      setPdfPreviewScale(Number.isFinite(nextScale) && nextScale > 0 ? nextScale : 1);
    };

    const scheduleUpdate = () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      frameId = window.requestAnimationFrame(() => {
        updateScale();
      });
    };

    scheduleUpdate();
    const delayedUpdateIds = [180, 360].map((delay) =>
      window.setTimeout(scheduleUpdate, delay)
    );
    const mobileScaleLockTimeoutId = window.setTimeout(() => {
      pdfPreviewMobileScaleLockedRef.current = true;
    }, 420);

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => {
        scheduleUpdate();
      });
      observer.observe(node);
    }

    window.addEventListener("resize", scheduleUpdate);

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      delayedUpdateIds.forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
      window.clearTimeout(mobileScaleLockTimeoutId);
      observer?.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [previewUrl]);

  const closeModal = () => {
    setIsModalOpen(false);
    setErrors({});
    setRequestError(null);
    setAddressVerificationError(null);
    setSuppressAddressSuggestions(false);
  };

  const openModal = () => {
    setRequestError(null);
    setShareError(null);
    setErrors({});
    setAddressVerificationError(null);
    setSuppressAddressSuggestions(false);
    setIsModalOpen(true);
  };

  const verifyAddressByPlaceId = async (
    placeId: string
  ): Promise<VerifiedAddress> => {
    const response = await fetch("/api/geo/verify-address", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ placeId })
    });

    const payload = (await response.json()) as
      | (VerifiedAddress & { ok?: boolean; error?: string })
      | { error?: string };

    if (!response.ok || !("formattedAddress" in payload)) {
      throw new Error(
        payload?.error ||
          "Invalid address. Please select a valid address from suggestions."
      );
    }

    return {
      formattedAddress: payload.formattedAddress,
      county: payload.county,
      state: payload.state,
      zip: payload.zip,
      lat: payload.lat,
      lng: payload.lng
    };
  };

  const handleAddressInputChange = (nextAddress: string) => {
    setAddress(nextAddress);
    setSelectedPlaceId(null);
    setVerifiedAddress(null);
    setAddressVerificationError(null);
    setSuppressAddressSuggestions(false);
    setErrors((current) => ({ ...current, address: undefined }));
  };

  const handleAddressSelect = async (
    selection: { placeId: string; formattedAddress: string } | null
  ) => {
    if (!selection) {
      setSelectedPlaceId(null);
      setVerifiedAddress(null);
      return;
    }

    setSelectedPlaceId(selection.placeId);
    setAddress(selection.formattedAddress);
    setAddressVerificationError(null);
    setSuppressAddressSuggestions(false);
    setIsVerifyingAddress(true);

    try {
      const verified = await verifyAddressByPlaceId(selection.placeId);
      setVerifiedAddress(verified);
      setAddress(verified.formattedAddress);
    } catch (error) {
      setVerifiedAddress(null);
      const message =
        error instanceof Error
          ? error.message
          : "Invalid address. Please select a valid address from suggestions.";
      setAddressVerificationError(message);
      setSuppressAddressSuggestions(true);
    } finally {
      setIsVerifyingAddress(false);
    }
  };

  const validateForm = (): {
    isValid: boolean;
    parsedPurchasePrice: number;
    parsedDownPaymentPercent: number;
  } => {
    const formErrors: FormErrors = {};
    const parsedPurchasePrice = parseNumericInput(purchasePrice);
    const parsedDownPaymentPercent = Number.isFinite(downPaymentPercent)
      ? downPaymentPercent
      : Number.NaN;

    if (!address.trim() || !selectedPlaceId || !verifiedAddress) {
      formErrors.address =
        "Invalid address. Please select a valid address from suggestions.";
    }

    if (
      !formErrors.address &&
      verifiedAddress?.state?.trim().toUpperCase() !== "MN"
    ) {
      formErrors.address = MINNESOTA_ADDRESS_ONLY_MESSAGE;
    }

    if (parsedPurchasePrice <= 0) {
      formErrors.purchasePrice = "Purchase price must be greater than 0.";
    }

    if (!Number.isFinite(parsedDownPaymentPercent)) {
      formErrors.downPaymentPercent =
        downPaymentOption === "custom" && customDownPaymentMode === "amount"
          ? "Down payment amount must be greater than 0 and less than purchase price."
          : "Down payment percent must be greater than 0 and less than 100.";
    } else if (parsedDownPaymentPercent <= 0 || parsedDownPaymentPercent >= 100) {
      formErrors.downPaymentPercent =
        downPaymentOption === "custom" && customDownPaymentMode === "amount"
          ? "Down payment amount must be greater than 0 and less than purchase price."
          : "Down payment percent must be greater than 0 and less than 100.";
    }

    if (!formErrors.purchasePrice && !formErrors.downPaymentPercent) {
      const parsedLoanAmount =
        parsedPurchasePrice -
        (parsedPurchasePrice * parsedDownPaymentPercent) / 100;
      const loanBoundsMessage = getLoanAmountBoundsMessage(parsedLoanAmount);

      if (loanBoundsMessage) {
        formErrors.loanAmount = loanBoundsMessage;
      }
    }

    setErrors(formErrors);

    return {
      isValid: Object.keys(formErrors).length === 0,
      parsedPurchasePrice,
      parsedDownPaymentPercent
    };
  };

  const handlePurchasePriceBlur = () => {
    setPurchasePrice(formatNumericInputWithCommas(purchasePrice));
  };

  const handlePurchasePriceChange = (value: string) => {
    setPurchasePrice(formatNumericInputWithCommas(value));
  };

  const handleCustomDownPaymentAmountChange = (value: string) => {
    setCustomDownPaymentAmount(formatNumericInputWithCommas(value));
  };

  const handleCustomDownPaymentAmountBlur = () => {
    setCustomDownPaymentAmount(
      formatNumericInputWithCommas(customDownPaymentAmount)
    );
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRequestError(null);

    const { isValid, parsedPurchasePrice, parsedDownPaymentPercent } =
      validateForm();

    if (!isValid) {
      return;
    }

    setIsSubmitting(true);

    try {
      let effectiveVerifiedAddress = verifiedAddress;
      if (!effectiveVerifiedAddress && selectedPlaceId) {
        effectiveVerifiedAddress = await verifyAddressByPlaceId(selectedPlaceId);
        setVerifiedAddress(effectiveVerifiedAddress);
      }

      if (!effectiveVerifiedAddress) {
        throw new Error(
          "Invalid address. Please select a valid address from suggestions."
        );
      }

      if (effectiveVerifiedAddress.state?.trim().toUpperCase() !== "MN") {
        throw new Error(MINNESOTA_ADDRESS_ONLY_MESSAGE);
      }

      const taxResponse = await fetch("/api/property-tax", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          formattedAddress: effectiveVerifiedAddress.formattedAddress,
          state: effectiveVerifiedAddress.state,
          lat: effectiveVerifiedAddress.lat,
          lng: effectiveVerifiedAddress.lng,
          purchasePrice: parsedPurchasePrice,
          county: effectiveVerifiedAddress.county,
          taxYear: new Date().getFullYear()
        })
      });

      const taxPayload = (await taxResponse.json()) as
        | PropertyTaxResult
        | { error?: string; details?: { estimation_notes?: string[] } };

      if (!taxResponse.ok || !("annualTax" in taxPayload)) {
        const errorMessage =
          "error" in taxPayload && typeof taxPayload.error === "string"
            ? taxPayload.error
            : "Unable to estimate property taxes.";
        throw new Error(errorMessage);
      }

      const resolvedTaxPayload = taxPayload as PropertyTaxResult;
      setPropertyTaxResult(resolvedTaxPayload);
      const propertyTaxSource: PropertyTaxResult["source"] =
        resolvedTaxPayload.source;
      const requestedTaxYear =
        resolvedTaxPayload.requestedTaxYear ??
        resolvedTaxPayload.details?.requested_tax_year ??
        null;
      const actualTaxYearUsed =
        resolvedTaxPayload.actualTaxYearUsed ??
        resolvedTaxPayload.details?.actual_tax_year_used ??
        null;
      const propertyTaxYearMatchStatus =
        resolvedTaxPayload.yearMatchStatus ??
        resolvedTaxPayload.details?.year_match_status ??
        "unknown";

      const response = await fetch("/api/transaction-summary", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          address: effectiveVerifiedAddress.formattedAddress,
          county: effectiveVerifiedAddress.county,
          state: effectiveVerifiedAddress.state,
          purchasePrice: parsedPurchasePrice,
          downPaymentPercent: parsedDownPaymentPercent,
          annualPropertyTax: resolvedTaxPayload.annualTax,
          propertyTaxSource,
          propertyTaxRequestedYear: requestedTaxYear,
          propertyTaxActualYearUsed: actualTaxYearUsed,
          propertyTaxYearMatchStatus
        })
      });

      if (!response.ok) {
        const errorPayload = (await response.json()) as { error?: string };
        throw new Error(
          errorPayload.error || "Unable to generate the transaction summary PDF."
        );
      }

      const blob = await response.blob();
      const nextPreviewUrl = URL.createObjectURL(blob);
      setPreviewBlob(blob);
      setPreviewFilename(
        buildTransactionSummaryFilename({
          formattedAddress: effectiveVerifiedAddress.formattedAddress,
          downPaymentPercent: parsedDownPaymentPercent
        })
      );
      setShareError(null);

      setPreviewUrl((currentUrl) => {
        if (currentUrl) {
          URL.revokeObjectURL(currentUrl);
        }
        return nextPreviewUrl;
      });

      closeModal();
      window.setTimeout(() => {
        previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 120);
    } catch (error) {
      console.error(error);
      const message =
        error instanceof Error
          ? error.message
          : "We couldn't generate your PDF right now. Please verify your entries and try again.";
      setRequestError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSharePdf = async () => {
    if (!previewBlob || !previewUrl) {
      return;
    }

    setShareError(null);

    try {
      const shareNavigator = navigator as ShareCapableNavigator;
      if (typeof shareNavigator.share !== "function") {
        const opened = window.open(previewUrl, "_blank", "noopener,noreferrer");
        if (!opened) {
          throw new Error(
            "Unable to open the PDF for sharing. Please allow pop-ups and try again."
          );
        }
        return;
      }

      const file = new File([previewBlob], previewFilename, {
        type: "application/pdf"
      });
      const fileShareData: ShareData = { files: [file] };

      if (
        typeof shareNavigator.canShare === "function" &&
        shareNavigator.canShare(fileShareData)
      ) {
        await shareNavigator.share(fileShareData);
        return;
      }

      window.open(previewUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      setShareError(
        error instanceof Error ? error.message : "Unable to share the PDF."
      );
    }
  };

  return (
    <div className="min-h-screen bg-slate-100">
      <header
        className="fixed inset-x-0 top-0 z-30 min-h-[4.25rem] border-b border-slate-200 bg-white shadow-[0_1px_0_rgba(15,23,42,0.04)] sm:bg-white/90 sm:backdrop-blur"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="mx-auto flex min-h-[4.25rem] max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center sm:h-11 sm:w-11">
            <Image
              src="/tree.svg"
              alt=""
              width={44}
              height={44}
              priority
              aria-hidden="true"
              className="h-10 w-10 object-contain sm:h-11 sm:w-11"
            />
          </div>
          <a
            href={PHONE_LINK}
            className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm transition-all duration-200 hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slateBlue focus-visible:ring-offset-2"
          >
            Call Mike Sikkink: {PHONE_DISPLAY}
          </a>
        </div>
      </header>

      <main style={{ paddingTop: "calc(4.25rem + env(safe-area-inset-top))" }}>
        <section className="mx-auto flex max-w-6xl flex-col items-center px-4 pb-16 pt-6 text-center sm:px-6 sm:pt-10 lg:px-8">
          <div
            aria-label="Stone River Mortgage"
            className="mt-4 whitespace-nowrap font-[family-name:var(--font-cormorant-garamond)] text-[2.6rem] font-bold leading-[0.9] tracking-[-0.04em] text-black sm:text-[3.2rem] lg:text-[3.4rem]"
          >
            <span>Stone River</span>
            <span className="ml-2 sm:ml-3">Mortgage</span>
          </div>

          <div className="mt-12 w-full max-w-[34rem] rounded-[1.75rem] border border-slate-200/90 bg-white/90 p-5 shadow-subtle backdrop-blur-sm sm:p-6">
            <h2 className="text-center text-lg font-semibold tracking-tight text-slate-900 sm:text-xl">
              Estimate Your Home Purchase
            </h2>
            <div className="mt-4 flex w-full flex-col items-center gap-3 md:flex-row md:justify-center">
              <button
                type="button"
                onClick={openModal}
                className="inline-flex w-full max-w-[18rem] items-center justify-center rounded-2xl bg-slateBlue px-6 py-3.5 text-lg font-bold text-white shadow-[0_2px_6px_rgba(15,23,42,0.12)] transition-all duration-200 hover:bg-[#17314f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slateBlue focus-visible:ring-offset-2 md:w-auto md:min-w-[13.5rem]"
              >
                Transaction Summary
              </button>
              <a
                href={APPLY_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-full max-w-[18rem] items-center justify-center rounded-2xl border-2 border-slate-300 bg-white px-6 py-3 text-lg font-bold text-slateBlue shadow-[0_2px_6px_rgba(15,23,42,0.1)] transition-all duration-200 hover:border-slateBlue/70 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slateBlue focus-visible:ring-offset-2 md:w-auto md:min-w-[13.5rem]"
              >
                Apply Now
              </a>
            </div>
          </div>
        </section>

        {previewUrl && previewBlob ? (
          <section
            ref={previewRef}
            className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 lg:px-8"
            aria-live="polite"
            style={{ scrollMarginTop: "calc(5.5rem + env(safe-area-inset-top))" }}
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
                Preview
              </h2>
              <button
                type="button"
                onClick={handleSharePdf}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition-all duration-200 hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slateBlue focus-visible:ring-offset-2"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  fill="none"
                  className="h-4 w-4"
                >
                  <path
                    d="M7.5 6.5 10 4m0 0 2.5 2.5M10 4v7"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M5.5 8.75v5.75A1.75 1.75 0 0 0 7.25 16.25h5.5a1.75 1.75 0 0 0 1.75-1.75V8.75"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Share
              </button>
            </div>
            {shareError ? (
              <p className="mt-2 text-sm text-red-700">{shareError}</p>
            ) : null}

            <div className="mt-5">
              <div
                ref={pdfPreviewViewportRef}
                className="mx-auto flex w-full items-start justify-center overflow-hidden lg:overflow-visible"
                style={{
                  height:
                    pdfPreviewScale !== null &&
                    !isDesktopPdfPreview &&
                    mobilePdfPreviewHeight
                      ? Math.min(
                          mobilePdfPreviewHeight,
                          PDF_PREVIEW_HEIGHT * pdfPreviewScale
                        )
                      : undefined
                }}
              >
                {pdfPreviewScale === null ? (
                  <div className="flex min-h-[8rem] items-center justify-center text-sm text-slate-500">
                    Preparing preview...
                  </div>
                ) : (
                  <div
                    className="relative shrink-0 overflow-hidden bg-white shadow-[0_1px_2px_rgba(15,23,42,0.06),0_8px_20px_rgba(15,23,42,0.08)] lg:shadow-[0_1px_2px_rgba(15,23,42,0.08),0_10px_24px_rgba(15,23,42,0.12)]"
                    style={{
                      width: PDF_PREVIEW_WIDTH * pdfPreviewScale,
                      height: PDF_PREVIEW_HEIGHT * pdfPreviewScale
                    }}
                  >
                    <PdfPreviewCanvas
                      previewBlob={previewBlob}
                      scale={pdfPreviewScale}
                    />
                  </div>
                )}
              </div>
            </div>

            {propertyTaxResult
              ? (() => {
                  const requestedTaxYear =
                    propertyTaxResult.requestedTaxYear ??
                    propertyTaxResult.details?.requested_tax_year ??
                    null;
                  const actualTaxYearUsed =
                    propertyTaxResult.actualTaxYearUsed ??
                    propertyTaxResult.details?.actual_tax_year_used ??
                    null;
                  const yearMatchStatus =
                    propertyTaxResult.yearMatchStatus ??
                    propertyTaxResult.details?.year_match_status ??
                    "unknown";
                  const showYearMismatchWarning =
                    yearMatchStatus === "latest_available_used" &&
                    Boolean(requestedTaxYear) &&
                    Boolean(actualTaxYearUsed);
                  const sourceLabel =
                    propertyTaxResult.source === "County Retrieved"
                      ? actualTaxYearUsed
                        ? yearMatchStatus === "latest_available_used"
                          ? `County Retrieved, ${actualTaxYearUsed} data`
                          : `County Retrieved, ${actualTaxYearUsed}`
                        : "County Retrieved"
                      : propertyTaxResult.source;
                  const filteredWarnings = showYearMismatchWarning
                    ? propertyTaxResult.warnings.filter(
                        (warning) =>
                          !(
                            /requested tax year/i.test(warning) &&
                            /latest available county data/i.test(warning)
                          )
                      )
                    : propertyTaxResult.warnings;

                  return (
                    <div className="mt-6 rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm text-slate-700 shadow-subtle">
                      <p className="font-semibold text-slate-900">
                        Property Tax: {formatCurrency(propertyTaxResult.annualTax)} / year (
                        {sourceLabel})
                      </p>
                      {showYearMismatchWarning ? (
                        <p className="mt-1 text-xs text-amber-700">
                          Requested {requestedTaxYear}; latest available county data is{" "}
                          {actualTaxYearUsed}.
                        </p>
                      ) : null}
                      <p className="mt-1">
                        Monthly Tax Escrow Estimate:{" "}
                        <span className="font-semibold text-slate-900">
                          {formatCurrency(propertyTaxResult.annualTax / 12)}
                        </span>
                      </p>
                      {propertyTaxResult.rateUsed ? (
                        <p className="mt-1 text-xs text-slate-600">
                          Estimated using{" "}
                          {propertyTaxResult.countyUsed || verifiedAddress?.county || "Minnesota"}{" "}
                          rate ({(propertyTaxResult.rateUsed * 100).toFixed(2)}%).
                        </p>
                      ) : null}
                      {filteredWarnings.length > 0 ? (
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-800">
                          {filteredWarnings.map((warning) => (
                            <li key={warning}>{warning}</li>
                          ))}
                        </ul>
                      ) : null}
                      <p className="mt-2 text-xs text-slate-600">
                        Property tax amounts are estimates unless verified. Actual taxes
                        may vary based on assessed value, homestead status, and local
                        levies.
                      </p>
                    </div>
                  );
                })()
              : null}
          </section>
        ) : null}

        <section>
          <div className="mx-auto max-w-6xl px-4 pb-12 pt-7 sm:px-6 sm:pb-14 sm:pt-9 lg:px-8">
            <div className="grid gap-6 md:grid-cols-3">
              <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-subtle">
                <h3 className="text-lg font-semibold text-slate-900">Our Business Delivers</h3>
                <ul className="mt-4 list-outside list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-700">
                  <li>Lower mortgage rates</li>
                  <li>Fantastic speed to close</li>
                  <li>Simplified user experience</li>
                  <li>Frequent updates</li>
                  <li>Substantial savings</li>
                </ul>
              </article>

              <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-subtle">
                <h3 className="text-lg font-semibold text-slate-900">Our Clients Have</h3>
                <ul className="mt-4 list-outside list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-700">
                  <li>Good credit</li>
                  <li>Home equity / assets</li>
                  <li>Organization skills</li>
                  <li>Price and service focus</li>
                  <li>Borrow $125,000+</li>
                </ul>
              </article>

              <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-subtle">
                <h3 className="text-lg font-semibold text-slate-900">
                  Licenced in Minnesota and Florida
                </h3>
                <ul className="mt-4 list-outside list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-700">
                  <li>CPA &amp; CFA referrals</li>
                  <li>Realtor referrals</li>
                  <li>Professional Mortgage Lender since 1993</li>
                </ul>
              </article>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200/80 bg-white/90">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-sm text-slate-600 sm:px-6 lg:px-8">
          <p>Stone River Mortgage LLC • NMLS ID: 345256 &amp; 2090973</p>
          <p>Mike Sikkink • {PHONE_DISPLAY}</p>
          <p>Licensed in MN &amp; FL</p>
          <p>
            <Link
              href="https://stonerivermortgage.com/"
              className="underline-offset-4 transition-colors duration-200 hover:text-slate-900 hover:underline"
            >
              stonerivermortgage.com
            </Link>
          </p>
        </div>
      </footer>

      {isModalOpen ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeModal();
            }
          }}
        >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="transaction-summary-title"
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-slate-200 bg-white p-6 pb-4 shadow-subtle sm:max-h-none sm:overflow-visible sm:p-7 sm:pb-5"
            >
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h2
                  id="transaction-summary-title"
                  className="text-xl font-semibold tracking-tight text-slate-900"
                >
                  Transaction Summary
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Enter loan details to create a transaction summary PDF.
                </p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                aria-label="Close"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-2xl leading-none text-slate-400 transition-colors duration-200 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slateBlue focus-visible:ring-offset-2"
              >
                <span aria-hidden="true">&times;</span>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div>
                <label
                  htmlFor="property-address"
                  className="mb-1.5 block text-sm font-medium text-slate-800"
                >
                  Minnesota Property Address
                </label>
                <AddressAutocomplete
                  id="property-address"
                  value={address}
                  onValueChange={handleAddressInputChange}
                  onSelect={handleAddressSelect}
                  placeholder="Start typing and select a valid address"
                  disabled={isSubmitting}
                  suppressSuggestions={suppressAddressSuggestions}
                  verificationState={
                    isVerifyingAddress
                      ? "verifying"
                      : verifiedAddress
                        ? "verified"
                        : "idle"
                  }
                />
                {addressVerificationError || errors.address || isVerifyingAddress ? (
                  <p
                    className={`mt-0.5 text-sm leading-4 ${
                      addressVerificationError || errors.address
                        ? "text-red-700"
                        : "text-slate-500"
                    }`}
                  >
                    {addressVerificationError
                      ? addressVerificationError
                      : errors.address
                        ? errors.address
                        : "Verifying address..."}
                  </p>
                ) : null}
              </div>

              <div>
                <label
                  htmlFor="purchase-price"
                  className="mb-1.5 block text-sm font-medium text-slate-800"
                >
                  Purchase Price
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">
                    $
                  </span>
                  <input
                    id="purchase-price"
                    type="text"
                    inputMode="decimal"
                    value={purchasePrice}
                    onChange={(event) => handlePurchasePriceChange(event.target.value)}
                    onBlur={handlePurchasePriceBlur}
                    placeholder="389,900.00"
                    className="w-full rounded-xl border border-slate-300 py-2.5 pl-7 pr-3 text-base text-slate-900 shadow-sm transition-all duration-200 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slateBlue/20 sm:text-sm"
                  />
                </div>
                {errors.purchasePrice ? (
                  <p className="mt-1.5 text-sm text-red-700">{errors.purchasePrice}</p>
                ) : null}
              </div>

              <div>
                <label
                  htmlFor="down-payment"
                  className="mb-1.5 block text-sm font-medium text-slate-800"
                >
                  Down Payment
                </label>
                <div
                  id="down-payment"
                  role="group"
                  aria-label="Down payment options"
                  className="grid grid-cols-5 gap-1.5 sm:flex sm:flex-wrap sm:gap-2"
                >
                  {DOWN_PAYMENT_BUTTONS.map((option) => {
                    const isActive = downPaymentOption === option.value;
                    const isCustomOption = option.value === "custom";
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => {
                          setDownPaymentOption(option.value);
                          setErrors((current) => ({
                            ...current,
                            downPaymentPercent: undefined,
                            loanAmount: undefined
                          }));
                        }}
                        className={`${isCustomOption ? "justify-self-start px-3 sm:px-4" : "w-full min-w-0 px-2 sm:w-auto sm:px-4"} rounded-xl border py-2 text-xs font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 sm:text-sm ${
                          isActive
                            ? "border-emerald-600 bg-emerald-600 text-white shadow-sm focus-visible:ring-emerald-600"
                            : "border-slate-300 bg-white text-slate-800 hover:border-slate-400 hover:bg-slate-50 focus-visible:ring-slateBlue"
                        }`}
                        aria-pressed={isActive}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>

                {downPaymentOption === "custom" ? (
                  <div className="mt-3">
                    <p className="mb-1.5 block text-sm font-medium text-slate-800">
                      Custom Down Payment
                    </p>
                    <div
                      role="group"
                      aria-label="Custom down payment entry mode"
                      className="mb-2 flex flex-wrap gap-2"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setCustomDownPaymentMode("percent");
                          setErrors((current) => ({
                            ...current,
                            downPaymentPercent: undefined,
                            loanAmount: undefined
                          }));
                        }}
                        className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
                          customDownPaymentMode === "percent"
                            ? "border-emerald-600 bg-emerald-600 text-white shadow-sm focus-visible:ring-emerald-600"
                            : "border-slate-300 bg-white text-slate-800 hover:border-slate-400 hover:bg-slate-50 focus-visible:ring-slateBlue"
                        }`}
                        aria-pressed={customDownPaymentMode === "percent"}
                      >
                        Percent (%)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setCustomDownPaymentMode("amount");
                          setErrors((current) => ({
                            ...current,
                            downPaymentPercent: undefined,
                            loanAmount: undefined
                          }));
                        }}
                        className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
                          customDownPaymentMode === "amount"
                            ? "border-emerald-600 bg-emerald-600 text-white shadow-sm focus-visible:ring-emerald-600"
                            : "border-slate-300 bg-white text-slate-800 hover:border-slate-400 hover:bg-slate-50 focus-visible:ring-slateBlue"
                        }`}
                        aria-pressed={customDownPaymentMode === "amount"}
                      >
                        Dollar Amount ($)
                      </button>
                    </div>

                    {customDownPaymentMode === "percent" ? (
                      <div className="relative">
                        <input
                          id="custom-down-payment"
                          type="number"
                          min="0"
                          max="99.99"
                          step="0.01"
                          value={customDownPaymentPercent}
                          onChange={(event) =>
                            setCustomDownPaymentPercent(event.target.value)
                          }
                          placeholder="18"
                          className="w-full rounded-xl border border-slate-300 py-2.5 pl-3 pr-8 text-base text-slate-900 shadow-sm transition-all duration-200 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slateBlue/20 sm:text-sm"
                        />
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">
                          %
                        </span>
                      </div>
                    ) : (
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">
                          $
                        </span>
                        <input
                          id="custom-down-payment-amount"
                          type="text"
                          inputMode="decimal"
                          value={customDownPaymentAmount}
                          onChange={(event) =>
                            handleCustomDownPaymentAmountChange(event.target.value)
                          }
                          onBlur={handleCustomDownPaymentAmountBlur}
                          placeholder="75,000"
                          className="w-full rounded-xl border border-slate-300 py-2.5 pl-7 pr-3 text-base text-slate-900 shadow-sm transition-all duration-200 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slateBlue/20 sm:text-sm"
                        />
                      </div>
                    )}
                  </div>
                ) : null}

                {errors.downPaymentPercent ? (
                  <p className="mt-1.5 text-sm text-red-700">{errors.downPaymentPercent}</p>
                ) : null}
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                Estimated down payment: {formatCurrency(estimatedDownPaymentAmount)}
              </div>
              {errors.loanAmount ? (
                <p className="text-sm text-red-700">{errors.loanAmount}</p>
              ) : null}

              {requestError ? <p className="text-sm text-red-700">{requestError}</p> : null}

              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex w-full items-center justify-center rounded-xl bg-slateBlue px-4 py-2.5 text-base font-semibold text-white transition-all duration-200 hover:bg-[#17314f] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slateBlue focus-visible:ring-offset-2"
              >
                {isSubmitting ? "Generating PDF..." : "Generate Summary"}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
