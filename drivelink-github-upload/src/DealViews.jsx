// src/DealViews.jsx
//
// Bring-your-own-deal: escrow for a car the two parties already found
// elsewhere. Two views, written to your existing conventions — plain function
// components taking props, inline styles from a `dealStyles` object at the
// bottom, no react-router, no Tailwind.
//
// StartDealView  → /deals/new   the person creating the deal
// JoinDealView   → /d/:token    the counterparty opening the link
//
// The price field is typed in whole dollars and posted that way. create-deal
// converts to cents at the door; everything that comes BACK from the server
// (car.price on a preview) is cents, so it is divided before display.

import { useState, useEffect } from "react";
import { supabase } from "./supabase";

const currentYear = new Date().getFullYear();

// Standing Promoter attribution, 3-day window. Key and TTL mirror App.jsx —
// duplicated rather than imported because App.jsx imports this file, and
// pulling the other way would make the cycle.
const PROMO_KEY = "dl_promoter_code";
const PROMO_TTL_MS = 3 * 24 * 60 * 60 * 1000;

function readPromoterCode() {
  try {
    const raw = localStorage.getItem(PROMO_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p?.code || Date.now() - p.at > PROMO_TTL_MS) {
      localStorage.removeItem(PROMO_KEY);
      return null;
    }
    return p.code;
  } catch { return null; }
}

function clearPromoterCode() {
  try { localStorage.removeItem(PROMO_KEY); } catch { /* nothing to clear */ }
}

// ============================================================================
// StartDealView
// ============================================================================

