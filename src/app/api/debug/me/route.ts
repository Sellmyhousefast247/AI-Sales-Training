import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createSupabaseServerClient();

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  const user = userData?.user ?? null;

  let profile: unknown = null;
  let profileErr: unknown = null;
  if (user) {
    const r = await supabase
      .from("users")
      .select("id, email, full_name, company_id, role")
      .eq("id", user.id)
      .maybeSingle();
    profile = r.data;
    profileErr = r.error;
  }

  return NextResponse.json({
    has_user: !!user,
    user_id: user?.id ?? null,
    user_email: user?.email ?? null,
    user_app_metadata: user?.app_metadata ?? null,
    profile,
    profile_error: profileErr,
    auth_error: userErr ? { message: userErr.message } : null,
  });
}
