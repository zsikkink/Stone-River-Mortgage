import { DEFAULT_MN_TITLE_PREMIUM_CONFIG } from "./configMN";
import {
  LendersPolicyResult,
  OwnersPolicyResult,
  RateTier,
  TieredPremiumResult,
  TitlePremiumConfig,
  TitlePremiumInput,
  TitlePremiumOutput
} from "./types";

function roundToCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

function toRoundedUpThousands(amount: number): number {
  if (amount <= 0) {
    return 0;
  }

  return Math.ceil(amount / 1000);
}

function calculateMnPurchaseLenderShown(loanAmount: number): number {
  const loanThousands = toRoundedUpThousands(loanAmount);

  if (loanThousands <= 250) {
    return roundHalfUp(3.5 * loanThousands);
  }

  if (loanThousands <= 500) {
    return roundHalfUp(875 + 2.25 * (loanThousands - 250));
  }

  return roundHalfUp(1437.5 + 2 * (loanThousands - 500));
}

function calculateMnPurchaseTotalPackagePremium(purchasePrice: number): number {
  const purchaseThousands = toRoundedUpThousands(purchasePrice);

  if (purchaseThousands <= 200) {
    return roundHalfUp(850 + 0.35 * purchaseThousands);
  }

  if (purchaseThousands <= 250) {
    return roundHalfUp(920 + 3.86 * (purchaseThousands - 200));
  }

  if (purchaseThousands <= 500) {
    return roundHalfUp(1113 + 2.475 * (purchaseThousands - 250));
  }

  return roundHalfUp(1731.75 + 2.2 * (purchaseThousands - 500));
}

const OWNER_POLICY_STEP_TABLE: Array<{ maxAmount: number; premium: number }> = [
  { maxAmount: 50000, premium: 215 },
  { maxAmount: 60000, premium: 250 },
  { maxAmount: 70000, premium: 285 },
  { maxAmount: 80000, premium: 320 },
  { maxAmount: 90000, premium: 355 },
  { maxAmount: 100000, premium: 390 },
  { maxAmount: 110000, premium: 420 },
  { maxAmount: 120000, premium: 445 },
  { maxAmount: 130000, premium: 475 },
  { maxAmount: 140000, premium: 505 },
  { maxAmount: 150000, premium: 530 },
  { maxAmount: 160000, premium: 555 },
  { maxAmount: 170000, premium: 580 },
  { maxAmount: 180000, premium: 600 },
  { maxAmount: 190000, premium: 625 },
  { maxAmount: 200000, premium: 650 },
  { maxAmount: 210000, premium: 670 },
  { maxAmount: 220000, premium: 695 },
  { maxAmount: 230000, premium: 715 },
  { maxAmount: 240000, premium: 740 },
  { maxAmount: 250000, premium: 760 },
  { maxAmount: 260000, premium: 785 },
  { maxAmount: 270000, premium: 810 },
  { maxAmount: 280000, premium: 830 },
  { maxAmount: 290000, premium: 855 },
  { maxAmount: 300000, premium: 875 }
];
const OWNER_POLICY_TOP_BRACKET_AMOUNT = 300000;
const OWNER_POLICY_INCREMENTAL_RATE_PER_THOUSAND = 3;

export function roundUpToIncrement(amount: number, increment: number): number {
  if (amount <= 0) {
    return 0;
  }

  if (increment <= 0) {
    return amount;
  }

  return Math.ceil(amount / increment) * increment;
}

