"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
// Pull pure helpers directly — the @/lib/comping barrel re-exports
// server-only modules (warmer, orchestrator) that would pull
// next/headers into the client bundle.
import { detectRepairLevel } from "@/lib/comping/repair-estimator";
import type { RepairLevel } from "@/lib/comping/types";
import { parseAddress } from "@/lib/address-parse";

interface ManualComp {
  status: "sold" | "active" | "pending";
  price: string;
  beds: string;
  baths: string;
  sqft: string;
  distance_mi: string;
  condition: "as_is" | "average" | "renovated";
  list_price?: string;
  dom_days?: string;
  close_date?: string;
}

const PROPERTY_TYPES = [
  { v: "single_family", l: "Single family" },
  { v: "townhouse", l: "Townhouse" },
  { v: "condo", l: "Condo" },
  { v: "multi_family", l: "Multi-family" },
  { v: "manufactured", l: "Manufactured" },
  { v: "land", l: "Land" },
] as const;

// Display labels reflect the user-facing rehab vocabulary.
const REPAIR_TIER_OPTIONS: Array<{
  value: RepairLevel;
  label: string;
  blurb: string;
  swatch: string;
}> = [
  { value: "Light",     label: "Turnkey",    blurb: "Move-in ready · $10–20/sqft", swatch: "from-money-500 to-money-700" },
  { value: "Moderate",  label: "Outdated",   blurb: "Cosmetic updates · $20–35/sqft", swatch: "from-sky2-500 to-sky2-700" },
  { value: "Heavy",     label: "Heavy",      blurb: "Major systems · $35–55/sqft", swatch: "from-flame-500 to-flame-700" },
  { value: "Full Gut",  label: "Full Gut",   blurb: "Down to studs · $55–85/sqft", swatch: "from-violet2-500 to-violet2-700" },
  { value: "Teardown",  label: "Teardown",   blurb: "Lot value only", swatch: "from-ink-700 to-ink-900" },
];

function labelFor(v: typeof PROPERTY_TYPES[number]["v"]): string {
  return PROPERTY_TYPES.find((t) => t.v === v)?.l ?? v;
}

interface AddressSuggestion {
  description: string;
}

