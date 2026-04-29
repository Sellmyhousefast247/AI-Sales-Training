import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { analyzeDeal, analyzeDealInputSchema } from "@/lib/comping";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const input = analyzeDealInputSchema.parse(body);
    const result = analyzeDeal(input);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Invalid input", issues: err.issues }, { status: 422 });
    }
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
