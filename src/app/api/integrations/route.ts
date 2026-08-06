import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/queries";

const PROVIDERS = ["gohighlevel", "smrtphone", "wavv", "dialpad", "aircall", "zapier", "n8n", "webhook"] as const;

const PostBody = z.object({
  provider: z.enum(PROVIDERS),
  default_rep_id: z.string().uuid().nullable().optional(),
  signing_secret: z.string().max(200).nullable().optional(),
  min_duration_sec: z.number().int().min(0).max(3600).nullable().optional(),
  auto_score: z.boolean().nullable().optional(),
  rotate_token: z.boolean().optional().default(false),
  is_active: z.boolean().optional(),
});

function requireAdmin(profile: any) {
  return profile?.company_id && ["company_admin", "manager", "super_admin"].includes(profile.role);
}

/** GET /api/integrations — list this company's integrations (with webhook URLs). */
export async function GET(req: NextRequest) {
  const profile = await getCurrentProfile();
  if (!requireAdmin(profile)) {
    return NextResponse.json({ error: { code: "unauthorized", message: "Admin only" } }, { status: 401 });
  }
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("integrations")
    .select("id, provider, webhook_token, config_json, is_active, last_sync_at, created_at")
    .eq("company_id", profile!.company_id)
    .order("provider");
  if (error) return NextResponse.json({ error: { code: "internal", message: error.message } }, { status: 500 });

  const origin = req.nextUrl.origin;
  const rows = (data ?? []).map((r: any) => ({
    ...r,
    webhook_url: r.webhook_token ? `${origin}/api/webhooks/${r.provider}?token=${r.webhook_token}` : null,
    config_json: { ...r.config_json, signing_secret: r.config_json?.signing_secret ? "•••" : null },
  }));
  return NextResponse.json({ integrations: rows });
}

/** POST /api/integrations — create or update an integration for a provider. */
export async function POST(req: NextRequest) {
  const profile = await getCurrentProfile();
  if (!requireAdmin(profile)) {
    return NextResponse.json({ error: { code: "unauthorized", message: "Admin only" } }, { status: 401 });
  }

  const parsed = PostBody.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation_failed", message: parsed.error.message } }, { status: 400 });
  }
  const body = parsed.data;
  const admin = createSupabaseAdminClient();

  if (body.default_rep_id) {
    const { data: rep } = await admin
      .from("reps")
      .select("id, company_id")
      .eq("id", body.default_rep_id)
      .maybeSingle();
    if (!rep || rep.company_id !== profile!.company_id) {
      return NextResponse.json({ error: { code: "validation_failed", message: "default_rep_id is not a rep in your company" } }, { status: 400 });
    }
  }

  const { data: existing } = await admin
    .from("integrations")
    .select("id, webhook_token, config_json")
    .eq("company_id", profile!.company_id)
    .eq("provider", body.provider)
    .maybeSingle();

  const token =
    body.rotate_token || !existing?.webhook_token
      ? crypto.randomBytes(24).toString("hex")
      : existing.webhook_token;

  const config = {
    ...(existing?.config_json ?? {}),
    ...(body.default_rep_id !== undefined ? { default_rep_id: body.default_rep_id } : {}),
    ...(body.signing_secret !== undefined ? { signing_secret: body.signing_secret } : {}),
    ...(body.min_duration_sec !== undefined ? { min_duration_sec: body.min_duration_sec } : {}),
    ...(body.auto_score !== undefined ? { auto_score: body.auto_score } : {}),
  };

  const row = {
    company_id: profile!.company_id,
    provider: body.provider,
    webhook_token: token,
    config_json: config,
    ...(body.is_active !== undefined ? { is_active: body.is_active } : {}),
  };

  const { data: saved, error } = existing
    ? await admin.from("integrations").update(row).eq("id", existing.id).select("id, provider, webhook_token, is_active").single()
    : await admin.from("integrations").insert(row).select("id, provider, webhook_token, is_active").single();

  if (error) return NextResponse.json({ error: { code: "internal", message: error.message } }, { status: 500 });

  await admin.from("audit_logs").insert({
    company_id: profile!.company_id,
    actor_user_id: profile!.id,
    action: existing ? "integration.updated" : "integration.created",
    target_table: "integrations",
    target_id: saved.id,
    metadata_json: { provider: body.provider, rotated: body.rotate_token },
  });

  const origin = req.nextUrl.origin;
  return NextResponse.json({
    integration: {
      ...saved,
      webhook_url: `${origin}/api/webhooks/${saved.provider}?token=${saved.webhook_token}`,
    },
  });
}
