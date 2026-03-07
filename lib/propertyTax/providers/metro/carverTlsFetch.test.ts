import { describe, expect, it, vi } from "vitest";
import {
  createCarverCookieAwareFetch,
  getCarverTlsDiagnostics
} from "./carverTlsFetch";

describe("carverTlsFetch", () => {
  it("uses request-scoped CA path for Carver host when CARVER_CA_PEM is set", async () => {
    const fallbackFetch = vi.fn(async () => {
      throw new Error("fallback fetch should not be used");
    });
    const requestWithCaImpl = vi.fn(async () => ({
      response: new Response("ok", { status: 200 }),
      finalUrl:
        "https://publicaccess.carvercountymn.gov/search/commonsearch.aspx?mode=combined",
      setCookies: [],
      transport: "carver_ca_pem"
    }));

    const fetchWithCarverCa = createCarverCookieAwareFetch({
      env: {
        CARVER_CA_PEM:
          "-----BEGIN CERTIFICATE-----\\nMIIFAKE\\n-----END CERTIFICATE-----"
      } as unknown as NodeJS.ProcessEnv,
      fallbackFetch: fallbackFetch as unknown as typeof fetch,
      requestWithCaImpl
    });

    const result = await fetchWithCarverCa(
      "https://publicaccess.carvercountymn.gov/search/commonsearch.aspx?mode=combined",
      { method: "GET" }
    );

    expect(requestWithCaImpl).toHaveBeenCalledTimes(1);
    expect(fallbackFetch).not.toHaveBeenCalled();
    expect(result.transport).toBe("carver_ca_pem");
  });

  it("keeps non-Carver hosts on default trust path", async () => {
    const fallbackFetch = vi.fn(async () =>
      new Response("<html>ok</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" }
      })
    );
    const requestWithCaImpl = vi.fn();

    const fetchWithCarverCa = createCarverCookieAwareFetch({
      env: {
        CARVER_CA_PEM:
          "-----BEGIN CERTIFICATE-----\\nMIIFAKE\\n-----END CERTIFICATE-----"
      } as unknown as NodeJS.ProcessEnv,
      fallbackFetch: fallbackFetch as unknown as typeof fetch,
      requestWithCaImpl
    });

    const result = await fetchWithCarverCa(
      "https://publicaccess.scottcountymn.gov/search/commonsearch.aspx?mode=combined",
      { method: "GET" }
    );

    expect(fallbackFetch).toHaveBeenCalledTimes(1);
    expect(requestWithCaImpl).not.toHaveBeenCalled();
    expect(result.transport).toBe("default_fetch");
  });

  it("reports invalid CARVER_CA_PEM diagnostics", () => {
    const diagnostics = getCarverTlsDiagnostics({
      CARVER_CA_PEM: "invalid",
      NODE_EXTRA_CA_CERTS: "/tmp/extra-ca.pem"
    } as unknown as NodeJS.ProcessEnv);

    expect(diagnostics.carverCaPemConfigured).toBe(true);
    expect(diagnostics.carverCaPemValid).toBe(false);
    expect(diagnostics.requestScopedCaEnabled).toBe(false);
    expect(diagnostics.trustPath).toBe("default_trust_store");
    expect(diagnostics.nodeExtraCaCertsConfigured).toBe(true);
  });
});
