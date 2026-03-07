import { createPublicAccessCountyProvider } from "./publicAccessCountyProvider";
import {
  createCarverCookieAwareFetch,
  getCarverTlsDiagnostics
} from "./carverTlsFetch";

const carverCookieAwareFetch = createCarverCookieAwareFetch();

export const carverCountyTaxProvider = createPublicAccessCountyProvider({
  county: "Carver",
  baseUrl: "https://publicaccess.carvercountymn.gov",
  sourceName: "Carver County Property Tax Search",
  providerKey: "mn-carver-authoritative-tax-provider-v3",
  preferredDataletModes: [
    "tax_sa_hist_by_year",
    "tax_statement_1",
    "tax_collection"
  ],
  fetchImpl: carverCookieAwareFetch,
  getRuntimeDiagnostics: () => getCarverTlsDiagnostics()
});
