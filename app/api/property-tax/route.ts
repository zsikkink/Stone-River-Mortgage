import { NextResponse } from "next/server";
import { z } from "zod";
import { MINNESOTA_ADDRESS_ONLY_MESSAGE } from "@/lib/constants";
import {
  computeAnnualPropertyTax,
  getAnnualPropertyTax
} from "@/lib/propertyTax/calc";
import { buildPropertyTaxApiResponse } from "@/lib/propertyTax/presentation";

export const runtime = "nodejs";

const propertyTaxRequestSchema = z.object({
  purchasePrice: z.coerce
    .number()
    .positive("Purchase price must be greater than 0."),
  formattedAddress: z.string().trim().nullable().optional(),
  state: z.string().trim().nullable().optional(),
  county: z.string().trim().nullable().optional(),
  lat: z.coerce.number().nullable().optional(),
  lng: z.coerce.number().nullable().optional(),
  taxYear: z.coerce.number().int().positive().nullable().optional(),
  actualAnnualTax: z.coerce.number().positive().nullable().optional()
});

export async function POST(request: Request) {
  try {
    const payload: unknown = await request.json();
    const parsed = propertyTaxRequestSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request payload.", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const normalizedState = parsed.data.state?.trim().toUpperCase() ?? null;
    if (normalizedState !== "MN" && normalizedState !== "MINNESOTA") {
      return NextResponse.json(
        { error: MINNESOTA_ADDRESS_ONLY_MESSAGE },
        { status: 422 }
      );
    }

    if (
      typeof parsed.data.actualAnnualTax === "number" &&
      parsed.data.actualAnnualTax > 0
    ) {
      const userProvidedResult = computeAnnualPropertyTax({
        purchasePrice: parsed.data.purchasePrice,
        county: parsed.data.county ?? null,
        state: parsed.data.state ?? null,
        formattedAddress: parsed.data.formattedAddress ?? null,
        lat: parsed.data.lat ?? null,
        lng: parsed.data.lng ?? null,
        taxYear: parsed.data.taxYear ?? null,
        actualAnnualTax: parsed.data.actualAnnualTax
      });

      return NextResponse.json(userProvidedResult, { status: 200 });
    }

    const detailedEstimate = await getAnnualPropertyTax({
      formattedAddress: parsed.data.formattedAddress ?? null,
      county: parsed.data.county ?? null,
      state: parsed.data.state ?? null,
      lat: parsed.data.lat ?? null,
      lng: parsed.data.lng ?? null,
      purchasePrice: parsed.data.purchasePrice,
      taxYear: parsed.data.taxYear ?? null
    });

    if (
      detailedEstimate.result_type === "unresolved" ||
      typeof detailedEstimate.annual_property_tax !== "number"
    ) {
      console.warn("Property tax estimate unresolved", {
        strategyKey: detailedEstimate.strategy_key,
        county: detailedEstimate.county,
        state: detailedEstimate.state,
        reason:
          detailedEstimate.estimation_notes[
            detailedEstimate.estimation_notes.length - 1
          ] || "unresolved"
      });

      return NextResponse.json(
        {
          error:
            detailedEstimate.estimation_notes[
              detailedEstimate.estimation_notes.length - 1
            ] || "Unable to estimate annual property tax.",
          details: detailedEstimate
        },
        { status: 422 }
      );
    }

    if (detailedEstimate.source_kind === "fallback") {
      console.info("Property tax estimate used default fallback rate", {
        strategyKey: detailedEstimate.strategy_key,
        county: detailedEstimate.county,
        state: detailedEstimate.state
      });
    }

    const result = buildPropertyTaxApiResponse(detailedEstimate);

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(
      { error: "Unable to compute property tax." },
      { status: 400 }
    );
  }
}
