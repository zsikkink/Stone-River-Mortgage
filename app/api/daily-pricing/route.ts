import { NextRequest, NextResponse } from "next/server";
import {
  DAILY_PRICING_AUTH_COOKIE,
  getDailyPricingAuthWarning,
  getDailyPricingStorageDiagnostics,
  getPricingConfig,
  getSessionEmail
} from "@/lib/daily-pricing-store";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const pricing = await getPricingConfig();
    const token = request.cookies.get(DAILY_PRICING_AUTH_COOKIE)?.value ?? "";
    const userEmail = token ? await getSessionEmail(token) : null;
    const authWarning = getDailyPricingAuthWarning();
    const storageDiagnostics = getDailyPricingStorageDiagnostics();

    return NextResponse.json({
      authenticated: Boolean(userEmail),
      userEmail,
      pricing,
      authWarning,
      storage: storageDiagnostics
    });
  } catch {
    return NextResponse.json(
      { error: "Unable to load daily pricing settings right now." },
      { status: 500 }
    );
  }
}
