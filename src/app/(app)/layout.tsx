import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("full_name, role, company_id, companies:company_id(name)")
    .eq("id", user.id)
    .single();

  const companyName = (profile as any)?.companies?.name ?? "Your company";
  const role = (profile as any)?.role ?? "rep";

  return (
    <div className="grid min-h-screen grid-cols-[240px_1fr] bg-ink-50">
      <aside className="flex flex-col border-r border-ink-200 bg-gradient-to-b from-ink-900 via-ink-800 to-ink-900 text-white">
        <div className="px-5 py-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/50">
            Workspace
          </div>
          <div className="mt-1 truncate text-base font-semibold">{companyName}</div>
        </div>

        <nav className="flex-1 space-y-0.5 px-3 py-2 text-sm">
          <NavLink href="/dashboard" icon="📊">Dashboard</NavLink>
          <NavLink href="/comping" icon="🏠" featured>Comping</NavLink>
          <NavLink href="/calls" icon="📞">Calls</NavLink>
          <NavLink href="/reps" icon="👥">Reps</NavLink>
          <NavLink href="/leaderboard" icon="🏆">Leaderboard</NavLink>
          {(role === "manager" || role === "company_admin" || role === "super_admin") && (
            <>
              <NavLink href="/coaching" icon="🎯">Coaching</NavLink>
              <NavLink href="/reports" icon="📈">Reports</NavLink>
            </>
          )}
          {(role === "company_admin" || role === "super_admin") && (
            <NavLink href="/settings" icon="⚙️">Settings</NavLink>
          )}
        </nav>

        <div className="border-t border-white/10 px-5 py-4 text-sm">
          <div className="truncate font-medium">{(profile as any)?.full_name ?? user.email}</div>
          <div className="text-xs capitalize text-white/50">{String(role).replace("_", " ")}</div>
          <form action="/api/auth/signout" method="post" className="mt-2">
            <button className="text-xs text-white/60 transition hover:text-white">Sign out</button>
          </form>
        </div>
      </aside>

      <main className="overflow-auto">{children}</main>
    </div>
  );
}

function NavLink({
  href,
  icon,
  featured,
  children,
}: {
  href: string;
  icon?: string;
  featured?: boolean;
  children: React.ReactNode;
}) {
  const base = "group flex items-center gap-2.5 rounded-lg px-3 py-2 transition";
  const cls = featured
    ? `${base} bg-brand-gradient text-white shadow-sm shadow-brand-700/30 ring-1 ring-white/10 hover:brightness-110`
    : `${base} text-white/75 hover:bg-white/5 hover:text-white`;
  return (
    <Link href={href} className={cls}>
      {icon ? <span className="text-base leading-none opacity-90">{icon}</span> : null}
      <span className="font-medium">{children}</span>
    </Link>
  );
}
