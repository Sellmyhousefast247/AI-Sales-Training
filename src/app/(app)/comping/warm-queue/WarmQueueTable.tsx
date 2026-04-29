"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export interface QueueRow {
  id: string;
  zip: string;
  state: string | null;
  city: string | null;
  priority: number;
  last_warmed_at: string | null;
  last_error: string | null;
  queued_at: string;
}

export function WarmQueueTable({ initialRows }: { initialRows: QueueRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<QueueRow[]>(initialRows);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Add-zip form state
  const [zip, setZip] = useState("");
  const [stateAbbr, setStateAbbr] = useState("");
  const [city, setCity] = useState("");
  const [priority, setPriority] = useState("0");
  const [runNow, setRunNow] = useState(false);

  const dueCount = useMemo(
    () => rows.filter((r) => !r.last_warmed_at || stale(r.last_warmed_at)).length,
    [rows]
  );

  function setRow(id: string, patch: Partial<QueueRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  async function addZip(e: React.FormEvent) {
    e.preventDefault();
    if (!zip.trim()) {
      setErr("Zip is required.");
      return;
    }
    setBusy("add");
    setErr(null);
    const res = await fetch("/api/comp/warm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        zip: zip.trim(),
        state: stateAbbr.trim().toUpperCase() || undefined,
        city: city.trim() || undefined,
        priority: Number(priority) || 0,
        run_now: runNow,
      }),
    });
    setBusy(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error ?? "Failed to enqueue.");
      return;
    }
    setZip("");
    setStateAbbr("");
    setCity("");
    setPriority("0");
    setRunNow(false);
    router.refresh();
  }

  async function savePriority(id: string, value: number) {
    setBusy(id);
    setErr(null);
    const res = await fetch(`/api/comp/warm/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ priority: value }),
    });
    setBusy(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error ?? "Failed to update priority.");
    }
  }

  async function runNowFor(row: QueueRow) {
    setBusy(row.id);
    setErr(null);
    const res = await fetch("/api/comp/warm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        zip: row.zip,
        state: row.state ?? undefined,
        city: row.city ?? undefined,
        priority: row.priority,
        run_now: true,
      }),
    });
    setBusy(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error ?? "Failed to run.");
      return;
    }
    router.refresh();
  }

  async function deleteRow(id: string) {
    if (!confirm("Delete this zip from the warm queue?")) return;
    setBusy(id);
    setErr(null);
    const res = await fetch(`/api/comp/warm/${id}`, { method: "DELETE" });
    setBusy(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error ?? "Failed to delete.");
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  return (
    <div className="space-y-6">
      {/* Add zip */}
      <section className="rounded-lg border border-ink-200 bg-white p-5">
        <h2 className="text-sm font-semibold">Add a zip</h2>
        <form onSubmit={addZip} className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-6">
          <Field label="Zip" required>
            <input
              required
              value={zip}
              onChange={(e) => setZip(e.target.value)}
              className={inputCls}
              placeholder="78701"
            />
          </Field>
          <Field label="State">
            <input
              maxLength={2}
              value={stateAbbr}
              onChange={(e) => setStateAbbr(e.target.value)}
              className={inputCls}
              placeholder="TX"
            />
          </Field>
          <Field label="City">
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Priority">
            <input
              type="number"
              min={0}
              max={100}
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Run now">
            <label className="mt-2 inline-flex items-center gap-2 text-xs text-ink-700">
              <input
                type="checkbox"
                checked={runNow}
                onChange={(e) => setRunNow(e.target.checked)}
              />
              Warm immediately
            </label>
          </Field>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={busy === "add"}
              className="rounded-md bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-50"
            >
              {busy === "add" ? "Adding…" : "Add"}
            </button>
          </div>
        </form>
      </section>

      {err ? (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">{err}</div>
      ) : null}

      {/* Queue */}
      <section className="rounded-lg border border-ink-200 bg-white">
        <header className="flex items-center justify-between border-b border-ink-200 px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold">Queue ({rows.length})</h2>
            <p className="text-xs text-ink-500">
              {dueCount} due for refresh.
            </p>
          </div>
        </header>
        {rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-ink-500">
            No zips in the queue yet. Add one above.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-4 py-3">Zip</th>
                  <th className="px-4 py-3">Location</th>
                  <th className="px-4 py-3 text-right">Priority</th>
                  <th className="px-4 py-3">Last warmed</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-3 font-medium">{r.zip}</td>
                    <td className="px-4 py-3 text-ink-700">
                      {[r.city, r.state].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={r.priority}
                        onChange={(e) => setRow(r.id, { priority: Number(e.target.value) })}
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (!Number.isNaN(v)) savePriority(r.id, v);
                        }}
                        className="w-16 rounded border border-ink-200 bg-white px-2 py-1 text-right text-xs"
                        disabled={busy === r.id}
                      />
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-700">
                      {r.last_warmed_at ? formatRelative(r.last_warmed_at) : (
                        <span className="text-amber-700">never</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {r.last_error ? (
                        <span className="rounded bg-red-100 px-2 py-0.5 text-red-800" title={r.last_error}>
                          error
                        </span>
                      ) : r.last_warmed_at ? (
                        <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-800">ok</span>
                      ) : (
                        <span className="rounded bg-ink-100 px-2 py-0.5 text-ink-700">queued</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => runNowFor(r)}
                          disabled={busy === r.id}
                          className="rounded border border-ink-300 bg-white px-2 py-1 text-xs hover:bg-ink-100 disabled:opacity-40"
                        >
                          {busy === r.id ? "…" : "Run now"}
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteRow(r.id)}
                          disabled={busy === r.id}
                          className="rounded border border-ink-300 bg-white px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-40"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

const inputCls =
  "w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-ink-500 focus:outline-none focus:ring-1 focus:ring-ink-500";

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-700">
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </span>
      {children}
    </label>
  );
}

function stale(iso: string): boolean {
  // Match the cron's effective TTL: 30-day signals, but we treat anything
  // older than 24h as "due" so the operator sees fresh refresh activity.
  const ageHours = (Date.now() - new Date(iso).getTime()) / 36e5;
  return ageHours >= 24;
}

function formatRelative(iso: string): string {
  const ageMs = Date.now() - new Date(iso).getTime();
  const m = Math.round(ageMs / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
