import { NextResponse } from "next/server";
import { z } from "zod";
import { MINNESOTA_ADDRESS_ONLY_MESSAGE } from "@/lib/constants";
import { fetchWithTimeout } from "@/lib/server/fetch-timeout";

export const runtime = "nodejs";

const verifyAddressSchema = z.object({
  placeId: z.string().trim().min(1, "Place ID is required.")
});

type GooglePlaceDetailsResponse = {
  formattedAddress?: string;
  location?: {
    latitude?: number;
    longitude?: number;
  };
  addressComponents?: Array<{
    longText?: string;
    shortText?: string;
    types?: string[];
  }>;
  error?: {
    message?: string;
    status?: string;
  };
};

type AddressComponent = {
  longText?: string;
  shortText?: string;
  types?: string[];
};

function normalizeCountyName(county: string | null): string | null {
  if (!county) {
    return null;
  }

  return county.replace(/\s+County$/i, "").trim() || null;
}

function getAddressComponent(params: {
  components: AddressComponent[] | undefined;
  type: string;
  useShortName?: boolean;
}): string | null {
  const { components, type, useShortName = false } = params;
  if (!components) {
    return null;
  }

  const component = components.find((candidate) =>
    candidate.types?.includes(type)
  );

  if (!component) {
    return null;
  }

  return useShortName ? component.shortText ?? null : component.longText ?? null;
}

export async function POST(request: Request) {
  try {
    const payload: unknown = await request.json();
    const parsed = verifyAddressSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request payload.", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing GOOGLE_MAPS_API_KEY environment variable." },
        { status: 500 }
      );
    }

    const placeResource = parsed.data.placeId.startsWith("places/")
      ? parsed.data.placeId
      : `places/${parsed.data.placeId}`;
    const endpoint = `https://places.googleapis.com/v1/${placeResource}`;

    const googleResponse = await fetchWithTimeout(endpoint, {
      method: "GET",
      cache: "no-store",
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "formattedAddress,location,addressComponents"
      }
    }, { timeoutMs: 9000 });

    const details = (await googleResponse.json()) as GooglePlaceDetailsResponse;

    if (!googleResponse.ok) {
      if (details.error?.status === "PERMISSION_DENIED") {
        return NextResponse.json(
          {
            error:
              details.error.message ||
              "Google Places request denied. Check GOOGLE_MAPS_API_KEY and Places API (New) enablement."
          },
          { status: 500 }
        );
      }

      return NextResponse.json(
        {
          error:
            "Invalid address. Please select a valid address from suggestions."
        },
        { status: 400 }
      );
    }

    if (
      !details.formattedAddress ||
      typeof details.location?.latitude !== "number" ||
      typeof details.location?.longitude !== "number"
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid address. Please select a valid address from suggestions."
        },
        { status: 400 }
      );
    }

    const countyRaw = getAddressComponent({
      components: details.addressComponents,
      type: "administrative_area_level_2"
    });
    const state = getAddressComponent({
      components: details.addressComponents,
      type: "administrative_area_level_1",
      useShortName: true
    });
    const normalizedState = state?.trim().toUpperCase() ?? null;

    if (normalizedState !== "MN") {
      return NextResponse.json(
        {
          error: MINNESOTA_ADDRESS_ONLY_MESSAGE
        },
        { status: 400 }
      );
    }

    const zip = getAddressComponent({
      components: details.addressComponents,
      type: "postal_code"
    });

    return NextResponse.json(
      {
        ok: true,
        formattedAddress: details.formattedAddress,
        lat: details.location.latitude,
        lng: details.location.longitude,
        county: normalizeCountyName(countyRaw),
        state,
        zip
      },
      { status: 200 }
    );
  } catch {
    return NextResponse.json(
      { error: "Invalid address. Please select a valid address from suggestions." },
      { status: 400 }
    );
  }
}
