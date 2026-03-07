import { describe, expect, it } from "vitest";
import {
  normalizeHennepinParcelId,
  parseHennepinTaxDueHtml
} from "./hennepinProvider";

describe("hennepin provider helpers", () => {
  it("normalizes parcel ids across dashed and non-dashed formats", () => {
    expect(normalizeHennepinParcelId("0211622120025")).toEqual({
      canonicalDigits: "0211622120025",
      displayParcelId: "02-116-22-12-0025"
    });

    expect(normalizeHennepinParcelId("02-116-22-12-0025")).toEqual({
      canonicalDigits: "0211622120025",
      displayParcelId: "02-116-22-12-0025"
    });
  });

  it("parses latest payable year and total payable from hennepin tax page html", () => {
    const html = `
      <div>
        <strong>Property ID number:&nbsp; </strong>
        02-116-22-12-0025
      </div>
      <b style="background-color: #FFCC66">2026 taxes</b>
      <table>
        <tr>
          <td align="left">Total payable</td>
          <td align="right">$8,250.28</td>
        </tr>
      </table>
      <p>This database is updated daily (Monday - Friday) at approximately 9:15 p.m. (CST)</p>
    `;

    const parsed = parseHennepinTaxDueHtml(html);
    expect(parsed.parcelIdDisplay).toBe("02-116-22-12-0025");
    expect(parsed.latestTaxYear).toBe(2026);
    expect(parsed.totalPayable).toBe(8250.28);
    expect(parsed.updateNote).toContain("updated daily");
  });
});
