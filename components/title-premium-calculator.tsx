"use client";

import { FormEvent, useMemo, useState } from "react";
import { MAX_LOAN_AMOUNT, MIN_LOAN_AMOUNT } from "@/lib/constants";
import { getLoanAmountBoundsMessage } from "@/lib/loanAmount";
import {
  toCustomerFacingTitlePremiumError,
  toCustomerFacingTitlePremiumIssues
} from "@/lib/public-error-messages";
import type {
  BreakdownLine,
  TitlePremiumOutput
} from "@/lib/titlePremium/types";

type ApiErrorPayload = {
  error?: string;
  issues?: Array<{ message?: string }>;
};

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

function formatUsd(value: number): string {
  return usdFormatter.format(value);
}

function parseIssueMessages(payload: ApiErrorPayload): string[] {
  if (!Array.isArray(payload.issues)) {
    return [];
  }

  return payload.issues
    .map((issue) => (typeof issue?.message === "string" ? issue.message : ""))
    .filter(Boolean);
}

function BreakdownTable({
  title,
  lines
}: {
  title: string;
  lines: BreakdownLine[];
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-800">
        {title}
      </div>

      {lines.length === 0 ? (
        <p className="px-4 py-3 text-sm text-slate-600">
          No tiered breakdown for this policy.
        </p>
      ) : (
        <table className="min-w-full text-left text-sm text-slate-700">
          <thead className="bg-white text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2.5">Tier Start</th>
              <th className="px-4 py-2.5">Tier End</th>
              <th className="px-4 py-2.5">Rate / $1,000</th>
              <th className="px-4 py-2.5">Tier Amount</th>
              <th className="px-4 py-2.5">Tier Premium</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr
                key={`${title}-${line.tierStart}-${line.tierEnd}-${index}`}
                className="border-t border-slate-100"
              >
                <td className="px-4 py-2.5">{formatUsd(line.tierStart)}</td>
                <td className="px-4 py-2.5">{formatUsd(line.tierEnd)}</td>
                <td className="px-4 py-2.5">{line.ratePerThousand.toFixed(2)}</td>
                <td className="px-4 py-2.5">{formatUsd(line.tierAmount)}</td>
                <td className="px-4 py-2.5">{formatUsd(line.tierPremium)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function TitlePremiumCalculator() {
  const [purchasePrice, setPurchasePrice] = useState("425000");
  const [loanAmount, setLoanAmount] = useState("340000");
  const [expandedOwnersCoverage, setExpandedOwnersCoverage] = useState(false);
  const [refinance, setRefinance] = useState(false);
  const [simultaneousIssue, setSimultaneousIssue] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorIssues, setErrorIssues] = useState<string[]>([]);
  const [result, setResult] = useState<TitlePremiumOutput | null>(null);

  const parsedPurchasePrice = Number(purchasePrice);
  const parsedLoanAmount = Number(loanAmount);
  const loanBoundsMessage = useMemo(
    () => getLoanAmountBoundsMessage(parsedLoanAmount),
    [parsedLoanAmount]
  );

  const simultaneousWarning = useMemo(() => {
    if (
      !simultaneousIssue ||
      !Number.isFinite(parsedPurchasePrice) ||
      !Number.isFinite(parsedLoanAmount)
    ) {
      return null;
    }

    if (parsedLoanAmount > parsedPurchasePrice) {
      return "Simultaneous issue is selected, but loan amount exceeds purchase price. Tiered lender premium will be used.";
    }

    return null;
  }, [parsedPurchasePrice, parsedLoanAmount, simultaneousIssue]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setErrorMessage(null);
    setErrorIssues([]);

    try {
      if (!Number.isFinite(parsedPurchasePrice) || parsedPurchasePrice <= 0) {
        throw new Error("Purchase price must be greater than 0.");
      }

      if (!Number.isFinite(parsedLoanAmount) || parsedLoanAmount < 0) {
        throw new Error("Loan amount must be 0 or greater.");
      }

      if (loanBoundsMessage) {
        throw new Error(loanBoundsMessage);
      }

      const response = await fetch("/api/title-premium", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purchasePrice: parsedPurchasePrice,
          loanAmount: parsedLoanAmount,
          expandedOwnersCoverage,
          refinance,
          simultaneousIssue
        })
      });

      if (!response.ok) {
        const payload = (await response.json()) as ApiErrorPayload;
        setErrorIssues(
          toCustomerFacingTitlePremiumIssues(parseIssueMessages(payload))
        );
        throw new Error(payload.error || "Unable to calculate title premiums.");
      }

      const payload = (await response.json()) as TitlePremiumOutput;
      setResult(payload);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to calculate premiums.";
      setErrorMessage(toCustomerFacingTitlePremiumError(message));
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-subtle sm:p-8">
      <form className="space-y-6" onSubmit={handleSubmit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="mn-title-purchase-price"
              className="mb-1.5 block text-sm font-medium text-slate-800"
            >
              Purchase Price
            </label>
            <input
              id="mn-title-purchase-price"
              type="number"
              min="0"
              step="0.01"
              required
              value={purchasePrice}
              onChange={(event) => setPurchasePrice(event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-900 shadow-sm transition-all duration-200 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slateBlue/20"
            />
          </div>

          <div>
            <label
              htmlFor="mn-title-loan-amount"
              className="mb-1.5 block text-sm font-medium text-slate-800"
            >
              Loan Amount
            </label>
            <input
              id="mn-title-loan-amount"
              type="number"
              min={String(MIN_LOAN_AMOUNT)}
              max={String(MAX_LOAN_AMOUNT)}
              step="0.01"
              required
              value={loanAmount}
              onChange={(event) => setLoanAmount(event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-900 shadow-sm transition-all duration-200 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slateBlue/20"
            />
            <p className="mt-1.5 text-xs text-slate-500">
              Loan amount must be between {formatUsd(MIN_LOAN_AMOUNT)} and{" "}
              {formatUsd(MAX_LOAN_AMOUNT)}.
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={expandedOwnersCoverage}
              onChange={(event) => setExpandedOwnersCoverage(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-slateBlue focus:ring-slateBlue/30"
            />
            Expanded Owner Coverage
          </label>

          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={refinance}
              onChange={(event) => setRefinance(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-slateBlue focus:ring-slateBlue/30"
            />
            Refinance
          </label>

          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={simultaneousIssue}
              onChange={(event) => setSimultaneousIssue(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-slateBlue focus:ring-slateBlue/30"
            />
            Simultaneous Issue
          </label>
        </div>

        {simultaneousWarning ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
            {simultaneousWarning}
          </p>
        ) : null}

        {loanBoundsMessage ? (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            {toCustomerFacingTitlePremiumError(loanBoundsMessage)}
          </p>
        ) : null}

        {errorMessage ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            <p>{errorMessage}</p>
            {errorIssues.length > 0 ? (
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {errorIssues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center justify-center rounded-xl bg-slateBlue px-5 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:bg-[#17314f] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slateBlue focus-visible:ring-offset-2"
        >
          {loading ? "Calculating..." : "Calculate"}
        </button>
      </form>

      {result ? (
        <div className="mt-6 space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Owner Premium
              </p>
              <p className="mt-1 text-lg font-semibold text-slate-900">
                {formatUsd(result.ownerPremium)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Lender Premium
              </p>
              <p className="mt-1 text-lg font-semibold text-slate-900">
                {formatUsd(result.lenderPremium)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Total Premium
              </p>
              <p className="mt-1 text-lg font-semibold text-slate-900">
                {formatUsd(result.totalPremium)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                APR (RATE/PMT)
              </p>
              <p className="mt-1 text-lg font-semibold text-slate-900">
                {result.aprPercent ?? "N/A"}
              </p>
            </div>
          </div>

          <details className="rounded-2xl border border-slate-200 bg-white">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-800">
              Details
            </summary>
            <div className="space-y-4 border-t border-slate-200 px-4 py-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <p className="text-sm text-slate-700">
                  Rounded Owner Liability:{" "}
                  <span className="font-semibold text-slate-900">
                    {formatUsd(result.details.roundedOwnerLiability)}
                  </span>
                </p>
                <p className="text-sm text-slate-700">
                  Rounded Lender Liability:{" "}
                  <span className="font-semibold text-slate-900">
                    {formatUsd(result.details.roundedLenderLiability)}
                  </span>
                </p>
                <p className="text-sm text-slate-700">
                  Min Premium Applied (Owner):{" "}
                  <span className="font-semibold text-slate-900">
                    {result.details.minPremiumAppliedOwner ? "Yes" : "No"}
                  </span>
                </p>
                <p className="text-sm text-slate-700">
                  Min Premium Applied (Lender):{" "}
                  <span className="font-semibold text-slate-900">
                    {result.details.minPremiumAppliedLender ? "Yes" : "No"}
                  </span>
                </p>
                <p className="text-sm text-slate-700">
                  Expanded Coverage Applied:{" "}
                  <span className="font-semibold text-slate-900">
                    {result.details.expandedCoverageApplied ? "Yes" : "No"}
                  </span>
                </p>
                <p className="text-sm text-slate-700">
                  Simultaneous Issue Applied:{" "}
                  <span className="font-semibold text-slate-900">
                    {result.details.simultaneousIssueApplied ? "Yes" : "No"}
                  </span>
                </p>
                {result.aprDetails ? (
                  <>
                    <p className="text-sm text-slate-700">
                      Monthly Payment (PMT):{" "}
                      <span className="font-semibold text-slate-900">
                        {formatUsd(result.aprDetails.payment)}
                      </span>
                    </p>
                    <p className="text-sm text-slate-700">
                      Amount Financed:{" "}
                      <span className="font-semibold text-slate-900">
                        {formatUsd(result.aprDetails.amountFinanced)}
                      </span>
                    </p>
                  </>
                ) : null}
              </div>

              {result.details.warnings.length > 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
                  <p className="font-semibold">Warnings</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {result.details.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="grid gap-4 lg:grid-cols-2">
                <BreakdownTable
                  title="Owner Breakdown"
                  lines={result.details.ownerBreakdown}
                />
                <BreakdownTable
                  title="Lender Breakdown"
                  lines={result.details.lenderBreakdown}
                />
              </div>
            </div>
          </details>
        </div>
      ) : null}
    </div>
  );
}
