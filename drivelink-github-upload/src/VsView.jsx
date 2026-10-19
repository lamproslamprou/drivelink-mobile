import { platformFeeLabel, platformFeeRate, promoActive } from "./fee.js";

// /vs/* — honest comparison pages against the three services buyers actually
// compare DriveLink with. English only for now.
//
// Competitor figures below were read from each company's own public site on
// Oct 12 2026 and are labeled as such on the page. They are NOT ours to
// guarantee: re-check them before editing this file, and keep "where they are
// the better fit" honest — a comparison page that only flatters us is worth
// nothing to the buyer reading it.
//
// DriveLink's own numbers come from fee.js so they flip with the promo.

export const VS_PATHS = {
  vsPrivateAuto: "/vs/drivelink-vs-privateauto",
  vsEscrowCom: "/vs/drivelink-vs-escrow-com",
  vsKeySavvy: "/vs/drivelink-vs-keysavvy",
};

const AS_OF = "October 12, 2026";
const usd = (n) => "$" + Math.round(n).toLocaleString("en-US");
const dlFee = (price) => price * platformFeeRate();

function pages() {
  const FEE = platformFeeLabel();
  const promo = promoActive();
  const dl = {
    fee: `${FEE} of the sale price, seller side, when the deal closes${promo ? " (half our usual 1%, through October 31)" : ""}`,
    note: "Card processing is separate: paid to Stripe, about 2.9% + $0.30 on cards, much less by bank transfer on purchases over $15,000.",
  };
  const prices = [10000, 30000, 60000];
  return {
    vsPrivateAuto: {
      name: "PrivateAuto",
      title: "DriveLink vs PrivateAuto",
      intro: "Both help two private parties close a car sale without a cashier's check. They are built differently, and they charge differently.",
      short: [
        "PrivateAuto charges the seller $29 to list plus $150 when the car sells. DriveLink charges nothing to list and " + FEE + " of the sale price when a deal closes.",
        "DriveLink holds the buyer's payment until the buyer gives the seller a 6-digit code at the handover. Nothing is released on a timer.",
        "DriveLink works on a car you found anywhere (Facebook Marketplace, Craigslist, a friend). You don't have to list it with us.",
      ],
      tableHead: ["Sale price", "DriveLink fee", "PrivateAuto ($29 + $150)"],
      tableRows: prices.map((p) => [usd(p), usd(dlFee(p)), usd(179)]),
      tableNote: `DriveLink at ${FEE}. ${dl.note} PrivateAuto's figures are from privateauto.com as of ${AS_OF}; its pricing may include processing differently, so check theirs.`,
      them: [
        "Flat fees: on higher-priced cars, $179 total can be less than a percentage fee" + (promo ? " once DriveLink's standard 1% returns on November 1" : "") + ".",
        "A full seller-side app with listing tools and a vehicle value report.",
      ],
      us: [
        "No listing fee, and no fee at all if the deal falls through.",
        "Funds release on the buyer's 6-digit handover code, not on a timer.",
        "Bring Your Own Deal: start a protected payment on a car listed anywhere else.",
        "Buyers pay nothing beyond the price of the car.",
      ],
      closing: "PrivateAuto says it does not handle funds itself; its page says funds are held in custody by US Alliance Financial. With DriveLink, the payment is processed by Stripe, held on DriveLink's Stripe balance, and released only when the buyer's code is entered.",
    },
    vsKeySavvy: {
      name: "KeySavvy",
      title: "DriveLink vs KeySavvy",
      intro: "KeySavvy and DriveLink solve different parts of the same problem. KeySavvy handles the title and payment paperwork as a licensed dealer. DriveLink protects the payment while you handle the handover yourselves.",
      short: [
        "KeySavvy charges a flat $99 to the buyer and $99 to the seller (plus $99 if the seller has a loan to pay off). DriveLink charges the seller " + FEE + " and the buyer nothing.",
        "KeySavvy acts as a dealer: it buys the car from the seller and sells it to the buyer, and ships the title. DriveLink never takes title. The two of you meet and hand over the keys and signed title yourselves.",
        "With DriveLink the buyer's money is released by a 6-digit code the buyer gives the seller at the handover.",
      ],
      tableHead: ["Sale price", "DriveLink (seller pays)", "KeySavvy (buyer $99 + seller $99)"],
      tableRows: prices.map((p) => [usd(p), usd(dlFee(p)), usd(198)]),
      tableNote: `DriveLink at ${FEE}. ${dl.note} KeySavvy's figures are from keysavvy.com as of ${AS_OF}; a loan payoff adds $99 there.`,
      them: [
        "It does the title work: reassigns the title and ships it with tracking, including out of state.",
        "It handles lien payoff with the lender, and checks the title for loans, brands and an NMVTIS report.",
        "A flat fee can be cheaper than a percentage on expensive cars.",
      ],
      us: [
        "No middleman holding title: it stays a normal private sale, in person.",
        "The buyer pays nothing extra.",
        "Works on cars you found anywhere, with no listing required.",
        "No fee if the deal falls through.",
      ],
      closing: "If the sale is out of state, has a loan on it, or you want someone else to run the title paperwork, KeySavvy may be the better fit. If you are meeting locally and just want the money held safely until the keys and title change hands, that is what DriveLink is for.",
    },
    vsEscrowCom: {
      name: "Escrow.com",
      title: "DriveLink vs Escrow.com",
      intro: "Escrow.com is the large, general-purpose escrow service, used for many kinds of transactions. DriveLink is built only for private car sales.",
      short: [
        "Escrow.com's own site claims over $8.3 billion processed and 3.9 million customers. DriveLink is new, and we won't pretend otherwise.",
        "Escrow.com is generic: you set up the transaction terms yourselves. DriveLink is built around one car handover: the buyer gets a 6-digit code when they pay and gives it to the seller only once the car and signed title are in hand.",
        "DriveLink's fee is a single percentage, paid by the seller, charged only when the deal closes. Escrow.com's calculator quotes a standard fee of $50 on a $1,000 motor vehicle, $240 on $10,000 and $1,900 on $100,000 when the buyer pays by wire. Its fee changes with the amount and payment method, so get a quote for yours.",
      ],
      tableHead: ["Sale price", "DriveLink fee", "Escrow.com standard fee (buyer pays by wire)"],
      tableRows: [[usd(1000), usd(dlFee(1000)), "$50"], [usd(10000), usd(dlFee(10000)), "$240"], [usd(100000), usd(dlFee(100000)), "$1,900"]],
      tableNote: `DriveLink at ${FEE}. ${dl.note} The Escrow.com figures are from its fee calculator (selling a motor vehicle, buyer paying by wire) as of ${AS_OF}. Their fee changes with the amount and payment method, so check their calculator for yours.`,
      them: [
        "Long track record, large volume, and many third-party reviews.",
        "Handles many transaction types, including international ones.",
      ],
      us: [
        "Made for cars: the release step is tied to the in-person handover, not to a generic checklist.",
        "U.S. private car sales only, with a simple seller-side percentage.",
        "Bring Your Own Deal: start a protected payment on a car listed anywhere else.",
        "Buyers pay nothing beyond the price of the car.",
      ],
      closing: "If you want the biggest name or are buying something other than a U.S. private-party car, Escrow.com may suit you better. If it is a car handover between two people in the U.S., DriveLink is set up for exactly that.",
    },
  };
}

