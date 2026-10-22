import { useLang } from "./i18n.jsx";
import { FOUNDER, TESTIMONIALS, USAGE, THIRD_PARTY } from "./siteProof.js";

// Blocks fed by siteProof.js. Each one returns null until it has real content,
// so shipping this file changes nothing visible until the content exists.

const pick = (v, lang) => (v && typeof v === "object" ? (v[lang] || v.en || "") : v || "");
export const founderReady = () => Boolean(FOUNDER.name && FOUNDER.photo && FOUNDER.profile);

// ── Founder block (About page, "Who runs it") ───────────────────────────────
export function FounderBlock() {
  const { lang } = useLang();
  if (!founderReady()) return null;
  const why = pick(FOUNDER.why, lang);
  return (
    <div style={S.founder}>
      <img src={FOUNDER.photo} alt={`${FOUNDER.name}, ${FOUNDER.role} of DriveLink`} width="88" height="88" style={S.founderPhoto} loading="lazy" />
      <div style={{ minWidth: 0 }}>
        <div style={S.founderName}>{FOUNDER.name}</div>
        <div style={S.founderRole}>{FOUNDER.role}, DriveLink LLC</div>
        {why && <p style={S.founderWhy}>{why}</p>}
        <a href={FOUNDER.profile} target="_blank" rel="noopener noreferrer me" style={S.founderLink}>
          {FOUNDER.profileLabel || "LinkedIn"} →
        </a>
      </div>
    </div>
  );
}

// ── Footer credit: "Run by <name> · DriveLink LLC, Branchburg, NJ" ──────────
export function FounderFooterLine({ style }) {
  const { lang } = useLang();
  if (!FOUNDER.name || !FOUNDER.profile) return null;
  return (
    <p style={style}>
      {lang === "es" ? "Dirigido por " : "Run by "}
      <a href={FOUNDER.profile} target="_blank" rel="noopener noreferrer me" style={{ color: "inherit", fontWeight: 600 }}>
        {FOUNDER.name}
      </a>
      {" · DriveLink LLC, Branchburg, NJ"}
    </p>
  );
}

// ── Usage line (homepage hero, under the fee stats) ─────────────────────────
export function UsageLine() {
  const { lang } = useLang();
  const parts = [];
  if (USAGE.dealsStarted > 0) parts.push(lang === "es" ? `${USAGE.dealsStarted.toLocaleString("es-US")} tratos iniciados` : `${USAGE.dealsStarted.toLocaleString("en-US")} deals started`);
  if (USAGE.carsListed > 0) parts.push(lang === "es" ? `${USAGE.carsListed.toLocaleString("es-US")} autos publicados` : `${USAGE.carsListed.toLocaleString("en-US")} cars listed`);
  if (!parts.length) return null;
  return (
    <div style={S.usage}>
      {USAGE.people.length > 0 && (
        <span style={S.avatars} aria-hidden="true">
          {USAGE.people.slice(0, 5).map((p, i) => (
            <img key={i} src={p.photo} alt="" width="28" height="28" style={{ ...S.avatar, marginLeft: i ? -8 : 0 }} loading="lazy" />
          ))}
        </span>
      )}
      <span>{parts.join(" · ")}</span>
    </div>
  );
}

