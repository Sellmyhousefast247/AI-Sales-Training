import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import {
  analyzeDeal,
  analyzeDealInputSchema,
  fetchAndAnalyze,
  subjectPropertySchema,
  compRecordSchema,
  marketSignalsSchema,
} from "@/lib/comping";
import { getCurrentProfile } from "@/lib/queries";

export const runtime = "nodejs";

/**
 * Two body shapes are accepted:
 *
 * 1. "manual" — caller supplies subject + comps + condition_text. Pure
 *    function, no DB writes, no provider calls. This is the path tests use.
 *
 * 2. "lookup" — caller supplies just an address (and optional condition
 *    text). We resolve the subject + comps via cache → providers, run the
 *    analysis, and persist everything under the caller's company_id.
 */
const lookupBody = z.object({
  mode: z.literal("lookup"),
  address: z.string().min(1),
  city: z.string().optional(),
  state: z.string().length(2).optional(),
  zip: z.string().optional(),
  condition_text: z.string().optional().default(""),
  wholesale_fee: z.number().nonnegative().optional(),
  novation_fee: z.number().nonnegative().optional(),
  subject_override: subjectPropertySchema.optional(),
  comps_override: z.array(compRecordSchema).optional(),
  signals_override: marketSignalsSchema.optional(),
  persist: z.boolean().optional(),
  repair_level: z.enum(["Light", "Moderate", "Heavy", "Full Gut", "Teardown"]).optional(),
  manual_pending_pct: z.number().min(0).max(1).optional(),
});

const manualBody = analyzeDealInputSchema.extend({
  mode: z.literal("manual").optional(),
});

const bodySchema = z.union([lookupBody, manualBody]);

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(json);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Invalid input", issues: err.issues }, { status: 422 });
    }
    throw err;
  }

  try {
    if ("mode" in parsed && parsed.mode === "lookup") {
      const profile = await getCurrentProfile();
      if (!profile?.company_id) {
        return NextResponse.json({ error: "Not signed in" }, { status: 401 });
      }
      const result = await fetchAndAnalyze({
        ctx: { companyId: profile.company_id, userId: profile.id },
        address: parsed.address,
        city: parsed.city,
        state: parsed.state,
        zip: parsed.zip,
        condition_text: parsed.condition_text,
        wholesale_fee: parsed.wholesale_fee,
        novation_fee: parsed.novation_fee,
        subject_override: parsed.subject_override,
        comps_override: parsed.comps_override,
        signals_override: parsed.signals_override,
        persist: parsed.persist,
        repair_level: parsed.repair_level,
        manual_pending_pct: parsed.manual_pending_pct,
      });
      return NextResponse.json(result);
    }

    // Manual mode — pure function, no auth required for now.
    const result = analyzeDeal(parsed);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
