import { describe, expect, it } from "vitest";
import {
  isCloudflareChallengeResponse,
  normalizeRamseyParcelId,
  parseRamseyEgovTaxFromHtml,
  parseRamseyTaxFromHtml
} from "./ramseyProvider";

describe("ramsey provider helpers", () => {
  it("normalizes Ramsey parcel ids", () => {
    expect(normalizeRamseyParcelId("12-2922-34024-1")).toBe("122922340241");
    expect(normalizeRamseyParcelId("122922340241")).toBe("122922340241");
  });

  it("parses latest tax year and total payable from Ramsey html", () => {
    const parsed = parseRamseyTaxFromHtml(`
      <html>
        <body>
          <div>Payable 2025</div>
          <div>Payable 2026</div>
          <div>Total payable $5,412.33</div>
        </body>
      </html>
    `);

    expect(parsed.latestTaxYear).toBe(2026);
    expect(parsed.totalPayable).toBe(5412.33);
  });

  it("parses current-year total due from Ramsey eGov html", () => {
    const parsed = parseRamseyEgovTaxFromHtml(`
      <html>
        <body>
          <h2>Current Tax Year</h2>
          <table>
            <tr><td>Total Amount Due:</td><td>$6,694.00</td></tr>
          </table>
          <table>
            <tr><th>2026 Payable</th><th>2025 Payable</th></tr>
          </table>
        </body>
      </html>
    `);

    expect(parsed.latestTaxYear).toBe(2026);
    expect(parsed.totalPayable).toBe(6694);
  });

  it("detects cloudflare challenge pages", () => {
    const response = new Response("", {
      status: 200,
      headers: {
        "cf-mitigated": "challenge"
      }
    });

    expect(isCloudflareChallengeResponse(response, "<html>ok</html>")).toBe(true);
    expect(
      isCloudflareChallengeResponse(new Response("<html></html>"), "<title>Just a moment...</title>")
    ).toBe(true);
  });
});
