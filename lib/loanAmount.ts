import {
  MAX_LOAN_AMOUNT,
  MAX_LOAN_AMOUNT_MESSAGE,
  MIN_LOAN_AMOUNT,
  MIN_LOAN_AMOUNT_MESSAGE
} from "./constants";

export function getLoanAmountBoundsMessage(loanAmount: number): string | null {
  if (loanAmount < MIN_LOAN_AMOUNT) {
    return MIN_LOAN_AMOUNT_MESSAGE;
  }

  if (loanAmount > MAX_LOAN_AMOUNT) {
    return MAX_LOAN_AMOUNT_MESSAGE;
  }

  return null;
}
