import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile, getRepsBasic } from "@/lib/queries";
import { TierBadge } from "@/components/TierBadge";
import { formatScore } from "@/lib/utils";
import type { Tier } from "@/lib/types";
import { AddRepForm } from "./AddRepForm";

export default async function RepsPage() {
  const profile = await getCurrentProfile();
  if (!profile?.company_id) redirect("/login");
  const reps = await getRepsBasic(profile.company_id);
  const canManage = profile.role === "company_admin" || profile.role === "manager" || profile.role === "super_admin";

  return (
    <div className="space-y-6 p-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Reps</h1>
      </header>

      {canManage ? <AddRepForm /> : null}

      <div className="overflow-hidden rounded-lg border border-ink-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Tier</th>
              <th className="px-4 py-3 text-right">Avg score</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {reps.map((r) => (
              <tr key={r.id} className="hover:bg-ink-50">
                <td className="px-4 py-3 font-medium">
                  <Link href={`/reps/${r.id}`} className="hover:underline">{r.full_name}</Link>
                </td>
                <td className="px-4 py-3"><TierBadge tier={(r.current_tier ?? 1) as Tier} /></td>
                <td className="px-4 py-3 text-right font-mono tabular-nums">
                  {r.current_avg_score != null ? formatScore(Number(r.current_avg_score)) : "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/reps/${r.id}`} className="text-ink-500 hover:text-ink-900">View →</Link>
                </td>
              </tr>
            ))}
            {reps.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-12 text-center text-ink-500">No reps yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
