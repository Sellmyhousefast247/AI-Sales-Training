import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { ROAD_TO_DEAL_STEPS, STEP_LABELS, type RoadStep } from "@/lib/types";

/**
 * Branded, printable call-review PDF the manager can hand to the rep.
 * Pure function: data in → PDF bytes out (unit-testable, no framework deps).
 */

export interface CallReportData {
  companyName: string;
  sellerName: string;
  repName: string;
  callDatetime: string; // ISO
  callType: string;
  leadSource: string | null;
  durationSec: number | null;
  finalScore: number; // 0-10
  totalScore: number; // 0-100
  steps: Array<{ step: RoadStep; score: number; justification: string; supporting_quote: string | null }>;
  criticalBreakpoint: { quote: string; step_failed: string; why_it_caused_loss: string; what_should_have_happened: string } | null;
  whatWasDoneWell: string | null;
  areasForImprovement: Array<{ rep_said: string; issue: string; better_approach: string; corrected_script: string }>;
  missedOpportunities: Array<{ rep_said?: string; what_was_missed: string; fix: string }>;
  coachingNotesRep: string | null;
  coachingNotesManager: string | null;
  dealRisk: string | null;
  conversionProbability: number | null;
  recommendedNextAction: string | null;
}

// ---- text sanitation: standard PDF fonts only support WinAnsi ---------------
const REPLACEMENTS: Array<[RegExp, string]> = [
  [/[‘’ʼ]/g, "'"],
  [/[“”]/g, '"'],
  [/[–—]/g, "-"],
  [/…/g, "..."],
  [/[•●▪]/g, "-"],
  [/→/g, "->"],
  [/✓|✔/g, "[HIT]"],
  [/△|⚠/g, "[WEAK]"],
  [/✗|✘|❌/g, "[MISS]"],
  [/ /g, " "],
];
function clean(s: unknown): string {
  let t = String(s ?? "");
  for (const [re, rep] of REPLACEMENTS) t = t.replace(re, rep);
  // Drop anything WinAnsi can't encode.
  // eslint-disable-next-line no-control-regex
  t = t.replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "");
  return t.replace(/[ \t]+/g, " ").trim();
}

// ---- palette ----------------------------------------------------------------
const NAVY = rgb(0.09, 0.13, 0.21);
const INK = rgb(0.22, 0.26, 0.32);
const MUTE = rgb(0.45, 0.5, 0.56);
const LINE = rgb(0.85, 0.87, 0.9);
const GREEN = rgb(0.02, 0.55, 0.35);
const AMBER = rgb(0.8, 0.52, 0.05);
const RED = rgb(0.78, 0.2, 0.2);
const scoreColor = (n: number, max = 10) => {
  const pct = max ? n / max : 0;
  return pct >= 0.7 ? GREEN : pct >= 0.4 ? AMBER : RED;
};

const PAGE_W = 612;
const PAGE_H = 792;
const M = 48;
const BODY_W = PAGE_W - M * 2;

