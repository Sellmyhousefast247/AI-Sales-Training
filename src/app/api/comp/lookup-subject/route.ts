import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { resolveSubjectFromProviders } from "@/lib/comping/orchestrator";
import { getCurrentProfile } from "@/lib/queries";

export const runtime = "nodejs";

const Body = z.object({
  address: z.string().min(1),
  city: z.string().optional(),
  state: z.string().length(2).optional(),
  zip: z.string().optional(),
});

/**
 * Pre-fills the calculator with provider-resolved subject specs. Lets
 * the user paste an address and have beds / baths / sqft / year-built
 * auto-populate, with manual overrides still available on the form.
 */
export async function POST(req: Request) {
  const profile = await getCurrentProfile();
  if (!profile?.company_id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Invalid input", issues: err.issues }, { status: 422 });
    }
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const subject = await resolveSubjectFromProviders(parsed);
    if (!subject) {
      return NextResponse.json({ subject: null, configured: false });
    }
    return NextResponse.json({ subject, configured: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "lookup_failed";
    return NextResponse.json({ subject: null, error: message }, { status: 500 });
  }
}
