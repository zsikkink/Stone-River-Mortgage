import { NextRequest, NextResponse } from "next/server";
import {
  DAILY_PRICING_AUTH_COOKIE,
  getPricingRateHistory,
  parsePricingConfigUpdate,
  getSessionEmail,
  updatePricingConfig
} from "@/lib/daily-pricing-store";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get(DAILY_PRICING_AUTH_COOKIE)?.value ?? "";
    const userEmail = token ? await getSessionEmail(token) : null;

    if (!userEmail) {
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 }
      );
    }

    const payload: unknown = await request.json();
    if (!payload || typeof payload !== "object") {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }

    const candidate = payload as Record<string, unknown>;
    const pricingInput =
      typeof candidate.pricing === "object" && candidate.pricing
        ? candidate.pricing
        : payload;

    const parsedPricing = parsePricingConfigUpdate(pricingInput);

    const pricing = await updatePricingConfig({
      pricing: parsedPricing,
      updatedBy: userEmail
    });
    const rateHistory = await getPricingRateHistory();

    return NextResponse.json({ ok: true, pricing, rateHistory });
  } catch (error) {
    if (error instanceof Error && error.message) {
      const status = /login is disabled in production/i.test(error.message)
        ? 503
        : 400;
      return NextResponse.json({ error: error.message }, { status });
    }

    return NextResponse.json(
      { error: "Unable to update pricing right now." },
      { status: 500 }
    );
  }
}
