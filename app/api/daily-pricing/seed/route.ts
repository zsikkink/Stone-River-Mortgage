import { NextResponse } from "next/server";
import {
  getDailyPricingAuthWarning,
  getDailyPricingStorageDiagnostics,
  getPricingConfig,
  seededCredentialsUsingDefaults
} from "@/lib/daily-pricing-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const isProduction = process.env.NODE_ENV === "production";
  const seedToken = process.env.DAILY_PRICING_SEED_TOKEN;
  if (isProduction) {
    if (!seedToken) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }

    const url = new URL(request.url);
    const providedToken =
      request.headers.get("x-seed-token") || url.searchParams.get("token");
    if (!providedToken || providedToken !== seedToken) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
  }

  // Reading config forces store creation and seeded user initialization.
  await getPricingConfig();
  const authWarning = getDailyPricingAuthWarning();
  return NextResponse.json({
    ok: true,
    seededCredentialsUsingDefaults: seededCredentialsUsingDefaults(),
    authWarning,
    storage: getDailyPricingStorageDiagnostics()
  });
}
