"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface PendingCall {
  id: string;
  when: string;
  rep: string;
  seller: string;
  phone: string | null;
  durationSec: number | null;
}

type RowState = { status: "idle" | "uploading" | "done" | "error"; message?: string; fileName?: string };

/** Last 10 digits of a phone-like string, for tolerant matching. */
function digits10(s: string | null | undefined): string {
  const d = (s ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : d;
}

export function ImportRecordings({ pending }: { pending: PendingCall[] }) {
  const router = useRouter();
  const [state, setState] = useState<Record<string, RowState>>({});
  const [dragOver, setDragOver] = useState(false);
  const dropInputRef = useRef<HTMLInputElement>(null);

  const phoneIndex = useMemo(() => {
    const m = new Map<string, PendingCall>();
    for (const c of pending) {
      const d = digits10(c.phone);
      if (d.length === 10) m.set(d, c);
    }
    return m;
  }, [pending]);

  async function uploadFor(callId: string, file: File) {
    setState((s) => ({ ...s, [callId]: { status: "uploading", fileName: file.name } }));
    const fd = new FormData();
    fd.append("file", file);
    fd.append("call_id", callId);
    try {
      const res = await fetch("/api/calls/upload-recording", { method: "POST", body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState((s) => ({ ...s, [callId]: { status: "error", message: j.error?.message ?? "Upload failed", fileName: file.name } }));
        return;
      }
      // Transcript saved; scoring now runs in the background. The call leaves the
      // "awaiting audio" list on refresh and its score appears on the Calls page.
      setState((s) => ({
        ...s,
        [callId]: { status: "done", message: "Transcribed ✓ — scoring…", fileName: file.name },
      }));
      router.refresh();
    } catch (e: any) {
      setState((s) => ({ ...s, [callId]: { status: "error", message: String(e), fileName: file.name } }));
    }
  }

  /** Auto-match dropped files to calls by phone digits in the filename. */
  async function handleFiles(files: FileList | null) {
    if (!files) return;
    const unmatched: string[] = [];
    for (const file of Array.from(files)) {
      const fd = digits10(file.name);
      const match = fd.length === 10 ? phoneIndex.get(fd) : undefined;
      if (match) await uploadFor(match.id, file);
      else unmatched.push(file.name);
    }
    if (unmatched.length) {
      alert(
        `Couldn't auto-match ${unmatched.length} file(s) by phone number:\n` +
          unmatched.join("\n") +
          `\n\nUse the "Attach file" button on the matching call row instead.`
      );
    }
  }

  const fmtWhen = (iso: string) =>
    new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  return (
    <div className="space-y-6">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        onClick={() => dropInputRef.current?.click()}
        className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition ${
          dragOver ? "border-brand bg-ink-100" : "border-ink-300 bg-white"
        }`}
      >
        <div className="text-sm font-medium text-ink-800">Drop WAVV recordings here</div>
        <div className="mt-1 text-xs text-ink-500">
          They&apos;re matched to the calls below by the phone number in the filename (WAVV names files by number). Or attach one to a specific call using its row button.
        </div>
        <input
          ref={dropInputRef}
          type="file"
          accept="audio/*,.mp3,.wav,.m4a"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-ink-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Rep</th>
              <th className="px-4 py-3">Seller</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Length</th>
              <th className="px-4 py-3 text-right">Recording</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {pending.map((c) => {
              const st = state[c.id];
              return (
                <tr key={c.id} className="hover:bg-ink-50">
                  <td className="px-4 py-3 whitespace-nowrap">{fmtWhen(c.when)}</td>
                  <td className="px-4 py-3">{c.rep}</td>
                  <td className="px-4 py-3">{c.seller}</td>
                  <td className="px-4 py-3 font-mono tabular-nums">{c.phone ?? "—"}</td>
                  <td className="px-4 py-3">{c.durationSec ? `${Math.round(c.durationSec / 60)}m` : "—"}</td>
                  <td className="px-4 py-3 text-right">
                    {st?.status === "uploading" ? (
                      <span className="text-ink-500">Transcribing…</span>
                    ) : st?.status === "done" ? (
                      <span className="text-emerald-600">✓ {st.message}</span>
                    ) : st?.status === "error" ? (
                      <span className="text-red-500" title={st.message}>Failed — retry</span>
                    ) : (
                      <RowUpload onPick={(f) => uploadFor(c.id, f)} />
                    )}
                  </td>
                </tr>
              );
            })}
            {pending.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-ink-500">
                  No calls awaiting audio — everything is scored. 🎉
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RowUpload({ onPick }: { onPick: (f: File) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        onClick={() => ref.current?.click()}
        className="rounded-md border border-ink-300 bg-ink-100 px-3 py-1.5 text-xs font-medium text-ink-800 hover:bg-ink-200"
      >
        Attach file
      </button>
      <input
        ref={ref}
        type="file"
        accept="audio/*,.mp3,.wav,.m4a"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); }}
      />
    </>
  );
}
