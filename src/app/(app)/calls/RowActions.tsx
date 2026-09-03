"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * The View button on each calls row — with, for admins only, a small dropdown
 * holding "Delete call". Deleting asks for an inline confirmation (no native
 * browser dialogs) and then removes the call + scorecards + transcript via
 * DELETE /api/calls/[id], which re-checks the admin role server-side.
 */
export function RowActions({ callId, isAdmin }: { callId: string; isAdmin: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
        setConfirming(false);
        setError(null);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  async function doDelete() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/calls/${callId}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error?.message ?? "Delete failed");
        setBusy(false);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setBusy(false);
    }
  }

  if (!isAdmin) {
    return (
      <Link
        href={`/calls/${callId}`}
        className="rounded-md border border-ink-300 bg-ink-100 px-3 py-1 text-xs font-medium text-ink-800 hover:bg-ink-200"
      >
        View
      </Link>
    );
  }

  return (
    <div ref={boxRef} className="relative inline-flex">
      <Link
        href={`/calls/${callId}`}
        className="rounded-l-md border border-ink-300 bg-ink-100 px-3 py-1 text-xs font-medium text-ink-800 hover:bg-ink-200"
      >
        View
      </Link>
      <button
        onClick={() => {
          setOpen((v) => !v);
          setConfirming(false);
          setError(null);
        }}
        className="rounded-r-md border border-l-0 border-ink-300 bg-ink-100 px-1.5 py-1 text-xs text-ink-600 hover:bg-ink-200"
        title="More actions"
        aria-label="More actions"
      >
        ▾
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-44 rounded-md border border-ink-200 bg-white p-1 shadow-lg">
          {!confirming ? (
            <button
              onClick={() => setConfirming(true)}
              className="w-full rounded px-3 py-1.5 text-left text-xs font-medium text-rose-700 hover:bg-rose-50"
            >
              Delete call…
            </button>
          ) : (
            <div className="space-y-1 p-1">
              <div className="text-xs text-ink-700">Delete this call and its score forever?</div>
              <div className="flex gap-1">
                <button
                  onClick={doDelete}
                  disabled={busy}
                  className="flex-1 rounded bg-rose-700 px-2 py-1 text-xs font-medium text-white hover:bg-rose-800 disabled:opacity-50"
                >
                  {busy ? "Deleting…" : "Yes, delete"}
                </button>
                <button
                  onClick={() => {
                    setOpen(false);
                    setConfirming(false);
                  }}
                  disabled={busy}
                  className="flex-1 rounded border border-ink-300 px-2 py-1 text-xs text-ink-700 hover:bg-ink-100"
                >
                  Cancel
                </button>
              </div>
              {error && <div className="text-xs text-rose-700">{error}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
