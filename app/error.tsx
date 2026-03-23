"use client";

import { toCustomerFacingPublicPageError } from "@/lib/public-error-messages";

type ErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function Error({ error, reset }: ErrorProps) {
  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-3xl flex-col items-center justify-center px-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        Something went wrong
      </h1>
      <p className="mt-3 text-sm text-slate-600">
        {toCustomerFacingPublicPageError(error.message)}
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 transition-all duration-200 hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slateBlue focus-visible:ring-offset-2"
      >
        Try again
      </button>
    </main>
  );
}
