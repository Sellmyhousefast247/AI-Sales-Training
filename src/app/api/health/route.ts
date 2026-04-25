import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("companies").select("id", { count: "exact", head: true });
    if (error) throw error;
    return NextResponse.json({ ok: true, db: "ok", time: new Date().toISOString() });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 503 });
  }
}
