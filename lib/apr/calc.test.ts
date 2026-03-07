import { describe, expect, it } from "vitest";
import {
  calculateAprAnnual,
  calculateMonthlyPayment
} from "./calc";
import {
  MAX_LOAN_AMOUNT_MESSAGE,
  MIN_LOAN_AMOUNT_MESSAGE
} from "../constants";
import { getLoanAmountBoundsMessage } from "../loanAmount";

describe("Loan amount bounds", () => {
  it("returns min loan amount message for loan below minimum", () => {
    expect(getLoanAmountBoundsMessage(124999)).toBe(MIN_LOAN_AMOUNT_MESSAGE);
  });

  it("returns max loan amount message for loan above maximum", () => {
    expect(getLoanAmountBoundsMessage(832751)).toBe(MAX_LOAN_AMOUNT_MESSAGE);
  });
});

describe("APR calculation parity", () => {
  it("matches PMT from spreadsheet example", () => {
    const payment = calculateMonthlyPayment(0.05625, 360, 292425);

    expect(payment).toBeCloseTo(1683.36323977, 8);
  });

  it("matches APR RATE/PMT method from spreadsheet example", () => {
    const result = calculateAprAnnual({
      termMonths: 360,
      noteRateAnnual: 0.05625,
      loanAmount: 292425,
      pointsPercent: 0.09,
      underwritingFee: 1250,
      perDiemDays: 1
    });

    expect(result.aprAnnual).toBeCloseTo(0.0567378673, 8);
  });

  it("computes amountFinancedForApr and APR using payment + finance charges", () => {
    const result = calculateAprAnnual({
      termMonths: 360,
      noteRateAnnual: 0.05625,
      loanAmount: 525000,
      discountPointFactor: 0.933,
      underwritingFee: 1250,
      prePaidInterest: 80.91,
      principalAndInterest: 3022.2
    });

    expect(result.discountPointsDollarAmount).toBeCloseTo(4898.25, 2);
    expect(result.prepaidInterest).toBeCloseTo(80.91, 2);
    expect(result.amountFinancedForApr).toBeCloseTo(518770.84, 2);
    expect(result.amountFinanced).toBeCloseTo(518770.84, 2);
    expect(result.aprAnnual * 100).toBeCloseTo(5.734, 3);
  });

  it("treats missing prepaidInterest as zero when perDiemDays is omitted", () => {
    const result = calculateAprAnnual({
      termMonths: 360,
      noteRateAnnual: 0.05625,
      loanAmount: 525000,
      discountPointFactor: 0.933,
      underwritingFee: 1250,
      principalAndInterest: 3022.2
    });

    expect(result.prepaidInterest).toBe(0);
    expect(result.amountFinancedForApr).toBeCloseTo(518851.75, 2);
  });

  it("supports zero discount points", () => {
    const result = calculateAprAnnual({
      termMonths: 360,
      noteRateAnnual: 0.05625,
      loanAmount: 525000,
      discountPointFactor: 0,
      underwritingFee: 1250,
      prePaidInterest: 80.91,
      principalAndInterest: 3022.2
    });

    expect(result.discountPointsDollarAmount).toBe(0);
    expect(result.amountFinancedForApr).toBeCloseTo(523669.09, 2);
  });

  it("throws for invalid APR inputs", () => {
    expect(() =>
      calculateAprAnnual({
        termMonths: 0,
        noteRateAnnual: 0.05625,
        loanAmount: 525000,
        discountPointFactor: 0.933,
        underwritingFee: 1250,
        prePaidInterest: 80.91,
        principalAndInterest: 3022.2
      })
    ).toThrow("termMonths must be greater than 0.");

    expect(() =>
      calculateAprAnnual({
        termMonths: 360,
        noteRateAnnual: 0.05625,
        loanAmount: 525000,
        discountPointFactor: 0.933,
        underwritingFee: 600000,
        prePaidInterest: 0,
        principalAndInterest: 3022.2
      })
    ).toThrow(
      "amountFinancedForApr must be greater than 0 after subtracting finance charges."
    );
  });
});
