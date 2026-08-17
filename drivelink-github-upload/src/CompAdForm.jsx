import { useState } from "react";
import ImageUpload from "./ImageUpload.jsx";

// ── Comp an ad placement ─────────────────────────────────────────────────────
//
// Admin-only. Creates a live ad_placements row with no payment, so the first
// advertisers can be given a free run to get the rail populated.
//
// WHY THIS AND NOT A DISCOUNT CODE. A 100%-off coupon means adding discount
// handling to create-ad-checkout-session, a code that can be shared, and a
// Stripe checkout for $0 that Stripe would reject anyway. Comping is a
// different action from paying, and modelling it as a payment with a discount
// makes both paths worse. This writes the row directly.
//
// The comped rows are excluded from ad revenue by the `comped` flag, not by
// their zero amount — see the migration for why that distinction matters.
//
// There is deliberately no email to the advertiser here. Lampros is talking to
// these people directly; an automated "your free ad is live" email would be a
// second system to build and maintain for the handful of placements this is
// meant to cover.

const DURATIONS = [
  { id: "1mo", label: "1 month", months: 1 },
  { id: "3mo", label: "3 months", months: 3 },
  { id: "6mo", label: "6 months", months: 6 },
  { id: "12mo", label: "12 months", months: 12 },
];

// Matches the paid plan ids where they overlap so existing reporting that
// groups by `plan` doesn't grow a new category for every comped run. A 1-month
// comp has no paid equivalent and gets its own id.
const PLAN_FOR = { "1mo": "1mo", "3mo": "3mo", "6mo": "6mo", "12mo": "12mo" };

function addMonthsIso(months) {
  const d = new Date();
  const target = new Date(d.getFullYear(), d.getMonth() + months, d.getDate());
  // Rolls 31 Jan + 1 month to 3 Mar rather than throwing. Fine here — an ad end
  // date being a couple of days out is not worth date-library weight.
  return target.toISOString().slice(0, 10);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function CompAdForm({ onComp, onDone }) {
  const [open, setOpen] = useState(false);
  const [businessName, setBusinessName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [duration, setDuration] = useState("3mo");
  const [reason, setReason] = useState("");
  const [images, setImages] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const reset = () => {
    setBusinessName(""); setContactEmail(""); setLinkUrl("");
    setDuration("3mo"); setReason(""); setImages([]); setError("");
  };

  const submit = async () => {
    const name = businessName.trim();
    let url = linkUrl.trim();
    if (!name) return setError("Business name is required.");
    if (!url) return setError("Link URL is required.");

    // A bare domain in the ad rail renders as a relative link and sends the
    // clicker to drivelink.deals/theirsite.com. Prefixing here is friendlier
    // than rejecting it.
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    try {
      new URL(url);
    } catch {
      return setError("That link URL doesn't look valid.");
    }

    const months = DURATIONS.find(d => d.id === duration).months;

    setError("");
    setSaving(true);
    const result = await onComp({
      business_name: name,
      contact_email: contactEmail.trim() || null,
      link_url: url,
      image_url: images[0] || null,
      plan: PLAN_FOR[duration],
      amount_cents: 0,
      status: "active",
      comped: true,
      comped_reason: reason.trim() || null,
      start_date: todayIso(),
      end_date: addMonthsIso(months),
    });
    setSaving(false);

    if (result?.ok) {
      reset();
      setOpen(false);
      onDone?.();
    } else {
      setError(result?.message || "Couldn't create that placement.");
    }
  };

  if (!open) {
    return (
      <button style={styles.openBtn} onClick={() => setOpen(true)}>
        + Comp an ad placement
      </button>
    );
  }

  return (
    <div style={styles.panel}>
      <div style={styles.panelHead}>
        <strong style={{ fontSize: 15 }}>Comp an ad placement</strong>
        <button style={styles.closeBtn} onClick={() => { reset(); setOpen(false); }}>✕</button>
      </div>

      <p style={styles.note}>
        Creates a live placement with no payment. It appears on the rail
        immediately and is excluded from ad revenue.
      </p>

      <label style={styles.label}>Business name *</label>
      <input style={styles.input} value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="Morris County Auto Transport" />

      <label style={styles.label}>Link URL *</label>
      <input style={styles.input} value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="https://theirsite.com" />

      <label style={styles.label}>Contact email</label>
      <input style={styles.input} value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="them@theirsite.com" type="email" />

      <label style={styles.label}>Duration</label>
      <div style={styles.durRow}>
        {DURATIONS.map(d => (
          <button
            key={d.id}
            type="button"
            onClick={() => setDuration(d.id)}
            style={{
              ...styles.durBtn,
              ...(duration === d.id ? styles.durBtnActive : {}),
            }}
          >{d.label}</button>
        ))}
      </div>
      <div style={styles.hint}>Runs {todayIso()} → {addMonthsIso(DURATIONS.find(d => d.id === duration).months)}</div>

      <label style={styles.label}>Why comped (internal note)</label>
      <input style={styles.input} value={reason} onChange={e => setReason(e.target.value)} placeholder="Founding advertiser — free 3 months" />

      <label style={styles.label}>Ad image</label>
      <ImageUpload images={images} onChange={setImages} />

      {error && <div style={styles.error}>{error}</div>}

      <div style={styles.actions}>
        <button style={styles.cancelBtn} onClick={() => { reset(); setOpen(false); }}>Cancel</button>
        <button
          style={{ ...styles.confirmBtn, opacity: saving ? 0.6 : 1 }}
          onClick={submit}
          disabled={saving || !businessName.trim() || !linkUrl.trim()}
        >{saving ? "Creating…" : "Create comped placement"}</button>
      </div>
    </div>
  );
}

const styles = {
  openBtn: { background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", padding: "9px 16px", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 700, marginBottom: 16 },
  panel: { border: "1px solid #e5e7eb", borderRadius: 12, padding: 20, marginBottom: 20, background: "#fff" },
  panelHead: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  closeBtn: { background: "none", border: "none", cursor: "pointer", fontSize: 15, color: "#6b7280", padding: 0 },
  note: { fontSize: 13, color: "#6b7280", margin: "0 0 16px", lineHeight: 1.6 },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#374151", margin: "14px 0 6px", textTransform: "uppercase", letterSpacing: ".04em" },
  input: { width: "100%", padding: "10px 12px", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 14, fontFamily: "inherit", boxSizing: "border-box" },
  durRow: { display: "flex", gap: 8, flexWrap: "wrap" },
  durBtn: { padding: "8px 14px", border: "1px solid #e5e7eb", background: "#fff", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#374151" },
  durBtnActive: { border: "2px solid #FFB020", background: "#fffbeb", color: "#92400e" },
  hint: { fontSize: 12, color: "#6b7280", marginTop: 8 },
  error: { background: "#fee2e2", color: "#dc2626", fontSize: 13, padding: "9px 12px", borderRadius: 8, marginTop: 14 },
  actions: { display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 },
  cancelBtn: { background: "#fff", border: "1px solid #e5e7eb", padding: "10px 18px", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 600, color: "#374151" },
  confirmBtn: { background: "#0f172a", color: "#fff", border: "none", padding: "10px 18px", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 700 },
};
