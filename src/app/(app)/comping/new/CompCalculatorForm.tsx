"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
] as const;

function labelFor(v: typeof PROPERTY_TYPES[number]["v"]): string {
  return PROPERTY_TYPES.find((t) => t.v === v)?.l ?? v;
}

export function CompCalculatorForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [stateAbbr, setStateAbbr] = useState("");
  const [zip, setZip] = useState("");

  const [beds, setBeds] = useState("3");
  const [baths, setBaths] = useState("2");
  const [sqft, setSqft] = useState("1500");
  const [yearBuilt, setYearBuilt] = useState("");
  const [lotSqft, setLotSqft] = useState("");
  const [propertyType, setPropertyType] = useState<typeof PROPERTY_TYPES[number]["v"]>("single_family");
  const [garageStalls, setGarageStalls] = useState("");

  const [conditionText, setConditionText] = useState("");
  const [wholesaleFee, setWholesaleFee] = useState("20000");
  const [novationFee, setNovationFee] = useState("40000");

  // Photo-driven condition pre-fill — the user pastes URLs (one per line)
  // or uploads files; vision fills the condition_text textarea.
  const [photoUrlsText, setPhotoUrlsText] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoErr, setPhotoErr] = useState<string | null>(null);
  const [photoSummary, setPhotoSummary] = useState<string | null>(null);
  // Vision can return any property type the engine knows about — including
  // ones that aren't in the dropdown (e.g. "land"). We keep the raw string
  // and only surface the mismatch when it's a switchable option below.
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
      // Append to anything the user already typed instead of overwriting.
      const merged = [conditionText.trim(), out.condition_text.trim()]
        .filter(Boolean)
        .join(", ");
      setConditionText(merged);
    }
    if (out.property_type) {
      setVisionType(out.property_type);
    }
    setPhotoSummary(out.summary || `Overall condition: ${out.condition}.`);
    setPhotoBusy(false);
  }

  // Only surface the mismatch when the vision-detected type is one we can
  // switch the dropdown to. Out-of-bounds types (e.g. "land") are noted in
  // the summary but don't drive a one-click switch.
  const propertyTypeMismatch =
    visionType != null &&
    visionType !== propertyType &&
    PROPERTY_TYPES.some((t) => t.v === visionType)
      ? (visionType as typeof PROPERTY_TYPES[number]["v"])
      : null;

  const [comps, setComps] = useState<ManualComp[]>([]);
  const [showCompsPaste, setShowCompsPaste] = useState(false);
  const [compsCsv, setCompsCsv] = useState("");

  function addCompRow() {
    setComps((prev) => [
      ...prev,
      {
        status: "sold",
        price: "",
        beds,
        baths,
        sqft,
        distance_mi: "0.25",
        condition: "average",
      },
    ]);
  }

  function updateComp(i: number, patch: Partial<ManualComp>) {
    setComps((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }

  function removeComp(i: number) {
    setComps((prev) => prev.filter((_, idx) => idx !== i));
  }

  function parseCsv() {
    // Format: status,price,beds,baths,sqft,distance_mi,condition[,list_price,dom_days]
    const lines = compsCsv
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const parsed: ManualComp[] = [];
    for (const line of lines) {
      const parts = line.split(",").map((p) => p.trim());
      if (parts.length < 7) continue;
      parsed.push({
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
    setComps((prev) => [...prev, ...parsed]);
    setCompsCsv("");
    setShowCompsPaste(false);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!address.trim()) {
      setErr("Address is required.");
      return;
    }
    setBusy(true);
    setErr(null);

    const subjectOverride = {
      address: address.trim(),
      city: city.trim() || undefined,
      state: stateAbbr.trim().toUpperCase() || undefined,
      zip: zip.trim() || undefined,
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
        address: address.trim(),
        city: city.trim() || undefined,
        state: stateAbbr.trim().toUpperCase() || undefined,
        zip: zip.trim() || undefined,
        condition_text: conditionText,
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
    <form onSubmit={onSubmit} className="space-y-8">
      {/* Address */}
      <Section title="Property address" hint="Where is this deal?">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Street address" required>
            <input
              required
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="123 Main St"
              className={inputCls}
            />
          </Field>
          <Field label="City">
            <input value={city} onChange={(e) => setCity(e.target.value)} className={inputCls} />
          </Field>
          <Field label="State (2 letters)">
            <input
              maxLength={2}
              value={stateAbbr}
              onChange={(e) => setStateAbbr(e.target.value)}
              placeholder="TX"
              className={inputCls}
            />
          </Field>
          <Field label="ZIP">
            <input value={zip} onChange={(e) => setZip(e.target.value)} className={inputCls} />
          </Field>
        </div>
      </Section>

      {/* Subject specs */}
      <Section title="Subject specs" hint="Tell us about the house.">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field label="Beds">
            <input type="number" min={0} value={beds} onChange={(e) => setBeds(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Baths">
            <input
              type="number"
              min={0}
              step={0.5}
              value={baths}
              onChange={(e) => setBaths(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Living sqft">
            <input type="number" min={0} value={sqft} onChange={(e) => setSqft(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Year built">
            <input
              type="number"
              min={1800}
              max={2100}
              value={yearBuilt}
              onChange={(e) => setYearBuilt(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Lot sqft">
            <input
              type="number"
              min={0}
              value={lotSqft}
              onChange={(e) => setLotSqft(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Garage stalls">
            <input
              type="number"
              min={0}
              value={garageStalls}
              onChange={(e) => setGarageStalls(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Property type">
            <select
              value={propertyType}
              onChange={(e) => setPropertyType(e.target.value as typeof PROPERTY_TYPES[number]["v"])}
              className={inputCls}
            >
              {PROPERTY_TYPES.map((t) => (
                <option key={t.v} value={t.v}>
                  {t.l}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Section>

      {/* Photos (optional) — pre-fills condition via Claude vision. */}
      <Section
        title="Listing photos (optional)"
        hint="Upload files or paste photo URLs one per line. Claude will inspect them and pre-fill the condition box below."
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
          <span className="text-xs text-ink-500">
            JPG / PNG / WebP / HEIC up to 5MB each
          </span>
        </div>
        <textarea
          value={photoUrlsText}
          onChange={(e) => setPhotoUrlsText(e.target.value)}
          rows={3}
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
          {photoSummary ? (
            <span className="text-xs text-ink-500">{photoSummary}</span>
          ) : null}
        </div>
        {photoErr ? (
          <div className="mt-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-900">
            {photoErr}
          </div>
        ) : null}
        {propertyTypeMismatch ? (
          <div className="mt-2 flex items-center justify-between gap-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <span>
              Photos look like a{" "}
              <strong>{labelFor(propertyTypeMismatch)}</strong> but you picked{" "}
              <strong>{labelFor(propertyType)}</strong>. Mixing types can throw
              off the comp set — comps are filtered by type.
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

      {/* Condition */}
      <Section title="Condition notes" hint="Describe what needs to be fixed. Be specific — we use this to size repairs.">
        <textarea
          value={conditionText}
          onChange={(e) => setConditionText(e.target.value)}
          rows={4}
          placeholder="e.g. Roof damage, outdated kitchen, foundation cracks, full rehab needed."
          className={`${inputCls} font-mono text-sm`}
        />
      </Section>

      {/* Comps */}
      <Section
        title="Comps"
        hint={
          <>
            Optional. If you don't paste comps, the engine pulls them from configured providers
            (ATTOM/Bridge/RentCast). Need none? Leave it empty for a repair-only estimate.
          </>
        }
      >
        <div className="space-y-3">
          {comps.map((c, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 rounded-md border border-ink-200 bg-ink-50 p-3 md:grid-cols-9">
              <select
                value={c.status}
                onChange={(e) => updateComp(i, { status: e.target.value as ManualComp["status"] })}
                className={smallInputCls}
              >
                <option value="sold">sold</option>
                <option value="active">active</option>
                <option value="pending">pending</option>
              </select>
              <input
                placeholder="Price"
                value={c.price}
                onChange={(e) => updateComp(i, { price: e.target.value })}
                className={smallInputCls}
              />
              <input
                placeholder="Beds"
                value={c.beds}
                onChange={(e) => updateComp(i, { beds: e.target.value })}
                className={smallInputCls}
              />
              <input
                placeholder="Baths"
                value={c.baths}
                onChange={(e) => updateComp(i, { baths: e.target.value })}
                className={smallInputCls}
              />
              <input
                placeholder="Sqft"
                value={c.sqft}
                onChange={(e) => updateComp(i, { sqft: e.target.value })}
                className={smallInputCls}
              />
              <input
                placeholder="Dist mi"
                value={c.distance_mi}
                onChange={(e) => updateComp(i, { distance_mi: e.target.value })}
                className={smallInputCls}
              />
              <select
                value={c.condition}
                onChange={(e) => updateComp(i, { condition: e.target.value as ManualComp["condition"] })}
                className={smallInputCls}
              >
                <option value="as_is">as_is</option>
                <option value="average">average</option>
                <option value="renovated">renovated</option>
              </select>
              <input
                placeholder="List $ (NDS)"
                value={c.list_price ?? ""}
                onChange={(e) => updateComp(i, { list_price: e.target.value })}
                className={smallInputCls}
              />
              <button
                type="button"
                onClick={() => removeComp(i)}
                className="rounded-md border border-ink-200 bg-white px-2 py-1 text-xs text-ink-700 hover:bg-red-50 hover:text-red-700"
              >
                Remove
              </button>
            </div>
          ))}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={addCompRow}
              className="rounded-md border border-ink-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-ink-100"
            >
              + Add comp
            </button>
            <button
              type="button"
              onClick={() => setShowCompsPaste((v) => !v)}
              className="rounded-md border border-ink-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-ink-100"
            >
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
              <button
                type="button"
                onClick={parseCsv}
                className="rounded-md bg-ink-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-ink-800"
              >
                Add to list
              </button>
            </div>
          )}
        </div>
      </Section>

      {/* Fees */}
      <Section title="Offer fees" hint="Tune the formulas if your numbers differ.">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Wholesale fee">
            <input
              type="number"
              min={0}
              value={wholesaleFee}
              onChange={(e) => setWholesaleFee(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Novation fee">
            <input
              type="number"
              min={0}
              value={novationFee}
              onChange={(e) => setNovationFee(e.target.value)}
              className={inputCls}
            />
          </Field>
        </div>
      </Section>

      {err ? (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">{err}</div>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-ink-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-50"
        >
          {busy ? "Running…" : "Run analysis"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/comping")}
          className="rounded-md border border-ink-300 bg-white px-5 py-2.5 text-sm font-medium hover:bg-ink-100"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

const inputCls =
  "w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-ink-500 focus:outline-none focus:ring-1 focus:ring-ink-500";
const smallInputCls =
  "w-full rounded-md border border-ink-300 bg-white px-2 py-1 text-xs focus:border-ink-500 focus:outline-none focus:ring-1 focus:ring-ink-500";

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-ink-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
      {hint ? <p className="mt-1 text-xs text-ink-500">{hint}</p> : null}
      <div className="mt-4">{children}</div>
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
