import { describe, expect, it } from "vitest";
import {
  parseDakotaAnnualTaxFromPdf,
  parseDakotaStatementLinks
} from "./dakotaProvider";

describe("dakota provider helpers", () => {
  it("parses Dakota statement links from history page", () => {
    const links = parseDakotaStatementLinks(`
      <a href='TaxStatement_PDF.aspx?Id=010130077010&Year=2026'>View 2026 Tax Statement PDF</a>
      <a href='TaxStatement_PDF.aspx?Id=010130077010&Year=2025'>View 2025 Tax Statement PDF</a>
    `);

    expect(links).toEqual([
      {
        year: 2026,
        url:
          "https://propertysearch.co.dakota.mn.us/PropertyInformationOnline/TaxStatement_PDF.aspx?Id=010130077010&Year=2026"
      },
      {
        year: 2025,
        url:
          "https://propertysearch.co.dakota.mn.us/PropertyInformationOnline/TaxStatement_PDF.aspx?Id=010130077010&Year=2025"
      }
    ]);
  });

  it("parses annual tax from Dakota statement PDF content", () => {
    const pdfLikeText = `
stream
BT
(Payable 2025)Tj
(Payable 2026)Tj
(14. Your Total Property Tax and Special Assessments)Tj
($4,100.00)Tj
($4,624.00)Tj
ET
endstream
`;
    const parsed = parseDakotaAnnualTaxFromPdf(Buffer.from(pdfLikeText, "latin1"));

    expect(parsed.payableYear).toBe(2026);
    expect(parsed.annualTax).toBe(4624);
    expect(parsed.evidenceLine).toContain("14. Your Total Property Tax and Special Assessments");
  });

  it("prefers total property tax line when Dakota statement also includes an M1PR refund line", () => {
    const pdfLikeText = `
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
`;
    const parsed = parseDakotaAnnualTaxFromPdf(Buffer.from(pdfLikeText, "latin1"));

    expect(parsed.payableYear).toBe(2025);
    expect(parsed.annualTax).toBe(5499.58);
    expect(parsed.evidenceLine).toContain("Total Property Tax and Special Assessments");
  });

  it("returns null when Dakota statement only exposes a zero-dollar refund line", () => {
    const pdfLikeText = `
stream
BT
(2026 Property Tax Statement)Tj
(Payable 2026)Tj
(2.  Use this amount for the special property tax refund on schedule 1 on Form M1PR.)Tj
($0.00)Tj
ET
endstream
`;
    const parsed = parseDakotaAnnualTaxFromPdf(Buffer.from(pdfLikeText, "latin1"));

    expect(parsed.payableYear).toBe(2026);
    expect(parsed.annualTax).toBeNull();
    expect(parsed.evidenceLine).toContain("special property tax refund");
  });
});
