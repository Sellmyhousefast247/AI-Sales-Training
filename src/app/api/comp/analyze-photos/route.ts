import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { getCurrentProfile } from "@/lib/queries";
import { analyzeSubjectPhotos } from "@/lib/comping/subject-photo-analyzer";

export const runtime = "nodejs";

const bodySchema = z.object({
  photo_urls: z.array(z.string().url()).min(1).max(20),
});

export async function POST(req: Request) {
  const profile = await getCurrentProfile();
  if (!profile?.company_id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Invalid input", issues: err.issues }, { status: 422 });
    }
    throw err;
  }

  try {
    const result = await analyzeSubjectPhotos(parsed.photo_urls);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message ?? "Internal error" },
      { status: 500 }
    );
  }
}
