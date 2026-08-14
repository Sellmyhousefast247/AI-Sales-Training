"use client";

import { useState, useTransition } from "react";
import { saveScriptContent } from "./actions";

/**
 * Editor for the company reference script (company_settings.script_content).
 * The scorer treats this text as the source of truth (<COMPANY_SCRIPT>), so
 * saving here changes how every future call is graded.
 *
 * `manualDefault` is the current "2026 ACQ Closer Manual" bundled with the app —
 * the "Load latest manual" button drops it into the editor so it can be saved
 * without pasting the whole thing.
 */
export function ScriptEditor({
  initial,
  manualDefault,
}: {
  initial: string;
  manualDefault: string;
}) {
  const [text, setText] = useState(initial ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();

  const dirty = text !== (initial ?? "");

  function save() {
    setMsg(null);
    startTransition(async () => {
      const r = await saveScriptContent(text);
      setOk(r.ok);
      setMsg(r.ok ? "Saved ✓ — new calls will be scored against this script." : r.error ?? "Save failed");
    });
  }

  return (
    <section className="rounded-lg border border-ink-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">Reference script</div>
          <div className="mt-1 text-xs text-ink-500">
            The official call script the AI grades every call against (Road to a Deal). Edit and save to update scoring.
          </div>
        </div>
        <button
          type="button"
          onClick={() => { setText(manualDefault); setMsg(null); }}
          className="rounded-md border border-ink-300 bg-ink-100 px-3 py-1.5 text-xs font-medium text-ink-800 hover:bg-ink-200"
          title="Replace the editor contents with the bundled 2026 Closer Manual script"
        >
          Load latest manual (8/14/26)
        </button>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        className="mt-3 h-96 w-full resize-y rounded-md border border-ink-300 bg-ink-50 p-3 font-mono text-xs leading-relaxed text-ink-900"
        placeholder="Paste or load the company reference script…"
      />

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending || !dirty}
          className="rounded-md bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save script"}
        </button>
        <span className="text-xs text-ink-500">{text.length.toLocaleString()} characters</span>
        {msg && (
          <span className={`text-xs ${ok ? "text-emerald-600" : "text-red-500"}`}>{msg}</span>
        )}
      </div>
    </section>
  );
}
