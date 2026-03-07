"use client";

import Image from "next/image";
import { FormEvent, useEffect, useState } from "react";

type PricingFees = {
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

type PricingFooter = {
  estimatedChargesLine: string;
  interestAvailabilityPrefix: string;
  companyLine: string;
  pricingUpdatedPrefix: string;
  contactLine: string;
};

type EditablePricingConfig = {
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

type PricingConfig = EditablePricingConfig & {
  lastUpdatedAt: string | null;
  lastUpdatedBy: string | null;
};

type PricingAnalytics = {
  pdfGeneratedCount: number;
  propertyTaxLookupCount: number;
  propertyTaxLookupCountByCounty: Record<string, number>;
  propertyTaxLookupNonMetroCount: number;
  propertyTaxCurrentOrPreviousYearRecordFoundCount: number;
  currentYear: number;
  previousYear: number;
  currentOrPreviousYearSuccessRate: number | null;
};

type PricingResponse = {
  authenticated: boolean;
  userEmail: string | null;
  pricing: PricingConfig;
  analytics?: PricingAnalytics;
  authWarning?: string | null;
  storage?: {
    dataDir: string;
    storageMode: "filesystem" | "memory_fallback";
  };
};

type CoreNumericFieldKey =
  | "interestRate"
  | "discountPointFactor"
  | "aprSpread"
  | "propertyTaxAnnualRate"
  | "homeownersInsuranceRate"
  | "homeownersInsuranceRoundDownTo"
  | "mortgageInsuranceMonthly"
  | "hoaMonthly"
  | "mortgageRegistrationTaxRate";

const coreNumericFields: Array<{
  key: CoreNumericFieldKey;
  label: string;
  step: string;
  min: string;
  hint: string;
}> = [
  {
    key: "interestRate",
    label: "Interest Rate (%)",
    step: "0.001",
    min: "0",
    hint: "Principal & interest payment uses this rate."
  },
  {
    key: "discountPointFactor",
    label: "Discount Point Factor",
    step: "0.0001",
    min: "0",
    hint: "Discount points amount = Loan Amount x Discount Point Factor."
  },
  {
    key: "aprSpread",
    label: "APR Spread (%)",
    step: "0.001",
    min: "0",
    hint: "APR shown on PDF = Interest Rate + APR Spread."
  },
  {
    key: "propertyTaxAnnualRate",
    label: "Property Tax Annual Rate",
    step: "0.0001",
    min: "0",
    hint: "Property tax (est.) = Purchase Price x Property Tax Annual Rate / 12."
  },
  {
    key: "homeownersInsuranceRate",
    label: "Homeowners Insurance Annual Rate",
    step: "0.0001",
    min: "0",
    hint: "Insurance (est.) before rounding = Purchase Price x Homeowners Insurance Annual Rate / 12."
  },
  {
    key: "homeownersInsuranceRoundDownTo",
    label: "Insurance Round Down Increment ($)",
    step: "1",
    min: "1",
    hint: "Insurance (est.) is rounded down to the nearest increment."
  },
  {
    key: "mortgageInsuranceMonthly",
    label: "Mortgage Insurance Monthly ($)",
    step: "0.01",
    min: "0",
    hint: "Mortgage insurance line item uses this monthly amount."
  },
  {
    key: "hoaMonthly",
    label: "HOA Monthly ($)",
    step: "0.01",
    min: "0",
    hint: "HOA line item uses this monthly amount."
  },
  {
    key: "mortgageRegistrationTaxRate",
    label: "Mortgage Registration Tax Rate",
    step: "0.0001",
    min: "0",
    hint: "Mortgage Registration Tax = Loan Amount x Mortgage Registration Tax Rate."
  }
];

const feeFields: Array<{
  key: keyof PricingFees;
  label: string;
  hint: string;
}> = [
  {
    key: "underwritingFee",
    label: "Underwriting Fee",
    hint: "Added directly to closing costs."
  },
  {
    key: "appraisalFee",
    label: "Appraisal Fee",
    hint: "Added directly to closing costs."
  },
  {
    key: "creditReportFee",
    label: "Credit Report Fee",
    hint: "Added directly to closing costs."
  },
  {
    key: "mersFee",
    label: "MERS Fee",
    hint: "Added directly to closing costs."
  },
  {
    key: "floodCertFee",
    label: "Flood Certification Fee",
    hint: "Added directly to closing costs."
  },
  {
    key: "taxServiceFee",
    label: "Tax Service Fee",
    hint: "Added directly to closing costs."
  },
  {
    key: "settlementFee",
    label: "Settlement Closing Fee",
    hint: "Added directly to closing costs."
  },
  {
    key: "titlePrepFee",
    label: "Title Prep & Exam Fee",
    hint: "Added directly to closing costs."
  },
  {
    key: "lenderTitlePolicy",
    label: "Lender Title Policy",
    hint: "Added directly to closing costs."
  },
  {
    key: "ownerTitlePolicy",
    label: "Owner Title Policy",
    hint: "Added directly to closing costs."
  },
  {
    key: "countyRecording",
    label: "County Recording Fee",
    hint: "Added directly to closing costs."
  },
  {
    key: "conservationFee",
    label: "Conservation Fee",
    hint: "Added directly to closing costs."
  },
  {
    key: "brokerageAdminFee",
    label: "Brokerage Admin Fee",
    hint: "Total funds needed = Down Payment + Closing Costs + Brokerage Admin Fee."
  }
];

const footerFields: Array<{
  key: keyof PricingFooter;
  label: string;
  hint: string;
}> = [
  {
    key: "estimatedChargesLine",
    label: "Estimated Charges Line",
    hint: "Printed in the PDF footer disclaimer line."
  },
  {
    key: "interestAvailabilityPrefix",
    label: "Interest Availability Prefix",
    hint: "Printed before today's date in the PDF footer."
  },
  {
    key: "companyLine",
    label: "Company Line",
    hint: "Printed in the PDF footer company line."
  },
  {
    key: "pricingUpdatedPrefix",
    label: "Pricing Updated Prefix",
    hint: "Printed before the last-updated timestamp."
  },
  {
    key: "contactLine",
    label: "Contact Line",
    hint: "Printed in PDF header and footer contact rows."
  }
];

const inputClassName =
  "w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-900 shadow-sm transition-all duration-200 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slateBlue/20";

function formatLastUpdated(pricing: PricingConfig): string {
  if (!pricing.lastUpdatedAt) {
    return "Not updated yet";
  }

  const date = new Date(pricing.lastUpdatedAt);
  const timestamp = date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });

  if (pricing.lastUpdatedBy) {
    return `${timestamp} by ${pricing.lastUpdatedBy}`;
  }

  return timestamp;
}

