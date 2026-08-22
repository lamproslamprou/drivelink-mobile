import { useState } from "react";

// ── PILLAR GUIDE: LIEN PAYOFF IN A NEW JERSEY PRIVATE SALE ────────────────────
// Route: /guides/lien-payoff-nj
//
// Search intent this page exists to catch: someone mid-deal, right now, who has
// just been told the seller still owes money on the car and does not know
// whether that kills the deal. They are not researching. They are stuck.
//
// So the short answer comes first and the explanation second. Everything below
// the fold is for the reader who has decided to keep going and wants to know
// what the payoff actually involves.
//
// Deliberately NOT bilingual yet. The COPY object is keyed for it, but an SEO
// pillar page should be right in one language before it is doubled, and lien
// vocabulary in Spanish deserves a translator who knows the terms rather than a
// literal rendering of the English.
//
// Nothing here is legal advice and the page says so at the bottom.

const COPY = {
  en: {
    eyebrow: "New Jersey · Private sale guide",
    h1: "The seller still owes money on the car. Now what?",
    lede:
      "A loan on the car isn't a dealbreaker. It's a sequencing problem: the lender has to be paid before the title can come to you, and the order those two things happen in is what decides whether you get a car or a very expensive lesson.",
    back: "← Back",

    tldrTitle: "The short version",
    tldr: [
      "A lien means a lender has a legal claim on the car until the loan is paid off.",
      "In New Jersey the owner doesn't hold a title with a lien on it — the MVC sends that title to the lienholder. If the seller says they'll \"grab the title from the drawer,\" the loan is either paid off already or something isn't right.",
      "Never hand the seller the full price and trust them to pay the lender afterward. That's the failure everyone regrets.",
      "The safe version pays the lender directly, first, and the seller gets only what's left over.",
    ],

    sections: [
      {
        h: "What a lien actually is",
        p: [
          "When someone borrows money to buy a car, the lender records a security interest against the vehicle. That's the lien. It means the lender has a legal claim on the car itself until the debt is cleared — not on the seller personally, on the car. The claim follows the vehicle, which is the part that matters to you as a buyer.",
          "New Jersey handles this in a way that catches people out. The MVC doesn't give a lien-encumbered title to the owner. Titles showing an active lien go to the lienholder, and the owner gets one only once the lien is satisfied and released. A seller with a current loan therefore does not physically have the title to hand you.",
          "New Jersey also processes a lot of this electronically now. If a loan was paid off recently, the release and the title may have moved between the lender and the MVC digitally rather than arriving in the seller's mailbox as paper. A seller saying \"the title's coming\" isn't automatically stalling — but it isn't proof either.",
        ],
      },
      {
        h: "How this goes wrong",
        p: [
          "The failure has one shape. The buyer pays the seller the full price. The seller intends to pay off the loan, and either doesn't, can't, or takes long enough that it stops mattering. The lien stays on the car. The title never gets released. The buyer is now driving a car they can't register in their name, with a lender who still has a claim on it.",
          "There is no version of this the MVC can fix for you. The lien is real, the debt is the seller's, and your money is gone. Chasing it becomes a civil matter against someone who has already demonstrated what they do with money.",
          "The variant that stings more: the seller genuinely meant to pay it off, and something else came up. Intent doesn't change the outcome. This is why the structure matters more than your read on the person.",
        ],
      },
      {
        h: "How a payoff actually works",
        p: [
          "Ask the seller for a payoff quote from their lender. It's a standard request — a written figure, valid through a specific date, that says exactly what the lender needs to release the lien. It is not the same as the loan balance, because it includes interest through the quote date.",
          "Compare that number to the sale price. If the payoff is lower than the price, the deal is straightforward: the lender gets paid the payoff amount, the seller gets the difference. If the payoff is higher — the seller is upside down — then someone has to cover the gap in cash before the lien can clear, and it isn't going to be you. Establish which of these you're in before anything else.",
          "Pay the lender directly. Not the seller. Most lenders accept a payoff from a third party and many will tell you their process if you call with the account number and the seller on the line. The seller receives only the remainder, and only after the lender is satisfied.",
          "Then wait for the release. The lender notifies the MVC and the title is issued clear, or the lender sends a release letter and the stamped title. This takes days to weeks depending on the lender — it is not same-day, and a seller who insists you take the car and sort the title out later is asking you to absorb their risk.",
        ],
      },
      {
        h: "What New Jersey specifically requires",
        p: [
          "The lien has to be released before ownership can transfer cleanly. Where the lienholder is a bank or credit union, the release comes through the institution. Where the lienholder is an individual or a private company, New Jersey wants the release noted on the original title and a notarized lien release letter, dated and signed, with the title endorsed to show the lien is satisfied.",
          "If the title is sitting with a lienholder and needs to be released to the MVC, form OS/SS-54 is the mechanism — an application asking the lienholder to send the title in so the vehicle can be titled in New Jersey.",
          "The transfer itself has a clock on it. New Jersey or dealer-reassigned titles must be transferred within 10 working days of the sale date, and missing that carries a penalty. Don't let a lien delay push you past it without knowing you're doing it.",
          "Two things sellers forget. New Jersey plates belong to the owner, not the car, so they come off before the buyer drives away. And the seller should file the Notice of Transfer and Release of Liability with the MVC, which is free and protects them from what happens with the car afterward.",
        ],
      },
      {
        h: "When to walk",
        p: [
          "The seller won't produce a payoff quote. It costs them a phone call. Refusing to make it is the answer.",
          "The seller wants the full amount in cash and will \"take care of the loan tomorrow.\" This is the exact failure described above, offered to you in advance.",
          "The payoff exceeds the sale price and nobody can explain who's covering the difference.",
          "The name on the loan isn't the name of the person selling you the car, and there's no clear explanation of who actually owns it.",
          "The seller pushes to complete before the lien is released, using time pressure — another buyer, a deadline, a move. Urgency and unresolved liens are a bad combination.",
        ],
      },
    ],

    faqTitle: "Common questions",
    faqs: [
      {
        q: "Can I legally buy a car that has a lien on it?",
        a: "Yes. It happens constantly. What you cannot safely do is pay for it in a way that leaves the lien in place. The purchase is fine; the sequencing is what has to be right.",
      },
      {
        q: "How do I check whether a car has a lien?",
        a: "Ask the seller directly and ask to see the title. In New Jersey, a seller who can't produce a title should be able to explain why — and \"the bank has it\" is a real answer that also tells you there's an active loan. A vehicle history report and a title search through the MVC are additional checks.",
      },
      {
        q: "What if the seller owes more than the car is worth?",
        a: "Then the seller has to bring cash to close the gap before the lien can be released. That's their problem to solve, not yours to finance. Plenty of deals die here, and that's the system working.",
      },
      {
        q: "Can I just pay the lender myself?",
        a: "Usually, yes, and it's the safest structure. Call the lender with the seller present, get the payoff figure and their process for a third-party payment, and pay them directly. The seller gets the balance after the lender is satisfied.",
      },
      {
        q: "How long does a lien release take?",
        a: "It varies by lender — days to several weeks. New Jersey processes many titles electronically, which speeds things up, but it isn't instant. Agree in advance what happens to the car and the money during that window.",
      },
      {
        q: "Do I need a bill of sale?",
        a: "New Jersey doesn't legally require one for a private sale, but you want it anyway. It records the price, the odometer reading, the VIN and the date, all of which matter later at the MVC and if anything is disputed.",
      },
    ],

    ctaTitle: "The safe way to sequence this",
    ctaBody:
      "DriveLink holds the buyer's money until the car and title have actually changed hands. On a deal with a lien, that removes the exact gap where things go wrong — the seller can see the funds are real, and you're not trusting anyone to pay a lender after the fact.",
    ctaButton: "See how it works",

    disclaimerTitle: "One caveat",
    disclaimer:
      "This is general information about how lien payoffs work in New Jersey private sales, not legal advice. Requirements change and individual situations vary. Check current requirements with the NJ MVC, and talk to a lawyer if real money is at stake.",
  },
};

