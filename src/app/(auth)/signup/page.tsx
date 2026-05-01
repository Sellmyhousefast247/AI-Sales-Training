"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function SignupPage() {
  const router = useRouter();
  const [companyName, setCompanyName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName, company_name: companyName },
        emailRedirectTo: `${window.location.origin}/api/auth/confirmed`,
      },
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }

    // Provision the company server-side now that we have a session
    const res = await fetch("/api/companies/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ company_name: companyName, full_name: fullName }),
    });
    if (!res.ok) {
      let detail = `${res.status}`;
      try {
        const j = await res.json();
        detail = j?.error?.message ?? JSON.stringify(j);
      } catch {
        try { detail = await res.text(); } catch {}
      }
      setErr(`Workspace setup failed: ${detail}`);
      return;
    }

    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <main className="grid min-h-screen place-items-center bg-ink-50 px-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm rounded-lg border border-ink-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold">Create your workspace</h1>
        <p className="mt-1 text-sm text-ink-500">Free 14-day trial. No card required.</p>

        <Field label="Company name" value={companyName} onChange={setCompanyName} required />
        <Field label="Your name" value={fullName} onChange={setFullName} required />
        <Field label="Work email" type="email" value={email} onChange={setEmail} required />
        <Field label="Password" type="password" value={password} onChange={setPassword} required />

        {err ? <div className="mt-4 text-sm text-red-600">{err}</div> : null}

        <button
          disabled={busy}
          className="mt-6 w-full rounded-md bg-ink-900 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create workspace"}
        </button>

        <div className="mt-4 text-center text-sm text-ink-500">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-ink-900 hover:underline">
            Sign in
          </Link>
        </div>
      </form>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <div className="mt-4">
      <label className="block text-sm font-medium">{label}</label>
      <input
        type={type}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-ink-300 px-3 py-2 text-sm"
      />
    </div>
  );
}