export async function buildCallReportPdf(d: CallReportData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

  let page: PDFPage = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - M;

  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - M;
  };
  const ensure = (needed: number) => {
    if (y - needed < M + 24) newPage();
  };

  const wrap = (text: string, font: PDFFont, size: number, width: number): string[] => {
    const out: string[] = [];
    for (const para of text.split(/\n+/)) {
      const words = para.split(" ").filter(Boolean);
      let line = "";
      for (const w of words) {
        const probe = line ? `${line} ${w}` : w;
        if (font.widthOfTextAtSize(probe, size) <= width) line = probe;
        else {
          if (line) out.push(line);
          line = w;
        }
      }
      if (line) out.push(line);
    }
    return out.length ? out : [""];
  };

  const draw = (
    text: string,
    opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; x?: number; width?: number; lineGap?: number } = {}
  ) => {
    const font = opts.font ?? helv;
    const size = opts.size ?? 9.5;
    const x = opts.x ?? M;
    const width = opts.width ?? PAGE_W - x - M;
    const gap = opts.lineGap ?? 3;
    const lines = wrap(clean(text), font, size, width);
    for (const line of lines) {
      ensure(size + gap);
      page.drawText(line, { x, y: y - size, size, font, color: opts.color ?? INK });
      y -= size + gap;
    }
  };

  const spacer = (h: number) => { ensure(h); y -= h; };

  const sectionTitle = (title: string) => {
    ensure(34);
    spacer(12);
    page.drawText(clean(title).toUpperCase(), { x: M, y: y - 10, size: 10, font: bold, color: NAVY });
    y -= 16;
    page.drawLine({ start: { x: M, y }, end: { x: PAGE_W - M, y }, thickness: 0.7, color: LINE });
    y -= 8;
  };

  // ---- Header ---------------------------------------------------------------
  page.drawText(clean(d.companyName).toUpperCase(), { x: M, y: y - 9, size: 9, font: bold, color: MUTE });
  page.drawText("CALL REVIEW", { x: PAGE_W - M - bold.widthOfTextAtSize("CALL REVIEW", 9), y: y - 9, size: 9, font: bold, color: MUTE });
  y -= 26;
  page.drawText(clean(d.sellerName || "Unknown seller"), { x: M, y: y - 18, size: 19, font: bold, color: NAVY });

  // Score box (right)
  const scoreTxt = `${d.finalScore.toFixed(1)}`;
  const boxW = 92, boxH = 46;
  page.drawRectangle({ x: PAGE_W - M - boxW, y: y - 24 - boxH + 22, width: boxW, height: boxH, borderColor: LINE, borderWidth: 1 });
  page.drawText(scoreTxt, {
    x: PAGE_W - M - boxW / 2 - bold.widthOfTextAtSize(scoreTxt, 21) / 2 - 8,
    y: y - 18, size: 21, font: bold, color: scoreColor(d.finalScore),
  });
  page.drawText("/ 10", { x: PAGE_W - M - boxW / 2 + 12, y: y - 15, size: 9, font: helv, color: MUTE });
  const totalTxt = `${d.totalScore}/100 total`;
  page.drawText(totalTxt, { x: PAGE_W - M - boxW / 2 - helv.widthOfTextAtSize(totalTxt, 7.5) / 2, y: y - 34, size: 7.5, font: helv, color: MUTE });
  y -= 24;

  const mins = d.durationSec != null ? `${Math.round(d.durationSec / 60)} min` : null;
  const when = new Date(d.callDatetime);
  const dateStr = isNaN(when.getTime())
    ? ""
    : when.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
  draw([dateStr, d.repName, d.callType.replace(/_/g, " "), mins, d.leadSource].filter(Boolean).join("   |   "), { color: MUTE, size: 9 });

  const statLine = [
    d.dealRisk ? `Deal risk: ${d.dealRisk}` : null,
    d.conversionProbability != null ? `Conversion: ${d.conversionProbability}%` : null,
    d.recommendedNextAction ? `Next: ${d.recommendedNextAction}` : null,
  ].filter(Boolean).join("   |   ");
  if (statLine) draw(statLine, { color: MUTE, size: 9 });

  // ---- Road to a Deal -------------------------------------------------------
  sectionTitle("Road to a Deal");
  const byStep = new Map(d.steps.map((s) => [s.step, s]));
  ROAD_TO_DEAL_STEPS.forEach((key, i) => {
    const s = byStep.get(key);
    const score = s?.score ?? 0;
    const tag = score >= 8 ? "HIT" : score >= 3 ? "WEAK" : "MISS";
    ensure(30);
    const head = `${i + 1}. ${STEP_LABELS[key]}`;
    page.drawText(clean(head), { x: M, y: y - 10, size: 10, font: bold, color: NAVY });
    const right = `${score}/10  ${tag}`;
    page.drawText(right, { x: PAGE_W - M - bold.widthOfTextAtSize(right, 10), y: y - 10, size: 10, font: bold, color: scoreColor(score) });
    y -= 15;
    if (s?.justification) draw(s.justification, { x: M + 14, size: 9 });
    if (s?.supporting_quote) draw(`"${s.supporting_quote}"`, { x: M + 14, size: 8.5, font: italic, color: MUTE });
    spacer(5);
  });

  // ---- Critical breakpoint --------------------------------------------------
  if (d.criticalBreakpoint) {
    sectionTitle("Critical Breakpoint");
    const cb = d.criticalBreakpoint;
    const failLabel = STEP_LABELS[cb.step_failed as RoadStep] ?? cb.step_failed;
    draw(`Step failed: ${failLabel}`, { font: bold, size: 9.5, color: RED });
    if (cb.quote) draw(`"${cb.quote}"`, { font: italic, size: 9, color: MUTE });
    draw(`Why it hurt the deal: ${cb.why_it_caused_loss}`, { size: 9.5 });
    draw(`What should have happened: ${cb.what_should_have_happened}`, { size: 9.5 });
  }

  // ---- What was done well ---------------------------------------------------
  if (d.whatWasDoneWell) {
    sectionTitle("What Was Done Well");
    draw(d.whatWasDoneWell, { size: 9.5 });
  }

  // ---- Areas for improvement ------------------------------------------------
  if (d.areasForImprovement.length) {
    sectionTitle("Areas for Improvement");
    d.areasForImprovement.slice(0, 5).forEach((a, i) => {
      ensure(40);
      page.drawText(`${i + 1}.`, { x: M, y: y - 10, size: 10, font: bold, color: NAVY });
      y -= 14;
      if (a.rep_said) draw(`Rep said: "${a.rep_said}"`, { x: M + 14, size: 9, font: italic, color: MUTE });
      draw(`Issue: ${a.issue}`, { x: M + 14, size: 9.5 });
      draw(`Better approach: ${a.better_approach}`, { x: M + 14, size: 9.5 });
      if (a.corrected_script) draw(`Say this instead: "${a.corrected_script}"`, { x: M + 14, size: 9.5, font: bold, color: NAVY });
      spacer(6);
    });
  }

  // ---- Missed opportunities -------------------------------------------------
  if (d.missedOpportunities.length) {
    sectionTitle("Missed Opportunities");
    d.missedOpportunities.slice(0, 4).forEach((m2) => {
      draw(`- ${m2.what_was_missed}`, { size: 9.5 });
      draw(`Fix: ${m2.fix}`, { x: M + 14, size: 9, color: MUTE });
      spacer(3);
    });
  }

  // ---- Coaching notes -------------------------------------------------------
  if (d.coachingNotesRep) {
    sectionTitle("Coaching Notes (for the rep)");
    draw(d.coachingNotesRep, { size: 9.5 });
  }
  if (d.coachingNotesManager) {
    sectionTitle("What to Drill This Week (manager)");
    draw(d.coachingNotesManager, { size: 9.5 });
  }

  // ---- Footer on every page -------------------------------------------------
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const label = `${clean(d.companyName)} - Call Review - ${clean(d.sellerName)}  |  Page ${i + 1} of ${pages.length}`;
    p.drawText(label, { x: M, y: 26, size: 7.5, font: helv, color: MUTE });
  });

  return doc.save();
}
