"use client";

import Image from "next/image";
import Link from "next/link";
import { CSSProperties, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { AddressAutocomplete } from "@/components/address-autocomplete";
import { MINNESOTA_ADDRESS_ONLY_MESSAGE } from "@/lib/constants";
import { getLoanAmountBoundsMessage } from "@/lib/loanAmount";

const APPLY_URL =
  "https://www.blink.mortgage/app/signup/p/stonerivermortgagellc/mikesikkink?campaign=StoneRiverMortgage";
const PHONE_DISPLAY = "612.850.2018";
const PHONE_LINK = "tel:+16128502018";

type DownPaymentOption = "5" | "10" | "15" | "20" | "25" | "custom";

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

const DOWN_PAYMENT_BUTTONS: Array<{ value: DownPaymentOption; label: string }> = [
  { value: "5", label: "5%" },
  { value: "10", label: "10%" },
  { value: "15", label: "15%" },
  { value: "20", label: "20%" },
  { value: "25", label: "25%" },
  { value: "custom", label: "Custom" }
];

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

function LogoShell({
  className,
  priority = false,
  style
}: {
  className: string;
  priority?: boolean;
  style?: CSSProperties;
}) {
  const [logoError, setLogoError] = useState(false);

  return (
    <div className={className} style={style} aria-label="Stone River Mortgage logo">
      {logoError ? (
        <div className="flex min-h-[7rem] w-full items-center justify-center rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-100 to-slate-50 px-4 text-center text-sm font-medium tracking-wide text-slate-500">
          Add logo at /public/logo.png
        </div>
      ) : (
        <Image
          src="/logo.png"
          alt="Stone River Mortgage logo"
          width={1200}
          height={400}
          className="h-auto w-full object-contain"
          style={{ maxWidth: "100%", height: "auto" }}
          priority={priority}
          onError={() => setLogoError(true)}
          sizes="(max-width: 640px) 90vw, 460px"
        />
      )}
    </div>
  );
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
  const [customDownPaymentPercent, setCustomDownPaymentPercent] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [requestError, setRequestError] = useState<string | null>(null);
  const [propertyTaxResult, setPropertyTaxResult] =
    useState<PropertyTaxResult | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const previewRef = useRef<HTMLElement | null>(null);

  const downPaymentPercent = useMemo(() => {
    if (downPaymentOption === "custom") {
      return Number.parseFloat(customDownPaymentPercent);
    }

    return Number.parseFloat(downPaymentOption);
  }, [downPaymentOption, customDownPaymentPercent]);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
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
      : 0;

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

    if (
      !Number.isFinite(parsedDownPaymentPercent) ||
      parsedDownPaymentPercent <= 0 ||
      parsedDownPaymentPercent >= 100
    ) {
      formErrors.downPaymentPercent =
        "Down payment percent must be greater than 0 and less than 100.";
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
            "Unable to open the PDF for sharing. Please allow pop-ups or use Download PDF."
          );
        }
        return;
      }

      const file = new File([previewBlob], "transaction-summary.pdf", {
        type: "application/pdf"
      });
      const fileShareData: ShareData = {
        title: "Transaction Summary PDF",
        text: "Stone River Mortgage Transaction Summary",
        files: [file]
      };

      if (
        typeof shareNavigator.canShare === "function" &&
        shareNavigator.canShare(fileShareData)
      ) {
        await shareNavigator.share(fileShareData);
        return;
      }

      const opened = window.open(previewUrl, "_blank", "noopener,noreferrer");
      if (!opened) {
        await shareNavigator.share({
          title: "Transaction Summary PDF",
          text: "Stone River Mortgage Transaction Summary",
          url: window.location.href
        });
      }
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
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-end gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <a
            href={PHONE_LINK}
            className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm transition-all duration-200 hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slateBlue focus-visible:ring-offset-2"
          >
            Call Mike Sikkink: {PHONE_DISPLAY}
          </a>
        </div>
      </header>

      <main>
        <section className="mx-auto flex max-w-6xl flex-col items-center px-4 pb-16 pt-5 text-center sm:px-6 sm:pt-8 lg:px-8">
          <LogoShell
            className="w-full max-w-[31rem]"
            style={{ width: "min(100%, 31rem)" }}
            priority
          />
          <h1 className="mt-8 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            Exceptional Rates for Exceptional Clients
          </h1>

          <div className="mt-8 flex w-full max-w-xl flex-col gap-3 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={openModal}
              className="rounded-xl border border-slate-300 bg-white px-8 py-4 text-lg font-semibold text-slate-800 shadow-sm transition-all duration-200 hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slateBlue focus-visible:ring-offset-2"
            >
              Transaction Summary
            </button>
            <a
              href={APPLY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-xl bg-slateBlue px-8 py-4 text-lg font-semibold text-white shadow-subtle transition-all duration-200 hover:bg-[#17314f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slateBlue focus-visible:ring-offset-2"
            >
              Apply Now
            </a>
          </div>
        </section>

        {previewUrl ? (
          <section
            ref={previewRef}
            className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 lg:px-8"
            aria-live="polite"
          >
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-subtle sm:p-8">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
                  Preview
                </h2>
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                  <button
                    type="button"
                    onClick={handleSharePdf}
                    className="inline-flex w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition-all duration-200 hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slateBlue focus-visible:ring-offset-2 sm:w-auto"
                  >
                    Share PDF
                  </button>
                  <a
                    href={previewUrl}
                    download="transaction-summary.pdf"
                    className="inline-flex w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition-all duration-200 hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slateBlue focus-visible:ring-offset-2 sm:w-auto"
                  >
                    Download PDF
                  </a>
                </div>
              </div>
              {shareError ? (
                <p className="mt-2 text-sm text-red-700">{shareError}</p>
              ) : null}

              <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                <div className="mx-auto w-full max-w-[920px]">
                  <iframe
                    src={`${previewUrl}#page=1&zoom=page-fit&toolbar=0&navpanes=0&scrollbar=0`}
                    title="Transaction Summary PDF Preview"
                    className="aspect-[8.5/11] w-full border-0"
                  />
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
                      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
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
            </div>
          </section>
        ) : null}

        <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 lg:px-8">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-subtle sm:p-10">
            <div className="grid gap-6 md:grid-cols-3">
              <article className="rounded-2xl border border-slate-200 bg-slate-50/60 p-5">
                <h3 className="text-lg font-semibold text-slate-900">Our Business Delivers</h3>
                <ul className="mt-4 list-outside list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-700">
                  <li>Lower mortgage rates</li>
                  <li>Fantastic speed to close</li>
                  <li>Simplified user experience</li>
                  <li>Frequent updates</li>
                  <li>Substantial savings</li>
                </ul>
              </article>

              <article className="rounded-2xl border border-slate-200 bg-slate-50/60 p-5">
                <h3 className="text-lg font-semibold text-slate-900">Our Mortgage Clients Have</h3>
                <ul className="mt-4 list-outside list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-700">
                  <li>Good credit</li>
                  <li>Home equity / assets</li>
                  <li>Organization skills</li>
                  <li>Price and service focus</li>
                  <li>Loan $300,000 - $2,000,000</li>
                </ul>
              </article>

              <article className="rounded-2xl border border-slate-200 bg-slate-50/60 p-5">
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
          className="fixed inset-0 z-40 flex items-end bg-slate-900/50 p-4 sm:items-center sm:justify-center"
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
                  Property Address
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
                    className="w-full rounded-xl border border-slate-300 py-2.5 pl-7 pr-3 text-sm text-slate-900 shadow-sm transition-all duration-200 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slateBlue/20"
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
                  className="flex flex-wrap gap-2"
                >
                  {DOWN_PAYMENT_BUTTONS.map((option) => {
                    const isActive = downPaymentOption === option.value;
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
                        className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
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
                    <label
                      htmlFor="custom-down-payment"
                      className="mb-1.5 block text-sm font-medium text-slate-800"
                    >
                      Custom Down Payment %
                    </label>
                    <div className="relative">
                      <input
                        id="custom-down-payment"
                        type="number"
                        min="0"
                        max="99.99"
                        step="0.01"
                        value={customDownPaymentPercent}
                        onChange={(event) => setCustomDownPaymentPercent(event.target.value)}
                        placeholder="18"
                        className="w-full rounded-xl border border-slate-300 py-2.5 pl-3 pr-8 text-sm text-slate-900 shadow-sm transition-all duration-200 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slateBlue/20"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">
                        %
                      </span>
                    </div>
                  </div>
                ) : null}

                {errors.downPaymentPercent ? (
                  <p className="mt-1.5 text-sm text-red-700">{errors.downPaymentPercent}</p>
                ) : null}
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                Estimated down payment: {formatCurrency((parseNumericInput(purchasePrice) * (Number.isFinite(downPaymentPercent) ? downPaymentPercent : 0)) / 100)}
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
