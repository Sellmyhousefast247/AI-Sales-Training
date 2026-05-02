import { NextResponse } from "next/server";
import { getGhlClient } from "@/lib/ghl/client";
import { getCurrentProfile } from "@/lib/queries";

export const runtime = "nodejs";

/**
 * Smoke-test the GHL connection. Returns the connected location's name
 * and address so the user can verify they wired up the right account.
 */
export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile?.company_id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const client = getGhlClient();
  if (!client) {
    return NextResponse.json({
      ok: false,
      configured: false,
      hint: "Set GHL_PRIVATE_INTEGRATION_TOKEN and GHL_LOCATION_ID in Vercel env vars.",
    });
  }

  const result = await client.getLocation();
  if (!result.ok) {
    return NextResponse.json({
      ok: false,
      configured: true,
      status: result.status,
      error: result.error,
      hint:
        result.status === 401
          ? "Token is invalid or expired. Re-generate it in GHL → Settings → Private Integrations."
          : result.status === 403
            ? "Token is missing required scopes. Verify View Locations is enabled."
            : "GHL responded with an error — check the message.",
    });
  }

  return NextResponse.json({
    ok: true,
    configured: true,
    location: {
      id: result.location.id,
      name: result.location.name,
      address: result.location.address,
      city: result.location.city,
      state: result.location.state,
      timezone: result.location.timezone,
    },
  });
}
