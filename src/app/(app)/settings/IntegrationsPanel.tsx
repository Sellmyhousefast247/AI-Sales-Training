"use client";
import { useEffect, useState, useCallback } from "react";

interface IntegrationView {
  id: string;
  provider: string;
  webhook_url: string | null;
  is_active: boolean;
  config_json: {
    default_rep_id?: string | null;
    min_duration_sec?: number | null;
    auto_score?: boolean | null;
    signing_secret?: string | null;
  } | null;
}

interface RepOption {
  id: string;
  full_name: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  gohighlevel: "GoHighLevel",
  smrtphone: "smrtPhone",
  wavv: "WAVV",
  dialpad: "Dialpad",
  aircall: "Aircall",
  webhook: "Generic webhook (Zapier / n8n / custom)",
};

export function IntegrationsPanel({ reps }: { reps: RepOption[] }) {
  const [rows, setRows] = useState<IntegrationView[]>([]);
  const [provider, setProvider] = useState("gohighlevel");
  const [defaultRep, setDefaultRep] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/integrations");
    if (res.ok) {
      const j = await res.json();
      setRows(j.integrations ?? []);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/integrations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider,
        default_rep_id: defaultRep || null,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error?.message ?? "Failed to save integration");
      return;
    }
    await load();
  }

  async function copyUrl(url: string, id: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // clipboard unavailable — the URL is selectable in the UI
    }
  }

  return (
    <section className="rounded-lg border border-ink-200 bg-white p-5">
      <div className="text-sm font-semibold">Dialer & CRM integrations</div>
      <p className="mt-1 text-xs text-ink-500">
        Connect a provider to get a webhook URL. Point your dialer&apos;s call-completed webhook at it and calls
        will flow in, transcribe, and score automatically.
      </p>

      {rows.length > 0 && (
        <ul className="mt-4 space-y-3">
          {rows.map((r) => (
            <li key={r.id} className="rounded-md border border-ink-200 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">{PROVIDER_LABELS[r.provider] ?? r.provider}</span>
                <span className={r.is_active ? "text-xs text-green-600" : "text-xs text-ink-400"}>
                  {r.is_active ? "Active" : "Disabled"}
                </span>
              </div>
              {r.webhook_url && (
                <div className="mt-2 flex items-center gap-2">
                  <code className="block flex-1 truncate rounded bg-ink-50 px-2 py-1 text-xs">{r.webhook_url}</code>
                  <button
                    type="button"
                    onClick={() => copyUrl(r.webhook_url!, r.id)}
                    className="rounded border border-ink-200 px-2 py-1 text-xs hover:bg-ink-50"
                  >
                    {copied === r.id ? "Copied!" : "Copy"}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={connect} className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-xs">
          <span className="mb-1 block uppercase tracking-wide text-ink-500">Provider</span>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="rounded border border-ink-200 px-2 py-1.5 text-sm"
          >
            {Object.entries(PROVIDER_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          <span className="mb-1 block uppercase tracking-wide text-ink-500">Default rep (fallback)</span>
          <select
            value={defaultRep}
            onChange={(e) => setDefaultRep(e.target.value)}
            className="rounded border border-ink-200 px-2 py-1.5 text-sm"
          >
            <option value="">— none —</option>
            {reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.full_name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-ink-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : "Connect / update"}
        </button>
      </form>
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
      <p className="mt-3 text-xs text-ink-500">
        Calls with no matching rep are assigned to the default rep. See <code>docs/INTEGRATIONS.md</code> for
        provider-by-provider setup steps.
      </p>
    </section>
  );
}
