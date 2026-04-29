import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { getCurrentProfile } from "@/lib/queries";
import { enqueueZip } from "@/lib/comping/warmer";

export const runtime = "nodejs";

const rowSchema = z.object({
  zip: z.string().min(3),
  state: z.string().length(2).optional(),
  city: z.string().optional(),
  priority: z.number().int().min(0).max(100).optional(),
});

const bodySchema = z.object({
  rows: z.array(rowSchema).min(1).max(500),
});

function isManager(role: string | null | undefined): boolean {
  return ["manager", "company_admin", "super_admin"].includes(role ?? "");
}

export async function POST(req: Request) {
  const profile = await getCurrentProfile();
  if (!profile?.company_id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (!isManager(profile.role)) {
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
  let added = 0;
  const errors: Array<{ zip: string; error: string }> = [];

  for (const row of parsed.rows) {
    try {
      await enqueueZip(
        ctx,
        row.zip.trim(),
        row.state ? row.state.toUpperCase() : null,
        row.city?.trim() ?? null,
        row.priority ?? 0
      );
      added++;
    } catch (err) {
      errors.push({ zip: row.zip, error: (err as Error).message });
    }
  }

  return NextResponse.json({ added, errors });
}
