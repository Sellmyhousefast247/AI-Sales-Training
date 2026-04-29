"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export interface CompRow {
  id: string;
  source: string;
  source_id: string | null;
  status: "sold" | "active" | "pending";
  price: number;
  list_price: number | null;
  dom_days: number | null;
  close_date: string | null;
  beds: number;
  baths: number;
  sqft: number;
  distance_mi: number;
  condition: "as_is" | "average" | "renovated";
  is_distressed: boolean;
  excluded: boolean;
  notes: string | null;
  remarks: string | null;
}

interface Props {
  analysisId: string;
  comps: CompRow[];
}

type Patch = Partial<
  Pick<
    CompRow,
    "price" | "list_price" | "dom_days" | "condition" | "status" | "distance_mi" | "is_distressed" | "excluded" | "notes"
  >
>;

export function CompsEditor({ analysisId, comps: initial }: Props) {
  const router = useRouter();
  const [comps, setComps] = useState<CompRow[]>(initial);
  const [dirty, setDirty] = useState<Record<string, Patch>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const dirtyCount = Object.keys(dirty).length;
  const includedCount = useMemo(() => comps.filter((c) => !c.excluded).length, [comps]);

  function update<K extends keyof CompRow>(id: string, key: K, value: CompRow[K]) {
    setComps((prev) => prev.map((c) => (c.id === id ? { ...c, [key]: value } : c)));
    setDirty((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), [key]: value as unknown } }));
  }

  function toggleExcluded(id: string) {
    const next = !comps.find((c) => c.id === id)?.excluded;
    update(id, "excluded", next);
  }

  function reset() {
    setComps(initial);
    setDirty({});
    setErr(null);
  }

  async function saveAll() {
    setBusy(true);
    setErr(null);
    try {
      for (const [id, patch] of Object.entries(dirty)) {
        const res = await fetch(`/api/comp/comps/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error ?? `Failed to save comp ${id}`);
        }
      }
      setDirty({});
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
      return;
    }
    setBusy(false);
  }

  async function recompute() {
    setBusy(true);
    setErr(null);
    if (dirtyCount > 0) {
      try {
        for (const [id, patch] of Object.entries(dirty)) {
          const res = await fetch(`/api/comp/comps/${id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(patch),
          });
          if (!res.ok) {
            const j = await res.json().catch(() => ({}));
            throw new Error(j.error ?? `Failed to save comp ${id}`);
          }
        }
        setDirty({});
      } catch (e) {
        setErr((e as Error).message);
        setBusy(false);
        return;
      }
    }
    const res = await fetch(`/api/comp/${analysisId}/recompute`, { method: "POST" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error ?? "Failed to recompute");
      setBusy(false);
      return;
    }
    const j = (await res.json()) as { id: string };
    router.push(`/comping/${j.id}`);
    router.refresh();
  }

  if (comps.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-ink-300 bg-white p-8 text-center text-sm text-ink-500">
        No comps recorded for this subject.
      </div>
    );
  }

  return (
    <section className="rounded-lg border border-ink-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200 px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold">Comps</h2>
          <p className="text-xs text-ink-500">
            {includedCount} of {comps.length} included.
            {dirtyCount > 0 ? <> {dirtyCount} unsaved change{dirtyCount === 1 ? "" : "s"}.</> : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={reset}
            disabled={busy || dirtyCount === 0}
            className="rounded-md border border-ink-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-ink-100 disabled:opacity-40"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={saveAll}
            disabled={busy || dirtyCount === 0}
            className="rounded-md border border-ink-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-ink-100 disabled:opacity-40"
          >
            Save changes
          </button>
          <button
            type="button"
            onClick={recompute}
            disabled={busy}
            className="rounded-md bg-ink-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-ink-800 disabled:opacity-50"
          >
            {busy ? "Working…" : dirtyCount > 0 ? "Save & recompute" : "Recompute"}
          </button>
        </div>
      </header>

      {err ? (
        <div className="border-b border-red-200 bg-red-50 px-5 py-2 text-xs text-red-900">{err}</div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-ink-50 text-left uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-3 py-2">Inc</th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Price</th>
              <th className="px-3 py-2 text-right">List $</th>
              <th className="px-3 py-2 text-right">DOM</th>
              <th className="px-3 py-2 text-right">Beds</th>
              <th className="px-3 py-2 text-right">Baths</th>
              <th className="px-3 py-2 text-right">Sqft</th>
              <th className="px-3 py-2 text-right">$/sqft</th>
              <th className="px-3 py-2 text-right">Dist mi</th>
              <th className="px-3 py-2">Cond.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {comps.map((c) => {
              const ppsf = c.price > 0 && c.sqft > 0 ? Math.round(c.price / c.sqft) : null;
              return (
                <tr key={c.id} className={c.excluded ? "bg-ink-50 text-ink-400" : ""}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={!c.excluded}
                      onChange={() => toggleExcluded(c.id)}
                      disabled={busy}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-ink-700">{c.source}</div>
                    <div className="text-[10px] text-ink-400">{c.source_id ?? "—"}</div>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={c.status}
                      onChange={(e) => update(c.id, "status", e.target.value as CompRow["status"])}
                      className={cellSelect}
                      disabled={busy}
                    >
                      <option value="sold">sold</option>
                      <option value="active">active</option>
                      <option value="pending">pending</option>
                    </select>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      value={c.price || 0}
                      onChange={(e) => update(c.id, "price", Number(e.target.value))}
                      className={`${cellInput} text-right`}
                      disabled={busy}
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      value={c.list_price ?? ""}
                      onChange={(e) =>
                        update(c.id, "list_price", e.target.value === "" ? null : Number(e.target.value))
                      }
                      className={`${cellInput} text-right`}
                      placeholder="—"
                      disabled={busy}
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      value={c.dom_days ?? ""}
                      onChange={(e) =>
                        update(c.id, "dom_days", e.target.value === "" ? null : Number(e.target.value))
                      }
                      className={`${cellInput} text-right`}
                      placeholder="—"
                      disabled={busy}
                    />
                  </td>
                  <td className="px-3 py-2 text-right">{c.beds}</td>
                  <td className="px-3 py-2 text-right">{c.baths}</td>
                  <td className="px-3 py-2 text-right">{c.sqft.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-ink-500">{ppsf ? `$${ppsf}` : "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      step={0.05}
                      value={c.distance_mi}
                      onChange={(e) => update(c.id, "distance_mi", Number(e.target.value))}
                      className={`${cellInput} text-right`}
                      disabled={busy}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={c.condition}
                      onChange={(e) => update(c.id, "condition", e.target.value as CompRow["condition"])}
                      className={cellSelect}
                      disabled={busy}
                    >
                      <option value="as_is">as_is</option>
                      <option value="average">average</option>
                      <option value="renovated">renovated</option>
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const cellInput =
  "w-24 rounded border border-ink-200 bg-white px-2 py-1 text-xs focus:border-ink-500 focus:outline-none focus:ring-1 focus:ring-ink-500";
const cellSelect =
  "rounded border border-ink-200 bg-white px-1 py-1 text-xs focus:border-ink-500 focus:outline-none focus:ring-1 focus:ring-ink-500";
