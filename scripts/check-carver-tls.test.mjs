import { describe, expect, it } from "vitest";
import { checkCarverTls } from "./check-carver-tls.mjs";

describe("checkCarverTls", () => {
  it("classifies TLS chain validation failures and reports missing CARVER_CA_PEM/NODE_EXTRA_CA_CERTS", async () => {
    const result = await checkCarverTls({
      env: {},
      fetchImpl: async () => {
        throw new TypeError("fetch failed", {
          cause: Object.assign(
            new Error("unable to verify the first certificate"),
            { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" }
          )
        });
      }
    });

    expect(result.ok).toBe(false);
    expect(result.providerErrorType).toBe("tls_certificate_validation");
    expect(result.providerErrorCode).toBe("UNABLE_TO_VERIFY_LEAF_SIGNATURE");
    expect(result.carverCaPemConfigured).toBe(false);
    expect(result.nodeExtraCaCertsConfigured).toBe(false);
    expect(result.recommendedAction).toContain("Set CARVER_CA_PEM");
  });

  it("reports success when connectivity works with request-scoped CARVER_CA_PEM", async () => {
    const result = await checkCarverTls({
      env: {
        CARVER_CA_PEM:
          "-----BEGIN CERTIFICATE-----\\nMIIFAKE\\n-----END CERTIFICATE-----"
      },
      requestWithCaImpl: async () => ({ ok: true, status: 200 }),
      fetchImpl: async () =>
        new Response("<html>ok</html>", {
          status: 200,
          headers: { "Content-Type": "text/html" }
        })
    });

    expect(result.ok).toBe(true);
    expect(result.providerErrorType).toBeNull();
    expect(result.trustPath).toBe("carver_ca_pem");
    expect(result.carverCaPemConfigured).toBe(true);
    expect(result.carverCaPemValid).toBe(true);
  });

  it("returns a classified error when CARVER_CA_PEM is invalid", async () => {
    const result = await checkCarverTls({
      env: {
        CARVER_CA_PEM: "not-a-pem"
      }
    });

    expect(result.ok).toBe(false);
    expect(result.providerErrorType).toBe("tls_certificate_validation");
    expect(result.providerErrorCode).toBe("INVALID_CARVER_CA_PEM");
    expect(result.carverCaPemConfigured).toBe(true);
    expect(result.carverCaPemValid).toBe(false);
    expect(result.recommendedAction).toContain("CARVER_CA_PEM");
  });
});
