import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/queries";
import { CompCalculatorForm } from "./CompCalculatorForm";

export default async function NewCompPage() {
  const profile = await getCurrentProfile();
  if (!profile?.company_id) redirect("/login");

  return (
    <div className="space-y-6 p-8">
      <header>
        <h1 className="text-2xl font-semibold">New analysis</h1>
        <p className="text-sm text-ink-500">
          Enter the property + condition. We'll handle ARV, repairs, and your offers.
        </p>
      </header>
      <CompCalculatorForm />
    </div>
  );
}
