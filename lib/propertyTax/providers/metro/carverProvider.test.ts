import { afterEach, describe, expect, it, vi } from "vitest";
import { carverCountyTaxProvider } from "./carverProvider";
import { MetroProviderError } from "./providerError";

afterEach(() => {
  delete process.env.CARVER_CA_PEM;
  vi.restoreAllMocks();
});

describe("carver provider", () => {
  it("classifies TLS certificate-chain failures as MetroProviderError", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);

      if (url.includes("publicaccess.carvercountymn.gov")) {
        throw new TypeError("fetch failed", {
          cause: Object.assign(
            new Error("unable to verify the first certificate"),
            { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" }
          )
        });
      }

      return new Response(JSON.stringify({ features: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });

    const parcel = {
      parcelId: "080080600",
      objectId: 107,
      situsAddress: "333 W 2nd St, Waconia, MN 55387",
      annualPropertyTax: 1988,
      taxYear: 2025,
      distanceMeters: 5,
      sourceUrl: "https://example.com",
      raw: {
        attributes: {
          COUNTY_PIN: "080080600"
        }
      }
    };

    await expect(
      carverCountyTaxProvider.fetchTaxObservation(parcel, {
        formattedAddress: "333 W 2nd St, Waconia, MN 55387",
        county: "Carver",
        state: "MN",
        lat: 44.850339,
        lng: -93.787977,
        taxYear: 2026
      })
    ).rejects.toMatchObject({
      name: "MetroProviderError",
      kind: "tls_certificate_validation"
    } satisfies Partial<MetroProviderError>);
  });

  it("returns a classified TLS error when CARVER_CA_PEM is invalid", async () => {
    process.env.CARVER_CA_PEM = "invalid";

    const parcel = {
      parcelId: "080080600",
      objectId: 107,
      situsAddress: "333 W 2nd St, Waconia, MN 55387",
      annualPropertyTax: 1988,
      taxYear: 2025,
      distanceMeters: 5,
      sourceUrl: "https://example.com",
      raw: {
        attributes: {
          COUNTY_PIN: "080080600"
        }
      }
    };

    await expect(
      carverCountyTaxProvider.fetchTaxObservation(parcel, {
        formattedAddress: "333 W 2nd St, Waconia, MN 55387",
        county: "Carver",
        state: "MN",
        lat: 44.850339,
        lng: -93.787977,
        taxYear: 2026
      })
    ).rejects.toMatchObject({
      name: "MetroProviderError",
      kind: "tls_certificate_validation",
      code: "INVALID_CARVER_CA_PEM"
    } satisfies Partial<MetroProviderError>);
  });
});
