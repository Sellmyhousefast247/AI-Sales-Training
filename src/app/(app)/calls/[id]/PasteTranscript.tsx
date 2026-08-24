"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Fallback scoring path on the call detail page: when the audio can't be
 * uploaded, the manager pastes the transcript text and we score from that.
 * POST /api/calls/paste-transcript saves the transcript and kicks off scoring
 * in the background; we poll (router.refresh) until the scorecard renders,
 * which replaces this component entirely.
 */
export function PasteTranscript({ callId }: { callId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"idle" | "busy" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  async function submit() {
    setStatus("busy");
    setMessage("Saving transcript…");
    try {
      const res = await fetch("/api/calls/paste-transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ call_id: callId, transcript: text }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus("error");
        setMessage(j.error?.message ?? "Failed to save transcript");
        return;
      }
      setMessage("Scoring… this usually takes about a minute.");
      // Poll until the scorecard lands; the parent page then renders it
      // instead of this form.
      for (let i = 0; i < 25; i++) {
        await new Promise((r) => setTimeout(r, 12000));
        router.refresh();
      }
      setStatus("error");
      setMessage("Scoring is taking longer than expected — refresh the page.");
    } catch (e: any) {
      setStatus("error");
      setMessage(String(e?.message ?? e));
    }
  }

  return (
    <div className="rounded-lg border border-ink-200 bg-white p-5">
      <div className="text-sm font-semibold">Paste transcript instead</div>
      <p className="mt-1 text-sm text-ink-500">
        Audio won&apos;t upload? Paste the call transcript here and it will be scored the same way.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={status === "busy"}
        rows={10}
        placeholder={"Paste the full transcript here…\n\nSpeaker labels (Rep: / Seller:) and timestamps are fine to include."}
        className="mt-3 w-full rounded-md border border-ink-200 p-3 font-mono text-xs text-ink-800 focus:border-ink-400 focus:outline-none disabled:bg-ink-50"
      />
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={submit}
          disabled={status === "busy" || words < 100}
          className="rounded-md bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "busy" ? "Working…" : "Save & score transcript"}
        </button>
        <span className="text-xs text-ink-400">
          {words > 0 && words < 100 ? `${words} words — need at least 100` : words > 0 ? `${words} words` : ""}
        </span>
      </div>
      {message && (
        <div className={`mt-3 text-sm ${status === "error" ? "text-rose-700" : "text-ink-600"}`}>{message}</div>
      )}
    </div>
  );
}