export function calculateTieredPremium(
  liabilityAmount: number,
  tiers: RateTier[],
  minPremium: number,
  increment: number
): TieredPremiumResult {
  const roundedLiability = roundUpToIncrement(liabilityAmount, increment);

  if (roundedLiability === 0) {
    return {
      premium: 0,
      roundedLiability: 0,
      breakdown: [],
      minPremiumApplied: false
    };
  }

  let remaining = roundedLiability;
  let previousLimit = 0;
  const breakdown: TieredPremiumResult["breakdown"] = [];
  let totalPremiumCents = 0;

  for (const tier of tiers) {
    if (remaining <= 0) {
      break;
    }

    const tierLimit =
      tier.limit === "inf" ? Number.POSITIVE_INFINITY : tier.limit;
    const tierCapacity =
      tierLimit === Number.POSITIVE_INFINITY
        ? remaining
        : Math.max(0, tierLimit - previousLimit);
    const tierAmount = Math.min(remaining, tierCapacity);

    if (tierAmount <= 0) {
      if (tierLimit !== Number.POSITIVE_INFINITY) {
        previousLimit = tierLimit;
      }
      continue;
    }

    const tierPremiumCents = Math.round(
      ((tierAmount * tier.ratePerThousand) / 1000) * 100
    );

    breakdown.push({
      tierStart: previousLimit === 0 ? 0 : previousLimit + 1,
      tierEnd: previousLimit + tierAmount,
      ratePerThousand: tier.ratePerThousand,
      tierAmount,
      tierPremium: roundToCents(tierPremiumCents / 100)
    });

    totalPremiumCents += tierPremiumCents;
    remaining -= tierAmount;

    if (tierLimit === Number.POSITIVE_INFINITY) {
      previousLimit += tierAmount;
    } else {
      previousLimit = tierLimit;
    }
  }

  const minPremiumCents = Math.round(minPremium * 100);
  const minPremiumApplied = totalPremiumCents < minPremiumCents;
  const premiumCents = minPremiumApplied ? minPremiumCents : totalPremiumCents;

  return {
    premium: roundToCents(premiumCents / 100),
    roundedLiability,
    breakdown,
    minPremiumApplied
  };
}

export function ownersPolicy(
  purchasePrice: number,
  expandedOwnersCoverage: boolean,
  config: TitlePremiumConfig = DEFAULT_MN_TITLE_PREMIUM_CONFIG
): OwnersPolicyResult {
  if (!Number.isFinite(purchasePrice) || purchasePrice <= 0) {
    return {
      premium: 0,
      roundedLiability: 0,
      breakdown: [],
      minPremiumApplied: false,
      expandedCoverageApplied: expandedOwnersCoverage
    };
  }

  const matchedStep =
    OWNER_POLICY_STEP_TABLE.find((step) => purchasePrice <= step.maxAmount) ||
    OWNER_POLICY_STEP_TABLE[OWNER_POLICY_STEP_TABLE.length - 1];

  const basePremium = matchedStep.premium;
  const baseBreakdownAmount = Math.min(
    purchasePrice,
    OWNER_POLICY_TOP_BRACKET_AMOUNT
  );
  const breakdown: TieredPremiumResult["breakdown"] = [
    {
      tierStart: 0,
      tierEnd: Math.round(baseBreakdownAmount),
      ratePerThousand: 0,
      tierAmount: Math.round(baseBreakdownAmount),
      tierPremium: roundToCents(basePremium)
    }
  ];

  let premiumBeforeMin = basePremium;
  if (purchasePrice > OWNER_POLICY_TOP_BRACKET_AMOUNT) {
    const additionalAmount = purchasePrice - OWNER_POLICY_TOP_BRACKET_AMOUNT;
    const additionalRoundedToThousands = roundUpToIncrement(
      additionalAmount,
      config.roundIncrement
    );
    const additionalPremium =
      (additionalRoundedToThousands / 1000) *
      OWNER_POLICY_INCREMENTAL_RATE_PER_THOUSAND;

    premiumBeforeMin += additionalPremium;
    breakdown.push({
      tierStart: OWNER_POLICY_TOP_BRACKET_AMOUNT + 1,
      tierEnd:
        OWNER_POLICY_TOP_BRACKET_AMOUNT + additionalRoundedToThousands,
      ratePerThousand: OWNER_POLICY_INCREMENTAL_RATE_PER_THOUSAND,
      tierAmount: additionalRoundedToThousands,
      tierPremium: roundToCents(additionalPremium)
    });
  }

  const minPremiumApplied = premiumBeforeMin < config.minPremium;
  const premiumWithMin = minPremiumApplied
    ? config.minPremium
    : premiumBeforeMin;

  const premium = expandedOwnersCoverage
    ? roundToCents(premiumWithMin * config.expandedCoverageMultiplier)
    : roundToCents(premiumWithMin);

  return {
    premium,
    roundedLiability: roundToCents(purchasePrice),
    breakdown,
    minPremiumApplied,
    expandedCoverageApplied: expandedOwnersCoverage
  };
}

