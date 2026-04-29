import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { getCurrentProfile } from "@/lib/queries";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const patchSchema = z
  .object({
    price: z.number().nonnegative().optional(),
    list_price: z.number().positive().nullable().optional(),
    dom_days: z.number().int().nonnegative().nullable().optional(),
    condition: z.enum(["as_is", "average", "renovated"]).optional(),
    status: z.enum(["sold", "active", "pending"]).optional(),
    distance_mi: z.number().nonnegative().optional(),
    is_distressed: z.boolean().optional(),
    excluded: z.boolean().optional(),
    notes: z.string().nullable().optional(),
  })
  .strict();

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const profile = await getCurrentProfile();
  if (!profile?.company_id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let patch: z.infer<typeof patchSchema>;
  try {
    patch = patchSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Invalid input", issues: err.issues }, { status: 422 });
    }
    throw err;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("comp_records")
    .update({
      ...patch,
      overridden_by: profile.id,
      overridden_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("company_id", profile.company_id)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Comp not found" }, { status: 404 });
  }
  return NextResponse.json({ id: data.id });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const profile = await getCurrentProfile();
  if (!profile?.company_id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const { id } = await params;

  // Soft delete via excluded=true so analyses retain auditability.
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("comp_records")
    .update({
      excluded: true,
      overridden_by: profile.id,
      overridden_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("company_id", profile.company_id)
    .select("id")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Comp not found" }, { status: 404 });
  return NextResponse.json({ id: data.id });
}
