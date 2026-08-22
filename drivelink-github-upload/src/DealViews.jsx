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

import { useState, useEffect, useRef } from "react";
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

export function StartDealView({ currentUser, promoterCode, onBack, onNavigate, showToast }) {
  const [role, setRole] = useState("seller");
  const [form, setForm] = useState({
    vin: "", year: "", make: "", model: "", mileage: "", price: "", note: "",
    handover_date: "",
  });
  const [decoding, setDecoding] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const [explainerCopied, setExplainerCopied] = useState(false);
  const [referrer, setReferrer] = useState(null);
  // The form is tall enough that the submit button sits below the error and
  // onboarding messages once you have scrolled to it. Both are rendered above
  // the button, so a failed submit put the only feedback off-screen and the
  // button looked dead. Scrolled into view rather than moved, because the
  // messages belong with the fields they are about.
  const feedbackRef = useRef(null);

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
          handover_date: form.handover_date || null,
          promoter_code: readPromoterCode(),
        },
      });

      if (fnErr) { setError("Could not create the deal. Try again."); revealFeedback(); return; }
      if (data?.error) { setError(data.error); revealFeedback(); return; }
      if (data?.needs_onboarding) { setNeedsOnboarding(true); revealFeedback(); return; }

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

  // Waits a tick so the message has rendered before we scroll to it.
  function revealFeedback() {
    setTimeout(() => {
      feedbackRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
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

  // The deal link alone assumes the other party knows what DriveLink is. They
  // usually don't — they met this person on Marketplace and are now being asked
  // to route a car sale through a company they've never heard of. /escrow is
  // written for exactly that reader, so it goes out alongside the invite rather
  // than leaving our own user to make the case unaided.
  const EXPLAINER_URL = `${window.location.origin}/escrow`;

  async function shareExplainer() {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "How DriveLink escrow works",
          url: EXPLAINER_URL,
        });
        return;
      } catch (e) {
        if (e?.name === "AbortError") return;
        // Any other failure falls through to the clipboard path below.
      }
    }
    try {
      await navigator.clipboard.writeText(EXPLAINER_URL);
      setExplainerCopied(true);
      setTimeout(() => setExplainerCopied(false), 2000);
    } catch {
      showToast?.("Copy failed — the address is drivelink.deals/escrow", "error");
    }
  }

  if (!currentUser) {
    return (
      <div style={dealStyles.page}>
        <div style={dealStyles.inner}>
          {/* The other two branches of this component have always had this and
              this one did not, which left a signed-out visitor with exactly one
              way off the page: create an account. Someone who arrives from a
              guide, an outreach email, or a /p/ link and is not ready to sign
              up yet had nowhere to go and no reason to believe there was
              anything else here. */}
          {onBack && <button style={dealStyles.backBtn} onClick={onBack}>← Back to DriveLink</button>}
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
          {/* Not everyone landing here has a car in mind — some arrive from a
              guide or an ad. Without this, the only path forward is signup,
              which loses the visitor who would happily have looked at
              inventory first. DriveLink is a marketplace as well as an escrow
              layer and this screen never said so. */}
          <p style={{ fontSize: 14, color: "#6b7280", marginTop: 22, textAlign: "center" }}>
            Don't have a car picked out yet?{" "}
            <button
              onClick={() => onNavigate?.("home")}
              style={{ background: "none", border: "none", padding: 0, color: "#1d4ed8", fontSize: 14, fontWeight: 600, cursor: "pointer", textDecoration: "underline" }}
            >
              Browse cars listed on DriveLink
            </button>
          </p>
        </div>
      </div>
    );
  }

  // ---- link created --------------------------------------------------------
  if (result) {
    const them = role === "promoter" ? "both parties" : role === "seller" ? "the buyer" : "the seller";
    return (
      <div style={dealStyles.page}>
        <div style={dealStyles.inner}>
          {onBack && <button style={dealStyles.backBtn} onClick={onBack}>← Back</button>}
          <h1 style={dealStyles.title}>Your deal is ready</h1>
          <p style={dealStyles.sub}>
            {role === "promoter"
              ? "Send this link to both parties. Whoever opens it first picks their side. No money moves until they both join."
              : `Send this link to ${them}. No money moves until you both agree.`}
          </p>

          <div style={dealStyles.linkBox}>
            <div style={dealStyles.eyebrow}>Deal link</div>
            <div style={dealStyles.linkText}>{result.url}</div>
          </div>

          <button style={dealStyles.primaryBtn} onClick={copyLink}>
            {copied ? "Copied" : "Copy link"}
          </button>

          <div style={dealStyles.explainerRow}>
            <div style={dealStyles.explainerText}>
              Never heard of DriveLink? Most people haven't. Send them this
              alongside the deal link and it explains who holds the money and
              when it's released.
            </div>
            <button
              style={{ ...dealStyles.secondaryBtn, width: "100%", marginTop: 12 }}
              onClick={shareExplainer}
            >
              {explainerCopied ? "Copied" : "Send them the explainer"}
            </button>
          </div>

          <div style={dealStyles.stepsWrap}>
            <div style={dealStyles.eyebrow}>What happens next</div>
            <ol style={dealStyles.steps}>
              <li style={dealStyles.step}>
                {role === "promoter"
                  ? "Both parties open the link, pick their side, and confirm the car and price."
                  : `${cap(them)} opens the link and confirms the car and price.`}
              </li>
              <li style={dealStyles.step}>The buyer pays into escrow. DriveLink holds the money.</li>
              <li style={dealStyles.step}>
                The car and title change hands, the buyer confirms, and the seller is paid out.
              </li>
              {role === "promoter" && (
                <li style={dealStyles.step}>Your 1% lands in your balance once the sale completes.</li>
              )}
            </ol>
          </div>
        </div>
      </div>
    );
  }

  // ---- form ---------------------------------------------------------------
  // Mirrors HANDOVER_MAX_DAYS in App.jsx, the create-deal validator, and the
  // deal_invites check constraint. All four have to agree.
  const todayIso = new Date().toISOString().slice(0, 10);
  const maxHandoverIso = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);

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
        {/* The third option only appears for someone holding an active Promoter
            code — create-deal rejects role:"promoter" without one, so offering
            it to everyone would produce a button that always errors. */}
        <div style={{ ...dealStyles.roleRow, gridTemplateColumns: promoterCode ? "1fr 1fr 1fr" : "1fr 1fr" }}>
          {["seller", "buyer", ...(promoterCode ? ["promoter"] : [])].map((r) => (
            <button
              key={r}
              onClick={() => setRole(r)}
              style={{ ...dealStyles.roleBtn, ...(role === r ? dealStyles.roleBtnActive : null), ...(r === "promoter" ? { fontSize: 14 } : null) }}
            >
              {r === "promoter" ? "Neither — I'm arranging it" : cap(r)}
            </button>
          ))}
        </div>

        {role === "promoter" && (
          <div style={{ ...dealStyles.infoBox, marginTop: -20, marginBottom: 28 }}>
            You're setting this up for two other people. Enter the car and the
            price they agreed on, then send them one link — whoever opens it
            first says whether they're the buyer or the seller. You earn 1% when
            the sale completes.
          </div>
        )}

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

        <div style={dealStyles.fieldLabel}>Handover date (optional)</div>
        <input
          type="date"
          value={form.handover_date}
          min={todayIso}
          max={maxHandoverIso}
          onChange={set("handover_date")}
          style={dealStyles.input}
        />
        <div style={{ fontSize: 13, color: "#6b7280", marginTop: 6, marginBottom: 18, lineHeight: 1.5 }}>
          {form.handover_date
            ? "The other party sees this date before they join. Escrow stays funded until the handover — set it if the car is shipping."
            : "If the car is being transported, put the date it should arrive. Without one, an unconfirmed deal is flagged for review a week after payment — which can be while the car is still on a truck."}
        </div>

        <div ref={feedbackRef} />

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
  // Only used on a promoter-arranged deal that still has both sides free.
  const [pickedRole, setPickedRole] = useState(null);
  const [waiting, setWaiting] = useState(null);

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
        // role is ignored unless the deal was arranged by a promoter and both
        // sides are still free.
        body: { token, action: "accept", role: pickedRole },
      });
      if (fnErr) { setError("Could not join this deal."); return; }
      if (data?.error) { setError(data.error); return; }

      if (data.state === "needs_onboarding") { setNeedsOnboarding(true); return; }

      // Promoter deal, first party in. There is no listing to pay for yet.
      if (data.state === "waiting_for_other_party") {
        try { localStorage.removeItem("dl_pending_deal"); } catch { /* noop */ }
        setWaiting({ role: data.your_role, message: data.message });
        return;
      }

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

  if (waiting) {
    return (
      <div style={dealStyles.page}>
        <div style={dealStyles.inner}>
          <h1 style={dealStyles.title}>You're in as the {waiting.role}</h1>
          <p style={dealStyles.sub}>{waiting.message}</p>
          <p style={dealStyles.sub}>
            We'll email you when the other party joins. You can close this page.
          </p>
          <button style={dealStyles.secondaryBtn} onClick={() => onNavigate?.("home")}>
            Go to DriveLink
          </button>
        </div>
      </div>
    );
  }

  const { car, your_role: yourRole, state, choose_role: chooseRole, arranged_by_promoter: byPromoter } = preview;
  // On a wide-open promoter deal the server sends no role — the visitor says
  // which side they are, and that answer drives the steps shown below.
  const effectiveRole = yourRole || pickedRole;
  const isSeller = effectiveRole === "seller";
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

        {chooseRole && (
          <div style={{ marginBottom: 28 }}>
            <div style={dealStyles.eyebrow}>Which side of this deal are you on?</div>
            <div style={dealStyles.roleRow}>
              {["buyer", "seller"].map((r) => (
                <button
                  key={r}
                  onClick={() => setPickedRole(r)}
                  style={{ ...dealStyles.roleBtn, ...(pickedRole === r ? dealStyles.roleBtnActive : null) }}
                >
                  {r === "buyer" ? "I'm buying" : "I'm selling"}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 13, color: "#6b7280", marginTop: 8, lineHeight: 1.5 }}>
              This deal was set up by someone arranging it for you both. Whoever
              opens this link second takes the other side.
            </div>
          </div>
        )}

        {effectiveRole && (
        <div style={dealStyles.stepsWrap}>
          <div style={dealStyles.eyebrow}>You are joining as the {effectiveRole}</div>
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
        )}

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
            disabled={joining || (chooseRole && !pickedRole)}
            style={{ ...dealStyles.primaryBtn, ...(joining || (chooseRole && !pickedRole) ? dealStyles.btnDisabled : null) }}
          >
            {joining ? "Joining…" : chooseRole && !pickedRole ? "Pick your side first" : "Join this deal"}
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
  infoBox: { background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 12, padding: "14px 18px", fontSize: 14, color: "#1e40af", lineHeight: 1.6 },
  finePrint: { fontSize: 12, color: "#9ca3af", textAlign: "center", marginTop: 16, lineHeight: 1.5 },
  explainerRow: { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "16px 20px", marginTop: 16 },
  explainerText: { fontSize: 13, color: "#6b7280", lineHeight: 1.6 },
};
