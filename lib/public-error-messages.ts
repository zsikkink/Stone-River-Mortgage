function normalizeMessage(message: string | null | undefined): string {
  return typeof message === "string" ? message.trim() : "";
}

function dedupeMessages(messages: string[]): string[] {
  return Array.from(new Set(messages.filter(Boolean)));
}

export function toCustomerFacingAddressAutocompleteError(
  message: string | null | undefined
): string {
  const normalized = normalizeMessage(message);

  if (/at least 3 characters/i.test(normalized)) {
    return "Please enter at least 3 characters to search for an address.";
  }

  if (/minnesota/i.test(normalized)) {
    return "Please enter a valid Minnesota property address.";
  }

  return "We couldn't load address suggestions right now. Please keep typing or try again in a moment.";
}

export function toCustomerFacingTransactionSummaryError(
  message: string | null | undefined
): string {
  const normalized = normalizeMessage(message);

  if (!normalized) {
    return "We couldn't create your transaction summary right now. Please try again in a moment.";
  }

  if (
    /annual property tax must be greater than 0/i.test(normalized) ||
    /unable to estimate annual property tax/i.test(normalized) ||
    /unable to estimate property taxes/i.test(normalized) ||
    /county tax lookup/i.test(normalized)
  ) {
    return "We couldn't confirm the property tax amount for this property right now. Please try again in a moment.";
  }

  if (
    /invalid address/i.test(normalized) ||
    /please select a valid address/i.test(normalized)
  ) {
    return "Please select a verified Minnesota property address from the suggestions.";
  }

  if (/only valid minnesota addresses are accepted/i.test(normalized)) {
    return "Please enter a valid Minnesota property address.";
  }

  if (
    /purchase price must be greater than 0/i.test(normalized) ||
    /down payment percent/i.test(normalized)
  ) {
    return "Please review the purchase price and down payment details, then try again.";
  }

  if (/unable to generate the transaction summary pdf/i.test(normalized)) {
    return "We couldn't create your transaction summary right now. Please try again in a moment.";
  }

  return normalized;
}

export function toCustomerFacingTitlePremiumError(
  message: string | null | undefined
): string {
  const normalized = normalizeMessage(message);

  if (!normalized) {
    return "We couldn't calculate title premiums right now. Please try again in a moment.";
  }

  if (/purchase price must be greater than 0/i.test(normalized)) {
    return "Please enter a purchase price greater than $0.";
  }

  if (/loan amount must be 0 or greater/i.test(normalized)) {
    return "Please enter a valid loan amount.";
  }

  if (/minimum loan amount/i.test(normalized)) {
    return "Please enter a loan amount within the supported range.";
  }

  if (/larger than/i.test(normalized) && /contact mike/i.test(normalized)) {
    return "Please enter a loan amount within the supported range, or contact Mike Sikkink for larger loan amounts.";
  }

  if (/simultaneous issue cannot be selected/i.test(normalized)) {
    return "Please turn off Simultaneous Issue when the loan amount is $0.";
  }

  if (/unable to calculate title premiums|unable to calculate premiums/i.test(normalized)) {
    return "We couldn't calculate title premiums right now. Please review your entries and try again.";
  }

  return normalized;
}

export function toCustomerFacingTitlePremiumIssues(
  messages: string[]
): string[] {
  return dedupeMessages(
    messages.map((message) => toCustomerFacingTitlePremiumError(message))
  );
}

export function toCustomerFacingPublicPageError(
  message: string | null | undefined
): string {
  const normalized = normalizeMessage(message);

  if (/not found/i.test(normalized)) {
    return "We couldn't find that page.";
  }

  return "We ran into a problem loading this page. Please refresh and try again.";
}
