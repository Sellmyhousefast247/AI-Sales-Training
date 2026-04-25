import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/queries";
import { formatDateTime } from "@/lib/utils";

export default async function CoachingPage() {
  const profile = await getCurrentProfile();
  if (!profile?.company_id) redirect("/login");
  if (profile.role === "rep") redirect("/dashboard");

  const supabase = await createSupabaseServerClient();
  const since = new Date(); since.setDate(since.getDate() - 7);

  const { data: notes } = await supabase
    .from("coaching_notes")
    .select(`
      id, kind, body, created_at, is_acknowledged,
      reps:rep_id (id, full_name)
    `)
    .eq("company_id", profile.company_id)
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <div className="space-y-6 p-8">
      <header>
        <h1 className="text-2xl font-semibold">Coaching</h1>
        <p className="text-sm text-ink-500">Last 7 days</p>
      </header>

      <div className="space-y-3">
        {(notes ?? []).map((n: any) => (
          <article key={n.id} className="rounded-lg border border-ink-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">{n.reps?.full_name ?? "Unknown rep"}</div>
              <div className="text-xs text-ink-500">{formatDateTime(n.created_at)} · {n.kind.replace("_", " ")}</div>
            </div>
            <div className="mt-2 whitespace-pre-wrap text-sm text-ink-800">{n.body}</div>
          </article>
        ))}
        {(notes?.length ?? 0) === 0 && (
          <div className="rounded-lg border border-ink-200 bg-white p-8 text-center text-sm text-ink-500">
            No coaching notes yet. Score a call to generate coaching.
          </div>
        )}
      </div>
    </div>
  );
}
