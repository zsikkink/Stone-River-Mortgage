import { NextRequest, NextResponse } from "next/server";
import {
  DAILY_PRICING_AUTH_COOKIE,
  getDailyPricingAuthWarning,
  loginWithCredentials
} from "@/lib/daily-pricing-store";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const authWarning = getDailyPricingAuthWarning();
  if (authWarning) {
    return NextResponse.json({ error: authWarning }, { status: 503 });
  }

  try {
    const payload: unknown = await request.json();
    if (!payload || typeof payload !== "object") {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }

    const candidate = payload as Partial<{ email: string; password: string }>;
    const email = typeof candidate.email === "string" ? candidate.email : "";
    const password =
      typeof candidate.password === "string" ? candidate.password : "";

    if (!email.trim() || !password) {
      return NextResponse.json(
        { error: "Email and password are required." },
        { status: 400 }
      );
    }

    const result = await loginWithCredentials(email, password);
    if (!result) {
      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 401 }
      );
    }

    const response = NextResponse.json({
      ok: true,
      userEmail: result.email
    });

    response.cookies.set({
      name: DAILY_PRICING_AUTH_COOKIE,
      value: result.token,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 12
    });

    return response;
  } catch (error) {
    if (error instanceof Error && error.message) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(
      { error: "Unable to sign in right now." },
      { status: 500 }
    );
  }
}
