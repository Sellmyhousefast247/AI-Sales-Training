import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { getCurrentProfile } from "@/lib/queries";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const Body = z.object({
  script_name: z.string().trim().max(200).optional().nullable(),
  script_version: z.string().trim().max(50).optional().nullable(),
  script_content: z.string().max(500_000).optional().nullable(),
});

/**
 * Save the company's script_name / script_version / script_content.
 *
 * Admin-only. Uses the service-role client to bypass RLS for the write
 * (RLS write requires the user_role claim, which we already check via
 * getCurrentProfile + the explicit admin check below).
 */
export async function POST(req: Request) {
  const profile = await getCurrentProfile();
  if (!profile?.company_id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (profile.role !== "company_admin" && profile.role !== "super_admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: "Invalid input", issues: err.issues },
        { status: 422 }
      );
    }
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  // Upsert company_settings row — most companies will have it from
  // bootstrap, but we cover the case where a row hasn't been created.
  const update: Record<string, unknown> = {
    company_id: profile.company_id,
  };
  if (parsed.script_name !== undefined) update.script_name = parsed.script_name;
  if (parsed.script_version !== undefined)
    update.script_version = parsed.script_version;
  if (parsed.script_content !== undefined)
    update.script_content = parsed.script_content;

  const { error } = await admin
    .from("company_settings")
    .upsert(update, { onConflict: "company_id" });

  if (error) {
    return NextResponse.json(
      { error: "Failed to save", message: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    saved_at: new Date().toISOString(),
    script_chars: parsed.script_content?.length ?? 0,
  });
}
