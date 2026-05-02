"use client";

import { useState } from "react";

interface Props {
  initialName: string;
  initialVersion: string;
  initialContent: string;
}

export function TrainingMaterialForm({
  initialName,
  initialVersion,
  initialContent,
}: Props) {
  const [name, setName] = useState(initialName);
  const [version, setVersion] = useState(initialVersion);
  const [content, setContent] = useState(initialContent);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "ok"; message: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  const charCount = content.length;
  const lineCount = content ? content.split(/\r?\n/).length : 0;
  const dirty =
    name !== initialName ||
    version !== initialVersion ||
    content !== initialContent;

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus({ kind: "idle" });
    try {
      const res = await fetch("/api/settings/script", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          script_name: name || null,
          script_version: version || null,
          script_content: content || null,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setStatus({ kind: "error", message: j.error ?? "Failed to save" });
        return;
      }
      setStatus({
        kind: "ok",
        message: `Saved · ${j.script_chars.toLocaleString()} chars · scoring will use this on every call from now on.`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Network error";
      setStatus({ kind: "error", message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSave} className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-700">
            Script name
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. ACQ Closer Manual"
            className="w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-700">
            Version
          </span>
          <input
            type="text"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="e.g. V3"
            className="w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
          />
        </label>
      </div>

      <label className="block">
        <span className="mb-1 flex items-center justify-between text-xs font-medium text-ink-700">
          <span>Knowledge base content</span>
          <span className="font-mono text-[11px] text-ink-500">
            {charCount.toLocaleString()} chars · {lineCount.toLocaleString()} lines
          </span>
        </span>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={20}
          spellCheck={false}
          placeholder="Paste your full master script + objection handlers + rules + rubric here. The AI scorer reads this verbatim on every call."
          className="w-full rounded-md border border-ink-300 bg-white px-3 py-2 font-mono text-xs leading-5 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
        />
      </label>

      <div className="rounded-lg border border-ink-200 bg-ink-50 p-3 text-xs text-ink-600">
        <div className="font-semibold text-ink-900">How this gets used</div>
        <p className="mt-1">
          When a call is scored, this content is injected into the AI's prompt as
          {" "}<code className="text-ink-800">&lt;COMPANY_SCRIPT&gt;</code>. The
          scorer treats it as the source of truth for grading every call. Length is
          unlimited — paste 30,000 characters or more if needed.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy || !dirty}
          className="rounded-lg bg-brand-gradient px-5 py-2.5 text-sm font-semibold text-white shadow-md transition hover:brightness-110 disabled:opacity-40"
        >
          {busy ? "Saving…" : dirty ? "Save changes" : "No changes"}
        </button>
        {status.kind === "ok" ? (
          <span className="text-xs font-medium text-money-700">
            ✓ {status.message}
          </span>
        ) : null}
        {status.kind === "error" ? (
          <span className="text-xs font-medium text-red-700">
            {status.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}
