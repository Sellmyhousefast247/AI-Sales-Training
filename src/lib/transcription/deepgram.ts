/**
 * Deepgram pre-recorded transcription with speaker diarization.
 * Requires DEEPGRAM_API_KEY. The recording URL must be fetchable by Deepgram
 * (all supported dialers serve recordings from public or signed URLs).
 */

export interface TranscriptionResult {
  /** "REP: …\nSELLER: …" formatted transcript ready for scoring. */
  formatted: string;
  speakers: { speaker: number; words: number }[];
  durationSec: number | null;
  raw: unknown;
}

export function transcriptionConfigured(): boolean {
  return Boolean(process.env.DEEPGRAM_API_KEY);
}

export async function transcribeRecordingUrl(
  recordingUrl: string,
  opts: { repDirectionHint?: "inbound" | "outbound" | null } = {}
): Promise<TranscriptionResult> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) throw new Error("DEEPGRAM_API_KEY is not configured");

  const params = new URLSearchParams({
    model: process.env.DEEPGRAM_MODEL ?? "nova-3",
    smart_format: "true",
    punctuate: "true",
    diarize: "true",
    utterances: "true",
  });

  const resp = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url: recordingUrl }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Deepgram ${resp.status}: ${text.slice(0, 300)}`);
  }

  const data: any = await resp.json();
  const utterances: any[] = data?.results?.utterances ?? [];
  const durationSec = data?.metadata?.duration != null ? Math.round(Number(data.metadata.duration)) : null;

  if (utterances.length === 0) {
    const alt = data?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
    if (!alt) throw new Error("Deepgram returned an empty transcript");
    return { formatted: alt, speakers: [], durationSec, raw: data };
  }

  // Word counts per diarized speaker.
  const counts = new Map<number, number>();
  for (const u of utterances) {
    const words = String(u.transcript ?? "").split(/\s+/).filter(Boolean).length;
    counts.set(u.speaker ?? 0, (counts.get(u.speaker ?? 0) ?? 0) + words);
  }
  const speakers = [...counts.entries()].map(([speaker, words]) => ({ speaker, words }));

  // Heuristic: on an outbound dial the rep speaks first; on inbound the rep
  // answers (also usually speaks first: "This is X with …"). Default: the
  // first speaker is the rep. If that speaker has <25% of words, flip —
  // closers who follow the script carry the majority of early talk time.
  let repSpeaker = utterances[0]?.speaker ?? 0;
  const total = speakers.reduce((a, s) => a + s.words, 0);
  const repShare = (counts.get(repSpeaker) ?? 0) / Math.max(1, total);
  if (speakers.length > 1 && repShare < 0.25) {
    repSpeaker = speakers.reduce((max, s) => (s.words > max.words ? s : max), speakers[0]).speaker;
  }

  const lines = utterances.map((u) => {
    const label = (u.speaker ?? 0) === repSpeaker ? "REP" : "SELLER";
    return `${label}: ${String(u.transcript ?? "").trim()}`;
  });

  return { formatted: lines.join("\n"), speakers, durationSec, raw: data };
}
