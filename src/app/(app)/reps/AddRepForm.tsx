"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function AddRepForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true); setErr(null);
    const res = await fetch("/api/reps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ full_name: name.trim() }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error?.message ?? "Failed to add rep");
      return;
    }
    setName("");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3 rounded-lg border border-ink-200 bg-white p-4">
      <label className="flex-1 min-w-60">
        <div className="text-xs font-medium uppercase tracking-wide text-ink-500">Add rep</div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Full name"
          className="mt-1 w-full rounded-md border border-ink-300 px-3 py-2 text-sm"
        />
      </label>
      <button disabled={busy || !name.trim()} className="rounded-md bg-ink-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
        {busy ? "Adding…" : "Add rep"}
      </button>
      {err ? <div className="basis-full text-sm text-red-600">{err}</div> : null}
    </form>
  );
}
