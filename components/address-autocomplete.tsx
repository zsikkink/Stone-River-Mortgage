"use client";

import { useEffect, useRef, useState } from "react";
import { toCustomerFacingAddressAutocompleteError } from "@/lib/public-error-messages";

type AddressSelection = {
  placeId: string;
  formattedAddress: string;
};

type AddressSuggestion = {
  placeId: string;
  description: string;
};

type AddressAutocompleteProps = {
  value: string;
  onValueChange: (value: string) => void;
  onSelect: (selection: AddressSelection | null) => void;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  verificationState?: "idle" | "verifying" | "verified";
  suppressSuggestions?: boolean;
};

function createSessionToken() {
  try {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return crypto.randomUUID();
    }
  } catch {
    // Fallback for browser/security contexts where randomUUID exists but throws.
  }

  return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function AddressAutocomplete({
  value,
  onValueChange,
  onSelect,
  id = "address-autocomplete",
  placeholder,
  disabled = false,
  verificationState = "idle",
  suppressSuggestions = false
}: AddressAutocompleteProps) {
  const sessionTokenRef = useRef<string>(createSessionToken());
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);

  useEffect(() => {
    if (disabled) {
      setSuggestions([]);
      setLoadingSuggestions(false);
      setSuggestionError(null);
      return;
    }

    if (verificationState !== "idle" || suppressSuggestions) {
      setSuggestions([]);
      setLoadingSuggestions(false);
      setSuggestionError(null);
      return;
    }

    const trimmed = value.trim();
    if (!trimmed || trimmed.length < 3) {
      setSuggestions([]);
      setLoadingSuggestions(false);
      setSuggestionError(null);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setLoadingSuggestions(true);
      setSuggestionError(null);

      try {
        const response = await fetch("/api/geo/autocomplete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            input: trimmed,
            sessionToken: sessionTokenRef.current
          })
        });

        const payload = (await response.json()) as
          | { suggestions?: AddressSuggestion[]; error?: string }
          | { error?: string };

        if (!response.ok) {
          setSuggestions([]);
          setSuggestionError(
            toCustomerFacingAddressAutocompleteError(payload?.error)
          );
          return;
        }

        const nextSuggestions =
          "suggestions" in payload && Array.isArray(payload.suggestions)
            ? payload.suggestions
            : [];
        setSuggestions(nextSuggestions);
        setSuggestionError(null);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setSuggestions([]);
          setSuggestionError(
            toCustomerFacingAddressAutocompleteError(null)
          );
        }
      } finally {
        setLoadingSuggestions(false);
      }
    }, 220);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [value, disabled, verificationState, suppressSuggestions]);

  const handleInputChange = (nextValue: string) => {
    onValueChange(nextValue);
    onSelect(null);
  };

  const handleSelectSuggestion = (suggestion: AddressSuggestion) => {
    onValueChange(suggestion.description);
    onSelect({
      placeId: suggestion.placeId,
      formattedAddress: suggestion.description
    });
    setSuggestions([]);
    setSuggestionError(null);
    sessionTokenRef.current = createSessionToken();
  };

  return (
    <div className="relative">
      <div className="relative">
        <input
          id={id}
          type="text"
          value={value}
          onChange={(event) => handleInputChange(event.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 pr-10 text-base text-slate-900 shadow-sm transition-all duration-200 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slateBlue/20 disabled:cursor-not-allowed disabled:bg-slate-100 sm:text-sm"
        />

        <span
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"
          aria-hidden="true"
        >
          {verificationState === "verifying" ? (
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-500" />
          ) : verificationState === "verified" ? (
            <span className="text-base leading-none">✅</span>
          ) : null}
        </span>

        {suggestions.length > 0 ? (
          <ul className="absolute left-0 right-0 top-full z-20 mt-0 max-h-56 w-full overflow-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
            {suggestions.map((suggestion) => (
              <li key={suggestion.placeId}>
                <button
                  type="button"
                  onClick={() => handleSelectSuggestion(suggestion)}
                  className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 transition-colors duration-150 hover:bg-slate-100"
                >
                  {suggestion.description}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {suggestionError || loadingSuggestions ? (
        <p
          className={`pointer-events-none absolute left-0 top-full mt-1 text-[11px] leading-4 ${
            suggestionError ? "text-red-700" : "text-slate-500"
          }`}
        >
          {suggestionError ? suggestionError : "Loading suggestions..."}
        </p>
      ) : null}
    </div>
  );
}