function toEditablePricing(pricing: PricingConfig): EditablePricingConfig {
  return {
    interestRate: pricing.interestRate,
    discountPointFactor: pricing.discountPointFactor,
    aprSpread: pricing.aprSpread,
    loanTerm: pricing.loanTerm,
    propertyTaxAnnualRate: pricing.propertyTaxAnnualRate,
    homeownersInsuranceRate: pricing.homeownersInsuranceRate,
    homeownersInsuranceRoundDownTo: pricing.homeownersInsuranceRoundDownTo,
    mortgageInsuranceMonthly: pricing.mortgageInsuranceMonthly,
    hoaMonthly: pricing.hoaMonthly,
    mortgageRegistrationTaxRate: pricing.mortgageRegistrationTaxRate,
    monthEndInterestDays: pricing.monthEndInterestDays,
    fees: { ...pricing.fees },
    footer: { ...pricing.footer }
  };
}

function toNumber(rawValue: string): number {
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function DailyPricingPage() {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [pricing, setPricing] = useState<PricingConfig | null>(null);
  const [analytics, setAnalytics] = useState<PricingAnalytics | null>(null);
  const [draftPricing, setDraftPricing] = useState<EditablePricingConfig | null>(
    null
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadPricing = async () => {
    setLoading(true);
    setErrorMessage(null);
    setWarningMessage(null);

    try {
      const response = await fetch("/api/daily-pricing", { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Unable to load daily pricing.");
      }

      const data: PricingResponse = await response.json();
      setAuthenticated(data.authenticated);
      setUserEmail(data.userEmail);
      setPricing(data.pricing);
      setAnalytics(data.analytics ?? null);
      setDraftPricing(toEditablePricing(data.pricing));
      setWarningMessage(data.authWarning || null);

      if (data.storage?.storageMode === "memory_fallback") {
        setWarningMessage((current) =>
          current
            ? `${current} Pricing settings are currently using in-memory storage and may not persist across restarts.`
            : "Pricing settings are currently using in-memory storage and may not persist across restarts."
        );
      }
    } catch {
      setErrorMessage("Could not load pricing settings.");
      setAnalytics(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPricing();
  }, []);

  const updateCoreNumericField = (key: CoreNumericFieldKey, value: string) => {
    setDraftPricing((previous) =>
      previous ? { ...previous, [key]: toNumber(value) } : previous
    );
  };

  const updateFeeField = (key: keyof PricingFees, value: string) => {
    setDraftPricing((previous) =>
      previous
        ? {
            ...previous,
            fees: { ...previous.fees, [key]: toNumber(value) }
          }
        : previous
    );
  };

  const updateFooterField = (key: keyof PricingFooter, value: string) => {
    setDraftPricing((previous) =>
      previous
        ? {
            ...previous,
            footer: { ...previous.footer, [key]: value }
          }
        : previous
    );
  };

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const response = await fetch("/api/daily-pricing/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to sign in.");
      }

      setPassword("");
      setSuccessMessage("Signed in.");
      await loadPricing();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to sign in.";
      setErrorMessage(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSavePricing = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!draftPricing) {
      setSubmitting(false);
      setErrorMessage("Pricing settings are not loaded yet.");
      return;
    }

    try {
      const response = await fetch("/api/daily-pricing/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pricing: draftPricing })
      });

      const payload = (await response.json()) as {
        error?: string;
        pricing?: PricingConfig;
      };

      if (!response.ok || !payload.pricing) {
        throw new Error(payload.error || "Unable to save pricing.");
      }

      setPricing(payload.pricing);
      setDraftPricing(toEditablePricing(payload.pricing));
      setSuccessMessage("Pricing settings updated.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to save pricing.";
      setErrorMessage(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    setSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await fetch("/api/daily-pricing/logout", { method: "POST" });
      setAuthenticated(false);
      setUserEmail(null);
      setEmail("");
      setPassword("");
      setSuccessMessage("Signed out.");
      await loadPricing();
    } catch {
      setErrorMessage("Unable to sign out.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-subtle">
          <p className="text-sm text-slate-600">Loading...</p>
        </div>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-subtle">
          <div className="mx-auto mb-6 max-w-[260px]">
            <Image
              src="/logo.png"
              alt="Stone River Mortgage logo"
              width={1200}
              height={400}
              priority
              className="h-auto w-full object-contain"
              sizes="260px"
            />
          </div>

          {errorMessage ? (
            <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
              {errorMessage}
            </p>
          ) : null}

          {successMessage ? (
            <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
              {successMessage}
            </p>
          ) : null}

          {warningMessage ? (
            <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
              {warningMessage}
            </p>
          ) : null}

          <form className="mt-6 space-y-4" onSubmit={handleLogin}>
            <div>
              <label
                htmlFor="daily-pricing-email"
                className="mb-1.5 block text-sm font-medium text-slate-800"
              >
                Employee Email
              </label>
              <input
                id="daily-pricing-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={inputClassName}
              />
            </div>

            <div>
              <label
                htmlFor="daily-pricing-password"
                className="mb-1.5 block text-sm font-medium text-slate-800"
              >
                Password
              </label>
              <input
                id="daily-pricing-password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className={inputClassName}
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex w-full items-center justify-center rounded-xl bg-slateBlue px-5 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:bg-[#17314f] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slateBlue focus-visible:ring-offset-2"
            >
              {submitting ? "Signing in..." : "Sign in"}
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-subtle sm:p-8">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          Daily Pricing
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Update all transaction summary rates, fees, and footer copy from one
          place.
        </p>

        {errorMessage ? (
          <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            {errorMessage}
          </p>
        ) : null}

        {successMessage ? (
          <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
            {successMessage}
          </p>
        ) : null}

        {warningMessage ? (
          <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
            {warningMessage}
          </p>
        ) : null}

        {pricing ? (
          <p className="mt-4 text-sm text-slate-600">
            Last updated: {formatLastUpdated(pricing)}
          </p>
        ) : null}

        {draftPricing ? (
          <div className="mt-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <span>Signed in as {userEmail}</span>
              <button
                type="button"
                onClick={handleLogout}
                disabled={submitting}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 transition-all duration-200 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slateBlue focus-visible:ring-offset-2"
              >
                Sign out
              </button>
            </div>

            {analytics ? (
              <section className="mb-6 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <h2 className="text-base font-semibold text-slate-900">
                  Activity
                </h2>
                <div className="mt-3 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
                  <p>PDFs generated: {analytics.pdfGeneratedCount}</p>
                  <p>
                    Property tax lookups: {analytics.propertyTaxLookupCount}
                  </p>
                  <p>
                    Record success ({analytics.currentYear}/{analytics.previousYear}):{" "}
                    {analytics.propertyTaxCurrentOrPreviousYearRecordFoundCount} /{" "}
                    {analytics.propertyTaxLookupCount}{" "}
                    {typeof analytics.currentOrPreviousYearSuccessRate === "number"
                      ? `(${(analytics.currentOrPreviousYearSuccessRate * 100).toFixed(1)}%)`
                      : "(n/a)"}
                  </p>
                  <p>
                    Non-metro county lookups:{" "}
                    {analytics.propertyTaxLookupNonMetroCount}
                  </p>
                </div>

                <div className="mt-3">
                  <h3 className="text-sm font-semibold text-slate-800">
                    Property Tax Lookups by County
                  </h3>
                  {Object.keys(analytics.propertyTaxLookupCountByCounty).length ===
                  0 ? (
                    <p className="mt-1 text-sm text-slate-600">
                      No lookup activity yet.
                    </p>
                  ) : (
                    <ul className="mt-1 grid gap-x-6 gap-y-1 text-sm text-slate-700 sm:grid-cols-2">
                      {Object.entries(analytics.propertyTaxLookupCountByCounty)
                        .sort(([leftCounty], [rightCounty]) =>
                          leftCounty.localeCompare(rightCounty)
                        )
                        .map(([county, count]) => (
                          <li key={county}>
                            {county}: {count}
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
              </section>
            ) : null}

            <form className="space-y-8" onSubmit={handleSavePricing}>
              <section>
                <h2 className="text-lg font-semibold text-slate-900">
                  Core Rates and Assumptions
                </h2>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  {coreNumericFields.map((field) => (
                    <div key={field.key}>
                      <label
                        htmlFor={`pricing-${field.key}`}
                        className="mb-1.5 block text-sm font-medium text-slate-800"
                      >
                        {field.label}
                      </label>
                      <input
                        id={`pricing-${field.key}`}
                        type="number"
                        step={field.step}
                        min={field.min}
                        required
                        value={draftPricing[field.key]}
                        onChange={(event) =>
                          updateCoreNumericField(field.key, event.target.value)
                        }
                        className={inputClassName}
                      />
                      <p className="mt-1.5 text-xs text-slate-500">{field.hint}</p>
                    </div>
                  ))}

                  <div>
                    <label
                      htmlFor="pricing-loan-term"
                      className="mb-1.5 block text-sm font-medium text-slate-800"
                    >
                      Loan Term Label
                    </label>
                    <input
                      id="pricing-loan-term"
                      type="text"
                      required
                      value={draftPricing.loanTerm}
                      onChange={(event) =>
                        setDraftPricing((previous) =>
                          previous
                            ? { ...previous, loanTerm: event.target.value }
                            : previous
                        )
                      }
                      className={inputClassName}
                    />
                    <p className="mt-1.5 text-xs text-slate-500">
                      Printed on PDF as the Conventional Loan Term value.
                    </p>
                  </div>
                </div>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-slate-900">Fees</h2>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  {feeFields.map((field) => (
                    <div key={field.key}>
                      <label
                        htmlFor={`fee-${field.key}`}
                        className="mb-1.5 block text-sm font-medium text-slate-800"
                      >
                        {field.label} ($)
                      </label>
                      <input
                        id={`fee-${field.key}`}
                        type="number"
                        step="0.01"
                        min="0"
                        required
                        value={draftPricing.fees[field.key]}
                        onChange={(event) =>
                          updateFeeField(field.key, event.target.value)
                        }
                        className={inputClassName}
                      />
                      <p className="mt-1.5 text-xs text-slate-500">{field.hint}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-slate-900">
                  Footer Text
                </h2>
                <div className="mt-4 grid gap-4">
                  {footerFields.map((field) => (
                    <div key={field.key}>
                      <label
                        htmlFor={`footer-${field.key}`}
                        className="mb-1.5 block text-sm font-medium text-slate-800"
                      >
                        {field.label}
                      </label>
                      <input
                        id={`footer-${field.key}`}
                        type="text"
                        required
                        value={draftPricing.footer[field.key]}
                        onChange={(event) =>
                          updateFooterField(field.key, event.target.value)
                        }
                        className={inputClassName}
                      />
                      <p className="mt-1.5 text-xs text-slate-500">{field.hint}</p>
                    </div>
                  ))}
                </div>
              </section>

              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center justify-center rounded-xl bg-slateBlue px-5 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:bg-[#17314f] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slateBlue focus-visible:ring-offset-2"
              >
                {submitting ? "Saving..." : "Save Pricing Settings"}
              </button>
            </form>
          </div>
        ) : null}
      </div>
    </main>
  );
}
