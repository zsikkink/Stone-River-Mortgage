import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseWrightTaxDataletHtml,
  wrightCountyTaxProvider
} from "./wrightProvider";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("wright provider helpers", () => {
  it("parses payable year and total tax from Wright tax-statement datalet", () => {
    const parsed = parseWrightTaxDataletHtml(`
      <table>
        <tr><td>Pay Year:</td><td>2026</td></tr>
        <tr><td>Total Tax before Spec Assess:</td><td>$4,625.28</td></tr>
        <tr><td><strong>Total Tax Incuding Specials:</strong></td><td>$4,650.28</td></tr>
      </table>
    `);

    expect(parsed.latestTaxYear).toBe(2026);
    expect(parsed.totalPayable).toBe(4650.28);
    expect(parsed.extractionMethod).toBe("tax_statement_total");
  });

  it("falls back to payment-history row parsing when tax-statement total is unavailable", () => {
    const parsed = parseWrightTaxDataletHtml(`
      <table id="Payment Details">
        <tr>
          <td>Pay Year</td><td>Asmt Year</td><td>Tax</td><td>Total</td>
        </tr>
        <tr>
          <td>2025</td><td>2024</td><td>1,872.00</td><td>1,872.00</td>
        </tr>
        <tr>
          <td>2024</td><td>2023</td><td>2,638.00</td><td>2,638.00</td>
        </tr>
      </table>
    `);

    expect(parsed.latestTaxYear).toBe(2025);
    expect(parsed.totalPayable).toBe(1872);
    expect(parsed.extractionMethod).toBe("payment_history_row");
  });

  it("falls back to address search when the GIS point lookup fails", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);

      if (
        url.includes(
          "web.co.wright.mn.us/arcgisserver/rest/services/Wright_County_Parcels/MapServer/1/query"
        )
      ) {
        return new Response("Not Found", { status: 404 });
      }

      if (
        url.includes(
          "propertyaccess.co.wright.mn.us/search/commonsearch.aspx?mode=combined"
        ) &&
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
        url.includes(
          "propertyaccess.co.wright.mn.us/search/commonsearch.aspx?mode=combined"
        ) &&
        init?.method === "POST"
      ) {
        return new Response(
          `
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
          `,
          { status: 200, headers: { "Content-Type": "text/html" } }
        );
      }

      return new Response(JSON.stringify({ features: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });

    const matches = await wrightCountyTaxProvider.searchProperty({
      formattedAddress: "1002 1st St NE, Buffalo, MN 55313",
      county: "Wright",
      state: "MN",
      lat: 45.1827,
      lng: -93.8657,
      taxYear: 2026
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]?.parcelId).toBe("214005001020");
    expect(matches[0]?.situsAddress).toBe("1002 1ST ST NE, BUFFALO 55313");
  });

  it("relaxes Wright address searches when the exact county query returns no rows", async () => {
    const searchBodies: string[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);

      if (
        url.includes(
          "web.co.wright.mn.us/arcgisserver/rest/services/Wright_County_Parcels/MapServer/1/query"
        )
      ) {
        return new Response("Not Found", { status: 404 });
      }

      if (
        url.includes(
          "propertyaccess.co.wright.mn.us/search/commonsearch.aspx?mode=combined"
        ) &&
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
        url.includes(
          "propertyaccess.co.wright.mn.us/search/commonsearch.aspx?mode=combined"
        ) &&
        init?.method === "POST"
      ) {
        const body = String(init.body ?? "");
        searchBodies.push(body);
        const params = new URLSearchParams(body);

        if (
          params.get("inpNumber") === "4382" &&
          params.get("inpStreet") === "87TH" &&
          params.get("inpSuffix") === "ST" &&
          params.get("inpDirection") === "NE" &&
          params.get("inpZip") === "55362"
        ) {
          return new Response(
            `
              <html>
                <body>
                  <form>
                    <input type="hidden" name="__VIEWSTATE" value="wright-results-vs" />
                    <input type="hidden" name="__VIEWSTATEGENERATOR" value="wright-results-vg" />
                    <input type="hidden" name="__EVENTVALIDATION" value="wright-results-ev" />
                  </form>
                  <div id="errorLbl">Your search did not find any records.</div>
                </body>
              </html>
            `,
            { status: 200, headers: { "Content-Type": "text/html" } }
          );
        }

        if (
          params.get("inpNumber") === "4382" &&
          !params.get("inpStreet") &&
          !params.get("inpZip")
        ) {
          return new Response(
            `
              <html>
                <body>
                  <table id="searchResults">
                    <tbody>
                      <tr onclick="javascript:selectSearchRow('../Datalets/Datalet.aspx?sIndex=0&idx=1')">
                        <td><input value='086:155180004040:2026' /></td>
                        <td><div>155180004040</div></td>
                        <td><div>MATTHEW L &amp; JESSICA L NORTON</div></td>
                        <td><div>4382 87TH ST NE</div></td>
                        <td><div>MONTICELLO</div></td>
                        <td><div>55362</div></td>
                      </tr>
                      <tr onclick="javascript:selectSearchRow('../Datalets/Datalet.aspx?sIndex=0&idx=2')">
                        <td><input value='086:114170005080:2026' /></td>
                        <td><div>114170005080</div></td>
                        <td><div>BRADLEY J GHINTER &amp;</div></td>
                        <td><div>4382 MASON CT NE</div></td>
                        <td><div>ST MICHAEL</div></td>
                        <td><div>55376</div></td>
                      </tr>
                    </tbody>
                  </table>
                </body>
              </html>
            `,
            { status: 200, headers: { "Content-Type": "text/html" } }
          );
        }

        if (
          !params.get("inpNumber") &&
          params.get("inpStreet") === "87TH" &&
          params.get("inpZip") === "55362"
        ) {
          return new Response(
            `
              <html>
                <body>
                  <table id="searchResults">
                    <tbody>
                      <tr onclick="javascript:selectSearchRow('../Datalets/Datalet.aspx?sIndex=0&idx=3')">
                        <td><input value='086:155180004040:2026' /></td>
                        <td><div>155180004040</div></td>
                        <td><div>MATTHEW L &amp; JESSICA L NORTON</div></td>
                        <td><div>4382 87TH ST NE</div></td>
                        <td><div>MONTICELLO</div></td>
                        <td><div>55362</div></td>
                      </tr>
                    </tbody>
                  </table>
                </body>
              </html>
            `,
            { status: 200, headers: { "Content-Type": "text/html" } }
          );
        }

        return new Response("<html><body></body></html>", {
          status: 200,
          headers: { "Content-Type": "text/html" }
        });
      }

      return new Response(JSON.stringify({ features: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });

    const request = {
      formattedAddress: "4382 87th St NE, Monticello, MN 55362",
      county: "Wright",
      state: "MN",
      lat: 45.2769,
      lng: -93.7994,
      taxYear: 2026
    } as const;

    const matches = await wrightCountyTaxProvider.searchProperty(request);

    expect(searchBodies).toHaveLength(4);
    expect(searchBodies[0]).toContain("selSortBy=FULLADD");
    expect(searchBodies[0]).toContain("PageSize=50");
    expect(matches).toHaveLength(2);
    expect(matches.map((match) => match.parcelId)).toEqual([
      "155180004040",
      "114170005080"
    ]);

    const bestMatch = wrightCountyTaxProvider.chooseBestParcel(matches, request);
    expect(bestMatch?.parcelId).toBe("155180004040");
    expect(bestMatch?.situsAddress).toBe("4382 87TH ST NE, MONTICELLO 55362");
  });

  it("treats a direct Wright datalet response as a parcel match", async () => {
    const searchBodies: string[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);

      if (
        url.includes(
          "web.co.wright.mn.us/arcgisserver/rest/services/Wright_County_Parcels/MapServer/1/query"
        )
      ) {
        return new Response("Not Found", { status: 404 });
      }

      if (
        url.includes(
          "propertyaccess.co.wright.mn.us/search/commonsearch.aspx?mode=combined"
        ) &&
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
        url.includes(
          "propertyaccess.co.wright.mn.us/search/commonsearch.aspx?mode=combined"
        ) &&
        init?.method === "POST"
      ) {
        searchBodies.push(String(init.body ?? ""));
        return new Response(
          `
            <html>
              <body>
                <form>
                  <input type="hidden" name="hdPin" value="155180004040" />
                  <input type="hidden" name="hdJur" value="086" />
                  <input type="hidden" name="hdTaxYear" value="2025" />
                  <input type="hidden" name="hdMode" value="PROFILEALL" />
                  <input type="hidden" name="DTLNavigator$hdRecCount" value="1" />
                </form>
              </body>
            </html>
          `,
          { status: 200, headers: { "Content-Type": "text/html" } }
        );
      }

      return new Response(JSON.stringify({ features: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });

    const request = {
      formattedAddress: "4382 87th St NE, Monticello, MN 55362",
      county: "Wright",
      state: "MN",
      lat: 45.2769,
      lng: -93.7994,
      taxYear: 2026
    } as const;

    const matches = await wrightCountyTaxProvider.searchProperty(request);

    expect(searchBodies).toHaveLength(1);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.parcelId).toBe("155180004040");
    expect(matches[0]?.taxYear).toBe(2025);
    expect(matches[0]?.situsAddress).toBe("4382 87th St NE, Monticello, MN 55362");
  });
});
