import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/queries";
import { ImportRecordings } from "./ImportRecordings";

export default async function ImportRecordingsPage() {
  const profile = await getCurrentProfile();
  if (!profile?.company_id) redirect("/login");

  const supabase = await createSupabaseServerClient();
  const { data: rows } = await supabase
    .from("calls")
    .select("id, call_datetime, seller_name, seller_phone, recording_duration_sec, reps:rep_id (full_name)")
    .eq("company_id", profile.company_id)
    .neq("transcript_status", "ready")
    .order("call_datetime", { ascending: false })
    .limit(100);

  const pending = (rows ?? []).map((c: any) => ({
    id: c.id,
    when: c.call_datetime,
    rep: c.reps?.full_name ?? "—",
    seller: c.seller_name ?? "—",
    phone: c.seller_phone ?? null,
    durationSec: c.recording_duration_sec ?? null,
  }));

  return (
    <div className="space-y-6 p-8">
      <div>
        <Link href="/calls" className="text-sm text-ink-500 hover:text-ink-900">← Back to calls</Link>
        <h1 className="mt-2 text-2xl font-semibold">Import call recordings</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-500">
          For calls awaiting audio, download the recording from your WAVV dialer (the download
          button next to each call&apos;s player), then drop the files below. Files are matched to
          calls automatically by the phone number in the filename — or attach one manually. Each
          recording is transcribed and scored on upload.
        </p>
      </div>
      <ImportRecordings pending={pending} />
    </div>
  );
}
