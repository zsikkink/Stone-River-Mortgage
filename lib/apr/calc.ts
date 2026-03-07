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
  pointsFee: number;
  perDiemInterest: number;
  amountFinanced: number;
  aprNumber: number;
  aprAnnual: number;
  aprPercent: string;
};

const EPSILON = 1e-12;
const DEFAULT_MAX_ITERATIONS = 200;

function formatAprPercent(aprAnnual: number): string {
  return `${(aprAnnual * 100).toFixed(6)}%`;
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
  const calculatedPayment = calculateMonthlyPayment(
    input.noteRateAnnual,
    input.termMonths,
    input.loanAmount
  );
  const payment =
    typeof input.principalAndInterest === "number" &&
    Number.isFinite(input.principalAndInterest) &&
    input.principalAndInterest > 0
      ? input.principalAndInterest
      : calculatedPayment;

  const discountPointPercent =
    typeof input.discountPointFactor === "number" &&
    Number.isFinite(input.discountPointFactor)
      ? input.discountPointFactor
      : input.pointsPercent ?? 0;
  const pointsFee = input.loanAmount * (discountPointPercent / 100);

  const perDiemInterest =
    typeof input.prePaidInterest === "number" &&
    Number.isFinite(input.prePaidInterest) &&
    input.prePaidInterest >= 0
      ? input.prePaidInterest
      : (input.perDiemDays ?? 0) *
        ((input.loanAmount * input.noteRateAnnual) / 365);

  const amountFinanced =
    input.loanAmount - pointsFee - input.underwritingFee - perDiemInterest;

  const monthlyRate = solveMonthlyRateFromPayment({
    termMonths: input.termMonths,
    payment,
    amountFinanced
  });
  const aprAnnual = monthlyRate * 12;

  return {
    payment,
    pointsFee,
    perDiemInterest,
    amountFinanced,
    aprNumber: amountFinanced,
    aprAnnual,
    aprPercent: formatAprPercent(aprAnnual)
  };
}
