"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Right-hand "Score" cell on the calls list. If the call is already scored it
 * shows the number; otherwise it shows an inline Upload control so the user can
 * attach the recording for THAT call and score it without leaving the page.
 *
 * Upload → transcribe (server) → score (server, in background). The upload
 * request returns as soon as the transcript is saved so long calls don't time
 * out; we then poll (router.refresh) until the score lands and the parent passes
 * a non-null `score`, at which point this cell renders the number.
 */
export function ScoreCell({
  callId,
  score,
}: {
  callId: string;
  score: number | null;
}) {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "busy" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  if (score != null) {
    return <span className="font-mono tabular-nums">{score.toFixed(1)}</span>;
  }

  async function upload(file: File) {
    setStatus("busy");
    setMessage("Transcribing…");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("call_id", callId);
    try {
      const res = await fetch("/api/calls/upload-recording", { method: "POST", body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus("error");
        setMessage(j.error?.message ?? "Upload failed");
        return;
      }
      // Transcript saved; scoring runs in the background. Poll for it to appear.
      setMessage("Scoring…");
      // ~5 min of polling; a scored call re-renders this cell as the number.
      for (let i = 0; i < 25; i++) {
        await new Promise((r) => setTimeout(r, 12000));
        router.refresh();
      }
      // If we get here the score still hasn't landed — let the user retry.
      setStatus("error");
      setMessage("Scoring is taking longer than expected — refresh the page");
    } catch (e: any) {
      setStatus("error");
      setMessage(String(e));
    }
  }

  if (status === "busy") {
    return <span className="text-xs text-ink-500">{message ?? "Working…"}</span>;
  }

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <button
        onClick={() => ref.current?.click()}
        className="rounded-md border border-ink-300 bg-ink-100 px-3 py-1 text-xs font-medium text-ink-800 hover:bg-ink-200"
        title="Upload this call's recording to transcribe and score it"
      >
        {status === "error" ? "Retry upload" : "Upload"}
      </button>
      {status === "error" && message && (
        <span className="max-w-[180px] truncate text-[10px] text-red-500" title={message}>
          {message}
        </span>
      )}
      <input
        ref={ref}
        type="file"
        accept="audio/*,.mp3,.wav,.m4a"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
        }}
      />
    </span>
  );
}
