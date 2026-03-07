import { NextResponse } from "next/server";
import { z } from "zod";
import { fetchWithTimeout } from "@/lib/server/fetch-timeout";

export const runtime = "nodejs";

const autocompleteSchema = z.object({
  input: z.string().trim().min(3, "Enter at least 3 characters."),
  sessionToken: z.string().trim().optional()
});

type PlacesAutocompleteResponse = {
  suggestions?: Array<{
    placePrediction?: {
      place?: string;
      placeId?: string;
      text?: {
        text?: string;
      };
      structuredFormat?: {
        mainText?: {
          text?: string;
        };
        secondaryText?: {
          text?: string;
        };
      };
    };
  }>;
  error?: {
    message?: string;
    status?: string;
  };
};

function extractPlaceId(prediction: NonNullable<
  PlacesAutocompleteResponse["suggestions"]
>[number]["placePrediction"]): string | null {
  if (!prediction) {
    return null;
  }

  if (prediction.placeId) {
    return prediction.placeId;
  }

  if (prediction.place?.startsWith("places/")) {
    return prediction.place.slice("places/".length);
  }

  return prediction.place ?? null;
}

function extractDescription(prediction: NonNullable<
  PlacesAutocompleteResponse["suggestions"]
>[number]["placePrediction"]): string | null {
  if (!prediction) {
    return null;
  }

  const fullText = prediction.text?.text?.trim();
  if (fullText) {
    return fullText;
  }

  const mainText = prediction.structuredFormat?.mainText?.text?.trim();
  const secondaryText = prediction.structuredFormat?.secondaryText?.text?.trim();

  if (mainText && secondaryText) {
    return `${mainText}, ${secondaryText}`;
  }

  return mainText || secondaryText || null;
}

export async function POST(request: Request) {
  try {
    const payload: unknown = await request.json();
    const parsed = autocompleteSchema.safeParse(payload);

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

    const googleResponse = await fetchWithTimeout(
      "https://places.googleapis.com/v1/places:autocomplete",
      {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask":
            "suggestions.placePrediction.place,suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat"
        },
        body: JSON.stringify({
          input: parsed.data.input,
          includedRegionCodes: ["us"],
          ...(parsed.data.sessionToken
            ? { sessionToken: parsed.data.sessionToken }
            : {})
        })
      },
      { timeoutMs: 9000 }
    );

    const googlePayload =
      (await googleResponse.json()) as PlacesAutocompleteResponse;

    if (!googleResponse.ok) {
      return NextResponse.json(
        {
          error:
            googlePayload.error?.message ||
            "Unable to load address suggestions."
        },
        { status: googleResponse.status >= 400 ? googleResponse.status : 400 }
      );
    }

    const suggestions = (googlePayload.suggestions || [])
      .map((entry) => {
        const placeId = extractPlaceId(entry.placePrediction);
        const description = extractDescription(entry.placePrediction);

        if (!placeId || !description) {
          return null;
        }

        return {
          placeId,
          description
        };
      })
      .filter((entry): entry is { placeId: string; description: string } =>
        Boolean(entry)
      );

    return NextResponse.json({ suggestions }, { status: 200 });
  } catch {
    return NextResponse.json(
      { error: "Unable to load address suggestions." },
      { status: 400 }
    );
  }
}
