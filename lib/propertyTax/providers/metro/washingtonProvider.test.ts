import { describe, expect, it } from "vitest";
import {
  extractWashingtonBillReferences,
  extractWashingtonNetTax,
  formatWashingtonParcelId
} from "./washingtonProvider";

describe("washington provider helpers", () => {
  it("formats Washington parcel ids from compact digits", () => {
    expect(formatWashingtonParcelId("1002821240030")).toBe("10.028.21.24.0030");
  });

  it("extracts bill references from payment history payload", () => {
    const references = extractWashingtonBillReferences({
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

    expect(references).toEqual([
      {
        taxYear: 2026,
        billUrl:
          "https://mn-washington.publicaccessnow.com/TaxSearch/Account/BillDetail.aspx?p=10.028.21.24.0030&a=52134&y=2026&n=3151431&b=8659719",
        y: "2026",
        n: "3151431",
        b: "8659719"
      }
    ]);
  });

  it("extracts net tax amount from Washington totals payload", () => {
    const amount = extractWashingtonNetTax({
      grandTotals: [
        { column: "NetTaxAmount", value: "6516.3" }
      ]
    });

    expect(amount).toBe(6516.3);
  });
});
