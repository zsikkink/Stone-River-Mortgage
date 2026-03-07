import { createPublicAccessCountyProvider } from "./publicAccessCountyProvider";

export const scottCountyTaxProvider = createPublicAccessCountyProvider({
  county: "Scott",
  baseUrl: "https://publicaccess.scottcountymn.gov",
  sourceName: "Scott County Property Tax Search",
  providerKey: "mn-scott-authoritative-tax-provider-v2",
  preferredDataletModes: ["payments", "tax_statement_1", "tax_collection"]
});
