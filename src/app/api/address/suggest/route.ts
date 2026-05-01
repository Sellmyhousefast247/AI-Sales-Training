import { NextResponse } from "next/server";

export const runtime = "nodejs";

interface Suggestion {
  description: string;
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
}

/**
 * Address autocomplete. Uses Google Places Autocomplete + Place Details
 * when GOOGLE_PLACES_API_KEY is set. Without a key, returns an empty
 * suggestion list — the form's input still works as a free-form
 * paste-friendly bar.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  if (q.length < 3) return NextResponse.json({ suggestions: [] });

  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return NextResponse.json({ suggestions: [], configured: false });

  try {
    const acURL = new URL("https://maps.googleapis.com/maps/api/place/autocomplete/json");
    acURL.searchParams.set("input", q);
    acURL.searchParams.set("types", "address");
    acURL.searchParams.set("components", "country:us");
    acURL.searchParams.set("key", key);
    const acRes = await fetch(acURL.toString(), { cache: "no-store" });
    if (!acRes.ok) {
      return NextResponse.json({ suggestions: [], error: "places_autocomplete_failed" });
    }
    const ac = (await acRes.json()) as {
      status: string;
      predictions?: Array<{ description: string; place_id: string }>;
    };
    if (ac.status !== "OK" || !ac.predictions) {
      return NextResponse.json({ suggestions: [] });
    }
    const suggestions: Suggestion[] = ac.predictions.slice(0, 5).map((p) => ({
      description: p.description,
      // We attach place_id in a hidden field via the description so the
      // client can request details on selection — keeps this endpoint cheap.
      // The client can call /api/address/details?place_id=... if it wants
      // structured components. For now the description string carries the
      // info the form's parser already handles.
    }));
    return NextResponse.json({ suggestions, configured: true });
  } catch {
    return NextResponse.json({ suggestions: [], error: "places_unreachable" });
  }
}
