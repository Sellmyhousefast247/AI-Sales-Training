import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { getCurrentProfile } from "@/lib/queries";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const patchSchema = z
  .object({
    priority: z.number().int().min(0).max(100).optional(),
    state: z.string().length(2).optional(),
    city: z.string().nullable().optional(),
  })
  .strict();

function isManager(role: string | null | undefined): boolean {
  return ["manager", "company_admin", "super_admin"].includes(role ?? "");
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const profile = await getCurrentProfile();
  if (!profile?.company_id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (!isManager(profile.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
    .from("comp_warm_queue")
    .update({
      ...patch,
      state: patch.state ? patch.state.toUpperCase() : undefined,
    })
    .eq("id", id)
    .eq("company_id", profile.company_id)
    .select("id")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Queue row not found" }, { status: 404 });
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
  if (!isManager(profile.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("comp_warm_queue")
    .delete()
    .eq("id", id)
    .eq("company_id", profile.company_id)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Queue row not found" }, { status: 404 });
  return NextResponse.json({ id: data.id });
}
