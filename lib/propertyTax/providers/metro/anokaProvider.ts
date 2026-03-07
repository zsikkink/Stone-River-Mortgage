import { createPublicAccessCountyProvider } from "./publicAccessCountyProvider";

export const anokaCountyTaxProvider = createPublicAccessCountyProvider({
  county: "Anoka",
  baseUrl: "https://prtpublicweb.co.anoka.mn.us",
  sourceName: "Anoka County Property Tax Search",
  providerKey: "mn-anoka-authoritative-tax-provider-v2",
  preferredDataletModes: ["tax_all_ank", "tax_statement_1", "tax_collection"]
});