export function lendersPolicy(
  loanAmount: number,
  purchasePrice: number,
  refinance: boolean,
  simultaneousIssue: boolean,
  config: TitlePremiumConfig = DEFAULT_MN_TITLE_PREMIUM_CONFIG
): LendersPolicyResult {
  if (loanAmount === 0) {
    return {
      premium: 0,
      roundedLiability: 0,
      breakdown: [],
      minPremiumApplied: false,
      simultaneousIssueApplied: false,
      warnings: []
    };
  }

  if (simultaneousIssue && loanAmount <= purchasePrice) {
    return {
      premium: roundToCents(config.simultaneousIssueLenderPremium),
      roundedLiability: roundUpToIncrement(loanAmount, config.roundIncrement),
      breakdown: [],
      minPremiumApplied: false,
      simultaneousIssueApplied: true,
      warnings: []
    };
  }

  const warnings: string[] = [];
  if (simultaneousIssue && loanAmount > purchasePrice) {
    warnings.push(
      "Simultaneous issue selected but loan exceeds purchase price; computed tiered lender premium."
    );
  }

  if (!refinance) {
    const roundedLiability = roundUpToIncrement(loanAmount, config.roundIncrement);
    const premium = calculateMnPurchaseLenderShown(loanAmount);

    return {
      premium,
      roundedLiability,
      breakdown: [
        {
          tierStart: 0,
          tierEnd: roundedLiability,
          ratePerThousand: 0,
          tierAmount: roundedLiability,
          tierPremium: premium
        }
      ],
      minPremiumApplied: false,
      simultaneousIssueApplied: false,
      warnings
    };
  }

  const rateTable = refinance
    ? config.lenderRefinanceRates
    : config.lenderPurchaseRates;
  const tieredResult = calculateTieredPremium(
    loanAmount,
    rateTable,
    config.minPremium,
    config.roundIncrement
  );

  return {
    ...tieredResult,
    premium: roundToCents(tieredResult.premium),
    simultaneousIssueApplied: false,
    warnings
  };
}

export function calculateTitlePremiums(
  input: TitlePremiumInput,
  config: TitlePremiumConfig = DEFAULT_MN_TITLE_PREMIUM_CONFIG
): TitlePremiumOutput {
  const expandedOwnersCoverage = input.expandedOwnersCoverage ?? false;
  const refinance = input.refinance ?? false;
  const simultaneousIssue = input.simultaneousIssue ?? false;

  const lender = lendersPolicy(
    input.loanAmount,
    input.purchasePrice,
    refinance,
    simultaneousIssue,
    config
  );

  const owner = !refinance && !simultaneousIssue
    ? (() => {
        // Watermark/TitleCapture MN purchase quote shows owner as allocation remainder:
        // OwnerShown = TotalPackagePremium(P) - LenderShown(L)
        const totalPackagePremium = calculateMnPurchaseTotalPackagePremium(
          input.purchasePrice
        );
        const ownerShown = totalPackagePremium - lender.premium;
        const premium = expandedOwnersCoverage
          ? roundHalfUp(ownerShown * config.expandedCoverageMultiplier)
          : ownerShown;
        const roundedLiability = roundUpToIncrement(
          input.purchasePrice,
          config.roundIncrement
        );

        return {
          premium,
          roundedLiability,
          breakdown: [
            {
              tierStart: 0,
              tierEnd: roundedLiability,
              ratePerThousand: 0,
              tierAmount: roundedLiability,
              tierPremium: premium
            }
          ],
          minPremiumApplied: false,
          expandedCoverageApplied: expandedOwnersCoverage
        } satisfies OwnersPolicyResult;
      })()
    : ownersPolicy(input.purchasePrice, expandedOwnersCoverage, config);

  const ownerPremium = roundToCents(owner.premium);
  const lenderPremium = roundToCents(lender.premium);
  const totalPremium = roundToCents(ownerPremium + lenderPremium);

  return {
    ownerPremium,
    lenderPremium,
    totalPremium,
    details: {
      roundedOwnerLiability: owner.roundedLiability,
      roundedLenderLiability: lender.roundedLiability,
      ownerBreakdown: owner.breakdown,
      lenderBreakdown: lender.breakdown,
      minPremiumAppliedOwner: owner.minPremiumApplied,
      minPremiumAppliedLender: lender.minPremiumApplied,
      simultaneousIssueApplied: lender.simultaneousIssueApplied,
      expandedCoverageApplied: owner.expandedCoverageApplied,
      warnings: lender.warnings
    }
  };
}