const CSS = `
.dl-g{--ink:#0A1B33;--mute:#5B6B85;--line:#DFE5EE;--green:#0F7A4E;--warn:#B42318;--warn-bg:#FEF3F2;
  max-width:720px;margin:0 auto;padding:0 20px 80px;color:var(--ink);
  font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.62;
  padding-top:env(safe-area-inset-top);}
.dl-g-top{padding:18px 0 0;}
.dl-g-back{background:none;border:0;padding:6px 0;font-size:15px;color:var(--mute);
  cursor:pointer;font-family:inherit;}
.dl-g-back:hover{color:var(--ink);}
.dl-g-eyebrow{font-size:12px;letter-spacing:2px;text-transform:uppercase;color:var(--mute);
  font-weight:600;margin:36px 0 16px;}
.dl-g h1{font-size:40px;line-height:1.1;letter-spacing:-1.3px;font-weight:800;margin:0 0 20px;}
.dl-g-lede{font-size:19px;color:var(--mute);margin:0;}
.dl-g-tldr{margin:40px 0 0;padding:24px 26px;background:#F5F8FC;border-radius:14px;}
.dl-g-tldr-h{font-size:12px;letter-spacing:1.8px;text-transform:uppercase;font-weight:700;
  color:var(--mute);margin:0 0 16px;}
.dl-g-tldr ul{margin:0;padding-left:20px;}
.dl-g-tldr li{font-size:16px;margin-bottom:12px;}
.dl-g-tldr li:last-child{margin-bottom:0;}
.dl-g h2{font-size:27px;line-height:1.22;letter-spacing:-.7px;font-weight:800;margin:56px 0 18px;}
.dl-g p{font-size:17px;margin:0 0 18px;}
.dl-g-walk{margin:0;padding:0;list-style:none;counter-reset:walk;}
.dl-g-walk li{counter-increment:walk;position:relative;padding-left:44px;margin-bottom:20px;font-size:17px;}
.dl-g-walk li::before{content:counter(walk);position:absolute;left:0;top:1px;
  width:28px;height:28px;border-radius:8px;background:#EDF2F9;color:var(--ink);
  font-size:14px;font-weight:700;display:flex;align-items:center;justify-content:center;}
.dl-g-flags{margin:0;padding:0;list-style:none;}
.dl-g-flags li{position:relative;padding-left:26px;margin-bottom:14px;font-size:17px;}
.dl-g-flags li::before{content:"";position:absolute;left:2px;top:11px;width:8px;height:8px;
  border-radius:2px;background:var(--warn);}
.dl-g-faq{border-top:1px solid var(--line);margin-top:20px;}
.dl-g-faq-item{border-bottom:1px solid var(--line);}
.dl-g-q{width:100%;text-align:left;background:none;border:0;padding:19px 32px 19px 0;
  font-size:17px;font-weight:600;color:var(--ink);cursor:pointer;position:relative;
  font-family:inherit;letter-spacing:-.2px;line-height:1.4;}
.dl-g-q:hover{color:#12294C;}
.dl-g-q::after{content:"+";position:absolute;right:4px;top:18px;font-size:22px;
  font-weight:400;color:var(--mute);}
.dl-g-q[aria-expanded="true"]::after{content:"\\2013";}
.dl-g-a{font-size:16px;color:var(--mute);padding:0 8px 20px 0;margin:0;}
.dl-g-cta{margin-top:60px;padding:32px;background:#0A1B33;border-radius:16px;color:#fff;}
.dl-g-cta h3{font-size:24px;font-weight:800;letter-spacing:-.6px;margin:0 0 12px;}
.dl-g-cta p{font-size:16px;color:#B9C9E0;margin:0 0 24px;}
.dl-g-btn{background:#3DD68C;color:#062012;font-weight:700;font-size:17px;border:0;
  padding:15px 30px;border-radius:10px;cursor:pointer;font-family:inherit;}
.dl-g-btn:hover{background:#35c17e;}
.dl-g-disc{margin-top:44px;padding-top:22px;border-top:1px solid var(--line);}
.dl-g-disc-h{font-size:12px;letter-spacing:1.6px;text-transform:uppercase;font-weight:700;
  color:var(--mute);margin:0 0 8px;}
.dl-g-disc p{font-size:14px;color:var(--mute);margin:0;line-height:1.6;}
@media (max-width:560px){
  .dl-g h1{font-size:31px;}
  .dl-g-lede{font-size:17px;}
  .dl-g h2{font-size:23px;}
  .dl-g p,.dl-g-walk li,.dl-g-flags li{font-size:16px;}
  .dl-g-cta{padding:26px 22px;}
}
`;

