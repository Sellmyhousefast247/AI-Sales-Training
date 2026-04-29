import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/queries";
import { WarmQueueTable, type QueueRow } from "./WarmQueueTable";

export default async function WarmQueuePage() {
  const profile = await getCurrentProfile();
  if (!profile?.company_id) redirect("/login");
  if (!["manager", "company_admin", "super_admin"].includes(profile.role ?? "")) {
    redirect("/comping");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("comp_warm_queue")
    .select("id, zip, state, city, priority, last_warmed_at, last_error, queued_at")
    .eq("company_id", profile.company_id)
    .order("last_warmed_at", { ascending: true, nullsFirst: true })
    .order("priority", { ascending: false });

  const rows = (data ?? []) as QueueRow[];

  return (
    <div className="space-y-6 p-8">
      <header>
        <Link href="/comping" className="text-xs text-ink-500 hover:text-ink-900">
          ← Back to comping
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Cache warm queue</h1>
        <p className="text-sm text-ink-500">
          Zips listed here get their market signals (schools, crime, lot defects)
          pre-fetched on a 30-minute cron so live calculator runs return instantly.
        </p>
      </header>

      {error ? (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          Failed to load queue: {error.message}
        </div>
      ) : null}

      <WarmQueueTable initialRows={rows} />
    </div>
  );
}
