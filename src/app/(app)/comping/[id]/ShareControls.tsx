"use client";

import { useState } from "react";

interface Props {
  analysisId: string;
  initialToken: string | null;
  /** Manager+ — only roles allowed to share. Reps see Print only. */
  canShare: boolean;
}

export function ShareControls({ analysisId, initialToken, canShare }: Props) {
  const [token, setToken] = useState<string | null>(initialToken);
  const [busy, setBusy] = useState<"share" | "revoke" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const shareUrl =
    token && typeof window !== "undefined"
      ? `${window.location.origin}/share/comp/${token}`
      : null;

  async function generate() {
    setBusy("share");
    setErr(null);
    const res = await fetch(`/api/comp/${analysisId}/share`, { method: "POST" });
    setBusy(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error ?? "Failed to generate share link.");
      return;
    }
    const j = (await res.json()) as { token: string };
    setToken(j.token);
  }

  async function revoke() {
    if (!confirm("Revoke the share link? Anyone with the URL will lose access.")) return;
    setBusy("revoke");
    setErr(null);
    const res = await fetch(`/api/comp/${analysisId}/share`, { method: "DELETE" });
    setBusy(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error ?? "Failed to revoke.");
      return;
    }
    setToken(null);
  }

  async function copy() {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="no-print flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => window.print()}
        className="rounded-md border border-ink-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-ink-100"
      >
        Print / Save PDF
      </button>

      {canShare ? (
        token ? (
          <>
            <button
              type="button"
              onClick={copy}
              className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-900 hover:bg-emerald-100"
            >
              {copied ? "Copied!" : "Copy share link"}
            </button>
            <button
              type="button"
              onClick={revoke}
              disabled={busy === "revoke"}
              className="rounded-md border border-ink-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-40"
            >
              {busy === "revoke" ? "…" : "Revoke"}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={generate}
            disabled={busy === "share"}
            className="rounded-md bg-ink-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-ink-800 disabled:opacity-50"
          >
            {busy === "share" ? "Creating…" : "Create share link"}
          </button>
        )
      ) : null}

      {shareUrl ? (
        <code className="max-w-md truncate rounded bg-ink-50 px-2 py-1 text-[11px] text-ink-600">
          {shareUrl}
        </code>
      ) : null}

      {err ? <span className="text-xs text-red-700">{err}</span> : null}
    </div>
  );
}