export function StartDealView({ currentUser, onBack, onNavigate, showToast }) {
  const [role, setRole] = useState("seller");
  const [form, setForm] = useState({
    vin: "", year: "", make: "", model: "", mileage: "", price: "", note: "",
  });
  const [decoding, setDecoding] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const [referrer, setReferrer] = useState(null);

  // Who sent them here, if anyone. promoter_codes is RLS-scoped to its owner,
  // so this has to go through an Edge Function rather than a direct select.
  // A failed lookup is not an error worth showing — the deal works either way.
  useEffect(() => {
    const code = readPromoterCode();
    if (!code) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.functions.invoke("resolve-promoter-code", {
          body: { code },
        });
        if (!cancelled && data?.name) setReferrer(data.name);
      } catch { /* no referrer shown */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function decodeVin() {
    const vin = form.vin.trim().toUpperCase();
    if (vin.length !== 17) {
      setError("A VIN is 17 characters. You can skip it and type the details instead.");
      return;
    }
    setDecoding(true);
    setError(null);
    try {
      const res = await fetch(
        `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/${vin}?format=json`,
      );
      const data = await res.json();
      const r = data?.Results?.[0];
      if (!r?.Make) {
        setError("That VIN did not return anything. Type the details instead.");
        return;
      }
      setForm((f) => ({
        ...f,
        vin,
        year: r.ModelYear || f.year,
        make: r.Make ? titleCase(r.Make) : f.make,
        model: r.Model || f.model,
        note: r.Trim && !f.note ? r.Trim : f.note,
      }));
    } catch {
      setError("Could not reach the VIN lookup. Type the details instead.");
    } finally {
      setDecoding(false);
    }
  }

  async function createDeal() {
    setSubmitting(true);
    setError(null);
    setNeedsOnboarding(false);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("create-deal", {
        body: {
          role,
          vin: form.vin || null,
          year: form.year,
          make: form.make,
          model: form.model,
          mileage: form.mileage || 0,
          price: form.price,
          note: form.note || null,
          promoter_code: readPromoterCode(),
        },
      });

      if (fnErr) { setError("Could not create the deal. Try again."); return; }
      if (data?.error) { setError(data.error); return; }
      if (data?.needs_onboarding) { setNeedsOnboarding(true); return; }

      // Attribution is spent. The promoter earns on the deal they referred, not
      // on everything this person does for the next 30 days — and the signed-out
      // screen promises they can start a later deal without a referral fee.
      clearPromoterCode();

      setResult(data);
      showToast?.("Deal created — send the link to the other party.");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(result.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast?.("Copy failed — select the link and copy it manually.", "error");
    }
  }

  if (!currentUser) {
    return (
      <div style={dealStyles.page}>
        <div style={dealStyles.inner}>
          {referrer && (
            <div style={dealStyles.inviteEyebrow}>Referred by {referrer}</div>
          )}
          <h1 style={dealStyles.title}>Buying a car from someone you've never met?</h1>
          <p style={dealStyles.sub}>
            DriveLink holds the money until the car is actually handed over, so
            neither side has to go first.
          </p>

          <div style={dealStyles.stepsWrap}>
            <ol style={dealStyles.steps}>
              <li style={dealStyles.step}>
                The buyer pays into escrow. The seller can see the funds are
                secured, but can't touch them yet.
              </li>
              <li style={dealStyles.step}>
                The seller ships or delivers the car.
              </li>
              <li style={dealStyles.step}>
                At handover the buyer gives the seller a 6-digit code. Entering
                it releases the money. No code, no payout.
              </li>
            </ol>
          </div>

          <div style={dealStyles.priceCard}>
            <div style={dealStyles.eyebrow}>What it costs</div>
            <div style={dealStyles.priceRow}>
              <span style={dealStyles.priceLabel}>DriveLink escrow fee</span>
              <span style={dealStyles.vinValue}>1%</span>
            </div>
            {referrer && (
              <div style={{ ...dealStyles.priceRow, marginTop: 10 }}>
                <span style={dealStyles.priceLabel}>
                  Referral fee — goes to {referrer}
                </span>
                <span style={dealStyles.vinValue}>1%</span>
              </div>
            )}
            {referrer && (
              <div style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.6, marginTop: 12 }}>
                The referral fee is how {referrer} is paid for sending you here.
                You can also start a deal directly at drivelink.deals without one.
              </div>
            )}
          </div>

          <button style={dealStyles.primaryBtn} onClick={() => onNavigate?.("auth")}>
            Create an account to start
          </button>
          <p style={{ fontSize: 13, color: "#6b7280", marginTop: 12, textAlign: "center" }}>
            Free to set up. You're only charged when a deal goes through.
          </p>
        </div>
      </div>
    );
  }

  // ---- link created --------------------------------------------------------
  if (result) {
    const them = role === "seller" ? "the buyer" : "the seller";
    return (
      <div style={dealStyles.page}>
        <div style={dealStyles.inner}>
          {onBack && <button style={dealStyles.backBtn} onClick={onBack}>← Back</button>}
          <h1 style={dealStyles.title}>Your deal is ready</h1>
          <p style={dealStyles.sub}>Send this link to {them}. No money moves until you both agree.</p>

          <div style={dealStyles.linkBox}>
            <div style={dealStyles.eyebrow}>Deal link</div>
            <div style={dealStyles.linkText}>{result.url}</div>
          </div>

          <button style={dealStyles.primaryBtn} onClick={copyLink}>
            {copied ? "Copied" : "Copy link"}
          </button>

          <div style={dealStyles.stepsWrap}>
            <div style={dealStyles.eyebrow}>What happens next</div>
            <ol style={dealStyles.steps}>
              <li style={dealStyles.step}>{cap(them)} opens the link and confirms the car and price.</li>
              <li style={dealStyles.step}>The buyer pays into escrow. DriveLink holds the money.</li>
              <li style={dealStyles.step}>
                The car and title change hands, the buyer confirms, and the seller is paid out.
              </li>
            </ol>
          </div>
        </div>
      </div>
    );
  }

  // ---- form ---------------------------------------------------------------
  const canSubmit =
    form.make.trim() && form.model.trim() && Number(form.year) > 1900 && Number(form.price) > 0;

  return (
    <div style={dealStyles.page}>
      <div style={dealStyles.inner}>
        {onBack && <button style={dealStyles.backBtn} onClick={onBack}>← Back</button>}
        <h1 style={dealStyles.title}>Start a secure deal</h1>
        <p style={dealStyles.sub}>
          Already found the car somewhere else? Use DriveLink to handle the money.
        </p>

        <div style={dealStyles.eyebrow}>In this deal, you are the</div>
        <div style={dealStyles.roleRow}>
          {["seller", "buyer"].map((r) => (
            <button
              key={r}
              onClick={() => setRole(r)}
              style={{ ...dealStyles.roleBtn, ...(role === r ? dealStyles.roleBtnActive : null) }}
            >
              {cap(r)}
            </button>
          ))}
        </div>

        <div style={dealStyles.fieldLabel}>VIN (optional — fills in the rest)</div>
        <div style={dealStyles.vinRow}>
          <input
            value={form.vin}
            onChange={set("vin")}
            maxLength={17}
            placeholder="1HGCM82633A004352"
            style={{ ...dealStyles.input, textTransform: "uppercase", fontFamily: "ui-monospace, monospace" }}
          />
          <button onClick={decodeVin} disabled={decoding} style={dealStyles.secondaryBtn}>
            {decoding ? "…" : "Look up"}
          </button>
        </div>

        <div style={dealStyles.grid2}>
          <Field label="Year" value={form.year} onChange={set("year")} placeholder={String(currentYear - 6)} />
          <Field label="Make" value={form.make} onChange={set("make")} placeholder="Toyota" />
        </div>
        <div style={dealStyles.grid2}>
          <Field label="Model" value={form.model} onChange={set("model")} placeholder="Tacoma" />
          <Field label="Mileage" value={form.mileage} onChange={set("mileage")} placeholder="84000" />
        </div>
        <div style={dealStyles.grid2}>
          <Field label="Agreed price" value={form.price} onChange={set("price")} placeholder="18500" prefix="$" />
          <Field label="Trim or notes" value={form.note} onChange={set("note")} placeholder="SR5, one owner" />
        </div>

        {error && <div style={dealStyles.errorBox}>{error}</div>}

        {needsOnboarding && (
          <div style={dealStyles.warnBox}>
            <div style={{ marginBottom: 12 }}>
              Set up payouts before you send the link. The buyer cannot fund a deal until you can
              receive the money.
            </div>
            <button style={dealStyles.primaryBtnInline} onClick={() => onNavigate?.("profile")}>
              Set up payouts
            </button>
          </div>
        )}

        <button
          onClick={createDeal}
          disabled={!canSubmit || submitting}
          style={{ ...dealStyles.primaryBtn, ...(!canSubmit || submitting ? dealStyles.btnDisabled : null) }}
        >
          {submitting ? "Creating…" : "Create deal link"}
        </button>

        <div style={dealStyles.finePrint}>
          DriveLink holds the funds until the buyer confirms the car. 1% seller fee, taken at payout.
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// JoinDealView
// ============================================================================

export function JoinDealView({ token, currentUser, onNavigate, onJoined, showToast }) {
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [joining, setJoining] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  useEffect(() => {
    // Survive the sign-up round trip.
    try { localStorage.setItem("dl_pending_deal", token); } catch { /* private mode */ }

    let cancelled = false;
    (async () => {
      const { data, error: fnErr } = await supabase.functions.invoke("accept-deal-invite", {
        body: { token, action: "preview" },
      });
      if (cancelled) return;
      if (fnErr) setError("Could not load this deal.");
      else if (data?.error) setError(data.error);
      else setPreview(data);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [token]);

  async function join() {
    setJoining(true);
    setError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("accept-deal-invite", {
        body: { token, action: "accept" },
      });
      if (fnErr) { setError("Could not join this deal."); return; }
      if (data?.error) { setError(data.error); return; }

      if (data.state === "needs_onboarding") { setNeedsOnboarding(true); return; }

      if (data.state === "ready_for_payment") {
        try { localStorage.removeItem("dl_pending_deal"); } catch { /* noop */ }
        showToast?.("You're in. Review the car and continue.");
        onJoined?.(data.listing_id);
      }
    } finally {
      setJoining(false);
    }
  }

  if (loading) {
    return (
      <div style={dealStyles.page}>
        <div style={dealStyles.inner}><p style={dealStyles.sub}>Loading deal…</p></div>
      </div>
    );
  }

  if (error && !preview) {
    return (
      <div style={dealStyles.page}>
        <div style={dealStyles.inner}>
          <h1 style={dealStyles.title}>This link doesn't work</h1>
          <p style={dealStyles.sub}>{error}</p>
          <button style={dealStyles.secondaryBtn} onClick={() => onNavigate?.("home")}>
            Go to DriveLink
          </button>
        </div>
      </div>
    );
  }

  const { car, your_role: yourRole, state } = preview;
  const isSeller = yourRole === "seller";
  const title = [car.year, car.make, car.model].filter(Boolean).join(" ");

  if (state === "already_accepted") {
    return (
      <div style={dealStyles.page}>
        <div style={dealStyles.inner}>
          <h1 style={dealStyles.title}>Someone already joined</h1>
          <p style={dealStyles.sub}>This deal is no longer open. Ask for a new link.</p>
          <button style={dealStyles.secondaryBtn} onClick={() => onNavigate?.("home")}>
            Go to DriveLink
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={dealStyles.page}>
      <div style={dealStyles.inner}>
        <div style={dealStyles.inviteEyebrow}>Secure deal invitation</div>
        <h1 style={dealStyles.title}>{title}</h1>
        <p style={dealStyles.sub}>
          {car.mileage ? `${Number(car.mileage).toLocaleString()} miles` : "Mileage not given"}
          {car.note ? ` · ${car.note}` : ""}
        </p>

        <div style={dealStyles.priceCard}>
          <div style={dealStyles.priceRow}>
            <span style={dealStyles.priceLabel}>Agreed price</span>
            <span style={dealStyles.priceValue}>${(Number(car.price) / 100).toLocaleString()}</span>
          </div>
          {car.vin && (
            <div style={dealStyles.vinRowSmall}>
              <span style={dealStyles.priceLabel}>VIN</span>
              <span style={dealStyles.vinValue}>{car.vin}</span>
            </div>
          )}
        </div>

        <div style={dealStyles.stepsWrap}>
          <div style={dealStyles.eyebrow}>You are joining as the {yourRole}</div>
          <ol style={dealStyles.steps}>
            {isSeller ? (
              <>
                <li style={dealStyles.step}>Confirm the car and price, and set up payouts.</li>
                <li style={dealStyles.step}>The buyer pays into escrow. You never wait on a cheque to clear.</li>
                <li style={dealStyles.step}>Hand over the car and title. The funds are released to your bank.</li>
              </>
            ) : (
              <>
                <li style={dealStyles.step}>Confirm the car and price.</li>
                <li style={dealStyles.step}>Pay into escrow. The seller does not receive the money yet.</li>
                <li style={dealStyles.step}>Inspect the car and take the title, then release the funds.</li>
              </>
            )}
          </ol>
        </div>

        {error && <div style={dealStyles.errorBox}>{error}</div>}

        {needsOnboarding ? (
          <div style={dealStyles.warnBox}>
            <div style={{ marginBottom: 12 }}>
              Set up payouts to receive the money, then come back to this link.
            </div>
            <button style={dealStyles.primaryBtnInline} onClick={() => onNavigate?.("profile")}>
              Set up payouts
            </button>
          </div>
        ) : currentUser ? (
          <button
            onClick={join}
            disabled={joining}
            style={{ ...dealStyles.primaryBtn, ...(joining ? dealStyles.btnDisabled : null) }}
          >
            {joining ? "Joining…" : "Join this deal"}
          </button>
        ) : (
          <button style={dealStyles.primaryBtn} onClick={() => onNavigate?.("auth")}>
            Create an account to continue
          </button>
        )}

        <div style={dealStyles.finePrint}>
          DriveLink holds the funds until the buyer confirms the car.
        </div>
      </div>
    </div>
  );
}

// ============================================================================

function Field({ label, prefix, ...props }) {
  return (
    <div>
      <div style={dealStyles.fieldLabel}>{label}</div>
      <div style={{ position: "relative" }}>
        {prefix && <span style={dealStyles.inputPrefix}>{prefix}</span>}
        <input {...props} style={{ ...dealStyles.input, paddingLeft: prefix ? 28 : 14 }} />
      </div>
    </div>
  );
}

function titleCase(s) {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const dealStyles = {
  page: { fontFamily: "'Inter', system-ui, sans-serif", background: "#f8fafc", minHeight: "100vh", color: "#111827" },
  inner: { maxWidth: 560, margin: "0 auto", padding: "48px 24px 96px" },
  backBtn: { background: "none", border: "1px solid #e5e7eb", padding: "8px 16px", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 600, color: "#374151", marginBottom: 28 },
  title: { fontSize: 32, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em", marginBottom: 8 },
  sub: { fontSize: 15, color: "#6b7280", lineHeight: 1.6, marginBottom: 32 },
  inviteEyebrow: { display: "inline-block", background: "#fffbeb", color: "#92400e", fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", padding: "5px 12px", borderRadius: 20, marginBottom: 16 },
  eyebrow: { fontSize: 12, color: "#6b7280", fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase", marginBottom: 12 },
  roleRow: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 32 },
  roleBtn: { background: "#fff", border: "1px solid #e5e7eb", padding: "12px 0", borderRadius: 10, cursor: "pointer", fontSize: 15, fontWeight: 600, color: "#4b5563" },
  roleBtnActive: { background: "#0f172a", borderColor: "#0f172a", color: "#fff" },
  fieldLabel: { fontSize: 12, color: "#6b7280", fontWeight: 500, marginBottom: 6 },
  vinRow: { display: "flex", gap: 8, marginBottom: 20 },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 },
  input: { width: "100%", boxSizing: "border-box", padding: "10px 14px", borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 14, outline: "none", background: "#fff", color: "#111827" },
  inputPrefix: { position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 14, color: "#9ca3af" },
  primaryBtn: { width: "100%", background: "#0f172a", color: "#fff", border: "none", padding: "14px 0", borderRadius: 12, cursor: "pointer", fontSize: 15, fontWeight: 700, marginTop: 8 },
  primaryBtnInline: { background: "#0f172a", color: "#fff", border: "none", padding: "9px 16px", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 600 },
  secondaryBtn: { background: "#fff", border: "1px solid #e5e7eb", padding: "10px 16px", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 600, color: "#374151", whiteSpace: "nowrap" },
  btnDisabled: { opacity: 0.4, cursor: "not-allowed" },
  linkBox: { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "16px 20px", marginBottom: 12 },
  linkText: { fontSize: 13, color: "#1d4ed8", fontFamily: "ui-monospace, monospace", wordBreak: "break-all", lineHeight: 1.5 },
  priceCard: { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 16, padding: "20px 24px", marginBottom: 28 },
  priceRow: { display: "flex", alignItems: "baseline", justifyContent: "space-between" },
  priceLabel: { fontSize: 13, color: "#6b7280" },
  priceValue: { fontSize: 28, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em" },
  vinRowSmall: { display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 14, paddingTop: 14, borderTop: "1px solid #f1f5f9" },
  vinValue: { fontSize: 13, color: "#374151", fontFamily: "ui-monospace, monospace" },
  stepsWrap: { borderTop: "1px dashed #e5e7eb", paddingTop: 24, marginTop: 32, marginBottom: 24 },
  steps: { margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 10 },
  step: { fontSize: 14, color: "#374151", lineHeight: 1.6 },
  errorBox: { background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: "12px 16px", fontSize: 14, color: "#b91c1c", lineHeight: 1.5, marginBottom: 16 },
  warnBox: { background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 12, padding: "16px 20px", fontSize: 14, color: "#92400e", lineHeight: 1.6, marginBottom: 16 },
  finePrint: { fontSize: 12, color: "#9ca3af", textAlign: "center", marginTop: 16, lineHeight: 1.5 },
};
