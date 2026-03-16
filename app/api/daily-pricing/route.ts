import { NextRequest, NextResponse } from "next/server";
import {
  DAILY_PRICING_AUTH_COOKIE,
  getDailyPricingAnalytics,
  getDailyPricingAuthWarning,
  getPricingRateHistory,
  getDailyPricingStorageDiagnostics,
  getPricingConfig,
  getSessionEmail,
  summarizeDailyPricingAnalytics
} from "@/lib/daily-pricing-store";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const pricing = await getPricingConfig();
    const rateHistory = await getPricingRateHistory();
    const analytics = await getDailyPricingAnalytics();
    const token = request.cookies.get(DAILY_PRICING_AUTH_COOKIE)?.value ?? "";
    const userEmail = token ? await getSessionEmail(token) : null;
    const authWarning = getDailyPricingAuthWarning();
    const storageDiagnostics = getDailyPricingStorageDiagnostics();
    const analyticsSummary = summarizeDailyPricingAnalytics({ analytics });

    return NextResponse.json({
      authenticated: Boolean(userEmail),
      userEmail,
      pricing,
      rateHistory,
      authWarning,
      storage: storageDiagnostics,
      analytics: {
        pdfGeneratedCount: analytics.pdfGeneratedCount,
        ...analyticsSummary
      }
    });
  } catch {
    return NextResponse.json(
      { error: "Unable to load daily pricing settings right now." },
      { status: 500 }
    );
  }
}
