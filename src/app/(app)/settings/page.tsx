import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/queries";
import { IntegrationsPanel } from "./IntegrationsPanel";

export default async function SettingsPage() {
  const profile = await getCurrentProfile();
  if (!profile?.company_id) redirect("/login");
  if (profile.role !== "company_admin" && profile.role !== "super_admin") redirect("/dashboard");

  const supabase = await createSupabaseServerClient();
  const [{ data: company }, { data: settings }, { data: reps }] = await Promise.all([
    supabase.from("companies").select("name, slug, primary_color, timezone").eq("id", profile.company_id).single(),
    supabase.from("company_settings").select("*").eq("company_id", profile.company_id).maybeSingle(),
    supabase.from("reps").select("id, full_name").eq("company_id", profile.company_id).eq("is_active", true).order("full_name"),
  ]);

  return (
    <div className="space-y-6 p-8">
      <header>
        <h1 className="text-2xl font-semibold">Settings</h1>
      </header>

      <section className="rounded-lg border border-ink-200 bg-white p-5">
        <div className="text-sm font-semibold">Company</div>
        <div className="mt-3 grid grid-cols-2 gap-4 text-sm">
          <Pair k="Name" v={company?.name ?? "—"} />
          <Pair k="Slug" v={company?.slug ?? "—"} />
          <Pair k="Timezone" v={company?.timezone ?? "—"} />
          <Pair k="Brand color" v={company?.primary_color ?? "—"} />
        </div>
      </section>

      <section className="rounded-lg border border-ink-200 bg-white p-5">
        <div className="text-sm font-semibold">Scorecard</div>
        <div className="mt-3 grid grid-cols-2 gap-4 text-sm">
          <Pair k="Rolling window" v={settings?.rolling_window ?? "last_10"} />
          <Pair k="Min calls to leave Tier 1" v={String(settings?.min_calls_to_leave_tier1 ?? 5)} />
          <Pair k="Scorecard preset" v={settings?.scorecard_preset ?? "rei_default"} />
          <Pair k="Monthly token budget" v={settings?.monthly_token_budget ? String(settings.monthly_token_budget) : "Unlimited"} />
        </div>
      </section>

      <IntegrationsPanel reps={reps ?? []} />

      <p className="text-xs text-ink-500">
        Edit UI ships in V2. For MVP, edit settings directly in Supabase or via API.
      </p>
    </div>
  );
}

function Pair({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-ink-500">{k}</div>
      <div className="mt-1">{v}</div>
    </div>
  );
}