export default function LienPayoffGuide({ onBack, onStart }) {
  const [open, setOpen] = useState(-1);
  const t = COPY.en;

  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        headline: t.h1,
        description: t.lede,
        about: "Vehicle lien payoff in a New Jersey private car sale",
        publisher: { "@type": "Organization", name: "DriveLink" },
      },
      {
        "@type": "FAQPage",
        mainEntity: t.faqs.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
    ],
  };

  return (
    <div className="dl-g">
      <style>{CSS}</style>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />

      <div className="dl-g-top">
        {onBack && (
          <button className="dl-g-back" onClick={onBack}>
            {t.back}
          </button>
        )}
      </div>

      <p className="dl-g-eyebrow">{t.eyebrow}</p>
      <h1>{t.h1}</h1>
      <p className="dl-g-lede">{t.lede}</p>

      <div className="dl-g-tldr">
        <p className="dl-g-tldr-h">{t.tldrTitle}</p>
        <ul>
          {t.tldr.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      </div>

      {t.sections.map((s, i) => (
        <section key={i}>
          <h2>{s.h}</h2>
          {i === 2 ? (
            <ol className="dl-g-walk">
              {s.p.map((para, j) => (
                <li key={j}>{para}</li>
              ))}
            </ol>
          ) : i === 4 ? (
            <ul className="dl-g-flags">
              {s.p.map((para, j) => (
                <li key={j}>{para}</li>
              ))}
            </ul>
          ) : (
            s.p.map((para, j) => <p key={j}>{para}</p>)
          )}
        </section>
      ))}

      <h2>{t.faqTitle}</h2>
      <div className="dl-g-faq">
        {t.faqs.map((f, i) => (
          <div className="dl-g-faq-item" key={i}>
            <button
              className="dl-g-q"
              aria-expanded={open === i}
              onClick={() => setOpen(open === i ? -1 : i)}
            >
              {f.q}
            </button>
            {open === i && <p className="dl-g-a">{f.a}</p>}
          </div>
        ))}
      </div>

      <div className="dl-g-cta">
        <h3>{t.ctaTitle}</h3>
        <p>{t.ctaBody}</p>
        <button className="dl-g-btn" onClick={onStart}>
          {t.ctaButton}
        </button>
      </div>

      <div className="dl-g-disc">
        <p className="dl-g-disc-h">{t.disclaimerTitle}</p>
        <p>{t.disclaimer}</p>
      </div>
    </div>
  );
}
