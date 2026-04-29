import { NextRequest, NextResponse } from "next/server";
import { warmDueQueue } from "@/lib/comping/warmer";

export const runtime = "nodejs";
// Tight per-run cap — Vercel cron will invoke this every N minutes/hours.
const PER_RUN_LIMIT = 25;

export async function GET(req: NextRequest) {
  return run(req);
}
export async function POST(req: NextRequest) {
  return run(req);
}

async function run(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const results = await warmDueQueue(PER_RUN_LIMIT);
    const ok = results.filter((r) => r.ok).length;
    const failed = results.length - ok;
    return NextResponse.json({
      processed: results.length,
      ok,
      failed,
      // Keep the response compact — only surface failures' details.
      errors: results
        .filter((r) => !r.ok)
        .map((r) => ({ zip: r.zip, error: r.error ?? null })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message ?? "internal" },
      { status: 500 }
    );
  }
}
