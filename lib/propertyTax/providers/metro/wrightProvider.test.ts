import { describe, expect, it } from "vitest";
import { parseWrightTaxDataletHtml } from "./wrightProvider";

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
});
