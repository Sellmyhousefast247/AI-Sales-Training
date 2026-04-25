import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-ink-900 to-ink-700 text-white">
      <header className="flex items-center justify-between px-8 py-6">
        <div className="text-lg font-semibold">Acquisitions AI OS</div>
        <nav className="flex gap-4">
          <Link href="/login" className="text-sm text-ink-200 hover:text-white">Sign in</Link>
          <Link href="/signup" className="rounded-md bg-brand-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90">
            Start free
          </Link>
        </nav>
      </header>

      <section className="mx-auto max-w-3xl px-8 py-24 text-center">
        <h1 className="text-5xl font-bold leading-tight">Score every seller call. Coach every rep. Pay the right people.</h1>
        <p className="mt-6 text-lg text-ink-200">
          Paste a transcript. Get a 10-category scorecard, a coaching script, and a tier in 60 seconds.
          Built for real estate acquisitions teams.
        </p>
        <div className="mt-10 flex justify-center gap-4">
          <Link href="/signup" className="rounded-md bg-brand-accent px-6 py-3 font-medium hover:opacity-90">
            Start free
          </Link>
          <Link href="/login" className="rounded-md border border-ink-400 px-6 py-3 font-medium hover:bg-ink-800">
            Sign in
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-8 pb-24">
        <div className="grid gap-6 md:grid-cols-3">
          <Feature title="10-category scoring" body="Opening, rapport, discovery, questioning, control, objections, value, offer, close, conversion likelihood." />
          <Feature title="Tier system" body="5-tier ladder driven by rolling averages. Promote the right reps, retrain the rest." />
          <Feature title="Coaching that acts" body="Per-call rewrite of what the rep should have said. Weekly drills. Manager digest." />
        </div>
      </section>
    </main>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-800/50 p-6">
      <div className="font-semibold">{title}</div>
      <p className="mt-2 text-sm text-ink-300">{body}</p>
    </div>
  );
}
