import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/queries";
import { formatDateTime, formatMoney, formatPct } from "@/lib/utils";
import { computeListStats, type AnalysisListItem } from "@/lib/comping/stats";
import { CompingFilterBar } from "./CompingFilterBar";

interface AnalysisRow {
  id: string;
  created_at: string;
  arv: number;
  as_is_value: number;
  repair_estimate: number;
  repair_level: string;
  buying_pct: number;
  wholesale_mao: number;
  novation_mao: number;
  confidence_score: "Low" | "Medium" | "High";
  comps_used: number;
  comp_subjects: { id: string; address: string; city: string | null; state: string | null } | null;
  users: { id: string; full_name: string | null; email: string; team_id: string | null } | null;
}

const PAGE_SIZE = 25;

const SORTABLE_COLUMNS = {
  created_at: "created_at",
  arv: "arv",
  as_is_value: "as_is_value",
  repair_estimate: "repair_estimate",
  wholesale_mao: "wholesale_mao",
  novation_mao: "novation_mao",
  comps_used: "comps_used",
} as const;

type SortKey = keyof typeof SORTABLE_COLUMNS;

export default async function CompingListPage({
  searchParams,
}: {
  searchParams: Promise<{
    rep?: string;
    team?: string;
    sort?: string;
    dir?: string;
    page?: string;
  }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile?.company_id) redirect("/login");
  const params = await searchParams;
  const repFilter = params.rep || null;
  const teamFilter = params.team || null;

  const sort: SortKey =
    params.sort && params.sort in SORTABLE_COLUMNS
      ? (params.sort as SortKey)
      : "created_at";
  const dir: "asc" | "desc" = params.dir === "asc" ? "asc" : "desc";
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const fromIdx = (page - 1) * PAGE_SIZE;
  const toIdx = fromIdx + PAGE_SIZE - 1;

  const supabase = await createSupabaseServerClient();

  // Filter dropdowns: load all team members + teams in the company.
  const [{ data: usersData }, { data: teamsData }] = await Promise.all([
    supabase
      .from("users")
      .select("id, full_name, email, team_id")
      .eq("company_id", profile.company_id)
      .order("full_name", { ascending: true }),
    supabase
      .from("teams")
      .select("id, name")
      .eq("company_id", profile.company_id)
      .order("name", { ascending: true }),
  ]);
  const allUsers = (usersData ?? []) as Array<{
    id: string;
    full_name: string | null;
    email: string;
    team_id: string | null;
  }>;
  const teams = (teamsData ?? []) as Array<{ id: string; name: string }>;

  // For team filter, resolve to a list of user ids on that team.
  const teamMemberIds = teamFilter
    ? allUsers.filter((u) => u.team_id === teamFilter).map((u) => u.id)
    : null;

  let q = supabase
    .from("deal_analyses")
    .select(
      `
      id, created_at, arv, as_is_value, repair_estimate, repair_level,
      buying_pct, wholesale_mao, novation_mao, confidence_score, comps_used,
      comp_subjects:subject_id (id, address, city, state),
      users:created_by (id, full_name, email, team_id)
    `,
      { count: "exact" }
    )
    .eq("company_id", profile.company_id)
    .order(SORTABLE_COLUMNS[sort], { ascending: dir === "asc" })
    .range(fromIdx, toIdx);

  if (repFilter) q = q.eq("created_by", repFilter);
  if (teamMemberIds) {
    if (teamMemberIds.length === 0) {
      // Empty team — short-circuit to avoid an `in.()` PostgREST error.
      q = q.eq("created_by", "00000000-0000-0000-0000-000000000000");
    } else {
      q = q.in("created_by", teamMemberIds);
    }
  }

  const { data, error, count } = await q;
  const rows: AnalysisRow[] = (data ?? []) as unknown as AnalysisRow[];
  const totalCount = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const stats = computeListStats(rows as AnalysisListItem[]);

  const role = profile.role ?? "rep";
  const canManageQueue =
    role === "manager" || role === "company_admin" || role === "super_admin";

  return (
    <div className="min-h-full bg-ink-50">
      <div className="bg-brand-gradient">
        <div className="mx-auto max-w-7xl px-6 py-8 text-white md:px-8 md:py-10">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/60">
                Comping engine
              </div>
              <h1 className="mt-1 text-3xl font-bold tracking-tight md:text-4xl">
                Run a comp in 60 seconds
              </h1>
              <p className="mt-2 text-sm text-white/80">
                ARV · As-Is · Repairs · Wholesale &amp; Novation MAOs — built for live calls.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {canManageQueue ? (
                <>
                  <a
                    href={csvHref(repFilter, teamFilter)}
                    className="rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/20"
                  >
                    Export CSV
                  </a>
                  <Link
                    href="/comping/warm-queue"
                    className="rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/20"
                  >
                    Warm queue
                  </Link>
                </>
              ) : null}
              <Link
                href="/comping/new"
                className="rounded-lg bg-white px-4 py-2 text-sm font-bold text-brand-600 shadow-lg transition hover:shadow-xl"
              >
                + New analysis
              </Link>
            </div>
          </div>
        </div>
      </div>
      <div className="mx-auto max-w-7xl space-y-6 px-6 py-8 md:px-8">

      <CompingFilterBar
        reps={allUsers}
        teams={teams}
        selectedRep={repFilter}
        selectedTeam={teamFilter}
      />

      {rows.length > 0 ? (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
          <Stat label="Analyses" value={String(stats.count)} />
          <Stat label="Avg ARV" value={formatMoney(stats.avg_arv)} />
          <Stat label="Avg As-Is" value={formatMoney(stats.avg_as_is)} />
          <Stat label="Avg repairs" value={formatMoney(stats.avg_repairs)} />
          <Stat
            label="Total Wholesale MAO"
            value={formatMoney(stats.total_wholesale_mao)}
            tone="emerald"
          />
          <Stat
            label="Total Novation MAO"
            value={formatMoney(stats.total_novation_mao)}
            tone="emerald"
          />
          <Stat
            label="Median comps"
            value={String(stats.median_comps_used)}
            hint={`${formatPct(stats.high_confidence_pct, 0)} high · ${formatPct(stats.low_confidence_pct, 0)} low`}
          />
        </section>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          Failed to load analyses: {error.message}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-ink-300 bg-white p-10 text-center">
          <div className="text-sm font-medium text-ink-700">
            {repFilter || teamFilter ? "No analyses match these filters." : "No analyses yet"}
          </div>
          <p className="mt-1 text-sm text-ink-500">
            {repFilter || teamFilter
              ? "Try clearing the filters to see all analyses."
              : "Run your first deal to see it here. The form will walk you through it."}
          </p>
          {!repFilter && !teamFilter ? (
            <Link
              href="/comping/new"
              className="mt-4 inline-block rounded-md bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-800"
            >
              Start your first analysis
            </Link>
          ) : null}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-ink-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <SortHeader col="created_at" current={sort} dir={dir} ctx={params}>
                  When
                </SortHeader>
                <th className="px-4 py-3">Property</th>
                <th className="px-4 py-3">Created by</th>
                <SortHeader col="arv" current={sort} dir={dir} ctx={params} align="right">
                  ARV
                </SortHeader>
                <SortHeader col="as_is_value" current={sort} dir={dir} ctx={params} align="right">
                  As-Is
                </SortHeader>
                <SortHeader col="repair_estimate" current={sort} dir={dir} ctx={params} align="right">
                  Repairs
                </SortHeader>
                <SortHeader col="wholesale_mao" current={sort} dir={dir} ctx={params} align="right">
                  Wholesale MAO
                </SortHeader>
                <SortHeader col="novation_mao" current={sort} dir={dir} ctx={params} align="right">
                  Novation MAO
                </SortHeader>
                <SortHeader col="comps_used" current={sort} dir={dir} ctx={params}>
                  Confidence
                </SortHeader>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {rows.map((r) => {
                const subj = r.comp_subjects;
                const creator = r.users;
                return (
                  <tr key={r.id} className="hover:bg-ink-50">
                    <td className="whitespace-nowrap px-4 py-3 text-ink-700">
                      <Link href={`/comping/${r.id}`}>{formatDateTime(r.created_at)}</Link>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/comping/${r.id}`} className="font-medium text-ink-900 hover:underline">
                        {subj?.address ?? "—"}
                      </Link>
                      <div className="text-xs text-ink-500">
                        {[subj?.city, subj?.state].filter(Boolean).join(", ") || "—"}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-700">
                      {creator?.full_name ?? creator?.email ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-medium">{formatMoney(r.arv)}</td>
                    <td className="px-4 py-3 text-right">{formatMoney(r.as_is_value)}</td>
                    <td className="px-4 py-3 text-right">
                      {formatMoney(r.repair_estimate)}
                      <div className="text-xs text-ink-500">{r.repair_level}</div>
                    </td>
                    <td className="px-4 py-3 text-right text-emerald-700">{formatMoney(r.wholesale_mao)}</td>
                    <td className="px-4 py-3 text-right text-emerald-700">{formatMoney(r.novation_mao)}</td>
                    <td className="px-4 py-3">
                      <ConfidencePill value={r.confidence_score} />
                      <div className="text-xs text-ink-500">
                        {r.comps_used} comps · {formatPct(r.buying_pct, 0)}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {totalPages > 1 ? (
            <Pagination page={page} totalPages={totalPages} totalCount={totalCount} ctx={params} />
          ) : null}
        </div>
      )}
      </div>
    </div>
  );
}

type Ctx = { rep?: string; team?: string; sort?: string; dir?: string; page?: string };

function buildHref(overrides: Partial<Ctx>, ctx: Ctx): string {
  const merged: Ctx = { ...ctx, ...overrides };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v != null && v !== "") params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `/comping?${qs}` : "/comping";
}

function SortHeader({
  col,
  current,
  dir,
  ctx,
  align,
  children,
}: {
  col: SortKey;
  current: SortKey;
  dir: "asc" | "desc";
  ctx: Ctx;
  align?: "right";
  children: React.ReactNode;
}) {
  const active = col === current;
  // Toggle direction on the active column; switch column → default desc
  // for "When" (newest first) and asc for the others.
  const nextDir = active ? (dir === "asc" ? "desc" : "asc") : col === "created_at" ? "desc" : "asc";
  const href = buildHref({ sort: col, dir: nextDir, page: "1" }, ctx);
  const arrow = active ? (dir === "asc" ? " ↑" : " ↓") : "";
  return (
    <th className={`px-4 py-3 ${align === "right" ? "text-right" : ""}`}>
      <Link
        href={href}
        className={`inline-flex items-center gap-1 hover:text-ink-900 ${active ? "text-ink-900" : ""}`}
      >
        {children}
        {arrow}
      </Link>
    </th>
  );
}

function Pagination({
  page,
  totalPages,
  totalCount,
  ctx,
}: {
  page: number;
  totalPages: number;
  totalCount: number;
  ctx: Ctx;
}) {
  const prev = Math.max(1, page - 1);
  const next = Math.min(totalPages, page + 1);
  const pageHref = (p: number) => buildHref({ page: String(p) }, ctx);
  return (
    <div className="flex items-center justify-between border-t border-ink-200 bg-ink-50 px-4 py-3 text-xs">
      <div className="text-ink-600">
        Page {page} of {totalPages} · {totalCount.toLocaleString()} total
      </div>
      <div className="flex items-center gap-1">
        <PageLink href={pageHref(1)} disabled={page === 1}>
          ‹‹ First
        </PageLink>
        <PageLink href={pageHref(prev)} disabled={page === 1}>
          ‹ Prev
        </PageLink>
        <PageLink href={pageHref(next)} disabled={page >= totalPages}>
          Next ›
        </PageLink>
        <PageLink href={pageHref(totalPages)} disabled={page >= totalPages}>
          Last ››
        </PageLink>
      </div>
    </div>
  );
}

function PageLink({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) {
    return (
      <span className="rounded border border-ink-200 bg-white px-2 py-1 text-ink-300">{children}</span>
    );
  }
  return (
    <Link
      href={href}
      className="rounded border border-ink-300 bg-white px-2 py-1 text-ink-700 hover:bg-ink-100"
    >
      {children}
    </Link>
  );
}

function csvHref(rep: string | null, team: string | null): string {
  const params = new URLSearchParams();
  if (rep) params.set("rep", rep);
  if (team) params.set("team", team);
  const qs = params.toString();
  return `/api/exports/comp-analyses.csv${qs ? `?${qs}` : ""}`;
}

function ConfidencePill({ value }: { value: "Low" | "Medium" | "High" }) {
  const cls =
    value === "High"
      ? "bg-emerald-100 text-emerald-800"
      : value === "Medium"
        ? "bg-amber-100 text-amber-800"
        : "bg-red-100 text-red-800";
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{value}</span>;
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "emerald";
}) {
  const valueCls = tone === "emerald" ? "text-emerald-900" : "text-ink-900";
  return (
    <div className="rounded-lg border border-ink-200 bg-white p-3">
      <div className="text-[10px] uppercase tracking-wide text-ink-500">{label}</div>
      <div className={`mt-1 text-base font-semibold ${valueCls}`}>{value}</div>
      {hint ? <div className="mt-0.5 text-[10px] text-ink-500">{hint}</div> : null}
    </div>
  );
}
