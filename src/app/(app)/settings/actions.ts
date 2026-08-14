"use server";

import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/queries";
import { revalidatePath } from "next/cache";

/**
 * Save the company reference script (company_settings.script_content). This text
 * is fed to the scorer as <COMPANY_SCRIPT> and is the source of truth for how
 * calls are graded against the Road to a Deal. Admins only.
 */
export async function saveScriptContent(
  content: string
): Promise<{ ok: boolean; error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile?.company_id) return { ok: false, error: "Not signed in" };
  if (profile.role !== "company_admin" && profile.role !== "super_admin") {
    return { ok: false, error: "Admins only" };
  }

  const admin = createSupabaseAdminClient();
  const companyId = profile.company_id;

  const { data: existing } = await admin
    .from("company_settings")
    .select("company_id")
    .eq("company_id", companyId)
    .maybeSingle();

  const { error } = existing
    ? await admin
        .from("company_settings")
        .update({ script_content: content })
        .eq("company_id", companyId)
    : await admin
        .from("company_settings")
        .insert({ company_id: companyId, script_content: content });

  if (error) return { ok: false, error: error.message };

  // New scorecards pick up the change immediately; refresh the settings view.
  revalidatePath("/settings");
  revalidatePath("/calls");
  return { ok: true };
}
