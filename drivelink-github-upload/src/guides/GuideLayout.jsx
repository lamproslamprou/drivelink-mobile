import { useState } from "react";

// ── SHARED GUIDE SHELL ────────────────────────────────────────────────────────
// Every state guide is the same page with different facts, so the chrome lives
// here and the guides are content-only files. Adding a state should be writing
// prose, not copying 200 lines of CSS.
//
// Section rendering is driven by an explicit `style` on each section rather than
// by its index, because index-based branching breaks the moment a section is
// reordered or one is inserted in the middle.

const CSS = `
.dl-g{--ink:#0A1B33;--mute:#5B6B85;--line:#DFE5EE;--warn:#B42318;
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
.dl-g-p{font-size:17px;margin:0 0 18px;}
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
.dl-g-dl{margin-top:52px;padding:26px 28px;border:1px solid var(--line);border-radius:14px;
  background:#F7FAFD;display:flex;gap:22px;align-items:center;}
.dl-g-dl-icon{flex:none;width:52px;height:64px;border-radius:6px;background:#fff;
  border:1px solid var(--line);position:relative;}
.dl-g-dl-icon::after{content:"PDF";position:absolute;left:0;right:0;bottom:9px;text-align:center;
  font-size:10px;font-weight:800;letter-spacing:.5px;color:#B42318;}
.dl-g-dl-icon::before{content:"";position:absolute;left:11px;right:11px;top:13px;height:2px;
  background:var(--line);box-shadow:0 7px 0 var(--line),0 14px 0 var(--line);}
.dl-g-dl-body{flex:1;}
.dl-g-dl-h{font-size:17px;font-weight:700;margin:0 0 5px;letter-spacing:-.3px;}
.dl-g-dl-p{font-size:14.5px;color:var(--mute);margin:0 0 14px;line-height:1.5;}
.dl-g-dl-a{display:inline-block;font-size:15px;font-weight:700;color:#0A1B33;
  text-decoration:none;border-bottom:2px solid #3DD68C;padding-bottom:2px;}
.dl-g-dl-a:hover{border-bottom-color:#0A1B33;}
.dl-g-cta{margin-top:60px;padding:32px;background:#0A1B33;border-radius:16px;color:#fff;}
.dl-g-cta h3{font-size:24px;font-weight:800;letter-spacing:-.6px;margin:0 0 12px;}
.dl-g-cta-p{font-size:16px;color:#B9C9E0;margin:0 0 24px;}
.dl-g-btn{background:#3DD68C;color:#062012;font-weight:700;font-size:17px;border:0;
  padding:15px 30px;border-radius:10px;cursor:pointer;font-family:inherit;}
.dl-g-btn:hover{background:#35c17e;}
.dl-g-more{margin-top:48px;padding-top:24px;border-top:1px solid var(--line);}
.dl-g-more-h{font-size:12px;letter-spacing:1.6px;text-transform:uppercase;font-weight:700;
  color:var(--mute);margin:0 0 14px;}
.dl-g-more-link{display:block;background:none;border:0;padding:6px 0;font-family:inherit;
  font-size:16px;font-weight:600;color:#12294C;cursor:pointer;text-align:left;}
.dl-g-more-link:hover{text-decoration:underline;}
.dl-g-disc{margin-top:40px;padding-top:22px;border-top:1px solid var(--line);}
.dl-g-disc-h{font-size:12px;letter-spacing:1.6px;text-transform:uppercase;font-weight:700;
  color:var(--mute);margin:0 0 8px;}
.dl-g-disc-p{font-size:14px;color:var(--mute);margin:0;line-height:1.6;}
@media (max-width:560px){
  .dl-g h1{font-size:31px;}
  .dl-g-lede{font-size:17px;}
  .dl-g h2{font-size:23px;}
  .dl-g-p,.dl-g-walk li,.dl-g-flags li{font-size:16px;}
  .dl-g-cta{padding:26px 22px;}
  .dl-g-dl{flex-direction:column;align-items:flex-start;gap:16px;padding:22px;}
}
`;

export default function GuideLayout({
  eyebrow,
  h1,
  lede,
  tldrTitle = "The short version",
  tldr = [],
  sections = [],
  faqTitle = "Common questions",
  faqs = [],
  cta,
  related = [],
  disclaimer,
  about,
  onBack,
  onStart,
  onNavigate,
}) {
  const [open, setOpen] = useState(-1);

  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        headline: h1,
        description: lede,
        about,
        publisher: { "@type": "Organization", name: "DriveLink" },
      },
      ...(faqs.length
        ? [
            {
              "@type": "FAQPage",
              mainEntity: faqs.map((f) => ({
                "@type": "Question",
                name: f.q,
                acceptedAnswer: { "@type": "Answer", text: f.a },
              })),
            },
          ]
        : []),
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
            ← Back
          </button>
        )}
      </div>

      <p className="dl-g-eyebrow">{eyebrow}</p>
      <h1>{h1}</h1>
      <p className="dl-g-lede">{lede}</p>

      {tldr.length > 0 && (
        <div className="dl-g-tldr">
          <p className="dl-g-tldr-h">{tldrTitle}</p>
          <ul>
            {tldr.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      {sections.map((s, i) => (
        <section key={i}>
          <h2>{s.h}</h2>
          {s.style === "steps" ? (
            <ol className="dl-g-walk">
              {s.p.map((para, j) => (
                <li key={j}>{para}</li>
              ))}
            </ol>
          ) : s.style === "flags" ? (
            <ul className="dl-g-flags">
              {s.p.map((para, j) => (
                <li key={j}>{para}</li>
              ))}
            </ul>
          ) : (
            s.p.map((para, j) => (
              <p className="dl-g-p" key={j}>
                {para}
              </p>
            ))
          )}
        </section>
      ))}

      {faqs.length > 0 && (
        <>
          <h2>{faqTitle}</h2>
          <div className="dl-g-faq">
            {faqs.map((f, i) => (
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
        </>
      )}

      {/* The worksheet every guide in this cluster refers to. Ungated on
          purpose — no email wall. The download is the trust-builder; making
          someone pay for it with their address undoes the point of the page. */}
      <div className="dl-g-dl">
        <div className="dl-g-dl-icon" aria-hidden="true" />
        <div className="dl-g-dl-body">
          <p className="dl-g-dl-h">Free lien payoff worksheet and bill of sale</p>
          <p className="dl-g-dl-p">
            Two pages you can fill in on your phone or print. The payoff
            arithmetic, the order things have to happen in, and a bill of sale
            with a lien disclosure line. No email required.
          </p>
          <a
            className="dl-g-dl-a"
            href="/downloads/drivelink-lien-payoff-worksheet.pdf"
            download
          >
            Download the PDF ↓
          </a>
        </div>
      </div>

      {cta && (
        <div className="dl-g-cta">
          <h3>{cta.title}</h3>
          <p className="dl-g-cta-p">{cta.body}</p>
          <button className="dl-g-btn" onClick={onStart}>
            {cta.button}
          </button>
        </div>
      )}

      {related.length > 0 && (
        <div className="dl-g-more">
          <p className="dl-g-more-h">Other states</p>
          {related.map((r) => (
            <button
              key={r.view}
              className="dl-g-more-link"
              onClick={() => onNavigate?.(r.view)}
            >
              {r.label} →
            </button>
          ))}
        </div>
      )}

      {disclaimer && (
        <div className="dl-g-disc">
          <p className="dl-g-disc-h">One caveat</p>
          <p className="dl-g-disc-p">{disclaimer}</p>
        </div>
      )}
    </div>
  );
}
