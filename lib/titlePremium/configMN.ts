import { TitlePremiumConfig } from "./types";

export const DEFAULT_MN_TITLE_PREMIUM_CONFIG: TitlePremiumConfig = {
  ownerPolicyRates: [
    { limit: 250000, ratePerThousand: 3.5 },
    { limit: 500000, ratePerThousand: 2.75 },
    { limit: 1000000, ratePerThousand: 2.25 },
    { limit: "inf", ratePerThousand: 1.75 }
  ],
  lenderPurchaseRates: [
    { limit: 250000, ratePerThousand: 3.0 },
    { limit: 500000, ratePerThousand: 2.5 },
    { limit: 1000000, ratePerThousand: 2.0 },
    { limit: "inf", ratePerThousand: 1.5 }
  ],
  lenderRefinanceRates: [
    { limit: 250000, ratePerThousand: 2.0 },
    { limit: 500000, ratePerThousand: 1.75 },
    { limit: 1000000, ratePerThousand: 1.25 },
    { limit: "inf", ratePerThousand: 1.0 }
  ],
  minPremium: 200,
  simultaneousIssueLenderPremium: 150,
  expandedCoverageMultiplier: 1.1,
  roundIncrement: 1000
};
