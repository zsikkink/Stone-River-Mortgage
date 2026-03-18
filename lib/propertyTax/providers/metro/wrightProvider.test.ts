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
});
