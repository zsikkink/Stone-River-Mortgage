import { describe, expect, it } from "vitest";
import {
  classifyMetroProviderFailure,
  MetroProviderError
} from "./providerError";

describe("metro provider error classification", () => {
  it("classifies nested TLS certificate-chain failures", () => {
    const error = new TypeError("fetch failed", {
      cause: Object.assign(new Error("unable to verify the first certificate"), {
        code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
      })
    });

    const classification = classifyMetroProviderFailure(error);
    expect(classification.kind).toBe("tls_certificate_validation");
    expect(classification.code).toBe("UNABLE_TO_VERIFY_LEAF_SIGNATURE");
  });

  it("preserves MetroProviderError classification", () => {
    const classification = classifyMetroProviderFailure(
      new MetroProviderError({
        kind: "parse_error",
        message: "Could not parse county annual tax row",
        code: null
      })
    );

    expect(classification.kind).toBe("parse_error");
    expect(classification.code).toBeNull();
  });

  it("classifies INVALID_CARVER_CA_PEM as tls_certificate_validation", () => {
    const classification = classifyMetroProviderFailure(
      Object.assign(new Error("invalid carver pem"), {
        code: "INVALID_CARVER_CA_PEM"
      })
    );

    expect(classification.kind).toBe("tls_certificate_validation");
    expect(classification.code).toBe("INVALID_CARVER_CA_PEM");
  });
});
