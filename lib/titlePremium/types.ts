export type RateTier = {
  limit: number | "inf";
  ratePerThousand: number;
};

export type BreakdownLine = {
  tierStart: number;
  tierEnd: number;
  ratePerThousand: number;
  tierAmount: number;
  tierPremium: number;
};

export type TieredPremiumResult = {
  premium: number;
  roundedLiability: number;
  breakdown: BreakdownLine[];
  minPremiumApplied: boolean;
};

export type TitlePremiumInput = {
  purchasePrice: number;
  loanAmount: number;
  expandedOwnersCoverage?: boolean;
  refinance?: boolean;
  simultaneousIssue?: boolean;
};

export type OwnersPolicyResult = TieredPremiumResult & {
  expandedCoverageApplied: boolean;
};

export type LendersPolicyResult = TieredPremiumResult & {
  simultaneousIssueApplied: boolean;
  warnings: string[];
};

export type TitlePremiumDetails = {
  roundedOwnerLiability: number;
  roundedLenderLiability: number;
  ownerBreakdown: BreakdownLine[];
  lenderBreakdown: BreakdownLine[];
  minPremiumAppliedOwner: boolean;
  minPremiumAppliedLender: boolean;
  simultaneousIssueApplied: boolean;
  expandedCoverageApplied: boolean;
  warnings: string[];
};

export type TitlePremiumOutput = {
  ownerPremium: number;
  lenderPremium: number;
  totalPremium: number;
  aprAnnual?: number;
  aprPercent?: string;
  aprDetails?: {
    payment: number;
    pointsFee: number;
    perDiemInterest: number;
    amountFinanced: number;
    termMonths: number;
    noteRateAnnual: number;
    pointsPercent: number;
    underwritingFee: number;
    perDiemDays: number;
  };
  details: TitlePremiumDetails;
};

export type TitlePremiumConfig = {
  ownerPolicyRates: RateTier[];
  lenderPurchaseRates: RateTier[];
  lenderRefinanceRates: RateTier[];
  minPremium: number;
  simultaneousIssueLenderPremium: number;
  expandedCoverageMultiplier: number;
  roundIncrement: number;
};
