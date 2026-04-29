import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { getCurrentProfile } from "@/lib/queries";
import { enqueueZip, warmZip } from "@/lib/comping/warmer";

export const runtime = "nodejs";

const bodySchema = z.object({
  zip: z.string().min(3),
  state: z.string().length(2).optional(),
  city: z.string().optional(),
  priority: z.number().int().min(0).max(100).optional(),
  /** When true, run the warm immediately in addition to enqueueing. */
  run_now: z.boolean().optional(),
});

export async function POST(req: Request) {
  const profile = await getCurrentProfile();
  if (!profile?.company_id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  // Manual warm is a write — keep it to managers+ to avoid burning API spend.
  if (!["company_admin", "manager", "super_admin"].includes(profile.role ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Invalid input", issues: err.issues }, { status: 422 });
    }
    throw err;
  }

  const ctx = { companyId: profile.company_id };
  const state = parsed.state?.toUpperCase() ?? null;
  await enqueueZip(ctx, parsed.zip, state, parsed.city ?? null, parsed.priority ?? 0);

  if (parsed.run_now) {
    const result = await warmZip(ctx, parsed.zip, state, parsed.city ?? null);
    return NextResponse.json({ enqueued: true, ran: true, ...result });
  }
  return NextResponse.json({ enqueued: true, ran: false });
}
