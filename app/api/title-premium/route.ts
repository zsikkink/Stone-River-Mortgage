import { NextResponse } from "next/server";
import { z } from "zod";
import { calculateAprAnnual } from "@/lib/apr/calc";
import { getLoanAmountBoundsMessage } from "@/lib/loanAmount";
import { calculateTitlePremiums } from "@/lib/titlePremium/calc";

export const runtime = "nodejs";

const titlePremiumRequestSchema = z.object({
  purchasePrice: z.coerce
    .number()
    .positive("Purchase price must be greater than 0."),
  loanAmount: z.coerce.number().nonnegative("Loan amount must be 0 or greater."),
  expandedOwnersCoverage: z.boolean().optional().default(false),
  refinance: z.boolean().optional().default(false),
  simultaneousIssue: z.boolean().optional().default(false),
  termMonths: z.coerce.number().int().positive().optional().default(360),
  noteRateAnnual: z.coerce.number().positive().optional().default(0.05625),
  pointsPercent: z.coerce.number().nonnegative().optional().default(0.09),
  underwritingFee: z.coerce.number().nonnegative().optional().default(1250),
  perDiemDays: z.coerce.number().int().min(1).optional().default(1)
});

export async function POST(request: Request) {
  try {
    const payload: unknown = await request.json();
    const parsed = titlePremiumRequestSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid request payload.",
          issues: parsed.error.issues
        },
        { status: 400 }
      );
    }

    const loanBoundsMessage = getLoanAmountBoundsMessage(parsed.data.loanAmount);
    if (loanBoundsMessage) {
      return NextResponse.json({ error: loanBoundsMessage }, { status: 400 });
    }

    if (parsed.data.loanAmount === 0 && parsed.data.simultaneousIssue) {
      return NextResponse.json(
        { error: "Simultaneous issue cannot be selected when loan amount is 0." },
        { status: 400 }
      );
    }

    const result = calculateTitlePremiums(parsed.data);
    const aprResult = calculateAprAnnual({
      termMonths: parsed.data.termMonths,
      noteRateAnnual: parsed.data.noteRateAnnual,
      loanAmount: parsed.data.loanAmount,
      pointsPercent: parsed.data.pointsPercent,
      underwritingFee: parsed.data.underwritingFee,
      perDiemDays: parsed.data.perDiemDays
    });

    return NextResponse.json(
      {
        ...result,
        aprAnnual: aprResult.aprAnnual,
        aprPercent: aprResult.aprPercent,
        aprDetails: {
          payment: aprResult.payment,
          pointsFee: aprResult.pointsFee,
          perDiemInterest: aprResult.perDiemInterest,
          amountFinanced: aprResult.amountFinanced,
          termMonths: parsed.data.termMonths,
          noteRateAnnual: parsed.data.noteRateAnnual,
          pointsPercent: parsed.data.pointsPercent,
          underwritingFee: parsed.data.underwritingFee,
          perDiemDays: parsed.data.perDiemDays
        }
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(
      { error: "Unable to calculate title premiums." },
      { status: 400 }
    );
  }
}
