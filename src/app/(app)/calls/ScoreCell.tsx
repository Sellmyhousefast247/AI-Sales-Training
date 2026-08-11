"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Right-hand "Score" cell on the calls list. If the call is already scored it
 * shows the number; otherwise it shows an inline Upload control so the user can
 * attach the recording for THAT call and score it without leaving the page.
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
    setMessage(null);
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
      // Score is now set — refresh so the row shows the number.
      router.refresh();
    } catch (e: any) {
      setStatus("error");
      setMessage(String(e));
    }
  }

  if (status === "busy") {
    return <span className="text-xs text-ink-500">Scoring…</span>;
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
        <span className="max-w-[160px] truncate text-[10px] text-red-500" title={message}>
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