export function CompCalculatorForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // ── Address ────────────────────────────────────────────────────
  const [fullAddress, setFullAddress] = useState("");
  const [parsed, setParsed] = useState(parseAddress(""));
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionsConfigured, setSuggestionsConfigured] = useState<boolean | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupNote, setLookupNote] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setParsed(parseAddress(fullAddress));
  }, [fullAddress]);

  // Debounced suggestion fetch.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (fullAddress.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/address/suggest?q=${encodeURIComponent(fullAddress)}`,
          { cache: "no-store" }
        );
        if (!res.ok) return;
        const j = (await res.json()) as {
          suggestions: AddressSuggestion[];
          configured?: boolean;
        };
        setSuggestions(j.suggestions ?? []);
        if (typeof j.configured === "boolean") setSuggestionsConfigured(j.configured);
      } catch {
        /* best-effort */
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fullAddress]);

  async function lookupSubject(query: ReturnType<typeof parseAddress>) {
    if (!query.address) return;
    setLookingUp(true);
    setLookupNote(null);
    try {
      const res = await fetch("/api/comp/lookup-subject", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: query.address,
          city: query.city,
          state: query.state,
          zip: query.zip,
        }),
      });
      const j = (await res.json()) as {
        subject: {
          beds: number;
          baths: number;
          sqft: number;
          year_built?: number;
          lot_sqft?: number;
          property_type?: typeof PROPERTY_TYPES[number]["v"];
        } | null;
        configured?: boolean;
      };
      if (!j.subject) {
        setLookupNote(
          j.configured === false
            ? "No property data providers configured — fill specs manually."
            : "Couldn't find this address in our data sources. Fill specs manually."
        );
        return;
      }
      setBeds(String(j.subject.beds));
      setBaths(String(j.subject.baths));
      setSqft(String(j.subject.sqft));
      if (j.subject.year_built) setYearBuilt(String(j.subject.year_built));
      if (j.subject.lot_sqft) setLotSqft(String(j.subject.lot_sqft));
      if (j.subject.property_type) setPropertyType(j.subject.property_type);
      setLookupNote("Auto-filled from property records — override anything that's wrong.");
    } catch {
      setLookupNote("Couldn't reach the lookup service. Fill specs manually.");
    } finally {
      setLookingUp(false);
    }
  }

  function pickSuggestion(s: AddressSuggestion) {
    setFullAddress(s.description);
    setShowSuggestions(false);
    setSuggestions([]);
    const p = parseAddress(s.description);
    setParsed(p);
    void lookupSubject(p);
  }

  function onAddressBlur() {
    // Hide the suggestions menu after a tick so a click registers.
    setTimeout(() => setShowSuggestions(false), 150);
    // Trigger lookup when the user pauses typing on a complete-looking address.
    if (parsed.address && (parsed.zip || parsed.state)) {
      void lookupSubject(parsed);
    }
  }

  // ── Subject specs ──────────────────────────────────────────────
  const [beds, setBeds] = useState("3");
  const [baths, setBaths] = useState("2");
  const [sqft, setSqft] = useState("1500");
  const [yearBuilt, setYearBuilt] = useState("");
  const [lotSqft, setLotSqft] = useState("");
  const [propertyType, setPropertyType] =
    useState<typeof PROPERTY_TYPES[number]["v"]>("single_family");
  const [garageStalls, setGarageStalls] = useState("");

  const isLand = propertyType === "land";
  useEffect(() => {
    if (isLand) {
      setBeds("0");
      setBaths("0");
      setSqft("1");
      setYearBuilt("");
      setGarageStalls("");
    }
  }, [isLand]);

  // ── Condition ──────────────────────────────────────────────────
  const [conditionText, setConditionText] = useState("");
  const [repairTier, setRepairTier] = useState<"auto" | RepairLevel>("auto");
  const autoTier = useMemo(() => detectRepairLevel(conditionText), [conditionText]);
  const tierMismatch =
    repairTier !== "auto" && !autoTier.empty && repairTier !== autoTier.level
      ? autoTier.level
      : null;

  // ── Pending % ──────────────────────────────────────────────────
  const [pendingPctInput, setPendingPctInput] = useState(""); // empty = auto
  const pendingPct = useMemo(() => {
    if (!pendingPctInput.trim()) return null;
    const n = Number(pendingPctInput);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.min(100, n));
  }, [pendingPctInput]);

  const wholesaleMultiplier = useMemo(() => {
    if (pendingPct == null) return null;
    const r = pendingPct / 100;
    if (r < 0.15) return 0.66;
    if (r < 0.25) return 0.68;
    if (r < 0.35) return 0.70;
    if (r < 0.45) return 0.73;
    return 0.75;
  }, [pendingPct]);
  const novationStance = useMemo(() => {
    if (pendingPct == null) return null;
    const r = pendingPct / 100;
    if (r < 0.15) return "very conservative";
    if (r < 0.30) return "conservative";
    return "standard";
  }, [pendingPct]);

  // ── Fees ───────────────────────────────────────────────────────
  const [wholesaleFee, setWholesaleFee] = useState("20000");
  const [novationFee, setNovationFee] = useState("40000");

  // ── Photos ─────────────────────────────────────────────────────
  const [photoUrlsText, setPhotoUrlsText] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoErr, setPhotoErr] = useState<string | null>(null);
  const [photoSummary, setPhotoSummary] = useState<string | null>(null);
  const [visionType, setVisionType] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setPhotoErr(null);
    setUploading(files.length);
    const newUrls: string[] = [];
    let errored = 0;
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/comp/upload-photo", { method: "POST", body: fd });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setPhotoErr(j.error ?? `Failed to upload ${file.name}`);
        errored++;
        continue;
      }
      const j = (await res.json()) as { url: string };
      newUrls.push(j.url);
    }
    setUploading(0);
    if (newUrls.length === 0) return;
    const merged = [photoUrlsText.trim(), ...newUrls].filter(Boolean).join("\n");
    setPhotoUrlsText(merged);
    if (errored === 0) setPhotoErr(null);
  }

  async function analyzePhotos() {
    const photo_urls = photoUrlsText
      .split(/\r?\n/)
      .map((u) => u.trim())
      .filter((u) => /^https?:\/\//i.test(u));
    if (photo_urls.length === 0) {
      setPhotoErr("Paste at least one http(s) photo URL.");
      return;
    }
    setPhotoBusy(true);
    setPhotoErr(null);
    setPhotoSummary(null);
    setVisionType(null);
    const res = await fetch("/api/comp/analyze-photos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ photo_urls }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setPhotoBusy(false);
      setPhotoErr(j.error ?? "Failed to analyze photos.");
      return;
    }
    const out = (await res.json()) as {
      condition: "as_is" | "average" | "renovated";
      condition_text: string;
      drivers: string[];
      summary: string;
      property_type: string | null;
    };
    if (out.condition_text) {
      const merged = [conditionText.trim(), out.condition_text.trim()]
        .filter(Boolean)
        .join(", ");
      setConditionText(merged);
    }
    if (out.property_type) setVisionType(out.property_type);
    setPhotoSummary(out.summary || `Overall condition: ${out.condition}.`);
    setPhotoBusy(false);
  }

  const propertyTypeMismatch =
    visionType != null &&
    visionType !== propertyType &&
    PROPERTY_TYPES.some((t) => t.v === visionType)
      ? (visionType as typeof PROPERTY_TYPES[number]["v"])
      : null;

  // ── Comps (manual paste) ──────────────────────────────────────
  const [comps, setComps] = useState<ManualComp[]>([]);
  const [showCompsPaste, setShowCompsPaste] = useState(false);
  const [compsCsv, setCompsCsv] = useState("");

  function addCompRow() {
    setComps((prev) => [
      ...prev,
      { status: "sold", price: "", beds, baths, sqft, distance_mi: "0.25", condition: "average" },
    ]);
  }
  function updateComp(i: number, patch: Partial<ManualComp>) {
    setComps((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }
  function removeComp(i: number) {
    setComps((prev) => prev.filter((_, idx) => idx !== i));
  }
  function parseCsv() {
    const lines = compsCsv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const out: ManualComp[] = [];
    for (const line of lines) {
      const parts = line.split(",").map((p) => p.trim());
      if (parts.length < 7) continue;
      out.push({
        status: (parts[0] as ManualComp["status"]) || "sold",
        price: parts[1],
        beds: parts[2],
        baths: parts[3],
        sqft: parts[4],
        distance_mi: parts[5],
        condition: (parts[6] as ManualComp["condition"]) || "average",
        list_price: parts[7],
        dom_days: parts[8],
      });
    }
    setComps((prev) => [...prev, ...out]);
    setCompsCsv("");
    setShowCompsPaste(false);
  }

  // ── Submit ────────────────────────────────────────────────────
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!parsed.address) {
      setErr("Address is required.");
      return;
    }
    setBusy(true);
    setErr(null);

    const subjectOverride = {
      address: parsed.address,
      city: parsed.city || undefined,
      state: parsed.state?.toUpperCase() || undefined,
      zip: parsed.zip || undefined,
      beds: Number(beds),
      baths: Number(baths),
      sqft: Number(sqft),
      year_built: yearBuilt ? Number(yearBuilt) : undefined,
      lot_sqft: lotSqft ? Number(lotSqft) : undefined,
      property_type: propertyType,
      garage_stalls: garageStalls ? Number(garageStalls) : undefined,
    };

    const compsOverride = comps
      .filter((c) => c.price || c.list_price)
      .map((c) => ({
        source: "manual",
        status: c.status,
        price: Number(c.price) || 0,
        list_price: c.list_price ? Number(c.list_price) : undefined,
        dom_days: c.dom_days ? Number(c.dom_days) : undefined,
        close_date: c.close_date || undefined,
        beds: Number(c.beds),
        baths: Number(c.baths),
        sqft: Number(c.sqft),
        distance_mi: Number(c.distance_mi),
        condition: c.condition,
        is_distressed: false,
        property_type: propertyType,
      }));

    const res = await fetch("/api/comp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "lookup",
        address: parsed.address,
        city: parsed.city || undefined,
        state: parsed.state?.toUpperCase() || undefined,
        zip: parsed.zip || undefined,
        condition_text: conditionText,
        repair_level: repairTier === "auto" ? undefined : repairTier,
        manual_pending_pct: pendingPct != null ? pendingPct / 100 : undefined,
        wholesale_fee: Number(wholesaleFee),
        novation_fee: Number(novationFee),
        subject_override: subjectOverride,
        comps_override: compsOverride.length > 0 ? compsOverride : undefined,
      }),
    });

    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setBusy(false);
      setErr(j.error ?? "Failed to run analysis.");
      return;
    }

    const json = (await res.json()) as { analysis_id: string | null };
    if (json.analysis_id) {
      router.push(`/comping/${json.analysis_id}`);
    } else {
      setBusy(false);
      setErr("Analysis ran but wasn't persisted (check provider keys + DB).");
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {/* Address — single bar with autocomplete + auto-fill */}
      <Section
        accent="brand"
        title="Property address"
        hint="Paste the full address. We'll auto-fill the specs from our property records."
      >
        <div className="relative">
          <div className="flex items-stretch gap-2">
            <div className="relative flex-1">
              <input
                value={fullAddress}
                onChange={(e) => {
                  setFullAddress(e.target.value);
                  setShowSuggestions(true);
                }}
                onFocus={() => setShowSuggestions(true)}
                onBlur={onAddressBlur}
                placeholder="123 Main St, San Antonio, TX 78230"
                className="w-full rounded-xl border-2 border-ink-200 bg-white px-4 py-3.5 text-base font-medium shadow-sm transition focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100"
              />
              {lookingUp ? (
                <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs font-medium text-brand-600">
                  Looking up…
                </span>
              ) : null}
              {showSuggestions && suggestions.length > 0 ? (
                <div className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-xl border border-ink-200 bg-white shadow-xl">
                  {suggestions.map((s, i) => (
                    <button
                      key={i}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        pickSuggestion(s);
                      }}
                      className="flex w-full items-center gap-3 border-b border-ink-100 px-4 py-3 text-left text-sm last:border-0 hover:bg-brand-50"
                    >
                      <span className="text-base">📍</span>
                      <span className="font-medium text-ink-900">{s.description}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => void lookupSubject(parsed)}
              disabled={!parsed.address || lookingUp}
              className="rounded-xl bg-brand-gradient px-5 text-sm font-semibold text-white shadow-md transition hover:brightness-110 disabled:opacity-40"
            >
              {lookingUp ? "Looking up…" : "Auto-fill"}
            </button>
          </div>

          {/* Parsed-component preview keeps the user oriented when they paste */}
          {parsed.address ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-500">
              <Pill>street: {parsed.address}</Pill>
              {parsed.city ? <Pill>city: {parsed.city}</Pill> : null}
              {parsed.state ? <Pill>state: {parsed.state}</Pill> : null}
              {parsed.zip ? <Pill>zip: {parsed.zip}</Pill> : null}
            </div>
          ) : null}

          {lookupNote ? (
            <div className="mt-3 rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 text-xs text-brand-700">
              {lookupNote}
            </div>
          ) : null}

          {suggestionsConfigured === false ? (
            <p className="mt-2 text-[11px] text-ink-400">
              Address autocomplete needs a Google Places API key
              (<code className="font-mono">GOOGLE_PLACES_API_KEY</code>). Pasting still works.
            </p>
          ) : null}
        </div>
      </Section>

      {/* Subject specs */}
      <Section
        accent="sky"
        title="Subject specs"
        hint={
          isLand
            ? "Vacant land — only lot size matters."
            : "Auto-filled from records — override anything that's wrong."
        }
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {!isLand && (
            <>
              <Field label="Beds">
                <input type="number" min={0} value={beds} onChange={(e) => setBeds(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Baths">
                <input type="number" min={0} step={0.5} value={baths} onChange={(e) => setBaths(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Living sqft">
                <input type="number" min={0} value={sqft} onChange={(e) => setSqft(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Year built">
                <input type="number" min={1800} max={2100} value={yearBuilt} onChange={(e) => setYearBuilt(e.target.value)} className={inputCls} />
              </Field>
            </>
          )}
          <Field label="Lot sqft" required={isLand}>
            <input type="number" min={0} value={lotSqft} onChange={(e) => setLotSqft(e.target.value)} className={inputCls} required={isLand} />
          </Field>
          {!isLand && (
            <Field label="Garage stalls">
              <input type="number" min={0} value={garageStalls} onChange={(e) => setGarageStalls(e.target.value)} className={inputCls} />
            </Field>
          )}
          <Field label="Property type">
            <select
              value={propertyType}
              onChange={(e) => setPropertyType(e.target.value as typeof PROPERTY_TYPES[number]["v"])}
              className={inputCls}
            >
              {PROPERTY_TYPES.map((t) => (
                <option key={t.v} value={t.v}>{t.l}</option>
              ))}
            </select>
          </Field>
        </div>
      </Section>

      {/* Rehab tier — big visual cards */}
      {!isLand && (
        <Section
          accent="violet"
          title="Rehab tier"
          hint="Pick the level that matches the property — drives the per-sqft repair cost."
        >
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-5">
            <TierCard
              active={repairTier === "auto"}
              onClick={() => setRepairTier("auto")}
              title="Auto"
              blurb={conditionText ? `from notes (${autoTier.level})` : "from notes"}
              swatch="from-ink-300 to-ink-500"
            />
            {REPAIR_TIER_OPTIONS.map((opt) => (
              <TierCard
                key={opt.value}
                active={repairTier === opt.value}
                onClick={() => setRepairTier(opt.value)}
                title={opt.label}
                blurb={opt.blurb}
                swatch={opt.swatch}
              />
            ))}
          </div>

          <div className="mt-4 space-y-3">
            <textarea
              value={conditionText}
              onChange={(e) => setConditionText(e.target.value)}
              rows={3}
              placeholder="Condition notes (optional). e.g. roof damage, outdated kitchen, foundation cracks…"
              className={`${inputCls} font-mono text-sm`}
            />
            {tierMismatch ? (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Heads up — your notes look like <strong>{tierMismatch}</strong> but you picked{" "}
                <strong>{REPAIR_TIER_OPTIONS.find((o) => o.value === repairTier)?.label ?? repairTier}</strong>.
                Pick "Auto" to let the engine decide.
              </div>
            ) : null}
          </div>
        </Section>
      )}

      {/* Pending % — drives wholesale multiplier + novation conservatism */}
      <Section
        accent="flame"
        title="Market pending %"
        hint="Pendings ÷ (actives + pendings) for the subject's market. Drives the wholesale multiplier and how conservative the novation as-is offer is. Leave blank to auto-detect from your comps."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Pending percentage">
            <div className="relative">
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={pendingPctInput}
                onChange={(e) => setPendingPctInput(e.target.value)}
                placeholder="auto"
                className={inputCls}
              />
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-ink-500">
                %
              </span>
            </div>
          </Field>
          <div className="md:col-span-2">
            <div className="grid grid-cols-2 gap-2">
              <PreviewTile
                label="Wholesale multiplier"
                value={wholesaleMultiplier != null ? `${(wholesaleMultiplier * 100).toFixed(0)}%` : "auto"}
                tone="money"
              />
              <PreviewTile
                label="Novation stance"
                value={novationStance ?? "auto"}
                tone={
                  novationStance === "very conservative" || novationStance === "conservative"
                    ? "flame"
                    : "money"
                }
              />
            </div>
            <p className="mt-2 text-[11px] text-ink-500">
              &lt;15% → 66% multiplier · 15–24% → 68% · 25–34% → 70% · 35–44% → 73% · 45%+ → 75%.
              Novation goes <strong>conservative</strong> below 30% and <strong>very conservative</strong> below 15%.
            </p>
          </div>
        </div>
      </Section>

      {/* Photos */}
      <Section
        accent="ink"
        title="Listing photos (optional)"
        hint="Upload files or paste photo URLs. Claude inspects them and pre-fills the condition notes."
      >
        <div className="mb-3 flex items-center gap-3">
          <label className="cursor-pointer rounded-md border border-ink-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-ink-100">
            {uploading > 0 ? `Uploading ${uploading}…` : "Upload photos"}
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              disabled={uploading > 0}
              onChange={(e) => {
                uploadFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          <span className="text-xs text-ink-500">JPG / PNG / WebP / HEIC up to 5MB each</span>
        </div>
        <textarea
          value={photoUrlsText}
          onChange={(e) => setPhotoUrlsText(e.target.value)}
          rows={2}
          placeholder={"https://example.com/photo1.jpg\nhttps://example.com/photo2.jpg"}
          className={`${inputCls} font-mono text-xs`}
        />
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={analyzePhotos}
            disabled={photoBusy}
            className="rounded-md border border-ink-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-ink-100 disabled:opacity-40"
          >
            {photoBusy ? "Analyzing…" : "Analyze photos"}
          </button>
          {photoSummary ? <span className="text-xs text-ink-500">{photoSummary}</span> : null}
        </div>
        {photoErr ? (
          <div className="mt-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-900">{photoErr}</div>
        ) : null}
        {propertyTypeMismatch ? (
          <div className="mt-2 flex items-center justify-between gap-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <span>
              Photos look like a <strong>{labelFor(propertyTypeMismatch)}</strong> but you picked{" "}
              <strong>{labelFor(propertyType)}</strong>.
            </span>
            <button
              type="button"
              onClick={() => {
                setPropertyType(propertyTypeMismatch);
                setVisionType(null);
              }}
              className="rounded-md border border-amber-400 bg-white px-2 py-1 text-xs font-medium hover:bg-amber-100"
            >
              Switch to {labelFor(propertyTypeMismatch)}
            </button>
          </div>
        ) : null}
      </Section>

      {/* Comps */}
      <Section
        accent="ink"
        title="Comps (optional)"
        hint="If you don't paste comps, the engine pulls them from configured providers."
      >
        <div className="space-y-3">
          {comps.map((c, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 rounded-md border border-ink-200 bg-ink-50 p-3 md:grid-cols-9">
              <select value={c.status} onChange={(e) => updateComp(i, { status: e.target.value as ManualComp["status"] })} className={smallInputCls}>
                <option value="sold">sold</option>
                <option value="active">active</option>
                <option value="pending">pending</option>
              </select>
              <input placeholder="Price" value={c.price} onChange={(e) => updateComp(i, { price: e.target.value })} className={smallInputCls} />
              <input placeholder="Beds" value={c.beds} onChange={(e) => updateComp(i, { beds: e.target.value })} className={smallInputCls} />
              <input placeholder="Baths" value={c.baths} onChange={(e) => updateComp(i, { baths: e.target.value })} className={smallInputCls} />
              <input placeholder="Sqft" value={c.sqft} onChange={(e) => updateComp(i, { sqft: e.target.value })} className={smallInputCls} />
              <input placeholder="Dist mi" value={c.distance_mi} onChange={(e) => updateComp(i, { distance_mi: e.target.value })} className={smallInputCls} />
              <select value={c.condition} onChange={(e) => updateComp(i, { condition: e.target.value as ManualComp["condition"] })} className={smallInputCls}>
                <option value="as_is">as_is</option>
                <option value="average">average</option>
                <option value="renovated">renovated</option>
              </select>
              <input placeholder="List $ (NDS)" value={c.list_price ?? ""} onChange={(e) => updateComp(i, { list_price: e.target.value })} className={smallInputCls} />
              <button type="button" onClick={() => removeComp(i)} className="rounded-md border border-ink-200 bg-white px-2 py-1 text-xs text-ink-700 hover:bg-red-50 hover:text-red-700">
                Remove
              </button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={addCompRow} className="rounded-md border border-ink-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-ink-100">
              + Add comp
            </button>
            <button type="button" onClick={() => setShowCompsPaste((v) => !v)} className="rounded-md border border-ink-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-ink-100">
              {showCompsPaste ? "Hide" : "Paste CSV"}
            </button>
          </div>
          {showCompsPaste && (
            <div className="space-y-2 rounded-md border border-ink-200 bg-white p-3">
              <div className="text-xs text-ink-500">
                One comp per line:{" "}
                <code className="text-ink-700">status,price,beds,baths,sqft,distance_mi,condition[,list_price,dom_days]</code>
              </div>
              <textarea
                rows={5}
                value={compsCsv}
                onChange={(e) => setCompsCsv(e.target.value)}
                placeholder={`sold,320000,3,2,1450,0.21,renovated\nsold,245000,3,2,1500,0.30,as_is\nactive,335000,3,2,1500,0.40,renovated`}
                className={`${inputCls} font-mono text-xs`}
              />
              <button type="button" onClick={parseCsv} className="rounded-md bg-ink-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-ink-800">
                Add to list
              </button>
            </div>
          )}
        </div>
      </Section>

      {/* Fees */}
      <Section accent="ink" title="Offer fees" hint="Tune to your operation's economics.">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Wholesale fee">
            <input type="number" min={0} value={wholesaleFee} onChange={(e) => setWholesaleFee(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Novation fee">
            <input type="number" min={0} value={novationFee} onChange={(e) => setNovationFee(e.target.value)} className={inputCls} />
          </Field>
        </div>
      </Section>

      {err ? (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">{err}</div>
      ) : null}

      <div className="sticky bottom-4 flex items-center gap-3 rounded-xl border border-ink-200 bg-white/90 p-3 shadow-lg backdrop-blur">
        <button
          type="submit"
          disabled={busy}
          className="flex-1 rounded-lg bg-brand-gradient px-5 py-3 text-base font-semibold text-white shadow-md transition hover:brightness-110 disabled:opacity-50"
        >
          {busy ? "Running analysis…" : "Run analysis →"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/comping")}
          className="rounded-lg border border-ink-300 bg-white px-5 py-3 text-sm font-medium hover:bg-ink-100"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

const inputCls =
  "w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100";
const smallInputCls =
  "w-full rounded-md border border-ink-300 bg-white px-2 py-1 text-xs focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-200";

const ACCENT_BAR: Record<string, string> = {
  brand:  "bg-brand-gradient",
  sky:    "bg-sky-gradient",
  money:  "bg-money-gradient",
  flame:  "bg-flame-gradient",
  violet: "bg-gradient-to-r from-violet2-500 to-violet2-700",
  ink:    "bg-gradient-to-r from-ink-400 to-ink-700",
};

function Section({
  accent = "ink",
  title,
  hint,
  children,
}: {
  accent?: "brand" | "sky" | "money" | "flame" | "violet" | "ink";
  title: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-sm">
      <div className={`h-1.5 w-full ${ACCENT_BAR[accent]}`} />
      <div className="p-5 md:p-6">
        <h2 className="text-base font-semibold text-ink-900">{title}</h2>
        {hint ? <p className="mt-1 text-xs text-ink-500">{hint}</p> : null}
        <div className="mt-4">{children}</div>
      </div>
    </section>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-700">
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </span>
      {children}
    </label>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-ink-200 bg-ink-50 px-2.5 py-0.5 text-[11px] font-medium text-ink-600">
      {children}
    </span>
  );
}

function TierCard({
  active,
  onClick,
  title,
  blurb,
  swatch,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  blurb: string;
  swatch: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative overflow-hidden rounded-xl border-2 p-3 text-left transition ${
        active
          ? "border-brand-500 bg-brand-50 shadow-md ring-2 ring-brand-100"
          : "border-ink-200 bg-white hover:border-ink-300 hover:bg-ink-50"
      }`}
    >
      <div className={`mb-2 h-1.5 w-8 rounded-full bg-gradient-to-r ${swatch}`} />
      <div className="text-sm font-semibold text-ink-900">{title}</div>
      <div className="mt-0.5 text-[11px] text-ink-500">{blurb}</div>
      {active ? (
        <span className="absolute right-2 top-2 text-[11px] font-bold text-brand-600">✓</span>
      ) : null}
    </button>
  );
}

function PreviewTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "money" | "flame";
}) {
  const cls =
    tone === "money"
      ? "bg-money-50 text-money-700 border-money-100"
      : "bg-flame-50 text-flame-700 border-flame-100";
  return (
    <div className={`rounded-xl border ${cls} px-3 py-2`}>
      <div className="text-[10px] font-semibold uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-0.5 text-base font-bold capitalize">{value}</div>
    </div>
  );
}
