import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/queries";
import { CompCalculatorForm } from "./CompCalculatorForm";

export default async function NewCompPage() {
  const profile = await getCurrentProfile();
  if (!profile?.company_id) redirect("/login");

  return (
    <div className="min-h-full bg-ink-50">
      <div className="bg-brand-gradient">
        <div className="mx-auto max-w-5xl px-6 py-8 text-white md:px-10 md:py-10">
          <Link
            href="/comping"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-white/70 transition hover:text-white"
          >
            ← All analyses
          </Link>
          <h1 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
            New comp · while they're on hold
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-white/80 md:text-base">
            Paste the address, confirm the specs, hit run. Wholesale and novation
            offers come back ready to read off the script.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 py-8 md:px-10">
        <CompCalculatorForm />
      </div>
    </div>
  );
}