export default function VsView({ page, onBack, onStart, onPricing, onNavigate }) {
  const d = pages()[page];
  if (!d) return null;
  const others = Object.keys(VS_PATHS).filter((k) => k !== page);
  return (
    <div style={S.page}>
      <div style={S.inner}>
        <div style={S.topRow}>
          <button style={S.backBtn} onClick={onBack}>← Back to DriveLink</button>
        </div>
        <h1 style={S.title}>{d.title}</h1>
        <p style={S.lede}>{d.intro}</p>

        <h2 style={S.h2}>The short version</h2>
        <ul style={S.ul}>{d.short.map((x, i) => <li key={i} style={S.li}>{x}</li>)}</ul>

        {d.tableHead && (
          <>
            <h2 style={S.h2}>What it costs</h2>
            <div style={S.tableWrap}>
              <table style={S.table}>
                <thead><tr>{d.tableHead.map((h, i) => <th key={i} style={S.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {d.tableRows.map((r, i) => (
                    <tr key={i}>{r.map((c, j) => <td key={j} style={S.td}>{c}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <p style={S.note}>{d.tableNote}</p>

        <h2 style={S.h2}>Where {d.name} is the better fit</h2>
        <ul style={S.ul}>{d.them.map((x, i) => <li key={i} style={S.li}>{x}</li>)}</ul>

        <h2 style={S.h2}>Where DriveLink is the better fit</h2>
        <ul style={S.ul}>{d.us.map((x, i) => <li key={i} style={S.li}>{x}</li>)}</ul>

        <p style={S.closing}>{d.closing}</p>

        <div style={S.actions}>
          <button style={S.primary} onClick={onStart}>Start a protected deal</button>
          <button style={S.secondary} onClick={onPricing}>See our full pricing</button>
        </div>

        <p style={S.note}>Competitor details come from each company's public website as of {AS_OF} and may have changed. Check their site for current terms.</p>

        <div style={S.more}>
          {others.map((k) => (
            <button key={k} style={S.moreLink} onClick={() => onNavigate(k)}>{pages()[k].title} →</button>
          ))}
        </div>
      </div>
    </div>
  );
}

const S = {
  page: { fontFamily: "'Inter', system-ui, sans-serif", background: "#fff", minHeight: "100vh", color: "#111827" },
  inner: { maxWidth: 760, margin: "0 auto", padding: "48px 24px 96px" },
  topRow: { display: "flex", marginBottom: 32 },
  backBtn: { background: "none", border: "1px solid #e5e7eb", padding: "10px 16px", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 600, color: "#374151", minHeight: 44 },
  title: { fontSize: 34, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em", marginBottom: 10, lineHeight: 1.2 },
  lede: { fontSize: 16, color: "#374151", lineHeight: 1.7, marginBottom: 8, maxWidth: "60ch" },
  h2: { fontSize: 20, fontWeight: 800, color: "#0f172a", margin: "32px 0 12px" },
  ul: { margin: 0, paddingLeft: 20 },
  li: { fontSize: 15, lineHeight: 1.7, color: "#374151", marginBottom: 8 },
  tableWrap: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 15 },
  th: { textAlign: "left", padding: "10px 12px", borderBottom: "2px solid #e5e7eb", color: "#0f172a", fontWeight: 700 },
  td: { padding: "10px 12px", borderBottom: "1px solid #e5e7eb", color: "#374151" },
  note: { fontSize: 13, color: "#6b7280", lineHeight: 1.6, marginTop: 12 },
  closing: { fontSize: 15, lineHeight: 1.7, color: "#1f2937", marginTop: 28, padding: "16px 18px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12 },
  actions: { display: "flex", gap: 12, flexWrap: "wrap", marginTop: 28 },
  primary: { background: "#0f172a", color: "#fff", border: "none", padding: "13px 22px", borderRadius: 10, fontWeight: 700, fontSize: 15, cursor: "pointer", minHeight: 44 },
  secondary: { background: "#fff", color: "#0f172a", border: "1px solid #cbd5e1", padding: "13px 22px", borderRadius: 10, fontWeight: 700, fontSize: 15, cursor: "pointer", minHeight: 44 },
  more: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4, marginTop: 28 },
  moreLink: { background: "none", border: "none", padding: "8px 0", color: "#2563eb", fontWeight: 600, fontSize: 14, cursor: "pointer", fontFamily: "inherit", minHeight: 44 },
};
