import { NextRequest, NextResponse } from "next/server";
import { wavvProbe, wavvConfigured } from "@/lib/integrations/wavv";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

/**
 * GET /api/debug/wavv[?uuid=<wavv call uuid>] — CRON_SECRET-protected probe.
 *
 * WAVV's API docs aren't public, so this endpoint runs the client's discovery
 * matrix (base URL × auth style × path) server-side — the key never leaves
 * the environment — and reports status codes + sanitized body snippets so the
 * real endpoint shape can be identified and locked in.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const uuid = req.nextUrl.searchParams.get("uuid");
  const results = await wavvProbe(uuid);
  // Env-name diagnostics (names only, values never exposed): catches typos or
  // stray whitespace in the variable name as saved in Vercel.
  const wavvEnvNames = Object.keys(process.env)
    .filter((k) => k.toUpperCase().includes("WAVV"))
    .map((k) => JSON.stringify(k));
  return NextResponse.json({
    configured: wavvConfigured(),
    wavv_env_names: wavvEnvNames,
    attempts: results.length,
    results,
  });
}
