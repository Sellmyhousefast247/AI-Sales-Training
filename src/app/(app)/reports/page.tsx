import Link from "next/link";

export default async function ReportsPage() {
  return (
    <div className="space-y-6 p-8">
      <header>
        <h1 className="text-2xl font-semibold">Reports</h1>
        <p className="text-sm text-ink-500">Exports and scheduled reports</p>
      </header>

      <section className="rounded-lg border border-ink-200 bg-white p-5">
        <div className="text-sm font-semibold">CSV exports</div>
        <ul className="mt-3 space-y-2 text-sm">
          <li>
            <Link href="/api/exports/calls.csv" className="text-ink-900 hover:underline">
              Calls (last 12 months)
            </Link>
          </li>
        </ul>
      </section>

      <section className="rounded-lg border border-ink-200 bg-white p-5">
        <div className="text-sm font-semibold">Scheduled reports</div>
        <p className="mt-2 text-sm text-ink-500">
          Weekly rep / company digests and monthly incentive reports ship in V2 with email delivery.
        </p>
      </section>
    </div>
  );
}
