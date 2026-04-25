import Link from "next/link";
import { Sparkles } from "lucide-react";
import { formatDateTime } from "@/lib/utils";

interface Note {
  id: string;
  kind: string;
  body: string;
  pattern_key: string | null;
  created_at: string;
  reps?: { id: string; full_name: string } | { id: string; full_name: string }[] | null;
}

export function CoachingPriorities({ notes }: { notes: Note[] }) {
  if (notes.length === 0) {
    return (
      <div className="grid place-items-center rounded-lg border border-dashed border-ink-200 bg-ink-50/50 px-4 py-8 text-sm text-ink-500">
        Coaching priorities will appear here after the next batch of calls is scored.
      </div>
    );
  }
  return (
    <ul className="space-y-3">
      {notes.map((n) => {
        const rep = Array.isArray(n.reps) ? n.reps[0] : n.reps;
        const summary = (n.body || "").split("\n")[0]?.slice(0, 220) ?? "";
        return (
          <li key={n.id} className="rounded-lg border border-ink-200 bg-white p-4 transition-shadow hover:shadow-md">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <span className="grid h-7 w-7 place-items-center rounded-md bg-violet-100 text-violet-700">
                  <Sparkles className="h-3.5 w-3.5" />
                </span>
                {rep?.full_name ?? "Team"}
              </div>
              <div className="text-[10px] uppercase tracking-wide text-ink-500">
                {n.kind.replace("_", " ")} · {formatDateTime(n.created_at)}
              </div>
            </div>
            <div className="mt-2 line-clamp-2 text-sm text-ink-700">{summary}</div>
            {rep ? (
              <div className="mt-3">
                <Link
                  href={`/reps/${rep.id}`}
                  className="text-xs font-medium text-ink-700 hover:text-ink-900"
                >
                  View rep →
                </Link>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
