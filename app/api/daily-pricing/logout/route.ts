import { NextRequest, NextResponse } from "next/server";
import {
  DAILY_PRICING_AUTH_COOKIE,
  logoutSession
} from "@/lib/daily-pricing-store";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const token = request.cookies.get(DAILY_PRICING_AUTH_COOKIE)?.value ?? "";
  if (token) {
    await logoutSession(token);
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: DAILY_PRICING_AUTH_COOKIE,
    value: "",
    path: "/",
    expires: new Date(0)
  });

  return response;
}
