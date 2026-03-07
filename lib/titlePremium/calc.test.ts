import { describe, expect, it } from "vitest";
import {
  calculateTitlePremiums
} from "./calc";

function calculatePurchaseScenario(params: {
  purchasePrice: number;
  loanAmount: number;
}) {
  return calculateTitlePremiums({
    purchasePrice: params.purchasePrice,
    loanAmount: params.loanAmount,
    refinance: false,
    simultaneousIssue: false,
    expandedOwnersCoverage: false
  });
}

describe("MN purchase lender rounding checks", () => {
  it("matches lender outputs around key loan thresholds", () => {
    const cases = [
      { purchasePrice: 1000000, loanAmount: 199999, lender: 700 },
      { purchasePrice: 1000000, loanAmount: 200000, lender: 700 },
      { purchasePrice: 1000000, loanAmount: 200001, lender: 704 },
      { purchasePrice: 1000000, loanAmount: 299999, lender: 988 },
      { purchasePrice: 1000000, loanAmount: 300000, lender: 988 },
      { purchasePrice: 1000000, loanAmount: 300001, lender: 990 },
      { purchasePrice: 1000000, loanAmount: 399999, lender: 1213 },
      { purchasePrice: 1000000, loanAmount: 400000, lender: 1213 },
      { purchasePrice: 1000000, loanAmount: 400001, lender: 1215 }
    ];

    for (const entry of cases) {
      const result = calculatePurchaseScenario({
        purchasePrice: entry.purchasePrice,
        loanAmount: entry.loanAmount
      });

      expect(result.lenderPremium).toBe(entry.lender);
      expect(Number.isInteger(result.lenderPremium)).toBe(true);
    }
  });
});

describe("MN purchase owner/lender scenario parity", () => {
  it("matches expected owner/lender outputs for 700k purchase", () => {
    const cases = [
      { purchasePrice: 700000, loanAmount: 560000, owner: 614, lender: 1558 },
      { purchasePrice: 700000, loanAmount: 400000, owner: 959, lender: 1213 },
      { purchasePrice: 700000, loanAmount: 300000, owner: 1184, lender: 988 },
      { purchasePrice: 700000, loanAmount: 200000, owner: 1472, lender: 700 }
    ];

    for (const entry of cases) {
      const result = calculatePurchaseScenario({
        purchasePrice: entry.purchasePrice,
        loanAmount: entry.loanAmount
      });

      expect(result.ownerPremium).toBe(entry.owner);
      expect(result.lenderPremium).toBe(entry.lender);
      expect(Number.isInteger(result.ownerPremium)).toBe(true);
      expect(Number.isInteger(result.lenderPremium)).toBe(true);
    }
  });

  it("matches expected owner/lender outputs for 600k purchase", () => {
    const cases = [
      { purchasePrice: 600000, loanAmount: 400000, owner: 739, lender: 1213 },
      { purchasePrice: 600000, loanAmount: 300000, owner: 964, lender: 988 },
      { purchasePrice: 600000, loanAmount: 200000, owner: 1252, lender: 700 }
    ];

    for (const entry of cases) {
      const result = calculatePurchaseScenario({
        purchasePrice: entry.purchasePrice,
        loanAmount: entry.loanAmount
      });

      expect(result.ownerPremium).toBe(entry.owner);
      expect(result.lenderPremium).toBe(entry.lender);
    }
  });

  it("matches purchase price rounding behavior with fixed loan", () => {
    const cases = [
      { purchasePrice: 599999, loanAmount: 200000, owner: 1252, lender: 700 },
      { purchasePrice: 600000, loanAmount: 200000, owner: 1252, lender: 700 },
      { purchasePrice: 600001, loanAmount: 200000, owner: 1254, lender: 700 },
      { purchasePrice: 699999, loanAmount: 200000, owner: 1472, lender: 700 },
      { purchasePrice: 700000, loanAmount: 200000, owner: 1472, lender: 700 },
      { purchasePrice: 700001, loanAmount: 200000, owner: 1474, lender: 700 }
    ];

    for (const entry of cases) {
      const result = calculatePurchaseScenario({
        purchasePrice: entry.purchasePrice,
        loanAmount: entry.loanAmount
      });

      expect(result.ownerPremium).toBe(entry.owner);
      expect(result.lenderPremium).toBe(entry.lender);
    }
  });

  it("matches high-loan lender outputs", () => {
    const cases = [
      { purchasePrice: 2000000, loanAmount: 999000, lender: 2436 },
      { purchasePrice: 2000000, loanAmount: 1000000, lender: 2438 },
      { purchasePrice: 2000000, loanAmount: 1001000, lender: 2440 }
    ];

    for (const entry of cases) {
      const result = calculatePurchaseScenario({
        purchasePrice: entry.purchasePrice,
        loanAmount: entry.loanAmount
      });

      expect(result.lenderPremium).toBe(entry.lender);
    }
  });
});

describe("existing non-purchase branches", () => {
  it("preserves simultaneous issue lender premium", () => {
    const result = calculateTitlePremiums({
      purchasePrice: 425000,
      loanAmount: 340000,
      simultaneousIssue: true,
      expandedOwnersCoverage: false,
      refinance: false
    });

    expect(result.lenderPremium).toBe(150);
  });

  it("uses refinance lender tiers deterministically", () => {
    const result = calculateTitlePremiums({
      purchasePrice: 425000,
      loanAmount: 340000,
      refinance: true,
      simultaneousIssue: false
    });

    expect(result.lenderPremium).toBe(657.5);
  });
});
