import { afterEach, describe, expect, it, vi } from "vitest";
import { metroCountyTaxProviders } from "./index";

type MockResponsePayload = Record<string, unknown>;

function createJsonResponse(payload: MockResponsePayload): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function createHtmlResponse(html: string): Response {
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html" }
  });
}

function createPdfResponse(pdfLikeText: string): Response {
  return new Response(Buffer.from(pdfLikeText, "latin1"), {
    status: 200,
    headers: { "Content-Type": "application/pdf" }
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("metro county providers", () => {
  it("implements a concrete provider for each priority metro county", () => {
    const counties = metroCountyTaxProviders.map((provider) => provider.county);
    expect(counties).toEqual([
      "Hennepin",
      "Ramsey",
      "Dakota",
      "Anoka",
      "Washington",
      "Scott",
      "Carver",
      "Wright"
    ]);
  });

  it("searches, chooses parcel, and extracts authoritative annual tax observation for each metro provider", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);

      if (url.includes("/query") && url.includes("where=1%3D1")) {
        const county =
          url.match(/Parcels2025([A-Za-z]+)Points/i)?.[1] ?? "Hennepin";

        const parcelByCounty: Record<string, { objectId: number; parcelId: string }> = {
          Hennepin: { objectId: 101, parcelId: "0211622120025" },
          Ramsey: { objectId: 102, parcelId: "122922340241" },
          Dakota: { objectId: 103, parcelId: "010130077010" },
          Anoka: { objectId: 104, parcelId: "333425210001" },
          Washington: { objectId: 105, parcelId: "0102821240030" },
          Scott: { objectId: 106, parcelId: "030500161" },
          Carver: { objectId: 107, parcelId: "080080600" },
          Wright: { objectId: 108, parcelId: "214005001020" }
        };

        const selected = parcelByCounty[county] ?? parcelByCounty.Hennepin;
        return createJsonResponse({
          features: [
            {
              attributes: {
                OBJECTID: selected.objectId,
                COUNTY_PIN: selected.parcelId,
                STATE_PIN: `MN-${selected.parcelId}`,
                TAX_YEAR: 2025,
                TOTAL_TAX: 4999,
                ANUMBER: 123,
                ST_NAME: "Main",
                ST_POS_TYP: "St",
                POSTCOMM: "MINNEAPOLIS",
                ZIP: "55401",
                CO_NAME: county
              },
              geometry: {
                x: -93.266,
                y: 44.98
              }
            }
          ]
        });
      }

      if (url.includes("www16.co.hennepin.mn.us/taxpayments/taxesdue.jsp")) {
        return createHtmlResponse(`
          <html>
            <body>
              <strong>Property ID number:&nbsp; </strong>02-116-22-12-0025
              <b style="background-color: #FFCC66">2026 taxes</b>
              <table>
                <tr><td>Total payable</td><td>$8,250.28</td></tr>
              </table>
            </body>
          </html>
        `);
      }

      if (
        url.includes(
          "maps.co.ramsey.mn.us/arcgis/rest/services/ParcelData/AttributedData/MapServer/0/query"
        )
      ) {
        return createJsonResponse({
          features: [
            {
              attributes: {
                ParcelID: "122922340241",
                TaxYear: 2026,
                TotalTax: 5412.33,
                SiteAddress: "374 WHEELER ST N",
                SiteCityNameUSPS: "ST PAUL",
                SiteZIP5: "55104"
              }
            }
          ]
        });
      }

      if (url.includes("propertysearch.co.dakota.mn.us/PropertyInformationOnline/TaxStatementHistory.aspx")) {
        return createHtmlResponse(`
          <html>
            <body>
              <a href='TaxStatement_PDF.aspx?Id=010130077010&Year=2026'>View 2026 Tax Statement PDF</a>
            </body>
          </html>
        `);
      }

      if (url.includes("propertysearch.co.dakota.mn.us/PropertyInformationOnline/TaxStatement_PDF.aspx")) {
        return createPdfResponse(`
stream
BT
(2026 Property Tax Statement)Tj
(Payable 2025)Tj
(Payable 2026)Tj
(14. Your Total Property Tax and Special Assessments)Tj
($4,100.00)Tj
($4,624.00)Tj
ET
endstream
`);
      }

      if (url.includes("prtpublicweb.co.anoka.mn.us/search/commonsearch.aspx?mode=combined") && (!init || init.method === "GET")) {
        return createHtmlResponse(`
          <html>
            <body>
              <form>
                <input type="hidden" name="__VIEWSTATE" value="xyz" />
                <input type="hidden" name="__EVENTVALIDATION" value="abc" />
                <input type="submit" name="btAgree" value="Agree" />
              </form>
            </body>
          </html>
        `);
      }

      if (url.includes("prtpublicweb.co.anoka.mn.us/search/Disclaimer.aspx")) {
        return createHtmlResponse("<html><body>Accepted</body></html>");
      }

      if (url.includes("prtpublicweb.co.anoka.mn.us/search/commonsearch.aspx?mode=combined") && init?.method === "POST") {
        return createHtmlResponse(`
          <html>
            <body>
              <a href="../datalets/datalet.aspx?mode=tax_all_ank&sIndex=0&idx=1&LMparent=20">Tax</a>
            </body>
          </html>
        `);
      }

      if (url.includes("prtpublicweb.co.anoka.mn.us/datalets/datalet.aspx?mode=tax_all_ank")) {
        return createHtmlResponse(`
          <table>
            <tr><td>Pay Year</td><td>Total Tax</td></tr>
            <tr><td>2026</td><td>$4,987.65</td></tr>
          </table>
        `);
      }

      if (url.includes("publicaccess.scottcountymn.gov/search/commonsearch.aspx?mode=combined") && (!init || init.method === "GET")) {
        return createHtmlResponse(`
          <html>
            <body>
              <form>
                <input type="hidden" name="__VIEWSTATE" value="xyz" />
                <input type="hidden" name="__EVENTVALIDATION" value="abc" />
                <input type="submit" name="btAgree" value="Agree" />
              </form>
            </body>
          </html>
        `);
      }

      if (url.includes("publicaccess.scottcountymn.gov/search/Disclaimer.aspx")) {
        return createHtmlResponse("<html><body>Accepted</body></html>");
      }

      if (url.includes("publicaccess.scottcountymn.gov/search/commonsearch.aspx?mode=combined") && init?.method === "POST") {
        return createHtmlResponse(`
          <html>
            <body>
              <a href="../datalets/datalet.aspx?mode=payments&sIndex=0&idx=1&LMparent=20">Payments</a>
            </body>
          </html>
        `);
      }

      if (url.includes("publicaccess.scottcountymn.gov/datalets/datalet.aspx?mode=payments")) {
        return createHtmlResponse(`
          <table>
            <tr><td>Pay Year</td><td>Total</td></tr>
            <tr><td>2026</td><td>$6,123.00</td></tr>
          </table>
        `);
      }

      if (url.includes("publicaccess.carvercountymn.gov/search/commonsearch.aspx?mode=combined") && (!init || init.method === "GET")) {
        return createHtmlResponse(`
          <html>
            <body>
              <form>
                <input type="hidden" name="__VIEWSTATE" value="xyz" />
                <input type="hidden" name="__EVENTVALIDATION" value="abc" />
                <input type="submit" name="btAgree" value="Agree" />
              </form>
            </body>
          </html>
        `);
      }

      if (url.includes("publicaccess.carvercountymn.gov/search/Disclaimer.aspx")) {
        return createHtmlResponse("<html><body>Accepted</body></html>");
      }

      if (url.includes("publicaccess.carvercountymn.gov/search/commonsearch.aspx?mode=combined") && init?.method === "POST") {
        return createHtmlResponse(`
          <html>
            <body>
              <a href="../datalets/datalet.aspx?mode=tax_sa_hist_by_year&sIndex=0&idx=1&LMparent=20">Tax History</a>
            </body>
          </html>
        `);
      }

      if (url.includes("publicaccess.carvercountymn.gov/datalets/datalet.aspx?mode=tax_sa_hist_by_year")) {
        return createHtmlResponse(`
          <table>
            <tr><td>Pay Year</td><td>Total Tax including Specials</td></tr>
            <tr><td>2026</td><td>$4,321.00</td></tr>
          </table>
        `);
      }

      if (
        url.includes("propertyaccess.co.wright.mn.us/search/commonsearch.aspx?mode=combined") &&
        (!init || init.method === "GET")
      ) {
        return createHtmlResponse(`
          <html>
            <body>
              <form>
                <input type="hidden" name="__VIEWSTATE" value="wright-vs" />
                <input type="hidden" name="__EVENTVALIDATION" value="wright-ev" />
                <input type="hidden" name="__VIEWSTATEGENERATOR" value="wright-vg" />
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
            </body>
          </html>
        `);
      }

      if (
        url.includes("propertyaccess.co.wright.mn.us/search/commonsearch.aspx?mode=combined") &&
        init?.method === "POST"
      ) {
        const body = typeof init.body === "string" ? init.body : "";
        if (body.includes("mode=PARID")) {
          return createHtmlResponse(`
            <html>
              <body>
                <a href="../datalets/datalet.aspx?mode=tax_statement_1&sIndex=0&idx=1&LMparent=20">Property Tax Information</a>
              </body>
            </html>
          `);
        }

        return createHtmlResponse(`
          <html>
            <body>
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
            </body>
          </html>
        `);
      }

      if (url.toLowerCase().includes("propertyaccess.co.wright.mn.us/datalets/datalet.aspx?mode=tax_statement_1")) {
        return createHtmlResponse(`
          <table>
            <tr><td>Pay Year:</td><td>2026</td></tr>
            <tr><td><strong>Total Tax Incuding Specials:</strong></td><td>$5,678.90</td></tr>
          </table>
        `);
      }

      if (url.includes("mn-washington.publicaccessnow.com/DesktopModules/QuickSearch/API/Module/GetData")) {
        return createJsonResponse({
          items: [
            {
              quickSearchKey: "10.028.21.24.0030",
              fields: {
                ParcelID: "10.028.21.24.0030",
                PrimaryKey: "10.028.21.24.0030",
                AlternateKey: 52134,
                Situs: "1467 THORNHILL LN WOODBURY MN 55125"
              }
            }
          ]
        });
      }

      if (url.includes("mn-washington.publicaccessnow.com/TaxSearch/Account.aspx")) {
        return createHtmlResponse(`
          <html>
            <body>
              <input name="__dnnVariable" value="\`{\`sf_tabId\`:\`51\`}" />
              <input name="__RequestVerificationToken" value="token-account" />
            </body>
          </html>
        `);
      }

      if (url.includes("mn-washington.publicaccessnow.com/API/DataDisplay/DataSources/GetData") && url.includes("_m=449")) {
        return createJsonResponse({
          groups: [
            {
              rows: [
                {
                  values: [
                    { column: "TaxYear", value: "2026" },
                    {
                      column: "BillNumber",
                      hyperlink:
                        "/TaxSearch/Account/BillDetail.aspx?p=10.028.21.24.0030&a=52134&y=2026&n=3151431&b=8659719"
                    }
                  ]
                }
              ]
            }
          ]
        });
      }

      if (url.includes("mn-washington.publicaccessnow.com/TaxSearch/Account/BillDetail.aspx")) {
        return createHtmlResponse(`
          <html>
            <body>
              <input name="__dnnVariable" value="\`{\`sf_tabId\`:\`51\`}" />
              <input name="__RequestVerificationToken" value="token-bill" />
            </body>
          </html>
        `);
      }

      if (url.includes("mn-washington.publicaccessnow.com/API/DataDisplay/DataSources/GetData") && url.includes("_m=471")) {
        return createJsonResponse({
          grandTotals: [
            { column: "NetTaxAmount", value: "7654.32" }
          ]
        });
      }

      return createJsonResponse({ features: [] });
    });

    const expected: Record<string, { amount: number; year: number; sourceKind: string }> = {
      Hennepin: { amount: 8250.28, year: 2026, sourceKind: "official_county" },
      Ramsey: { amount: 5412.33, year: 2026, sourceKind: "county_api" },
      Dakota: { amount: 4624, year: 2026, sourceKind: "county_statement" },
      Anoka: { amount: 4987.65, year: 2026, sourceKind: "county_page" },
      Washington: { amount: 7654.32, year: 2026, sourceKind: "county_api" },
      Scott: { amount: 6123, year: 2026, sourceKind: "county_page" },
      Carver: { amount: 4321, year: 2026, sourceKind: "county_page" },
      Wright: { amount: 5678.9, year: 2026, sourceKind: "county_page" }
    };

    for (const provider of metroCountyTaxProviders) {
      const request = {
        formattedAddress: "123 Main St, Minneapolis, MN 55401",
        county: provider.county,
        state: "MN",
        lat: 44.98,
        lng: -93.266,
        taxYear: 2026
      };

      const matches = await provider.searchProperty(request);
      expect(matches.length).toBeGreaterThan(0);

      const parcel = provider.chooseBestParcel(matches, request);
      expect(parcel).not.toBeNull();

      const observation = await provider.fetchTaxObservation(parcel!, request);
      if (!observation) {
        throw new Error(`Expected observation for provider county: ${provider.county}`);
      }

      const countyExpectation = expected[provider.county];
      expect(observation?.annual_property_tax).toBe(countyExpectation.amount);
      expect(observation?.tax_year).toBe(countyExpectation.year);
      expect(observation?.source_kind).toBe(countyExpectation.sourceKind);
      expect(observation?.source_url).toBeTruthy();
      expect(observation?.retrieval_notes.join(" ")).toContain("Requested tax year");
    }

    expect(fetchMock).toHaveBeenCalled();
  });
});
