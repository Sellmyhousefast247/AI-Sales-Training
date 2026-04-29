"use client";

import { useRouter, useSearchParams } from "next/navigation";

interface UserOption {
  id: string;
  full_name: string | null;
  email: string;
}
interface TeamOption {
  id: string;
  name: string;
}

interface Props {
  reps: UserOption[];
  teams: TeamOption[];
  selectedRep: string | null;
  selectedTeam: string | null;
}

export function CompingFilterBar({ reps, teams, selectedRep, selectedTeam }: Props) {
  const router = useRouter();
  const params = useSearchParams();

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    // Changing a filter invalidates the current page — reset to 1.
    next.delete("page");
    router.push(`/comping?${next.toString()}`);
  }

  function reset() {
    router.push("/comping");
  }

  const hasFilters = !!(selectedRep || selectedTeam);

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-ink-200 bg-white p-3">
      <Field label="Rep">
        <select
          value={selectedRep ?? ""}
          onChange={(e) => setParam("rep", e.target.value)}
          className={selectCls}
        >
          <option value="">All reps</option>
          {reps.map((r) => (
            <option key={r.id} value={r.id}>
              {r.full_name ?? r.email}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Team">
        <select
          value={selectedTeam ?? ""}
          onChange={(e) => setParam("team", e.target.value)}
          className={selectCls}
        >
          <option value="">All teams</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </Field>
      {hasFilters ? (
        <button
          type="button"
          onClick={reset}
          className="ml-auto rounded-md border border-ink-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-ink-100"
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );
}

const selectCls =
  "rounded-md border border-ink-300 bg-white px-2 py-1 text-sm focus:border-ink-500 focus:outline-none focus:ring-1 focus:ring-ink-500";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2 text-xs text-ink-700">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}
