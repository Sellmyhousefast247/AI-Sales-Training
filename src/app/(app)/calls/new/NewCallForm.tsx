"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface RepOption { id: string; full_name: string }

const CALL_TYPES = [
  { v: "inbound", l: "Inbound" },
  { v: "outbound", l: "Outbound" },
  { v: "follow_up", l: "Follow-up" },
  { v: "offer", l: "Offer" },
  { v: "negotiation", l: "Negotiation" },
  { v: "closing", l: "Closing" },
];

export function NewCallForm({ reps }: { reps: RepOption[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [repId, setRepId] = useState(reps[0]?.id ?? "");
  const [callDate, setCallDate] = useState(() => new Date().toISOString().slice(0, 16));
  const [callType, setCallType] = useState("inbound");
  const [leadSource, setLeadSource] = useState("");
  const [sellerName, setSellerName] = useState("");
  const [propertyAddress, setPropertyAddress] = useState("");
  const [outcome, setOutcome] = useState("unknown");
  const [transcript, setTranscript] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!transcript.trim()) {
      setErr("Paste a transcript before saving.");
      return;
    }
    setBusy(true);
    setErr(null);

    const res = await fetch("/api/calls", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        rep_id: repId,
        call_datetime: new Date(callDate).toISOString(),
        call_type: callType,
        lead_source: leadSource || null,
        seller_name: sellerName || null,
        property_address: propertyAddress || null,
        deal_outcome: outcome,
        transcript,
      }),
    });

    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setBusy(false);
      setErr(j.error?.message ?? "Failed to save call");
      return;
    }

    const { call_id } = await res.json();

    // Trigger scoring
    const scoreRes = await fetch("/api/calls/score", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ call_id }),
    });

    setBusy(false);

    if (!scoreRes.ok) {
      router.push(`/calls/${call_id}?score_error=1`);
      return;
    }
    router.push(`/calls/${call_id}`);
  }

  if (reps.length === 0) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        Add at least one rep before scoring calls. <a href="/reps" className="font-medium underline">Add a rep →</a>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4 md:grid-cols-2">
      <Field label="Rep">
        <select value={repId} onChange={(e) => setRepId(e.target.value)} className={inputCls}>
          {reps.map((r) => <option key={r.id} value={r.id}>{r.full_name}</option>)}
        </select>
      </Field>
      <Field label="Call type">
        <select value={callType} onChange={(e) => setCallType(e.target.value)} className={inputCls}>
          {CALL_TYPES.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
        </select>
      </Field>
      <Field label="Date / time">
        <input type="datetime-local" value={callDate} onChange={(e) => setCallDate(e.target.value)} className={inputCls} />
      </Field>
      <Field label="Lead source">
        <input value={leadSource} onChange={(e) => setLeadSource(e.target.value)} placeholder="PPC, SMS, cold call…" className={inputCls} />
      </Field>
      <Field label="Seller name">
        <input value={sellerName} onChange={(e) => setSellerName(e.target.value)} className={inputCls} />
      </Field>
      <Field label="Property address">
        <input value={propertyAddress} onChange={(e) => setPropertyAddress(e.target.value)} className={inputCls} />
      </Field>
      <Field label="Outcome">
        <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className={inputCls}>
          <option value="unknown">Unknown</option>
          <option value="contract">Contract</option>
          <option value="appointment">Appointment</option>
          <option value="offer_made">Offer made</option>
          <option value="follow_up">Follow-up</option>
          <option value="dead">Dead</option>
        </select>
      </Field>
      <div className="md:col-span-2">
        <Field label="Transcript">
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            rows={14}
            placeholder="Paste the full transcript here. Speaker labels (REP:/SELLER:) help but aren't required."
            className={inputCls}
          />
        </Field>
      </div>

      {err ? <div className="md:col-span-2 text-sm text-red-600">{err}</div> : null}

      <div className="md:col-span-2 flex justify-end gap-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-md border border-ink-300 px-4 py-2 text-sm hover:bg-ink-50"
        >
          Cancel
        </button>
        <button
          disabled={busy}
          className="rounded-md bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-50"
        >
          {busy ? "Scoring…" : "Save & score"}
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

const inputCls =
  "block w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm focus:border-ink-900 focus:outline-none";
