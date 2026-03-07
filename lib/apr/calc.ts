export type AprCalculationInput = {
  termMonths: number;
  noteRateAnnual: number;
  loanAmount: number;
  pointsPercent?: number;
  discountPointFactor?: number;
  underwritingFee: number;
  perDiemDays?: number;
  prePaidInterest?: number;
  principalAndInterest?: number;
};

export type AprCalculationResult = {
  payment: number;
  // Backward-compatible alias for discountPointsDollarAmount.
  pointsFee: number;
  discountPointsDollarAmount: number;
  // Backward-compatible alias for prepaidInterest.
  perDiemInterest: number;
  prepaidInterest: number;
  // Backward-compatible alias for amountFinancedForApr.
  amountFinanced: number;
  amountFinancedForApr: number;
  aprAnnual: number;
  aprPercent: string;
};

const EPSILON = 1e-12;
const DEFAULT_MAX_ITERATIONS = 200;

function formatAprPercent(aprAnnual: number): string {
  return `${(aprAnnual * 100).toFixed(6)}%`;
}

function assertFiniteNumber(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a valid number.`);
  }
}

function paymentPresentValue(
  monthlyRate: number,
  termMonths: number,
  payment: number
): number {
  if (Math.abs(monthlyRate) < EPSILON) {
    return payment * termMonths;
  }

  return (
    (payment * (1 - (1 + monthlyRate) ** -termMonths)) /
    monthlyRate
  );
}

function solveMonthlyRateFromPayment(params: {
  termMonths: number;
  payment: number;
  amountFinanced: number;
  tolerance?: number;
  maxIterations?: number;
}): number {
  const {
    termMonths,
    payment,
    amountFinanced,
    tolerance = 1e-12,
    maxIterations = DEFAULT_MAX_ITERATIONS
  } = params;

  if (Math.abs(payment * termMonths - amountFinanced) <= tolerance) {
    return 0;
  }

  let lower = 0;
  let upper = 1;

  for (let i = 0; i < maxIterations; i += 1) {
    const pvAtUpper = paymentPresentValue(upper, termMonths, payment);
    if (pvAtUpper < amountFinanced) {
      break;
    }
    upper *= 2;
  }

  for (let i = 0; i < maxIterations; i += 1) {
    const mid = (lower + upper) / 2;
    const presentValue = paymentPresentValue(mid, termMonths, payment);
    const diff = presentValue - amountFinanced;

    if (Math.abs(diff) <= tolerance) {
      return mid;
    }

    if (presentValue > amountFinanced) {
      lower = mid;
    } else {
      upper = mid;
    }
  }

  return (lower + upper) / 2;
}

export function calculateMonthlyPayment(
  noteRateAnnual: number,
  termMonths: number,
  loanAmount: number
): number {
  if (termMonths <= 0) {
    return 0;
  }

  const monthlyRate = noteRateAnnual / 12;
  if (Math.abs(monthlyRate) < EPSILON) {
    return loanAmount / termMonths;
  }

  return (
    (loanAmount * monthlyRate) /
    (1 - (1 + monthlyRate) ** -termMonths)
  );
}

export function calculateAprAnnual(
  input: AprCalculationInput
): AprCalculationResult {
  assertFiniteNumber("termMonths", input.termMonths);
  assertFiniteNumber("noteRateAnnual", input.noteRateAnnual);
  assertFiniteNumber("loanAmount", input.loanAmount);
  assertFiniteNumber("underwritingFee", input.underwritingFee);

  if (input.termMonths <= 0) {
    throw new Error("termMonths must be greater than 0.");
  }

  if (input.noteRateAnnual < 0) {
    throw new Error("noteRateAnnual must be 0 or greater.");
  }

  if (input.loanAmount <= 0) {
    throw new Error("loanAmount must be greater than 0.");
  }

  if (input.underwritingFee < 0) {
    throw new Error("underwritingFee must be 0 or greater.");
  }

  const calculatedPayment = calculateMonthlyPayment(
    input.noteRateAnnual,
    input.termMonths,
    input.loanAmount
  );
  const monthlyPrincipalAndInterest =
    typeof input.principalAndInterest === "number" &&
    Number.isFinite(input.principalAndInterest) &&
    input.principalAndInterest > 0
      ? input.principalAndInterest
      : calculatedPayment;
  assertFiniteNumber("monthlyPrincipalAndInterest", monthlyPrincipalAndInterest);
  if (monthlyPrincipalAndInterest <= 0) {
    throw new Error("monthlyPrincipalAndInterest must be greater than 0.");
  }

  const discountPointFactorPercent =
    typeof input.discountPointFactor === "number" &&
    Number.isFinite(input.discountPointFactor)
      ? input.discountPointFactor
      : input.pointsPercent ?? 0;
  assertFiniteNumber("discountPointFactor", discountPointFactorPercent);
  const discountPointsDollarAmount =
    (discountPointFactorPercent * input.loanAmount) / 100;

  // APR basis deducts APR-included prepaid finance charges from the full loan amount.
  const prepaidInterest =
    typeof input.prePaidInterest === "number" &&
    Number.isFinite(input.prePaidInterest) &&
    input.prePaidInterest >= 0
      ? input.prePaidInterest
      : (() => {
          if (typeof input.perDiemDays === "number") {
            assertFiniteNumber("perDiemDays", input.perDiemDays);
            if (input.perDiemDays < 0) {
              throw new Error("perDiemDays must be 0 or greater.");
            }
            return (
              input.perDiemDays *
              ((input.loanAmount * input.noteRateAnnual) / 365)
            );
          }
          // If prePaidInterest is not provided, default to $0 unless perDiemDays are provided.
          return 0;
        })();
  assertFiniteNumber("prepaidInterest", prepaidInterest);
  if (prepaidInterest < 0) {
    throw new Error("prepaidInterest must be 0 or greater.");
  }

  const amountFinancedForApr =
    input.loanAmount -
    discountPointsDollarAmount -
    input.underwritingFee -
    prepaidInterest;
  assertFiniteNumber("amountFinancedForApr", amountFinancedForApr);
  if (amountFinancedForApr <= 0) {
    throw new Error(
      "amountFinancedForApr must be greater than 0 after subtracting finance charges."
    );
  }

  const monthlyRate = solveMonthlyRateFromPayment({
    termMonths: input.termMonths,
    payment: monthlyPrincipalAndInterest,
    amountFinanced: amountFinancedForApr
  });
  const aprAnnual = monthlyRate * 12;
  assertFiniteNumber("aprAnnual", aprAnnual);
  if (aprAnnual < 0) {
    throw new Error("aprAnnual must be 0 or greater.");
  }

  return {
    payment: monthlyPrincipalAndInterest,
    pointsFee: discountPointsDollarAmount,
    discountPointsDollarAmount,
    perDiemInterest: prepaidInterest,
    prepaidInterest,
    amountFinanced: amountFinancedForApr,
    amountFinancedForApr,
    aprAnnual,
    aprPercent: formatAprPercent(aprAnnual)
  };
}
