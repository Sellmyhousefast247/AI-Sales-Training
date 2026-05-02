import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/queries";
import { TrainingMaterialForm } from "./TrainingMaterialForm";

export default async function SettingsPage() {
  const profile = await getCurrentProfile();
  if (!profile?.company_id) redirect("/login");
  if (profile.role !== "company_admin" && profile.role !== "super_admin")
    redirect("/dashboard");

  const supabase = await createSupabaseServerClient();
  const [{ data: company }, { data: settings }] = await Promise.all([
    supabase
      .from("companies")
      .select("name, slug, primary_color, timezone")
      .eq("id", profile.company_id)
      .single(),
    supabase
      .from("company_settings")
      .select("*")
      .eq("company_id", profile.company_id)
      .maybeSingle(),
  ]);

  return (
    <div className="min-h-full bg-ink-50">
      <div className="bg-brand-gradient">
        <div className="mx-auto max-w-5xl px-6 py-8 text-white md:px-8 md:py-10">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/60">
            Settings
          </div>
          <h1 className="mt-1 text-3xl font-bold tracking-tight md:text-4xl">
            {company?.name ?? "Workspace"}
          </h1>
          <p className="mt-2 text-sm text-white/80">
            Company settings, scorecard configuration, and the AI training material.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-5xl space-y-6 px-6 py-8 md:px-8">
        <Section accent="ink" title="Company">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <Pair k="Name" v={company?.name ?? "—"} />
            <Pair k="Slug" v={company?.slug ?? "—"} />
            <Pair k="Timezone" v={company?.timezone ?? "—"} />
            <Pair k="Brand color" v={company?.primary_color ?? "—"} />
          </div>
        </Section>

        <Section accent="ink" title="Scorecard">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <Pair k="Rolling window" v={settings?.rolling_window ?? "last_10"} />
            <Pair
              k="Min calls to leave Tier 1"
              v={String(settings?.min_calls_to_leave_tier1 ?? 5)}
            />
            <Pair
              k="Scorecard preset"
              v={settings?.scorecard_preset ?? "rei_default"}
            />
            <Pair
              k="Monthly token budget"
              v={
                settings?.monthly_token_budget
                  ? String(settings.monthly_token_budget)
                  : "Unlimited"
              }
            />
          </div>
          <p className="mt-3 text-[11px] text-ink-500">
            Edit UI for these fields ships in V2.
          </p>
        </Section>

        <Section
          accent="brand"
          title="AI training material"
          hint="The master script + objection handlers + rules + rubric the AI uses to grade every call. Paste your full V3 knowledge base here."
        >
          <TrainingMaterialForm
            initialName={(settings as any)?.script_name ?? ""}
            initialVersion={(settings as any)?.script_version ?? ""}
            initialContent={(settings as any)?.script_content ?? ""}
          />
        </Section>
      </div>
    </div>
  );
}

const ACCENT_BAR: Record<string, string> = {
  brand: "bg-brand-gradient",
  ink: "bg-gradient-to-r from-ink-400 to-ink-700",
};

function Section({
  accent = "ink",
  title,
  hint,
  children,
}: {
  accent?: "brand" | "ink";
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-sm">
      <div className={`h-1.5 w-full ${ACCENT_BAR[accent]}`} />
      <div className="p-5 md:p-6">
        <h2 className="text-base font-semibold text-ink-900">{title}</h2>
        {hint ? <p className="mt-1 text-xs text-ink-500">{hint}</p> : null}
        <div className="mt-4">{children}</div>
      </div>
    </section>
  );
}

function Pair({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-ink-500">{k}</div>
      <div className="mt-1 font-medium text-ink-900">{v}</div>
    </div>
  );
}