// ── Customer stories (homepage wall) ────────────────────────────────────────
export function TestimonialWall({ sectionStyle, innerStyle, badgeStyle, titleStyle }) {
  const { lang } = useLang();
  if (!TESTIMONIALS.length) return null;
  return (
    <section style={sectionStyle} className="dl-section">
      <div style={innerStyle}>
        <div style={badgeStyle}>{lang === "es" ? "Tratos reales" : "Real deals"}</div>
        <h2 style={titleStyle} className="dl-section-title">
          {lang === "es" ? "Lo que dicen quienes ya cerraron un trato" : "What people say after closing a deal"}
        </h2>
        <div style={S.wall}>
          {TESTIMONIALS.slice(0, 6).map((t, i) => (
            <figure key={i} style={S.quoteCard}>
              <blockquote style={S.quote}>“{t.quote}”</blockquote>
              {t.before && <p style={S.before}>{t.before}</p>}
              {t.outcome && <p style={S.outcome}>{t.outcome}</p>}
              <figcaption style={S.who}>
                {t.photo && <img src={t.photo} alt={`${t.name}`} width="36" height="36" style={S.whoPhoto} loading="lazy" />}
                <span><strong>{t.name}</strong>{t.role ? ` · ${t.role}` : ""}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Third-party strip ───────────────────────────────────────────────────────
export function ThirdPartyStrip() {
  const { lang } = useLang();
  if (!THIRD_PARTY.length) return null;
  return (
    <div style={S.tp} aria-label={lang === "es" ? "Reseñas y menciones" : "Reviews and mentions"}>
      {THIRD_PARTY.map((x, i) => {
        const inner = (
          <>
            <strong>{x.label}</strong>
            {x.detail ? ` · ${x.detail}` : ""}
            {x.date ? <span style={{ color: "#94a3b8" }}> ({x.date})</span> : null}
          </>
        );
        return x.href
          ? <a key={i} href={x.href} target="_blank" rel="noopener noreferrer" style={S.tpItem}>{inner}</a>
          : <span key={i} style={S.tpItem}>{inner}</span>;
      })}
    </div>
  );
}

// ── Trust answer, two lines, under the hero trust strip ─────────────────────
// Same facts as the FAQ answer to "Why should I trust a company I've never
// heard of?" — keep them in step with FAQView / faqData.js.
export function TrustCallout({ onMore }) {
  const { lang } = useLang();
  const es = lang === "es";
  return (
    <div style={S.callout} className="dl-trust-callout">
      <strong style={{ color: "#0f172a" }}>
        {es ? "¿Por qué confiar en una empresa que no conoces? No tienes que hacerlo." : "Why trust a company you've never heard of? You don't have to."}
      </strong>
      <span>
        {es
          ? " Stripe procesa tu pago directamente a la cuenta de Stripe del vendedor, y el vendedor no puede retirarlo hasta que se ingrese el código de 6 dígitos del comprador. DriveLink LLC está registrada en Nueva Jersey."
          : " Stripe processes your payment straight to the seller's own Stripe account, and the seller can't withdraw it until the buyer's 6-digit code is entered. DriveLink LLC is registered in New Jersey."}
      </span>{" "}
      <button style={S.calloutLink} onClick={onMore}>{es ? "Lee las respuestas completas →" : "Read the full answers →"}</button>
    </div>
  );
}

const S = {
  founder: { display: "flex", gap: 18, alignItems: "flex-start", margin: "16px 0 20px", padding: 18, border: "1px solid #e5e7eb", borderRadius: 12, background: "#f9fafb" },
  founderPhoto: { width: 88, height: 88, borderRadius: "50%", objectFit: "cover", flex: "0 0 auto" },
  founderName: { fontSize: 18, fontWeight: 800, color: "#0f172a" },
  founderRole: { fontSize: 13, color: "#6b7280", marginBottom: 8 },
  founderWhy: { margin: "0 0 10px", fontSize: 15, lineHeight: 1.7, color: "#374151" },
  founderLink: { color: "#2563eb", fontWeight: 600, fontSize: 14, textDecoration: "none" },
  usage: { display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 16, fontSize: 14, fontWeight: 600, color: "#475569", flexWrap: "wrap" },
  avatars: { display: "inline-flex" },
  avatar: { borderRadius: "50%", objectFit: "cover", border: "2px solid #fff" },
  wall: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 18 },
  quoteCard: { margin: 0, padding: 22, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14 },
  quote: { margin: "0 0 12px", fontSize: 16, lineHeight: 1.6, color: "#0f172a", fontWeight: 600 },
  before: { margin: "0 0 4px", fontSize: 13, color: "#6b7280" },
  outcome: { margin: "0 0 12px", fontSize: 13, color: "#16a34a", fontWeight: 700 },
  who: { display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "#374151" },
  whoPhoto: { width: 36, height: 36, borderRadius: "50%", objectFit: "cover" },
  tp: { display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 10, padding: "14px 20px", background: "#f8fafc", borderBottom: "1px solid #e5e7eb" },
  tpItem: { fontSize: 13, color: "#334155", textDecoration: "none", padding: "6px 12px", border: "1px solid #e2e8f0", borderRadius: 999, background: "#fff" },
  callout: { marginTop: 14, fontSize: 14, lineHeight: 1.6, color: "#475569", maxWidth: "62ch" },
  calloutLink: { background: "none", border: "none", padding: 0, color: "#2563eb", fontWeight: 600, fontSize: 14, cursor: "pointer", fontFamily: "inherit" },
};
