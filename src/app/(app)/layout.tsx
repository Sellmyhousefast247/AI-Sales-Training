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

  // Note: typed loosely to keep this scaffold portable
  const companyName = (profile as any)?.companies?.name ?? "Your company";
  const role = (profile as any)?.role ?? "rep";

  return (
    <div className="grid min-h-screen grid-cols-[240px_1fr] bg-ink-50">
      <aside className="flex flex-col border-r border-ink-200 bg-white">
        <div className="px-5 py-4 text-sm">
          <div className="text-xs uppercase tracking-wide text-ink-400">Workspace</div>
          <div className="mt-1 truncate font-semibold">{companyName}</div>
        </div>

        <nav className="flex-1 px-2 py-2 text-sm">
          <NavLink href="/dashboard">Dashboard</NavLink>
          <NavLink href="/calls">Calls</NavLink>
          <NavLink href="/reps">Reps</NavLink>
          <NavLink href="/leaderboard">Leaderboard</NavLink>
          {(role === "manager" || role === "company_admin" || role === "super_admin") && (
            <>
              <NavLink href="/coaching">Coaching</NavLink>
              <NavLink href="/reports">Reports</NavLink>
            </>
          )}
          {(role === "company_admin" || role === "super_admin") && (
            <NavLink href="/settings">Settings</NavLink>
          )}
        </nav>

        <div className="border-t border-ink-200 p-4 text-sm">
          <div className="truncate font-medium">{(profile as any)?.full_name ?? user.email}</div>
          <div className="text-xs text-ink-500 capitalize">{role.replace("_", " ")}</div>
          <form action="/api/auth/signout" method="post" className="mt-2">
            <button className="text-xs text-ink-500 hover:text-ink-900">Sign out</button>
          </form>
        </div>
      </aside>

      <main className="overflow-auto">{children}</main>
    </div>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="block rounded-md px-3 py-2 text-ink-700 hover:bg-ink-100 hover:text-ink-900"
    >
      {children}
    </Link>
  );
}
