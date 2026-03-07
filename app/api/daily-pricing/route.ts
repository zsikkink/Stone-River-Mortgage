import { NextRequest, NextResponse } from "next/server";
import {
  DAILY_PRICING_AUTH_COOKIE,
  getDailyPricingAnalytics,
  getDailyPricingAuthWarning,
  getDailyPricingStorageDiagnostics,
  getPricingConfig,
  getSessionEmail
} from "@/lib/daily-pricing-store";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const pricing = await getPricingConfig();
    const analytics = await getDailyPricingAnalytics();
    const token = request.cookies.get(DAILY_PRICING_AUTH_COOKIE)?.value ?? "";
    const userEmail = token ? await getSessionEmail(token) : null;
    const authWarning = getDailyPricingAuthWarning();
    const storageDiagnostics = getDailyPricingStorageDiagnostics();
    const currentYear = new Date().getFullYear();
    const previousYear = currentYear - 1;
    const currentOrPreviousYearSuccessRate =
      analytics.propertyTaxLookupCount > 0
        ? analytics.propertyTaxCurrentOrPreviousYearRecordFoundCount /
          analytics.propertyTaxLookupCount
        : null;
    const propertyTaxLookupRatesByCounty = Object.fromEntries(
      Object.entries(analytics.propertyTaxLookupOutcomesByCounty).map(
        ([county, outcomes]) => {
          const total =
            outcomes.currentYear +
            outcomes.previousYear +
            outcomes.olderYear +
            outcomes.failed;

          const toRate = (value: number): number => (total > 0 ? value / total : 0);
          return [
            county,
            {
              total,
              currentYearCount: outcomes.currentYear,
              previousYearCount: outcomes.previousYear,
              olderYearCount: outcomes.olderYear,
              failedCount: outcomes.failed,
              currentYearRate: toRate(outcomes.currentYear),
              previousYearRate: toRate(outcomes.previousYear),
              olderYearRate: toRate(outcomes.olderYear),
              failedRate: toRate(outcomes.failed)
            }
          ];
        }
      )
    );

    return NextResponse.json({
      authenticated: Boolean(userEmail),
      userEmail,
      pricing,
      authWarning,
      storage: storageDiagnostics,
      analytics: {
        ...analytics,
        currentYear,
        previousYear,
        currentOrPreviousYearSuccessRate,
        propertyTaxLookupRatesByCounty
      }
    });
  } catch {
    return NextResponse.json(
      { error: "Unable to load daily pricing settings right now." },
      { status: 500 }
    );
  }
}
