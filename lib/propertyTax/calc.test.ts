import { afterEach, describe, expect, it, vi } from "vitest";
import {
  computeAnnualPropertyTax,
  getAnnualPropertyTax
} from "./calc";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getAnnualPropertyTax", () => {
  it("returns county_retrieved result for metro county provider success using authoritative hennepin tax source", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("www16.co.hennepin.mn.us/taxpayments/taxesdue.jsp")) {
        return new Response(
          `
            <html>
              <body>
                <strong>Property ID number:&nbsp;</strong> 02-116-22-12-0025
                <b style="background-color: #FFCC66">2026 taxes</b>
                <table>
                  <tr><td>Total payable</td><td>$8,250.28</td></tr>
                </table>
                <p>This database is updated daily (Monday - Friday) at approximately 9:15 p.m. (CST)</p>
              </body>
            </html>
          `,
          { status: 200, headers: { "Content-Type": "text/html" } }
        );
      }

      if (url.includes("/query") && url.includes("where=1%3D1")) {
        return new Response(
          JSON.stringify({
            features: [
              {
                attributes: {
                  OBJECTID: 999,
                  COUNTY_PIN: "0211622120025",
                  STATE_PIN: "MN-0211622120025",
                  TAX_YEAR: 2025,
                  TOTAL_TAX: 5250,
                  ANUMBER: 11836,
                  ST_NAME: "Thornhill",
                  ST_POS_TYP: "Rd",
                  POSTCOMM: "EDEN PRAIRIE",
                  ZIP: "55344",
                  CO_NAME: "Hennepin"
                },
                geometry: {
                  x: -93.4624,
                  y: 44.8544
                }
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (url.includes("/query") && url.includes("where=OBJECTID%3D999")) {
        return new Response(
          JSON.stringify({
            features: [
              {
                attributes: {
                  OBJECTID: 999,
                  COUNTY_PIN: "0211622120025",
                  STATE_PIN: "MN-0211622120025",
                  TAX_YEAR: 2025,
                  TOTAL_TAX: 5250,
                  ANUMBER: 11836,
                  ST_NAME: "Thornhill",
                  ST_POS_TYP: "Rd",
                  POSTCOMM: "EDEN PRAIRIE",
                  ZIP: "55344",
                  CO_NAME: "Hennepin"
                }
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(JSON.stringify({ features: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });

    const result = await getAnnualPropertyTax({
      formattedAddress: "11836 Thornhill Rd, Eden Prairie, MN 55344",
      county: "Hennepin County",
      state: "MN",
      lat: 44.8544,
      lng: -93.4624,
      purchasePrice: 400000,
      taxYear: 2026
    });

    expect(result.result_type).toBe("county_retrieved");
    expect(result.annual_property_tax).toBe(8250.28);
    expect(result.source_kind).toBe("official_county");
    expect(result.confidence).toBe("high");
    expect(result.strategy_key).toContain("mn-metro-hennepin");
    expect(result.parcel_id).toBe("0211622120025");
    expect(result.source_url).toContain("taxpayments/taxesdue.jsp");
    expect(result.requested_tax_year).toBe(2026);
    expect(result.actual_tax_year_used).toBe(2026);
    expect(result.year_match_status).toBe("matched");
    expect(result.retrieval_notes?.length).toBeGreaterThan(0);
  });

  it("uses latest available county year with explicit year metadata when requested year differs", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("www16.co.hennepin.mn.us/taxpayments/taxesdue.jsp")) {
        return new Response(
          `
            <html>
              <body>
                <strong>Property ID number:&nbsp;</strong> 02-116-22-12-0025
                <b style="background-color: #FFCC66">2026 taxes</b>
                <table><tr><td>Total payable</td><td>$8,250.28</td></tr></table>
              </body>
            </html>
          `,
          { status: 200, headers: { "Content-Type": "text/html" } }
        );
      }

      if (url.includes("/query") && url.includes("where=1%3D1")) {
        return new Response(
          JSON.stringify({
            features: [
              {
                attributes: {
                  OBJECTID: 999,
                  COUNTY_PIN: "0211622120025",
                  STATE_PIN: "MN-0211622120025",
                  TAX_YEAR: 2025,
                  TOTAL_TAX: 7580,
                  ANUMBER: 11836,
                  ST_NAME: "Thornhill",
                  ST_POS_TYP: "Rd",
                  POSTCOMM: "EDEN PRAIRIE",
                  ZIP: "55344",
                  CO_NAME: "Hennepin"
                },
                geometry: {
                  x: -93.4624,
                  y: 44.8544
                }
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(JSON.stringify({ features: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });

    const result = await getAnnualPropertyTax({
      formattedAddress: "11836 Thornhill Rd, Eden Prairie, MN 55344",
      county: "Hennepin County",
      state: "MN",
      lat: 44.8544,
      lng: -93.4624,
      purchasePrice: 400000,
      taxYear: 2027
    });

    expect(result.result_type).toBe("county_retrieved");
    expect(result.annual_property_tax).toBe(8250.28);
    expect(result.requested_tax_year).toBe(2027);
    expect(result.actual_tax_year_used).toBe(2026);
    expect(result.year_match_status).toBe("latest_available_used");
    expect((result.retrieval_notes || []).join(" ")).toContain(
      "Requested tax year 2027"
    );
  });

  it("returns county_retrieved result for Ramsey using county API instead of Beacon challenge pages", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);

      if (url.includes("Parcels2025RamseyPoints") && url.includes("where=1%3D1")) {
        return new Response(
          JSON.stringify({
            features: [
              {
                attributes: {
                  OBJECTID: 312,
                  COUNTY_PIN: "092922410003",
                  STATE_PIN: "27123-092922410003",
                  TAX_YEAR: 2025,
                  TOTAL_TAX: 128030,
                  ANUMBER: 1195,
                  ST_NAME: "Viking",
                  ST_POS_TYP: "Drive",
                  POSTCOMM: "Maplewood",
                  ZIP: "55109",
                  CO_NAME: "Ramsey"
                },
                geometry: {
                  x: -93.0502,
                  y: 45.0125
                }
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (
        url.includes(
          "maps.co.ramsey.mn.us/arcgis/rest/services/ParcelData/AttributedData/MapServer/0/query"
        )
      ) {
        return new Response(
          JSON.stringify({
            features: [
              {
                attributes: {
                  ParcelID: "092922410003",
                  TaxYear: 2025,
                  TotalTax: 128030,
                  SiteAddress: "1195 VIKING DR E",
                  SiteCityNameUSPS: "MAPLEWOOD",
                  SiteZIP5: "55109"
                }
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(JSON.stringify({ features: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });

    const result = await getAnnualPropertyTax({
      formattedAddress: "1195 Viking Dr E, Maplewood, MN 55109",
      county: "Ramsey County",
      state: "MN",
      lat: 45.0125,
      lng: -93.0502,
      purchasePrice: 410000,
      taxYear: 2028
    });

    expect(result.result_type).toBe("county_retrieved");
    expect(result.source_kind).toBe("county_api");
    expect(result.annual_property_tax).toBe(128030);
    expect(result.actual_tax_year_used).toBe(2025);
    expect(result.year_match_status).toBe("latest_available_used");
  });

  it("uses explicit anti-bot fallback messaging when Ramsey Beacon returns a challenge page", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);

      if (url.includes("Parcels2025RamseyPoints") && url.includes("where=1%3D1")) {
        return new Response(
          JSON.stringify({
            features: [
              {
                attributes: {
                  OBJECTID: 312,
                  COUNTY_PIN: "092922410003",
                  STATE_PIN: "27123-092922410003",
                  TAX_YEAR: 2025,
                  TOTAL_TAX: 128030,
                  ANUMBER: 1195,
                  ST_NAME: "Viking",
                  ST_POS_TYP: "Drive",
                  POSTCOMM: "Maplewood",
                  ZIP: "55109",
                  CO_NAME: "Ramsey"
                },
                geometry: {
                  x: -93.0502,
                  y: 45.0125
                }
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (
        url.includes(
          "maps.co.ramsey.mn.us/arcgis/rest/services/ParcelData/AttributedData/MapServer/0/query"
        )
      ) {
        return new Response(JSON.stringify({ features: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      if (url.includes("beacon.schneidercorp.com/Application.aspx")) {
        return new Response("<title>Just a moment...</title>", {
          status: 200,
          headers: {
            "Content-Type": "text/html",
            "cf-mitigated": "challenge"
          }
        });
      }

      return new Response(JSON.stringify({ features: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });

    const result = await getAnnualPropertyTax({
      formattedAddress: "1195 Viking Dr E, Maplewood, MN 55109",
      county: "Ramsey County",
      state: "MN",
      lat: 45.0125,
      lng: -93.0502,
      purchasePrice: 400000,
      taxYear: 2026
    });

    expect(result.result_type).toBe("estimated");
    expect(result.fallback_reason).toContain("anti-bot challenge page");
    expect(result.raw_evidence.provider_error_type).toBe("response_error");
    expect(result.raw_evidence.provider_error_code).toBe("CLOUDFLARE_CHALLENGE");
  });

  it("uses Ramsey eGov fallback and returns current tax due when county API has no defensible record", async () => {
    let egovRequested = false;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);

      if (url.includes("Parcels2025RamseyPoints") && url.includes("where=1%3D1")) {
        return new Response(
          JSON.stringify({
            features: [
              {
                attributes: {
                  OBJECTID: 701,
                  COUNTY_PIN: "102922240033",
                  STATE_PIN: "27123-102922240033",
                  TAX_YEAR: 2025,
                  TOTAL_TAX: 5749.52,
                  ANUMBER: 1481,
                  ST_NAME: "Sextant",
                  ST_POS_TYP: "Avenue",
                  POSTCOMM: "Maplewood",
                  ZIP: "55109",
                  CO_NAME: "Ramsey"
                },
                geometry: {
                  x: -93.0277,
                  y: 44.9836
                }
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (
        url.includes(
          "maps.co.ramsey.mn.us/arcgis/rest/services/ParcelData/AttributedData/MapServer/0/query"
        )
      ) {
        return new Response(JSON.stringify({ features: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      if (url.includes("ramsey.egovpayments.com/egov/apps/bill/pay.egov")) {
        egovRequested = true;
        const headers = new Headers(init?.headers);
        expect(headers.get("user-agent")).toContain("Mozilla/5.0");
        return new Response(
          `
            <html>
              <body>
                <h2>Current Tax Year</h2>
                <table><tr><td>Total Amount Due:</td><td>$6,694.00</td></tr></table>
                <table><tr><th>2026 Payable</th><th>2025 Payable</th></tr></table>
              </body>
            </html>
          `,
          { status: 200, headers: { "Content-Type": "text/html" } }
        );
      }

      if (url.includes("beacon.schneidercorp.com/Application.aspx")) {
        throw new Error("Beacon should not be called when Ramsey eGov fallback succeeds.");
      }

      return new Response(JSON.stringify({ features: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });

    const result = await getAnnualPropertyTax({
      formattedAddress: "1481 Sextant Ave E, Maplewood, MN 55109",
      county: "Ramsey County",
      state: "MN",
      lat: 44.9836,
      lng: -93.0277,
      purchasePrice: 500000,
      taxYear: 2026
    });

    expect(egovRequested).toBe(true);
    expect(result.result_type).toBe("county_retrieved");
    expect(result.source_kind).toBe("official_county");
    expect(result.annual_property_tax).toBe(6694);
    expect(result.actual_tax_year_used).toBe(2026);
    expect(result.year_match_status).toBe("matched");
    expect(result.source_url).toContain("ramsey.egovpayments.com");
  });

  it("uses Ramsey county API site-address fallback before Beacon", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);

      if (url.includes("Parcels2025RamseyPoints") && url.includes("where=1%3D1")) {
        return new Response(
          JSON.stringify({
            features: [
              {
                attributes: {
                  OBJECTID: 500,
                  COUNTY_PIN: "050000000001",
                  STATE_PIN: "27123-050000000001",
                  TAX_YEAR: 2025,
                  TOTAL_TAX: 3200,
                  ANUMBER: 555,
                  ST_NAME: "Example",
                  ST_POS_TYP: "Street",
                  POSTCOMM: "Saint Paul",
                  ZIP: "55102",
                  CO_NAME: "Ramsey"
                },
                geometry: {
                  x: -93.11,
                  y: 44.94
                }
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (
        url.includes(
          "maps.co.ramsey.mn.us/arcgis/rest/services/ParcelData/AttributedData/MapServer/0/query"
        ) &&
        url.includes("where=ParcelID")
      ) {
        return new Response(JSON.stringify({ features: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      if (
        url.includes(
          "maps.co.ramsey.mn.us/arcgis/rest/services/ParcelData/AttributedData/MapServer/0/query"
        ) &&
        url.includes("where=1%3D1")
      ) {
        return new Response(JSON.stringify({ features: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      if (
        url.includes(
          "maps.co.ramsey.mn.us/arcgis/rest/services/ParcelData/AttributedData/MapServer/0/query"
        ) &&
        url.includes("where=SiteAddress")
      ) {
        return new Response(
          JSON.stringify({
            features: [
              {
                attributes: {
                  ParcelID: "050000000001",
                  TaxYear: 2026,
                  TotalTax: 6789.12,
                  SiteAddress: "555 EXAMPLE ST",
                  SiteCityNameUSPS: "SAINT PAUL",
                  SiteZIP5: "55102"
                }
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (url.includes("beacon.schneidercorp.com/Application.aspx")) {
        throw new Error("Beacon should not be called when site-address fallback succeeds.");
      }

      return new Response(JSON.stringify({ features: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });

    const result = await getAnnualPropertyTax({
      formattedAddress: "555 Example Street, Saint Paul, MN 55102",
      county: "Ramsey County",
      state: "MN",
      lat: 44.95,
      lng: -93.12,
      purchasePrice: 450000,
      taxYear: 2026
    });

    expect(result.result_type).toBe("county_retrieved");
    expect(result.source_kind).toBe("county_api");
    expect(result.annual_property_tax).toBe(6789.12);
    expect(result.raw_evidence.lookup_mode).toBe("site_address");
  });

  it("uses Ramsey county API structured-street fallback before Beacon", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);

      if (url.includes("Parcels2025RamseyPoints") && url.includes("where=1%3D1")) {
        return new Response(
          JSON.stringify({
            features: [
              {
                attributes: {
                  OBJECTID: 700,
                  COUNTY_PIN: "070000000001",
                  STATE_PIN: "27123-070000000001",
                  TAX_YEAR: 2025,
                  TOTAL_TAX: 4100,
                  ANUMBER: 1481,
                  ST_NAME: "Sextant",
                  ST_POS_TYP: "Avenue",
                  POSTCOMM: "Arden Hills",
                  ZIP: "55112",
                  CO_NAME: "Ramsey"
                },
                geometry: {
                  x: -93.16,
                  y: 45.07
                }
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (
        url.includes(
          "maps.co.ramsey.mn.us/arcgis/rest/services/ParcelData/AttributedData/MapServer/0/query"
        ) &&
        (url.includes("where=ParcelID") ||
          url.includes("where=1%3D1") ||
          url.includes("where=SiteAddress"))
      ) {
        return new Response(JSON.stringify({ features: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      if (
        url.includes(
          "maps.co.ramsey.mn.us/arcgis/rest/services/ParcelData/AttributedData/MapServer/0/query"
        ) &&
        url.includes("BuildingNumber%3D%271481%27") &&
        url.includes("StreetName%3D%27SEXTANT%27")
      ) {
        return new Response(
          JSON.stringify({
            features: [
              {
                attributes: {
                  ParcelID: "070000000001",
                  TaxYear: 2026,
                  TotalTax: 7123.45,
                  SiteAddress: "1481 SEXTANT AVE",
                  SiteCityNameUSPS: "ARDEN HILLS",
                  SiteZIP5: "55112"
                }
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (url.includes("beacon.schneidercorp.com/Application.aspx")) {
        throw new Error(
          "Beacon should not be called when structured-street fallback succeeds."
        );
      }

      return new Response(JSON.stringify({ features: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });

    const result = await getAnnualPropertyTax({
      formattedAddress: "1481 Sextant Avenue, Arden Hills, MN 55112",
      county: "Ramsey County",
      state: "MN",
      lat: 45.07,
      lng: -93.16,
      purchasePrice: 500000,
      taxYear: 2026
    });

    expect(result.result_type).toBe("county_retrieved");
    expect(result.source_kind).toBe("county_api");
    expect(result.annual_property_tax).toBe(7123.45);
    expect(result.raw_evidence.lookup_mode).toBe("structured_street");
  });

  it("returns Dakota county-retrieved tax from direct statement PDF when history is stale", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);

      if (url.includes("Parcels2025DakotaPoints") && url.includes("where=1%3D1")) {
        return new Response(
          JSON.stringify({
            features: [
              {
                attributes: {
                  OBJECTID: 9901,
                  COUNTY_PIN: "228205301010",
                  STATE_PIN: "27037-228205301010",
                  TAX_YEAR: 2024,
                  TOTAL_TAX: 4999.12,
                  ANUMBER: 20508,
                  ST_NAME: "Hartford",
                  ST_POS_TYP: "Way",
                  POSTCOMM: "Lakeville",
                  ZIP: "55044",
                  CO_NAME: "Dakota"
                },
                geometry: {
                  x: -93.3177,
                  y: 44.642
                }
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (
        url.includes("propertysearch.co.dakota.mn.us/PropertyInformationOnline/TaxStatement_PDF.aspx") &&
        url.includes("Id=228205301010")
      ) {
        return new Response(
          Buffer.from(
            `
stream
BT
(2025 Property Tax Statement)Tj
(Payable 2024)Tj
(Payable 2025)Tj
(2.  Use this amount for the special property tax refund on schedule 1 on Form M1PR.)Tj
($5,338.00)Tj
(14. Your Total Property Tax and Special Assessments)Tj
($5,338.00)Tj
($5,499.58)Tj
ET
endstream
`,
            "latin1"
          ),
          { status: 200, headers: { "Content-Type": "application/pdf" } }
        );
      }

      if (url.includes("propertysearch.co.dakota.mn.us/PropertyInformationOnline/TaxStatementHistory.aspx")) {
        throw new Error("Dakota history should not be called when direct statement parse succeeds.");
      }

      return new Response(JSON.stringify({ features: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });

    const result = await getAnnualPropertyTax({
      formattedAddress: "20508 Hartford Way, Lakeville, MN 55044",
      county: "Dakota County",
      state: "MN",
      lat: 44.642,
      lng: -93.3177,
      purchasePrice: 550000,
      taxYear: 2025
    });

    expect(result.result_type).toBe("county_retrieved");
    expect(result.source_kind).toBe("county_statement");
    expect(result.annual_property_tax).toBe(5338);
    expect(result.actual_tax_year_used).toBe(2025);
    expect(result.year_match_status).toBe("matched");
    expect(result.source_url).toContain("TaxStatement_PDF.aspx?Id=228205301010");
  });

  it("falls back to estimate for metro county when provider is unresolved", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(JSON.stringify({ features: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });

    const result = await getAnnualPropertyTax({
      formattedAddress: "123 Main St, Minneapolis, MN 55401",
      county: "Hennepin County",
      state: "MN",
      lat: 44.98,
      lng: -93.266,
      purchasePrice: 400000,
      taxYear: 2026
    });

    expect(result.result_type).toBe("estimated");
    expect(result.annual_property_tax).toBe(5000);
    expect(result.fallback_reason).toContain("County provider");
    expect(result.source_kind).toBe("county_rate_table");
  });

  it("classifies Carver TLS failures and returns secure fallback messaging", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);

      if (url.includes("Parcels2025CarverPoints") && url.includes("where=1%3D1")) {
        return new Response(
          JSON.stringify({
            features: [
              {
                attributes: {
                  OBJECTID: 107,
                  COUNTY_PIN: "080080600",
                  STATE_PIN: "27019-080080600",
                  TAX_YEAR: 2025,
                  TOTAL_TAX: 1988,
                  ANUMBER: 333,
                  ST_NAME: "W 2nd",
                  ST_POS_TYP: "St",
                  POSTCOMM: "WACONIA",
                  ZIP: "55387",
                  CO_NAME: "Carver"
                },
                geometry: {
                  x: -93.787977,
                  y: 44.850339
                }
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

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

    const result = await getAnnualPropertyTax({
      formattedAddress: "333 W 2nd St, Waconia, MN 55387",
      county: "Carver County",
      state: "MN",
      lat: 44.850339,
      lng: -93.787977,
      purchasePrice: 400000,
      taxYear: 2026
    });

    expect(result.result_type).toBe("estimated");
    expect(result.fallback_reason).toContain("secure connection issue");
    expect(result.raw_evidence.provider_error_type).toBe(
      "tls_certificate_validation"
    );
    expect(result.raw_evidence.provider_error_code).toBe(
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
    );
    expect(result.raw_evidence.node_extra_ca_certs_configured).toBe(false);
    expect(result.raw_evidence.carver_ca_pem_configured).toBe(false);
  });

  it("returns county_retrieved result for Wright using authoritative county tax workflow", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);

      if (
        url.includes("propertyaccess.co.wright.mn.us/search/commonsearch.aspx?mode=combined") &&
        (!init || init.method === "GET")
      ) {
        return new Response(
          `
            <form>
              <input type="hidden" name="__VIEWSTATE" value="wright-vs" />
              <input type="hidden" name="__VIEWSTATEGENERATOR" value="wright-vg" />
              <input type="hidden" name="__EVENTVALIDATION" value="wright-ev" />
              <input type="hidden" name="mode" value="COMBINED" />
              <input type="hidden" name="PageNum" value="1" />
              <input type="hidden" name="PageSize" value="15" />
              <input type="hidden" name="SortBy" value="PARID" />
              <input type="hidden" name="SortDir" value=" asc" />
              <input type="hidden" name="hdAction" value="" />
              <input type="hidden" name="hdIndex" value="0" />
              <input type="hidden" name="sIndex" value="" />
              <input type="hidden" name="hdListType" value="PA" />
              <input type="hidden" name="hdJur" value="" />
              <input type="hidden" name="hdSelectAllChecked" value="" />
              <input type="hidden" name="mask" value="" />
              <input type="hidden" name="param1" value="" />
              <input type="hidden" name="searchimmediate" value="" />
              <input type="hidden" name="searchClt$hdSelSuf" value="" />
              <input type="hidden" name="searchClt$hdSelDir" value="" />
              <input type="hidden" name="searchOptions$hdBeta" value="" />
            </form>
          `,
          { status: 200, headers: { "Content-Type": "text/html" } }
        );
      }

      if (
        url.includes("propertyaccess.co.wright.mn.us/search/commonsearch.aspx?mode=combined") &&
        init?.method === "POST"
      ) {
        const body = typeof init.body === "string" ? init.body : "";
        if (body.includes("mode=PARID")) {
          return new Response(
            `
              <a href="../datalets/datalet.aspx?mode=tax_statement_1&sIndex=0&idx=1&LMparent=20">Property Tax Information</a>
            `,
            { status: 200, headers: { "Content-Type": "text/html" } }
          );
        }

        return new Response(
          `
            <table id="searchResults">
              <tbody>
                <tr onclick="javascript:selectSearchRow('../Datalets/Datalet.aspx?sIndex=0&idx=1')">
                  <td><input value='086:214005001020:2026' /></td>
                  <td><div>214005001020</div></td>
                  <td><div>TEST OWNER</div></td>
                  <td><div>1002 1ST ST NE</div></td>
                  <td><div>BUFFALO</div></td>
                  <td><div>55313</div></td>
                </tr>
              </tbody>
            </table>
          `,
          { status: 200, headers: { "Content-Type": "text/html" } }
        );
      }

      if (
        url
          .toLowerCase()
          .includes("propertyaccess.co.wright.mn.us/datalets/datalet.aspx?mode=tax_statement_1")
      ) {
        return new Response(
          `
            <table>
              <tr><td>Pay Year:</td><td>2026</td></tr>
              <tr><td><strong>Total Tax Incuding Specials:</strong></td><td>$5,678.90</td></tr>
            </table>
          `,
          { status: 200, headers: { "Content-Type": "text/html" } }
        );
      }

      return new Response(JSON.stringify({ features: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });

    const result = await getAnnualPropertyTax({
      formattedAddress: "1002 1st St NE, Buffalo, MN 55313",
      county: "Wright County",
      state: "MN",
      lat: 45.1827,
      lng: -93.8657,
      purchasePrice: 420000,
      taxYear: 2026
    });

    expect(result.result_type).toBe("county_retrieved");
    expect(result.county).toBe("Wright");
    expect(result.annual_property_tax).toBe(5678.9);
    expect(result.actual_tax_year_used).toBe(2026);
    expect(result.year_match_status).toBe("matched");
    expect(result.source_kind).toBe("county_page");
    expect(result.source_url).toContain("propertyaccess.co.wright.mn.us");
    expect(result.retrieval_notes?.join(" ")).toContain("Wright County tax page");
  });

  it("resolves county-road Wright addresses via Wright GIS parcel lookup and returns authoritative tax", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);

      if (
        url.includes(
          "web.co.wright.mn.us/arcgisserver/rest/services/Wright_County_Parcels/MapServer/1/query"
        )
      ) {
        return new Response(
          JSON.stringify({
            features: [
              {
                attributes: {
                  PID: "201000102400",
                  PHYSADDR: "4626 COUNTY ROAD 6 NW",
                  PHYSCITY: "ANNANDALE",
                  PHYSZIP: 55302,
                  TPYEAR: 2026,
                  OWNNAME: "EXAMPLE OWNER"
                },
                geometry: {
                  x: -94.065842504644,
                  y: 45.219401491442
                }
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (
        url.includes("propertyaccess.co.wright.mn.us/search/commonsearch.aspx?mode=combined") &&
        (!init || init.method === "GET")
      ) {
        return new Response(
          `
            <form>
              <input type="hidden" name="__VIEWSTATE" value="wright-vs" />
              <input type="hidden" name="__VIEWSTATEGENERATOR" value="wright-vg" />
              <input type="hidden" name="__EVENTVALIDATION" value="wright-ev" />
            </form>
          `,
          { status: 200, headers: { "Content-Type": "text/html" } }
        );
      }

      if (
        url.includes("propertyaccess.co.wright.mn.us/search/commonsearch.aspx?mode=combined") &&
        init?.method === "POST"
      ) {
        return new Response(
          `<h2>Object moved to <a href="/Datalets/Datalet.aspx?sIndex=0&amp;idx=1">here</a>.</h2>`,
          { status: 200, headers: { "Content-Type": "text/html" } }
        );
      }

      if (
        url
          .toLowerCase()
          .includes("propertyaccess.co.wright.mn.us/datalets/datalet.aspx?sindex=0&idx=1")
      ) {
        return new Response(
          `
            <table>
              <tr><td>Pay Year:</td><td>2026</td></tr>
              <tr><td><strong>Total Tax Incuding Specials:</strong></td><td>$5,500.12</td></tr>
            </table>
          `,
          { status: 200, headers: { "Content-Type": "text/html" } }
        );
      }

      return new Response(JSON.stringify({ features: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });

    const result = await getAnnualPropertyTax({
      formattedAddress: "4626 County Rd 6 NW, Annandale, MN 55302",
      county: "Wright County",
      state: "MN",
      lat: 45.219401491442,
      lng: -94.065842504644,
      purchasePrice: 700000,
      taxYear: 2026
    });

    expect(result.result_type).toBe("county_retrieved");
    expect(result.annual_property_tax).toBe(5500.12);
    expect(result.actual_tax_year_used).toBe(2026);
    expect(result.year_match_status).toBe("matched");
    expect(result.parcel_id).toBe("201000102400");
    expect(result.source_url).toContain("propertyaccess.co.wright.mn.us/Datalets/Datalet.aspx");
  });

  it("handles Wright PARID datalet redirect flow and parses tax_statement_1 totals", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);

      if (
        url.includes(
          "web.co.wright.mn.us/arcgisserver/rest/services/Wright_County_Parcels/MapServer/1/query"
        )
      ) {
        return new Response(
          JSON.stringify({
            features: [
              {
                attributes: {
                  PID: "118197019020",
                  PHYSADDR: "7427 MARTIN FARMS AVE NE",
                  PHYSCITY: "OTSEGO",
                  PHYSZIP: 55330,
                  TPYEAR: 2025,
                  OWNNAME: "EXAMPLE OWNER"
                },
                geometry: {
                  x: -93.618,
                  y: 45.315
                }
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (
        url.includes("propertyaccess.co.wright.mn.us/search/commonsearch.aspx?mode=combined") &&
        (!init || init.method === "GET")
      ) {
        return new Response(
          `
            <form>
              <input type="hidden" name="__VIEWSTATE" value="wright-vs" />
              <input type="hidden" name="__VIEWSTATEGENERATOR" value="wright-vg" />
              <input type="hidden" name="__EVENTVALIDATION" value="wright-ev" />
            </form>
          `,
          { status: 200, headers: { "Content-Type": "text/html" } }
        );
      }

      if (
        url.includes("propertyaccess.co.wright.mn.us/search/commonsearch.aspx?mode=combined") &&
        init?.method === "POST"
      ) {
        return new Response(
          `<h2>Object moved to <a href="/Datalets/Datalet.aspx?sIndex=2&amp;idx=1">here</a>.</h2>`,
          { status: 200, headers: { "Content-Type": "text/html" } }
        );
      }

      if (
        url
          .toLowerCase()
          .includes("propertyaccess.co.wright.mn.us/datalets/datalet.aspx?sindex=2&idx=1&mode=tax_statement_1")
      ) {
        return new Response(
          `
            <table>
              <tr><td>Pay Year:</td><td>2025</td></tr>
              <tr><td><strong>Total Tax Incuding Specials:</strong></td><td>$4,518.00</td></tr>
            </table>
          `,
          { status: 200, headers: { "Content-Type": "text/html" } }
        );
      }

      return new Response(JSON.stringify({ features: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });

    const result = await getAnnualPropertyTax({
      formattedAddress: "7427 Martin Farms Ave NE, Otsego, MN 55330",
      county: "Wright County",
      state: "MN",
      lat: 45.315,
      lng: -93.618,
      purchasePrice: 500000,
      taxYear: 2026
    });

    expect(result.result_type).toBe("county_retrieved");
    expect(result.parcel_id).toBe("118197019020");
    expect(result.annual_property_tax).toBe(4518);
    expect(result.actual_tax_year_used).toBe(2025);
    expect(result.year_match_status).toBe("latest_available_used");
  });

  it("returns estimated result for non-metro county using county-specific table rate", async () => {
    const result = await getAnnualPropertyTax({
      formattedAddress: "456 Oak Ave, Rochester, MN 55901",
      county: "Olmsted",
      state: "MN",
      purchasePrice: 400000
    });

    expect(result.result_type).toBe("estimated");
    expect(result.annual_property_tax).toBe(4720);
    expect(result.source_kind).toBe("county_rate_table");
    expect(result.confidence).toBe("medium");
    expect(result.strategy_key).toBe("mn-statewide-estimate-v1");
    expect(result.raw_evidence.rate_used).toBe(0.0118);
  });

  it("uses default fallback rate for counties missing from the rate table", async () => {
    const result = await getAnnualPropertyTax({
      formattedAddress: "789 Pine Rd, Pine County, MN",
      county: "Pine",
      state: "MN",
      purchasePrice: 400000
    });

    expect(result.result_type).toBe("estimated");
    expect(result.annual_property_tax).toBe(4880);
    expect(result.source_kind).toBe("fallback");
    expect(result.confidence).toBe("low");
    expect(result.estimation_notes.join(" ")).toContain(
      "used statewide fallback rate"
    );
    expect(result.raw_evidence.used_default_rate).toBe(true);
  });

  it("returns unresolved when county is missing", async () => {
    const result = await getAnnualPropertyTax({
      formattedAddress: "No County Example, MN",
      county: null,
      state: "MN",
      purchasePrice: 400000
    });

    expect(result.result_type).toBe("unresolved");
    expect(result.annual_property_tax).toBeNull();
    expect(result.confidence).toBe("low");
    expect(result.estimation_notes.join(" ")).toContain("County is missing");
  });

  it("returns unresolved for non-Minnesota addresses", async () => {
    const result = await getAnnualPropertyTax({
      formattedAddress: "123 Main St, Miami, FL",
      county: "Miami-Dade",
      state: "FL",
      purchasePrice: 400000
    });

    expect(result.result_type).toBe("unresolved");
    expect(result.annual_property_tax).toBeNull();
    expect(result.estimation_notes.join(" ")).toContain("Minnesota");
  });

  it("returns unresolved when valuation basis is missing", async () => {
    const result = await getAnnualPropertyTax({
      formattedAddress: "123 Main St, Minneapolis, MN",
      county: "Hennepin",
      state: "MN",
      purchasePrice: null
    });

    expect(result.result_type).toBe("unresolved");
    expect(result.annual_property_tax).toBeNull();
    expect(result.estimation_notes.join(" ")).toContain("purchase price is missing");
  });

  it("returns a cached estimate on repeated calls for identical inputs", async () => {
    const input = {
      formattedAddress: "123 Main St, Minneapolis, MN 55401",
      county: "Hennepin County",
      state: "MN",
      purchasePrice: 401111,
      taxYear: 2099
    } as const;

    const first = await getAnnualPropertyTax(input);
    const second = await getAnnualPropertyTax(input);

    expect(first.cache_metadata?.hit).toBe(false);
    expect(second.cache_metadata?.hit).toBe(true);
    expect(first.annual_property_tax).toBe(second.annual_property_tax);
  });
});

describe("computeAnnualPropertyTax compatibility wrapper", () => {
  it("uses user-provided annual tax when available", () => {
    const result = computeAnnualPropertyTax({
      purchasePrice: 400000,
      county: "Hennepin",
      state: "MN",
      actualAnnualTax: 5000
    });

    expect(result.annualTax).toBe(5000);
    expect(result.source).toBe("User Provided");
  });

  it("returns estimated source and details for MN county-rate estimates", () => {
    const result = computeAnnualPropertyTax({
      purchasePrice: 400000,
      county: "Hennepin",
      state: "MN"
    });

    expect(result.annualTax).toBe(5000);
    expect(result.source).toBe("Estimated Using County Rate");
  });

  it("adds warning when default fallback rate is used", () => {
    const result = computeAnnualPropertyTax({
      purchasePrice: 400000,
      county: "Unknown",
      state: "MN"
    });

    expect(result.warnings).toContain(
      "County not recognized; used statewide average rate."
    );
  });

  it("throws for invalid purchase price", () => {
    expect(() =>
      computeAnnualPropertyTax({
        purchasePrice: 0,
        county: "Hennepin",
        state: "MN"
      })
    ).toThrow("Purchase price must be greater than 0.");
  });
});
