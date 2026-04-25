import { redirect } from "next/navigation";
import { getCurrentProfile, getRepsBasic } from "@/lib/queries";
import { NewCallForm } from "./NewCallForm";

export default async function NewCallPage() {
  const profile = await getCurrentProfile();
  if (!profile?.company_id) redirect("/login");
  const reps = await getRepsBasic(profile.company_id);

  return (
    <div className="space-y-6 p-8">
      <header>
        <h1 className="text-2xl font-semibold">New call</h1>
        <p className="text-sm text-ink-500">Paste a transcript. We'll score it and surface coaching.</p>
      </header>

      <NewCallForm reps={reps.map((r) => ({ id: r.id, full_name: r.full_name }))} />
    </div>
  );
}
