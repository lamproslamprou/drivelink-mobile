import { useState, useEffect } from "react";
import { useLang } from "./i18n.jsx";

/*
  HowItWorksVideo — the 70-second "how DriveLink works" explainer.

  Click-to-play on purpose: nothing about the video (not the file, not a
  YouTube embed) loads until the visitor presses play, so it costs the page
  nothing and sets no third-party cookies. Until then it is a poster image.

  Source: by default the self-hosted file in /public/media. Once the video is
  uploaded to the YouTube channel, set YOUTUBE_ID below and the player switches
  to the privacy-enhanced (youtube-nocookie.com) embed instead; the file can
  then be deleted from /public/media.

  The video has on-screen text but no voiceover yet, and it is in English. The
  Spanish page says so rather than implying otherwise.

  Every claim in the video matches /faq: the buyer pays into the SELLER'S OWN
  Stripe account, DriveLink never holds the money and only controls when it can
  be paid out, and the payout is released when the buyer's 6-digit handover
  code is entered. If the process changes, re-cut the video before editing the
  words around it.
*/

const YOUTUBE_ID = "fjNvonbSRC0"; // @drivelink_deals, published 2026-11-25
const VIDEO_SRC = "/media/drivelink-how-it-works.mp4";
const POSTER_SRC = "/media/drivelink-how-it-works-poster.jpg";
const UPLOAD_DATE = "2026-11-25";
const SITE = "https://drivelink.deals";

const COPY = {
  en: {
    badge: "See it in 70 seconds",
    title: "Where your money sits while you buy a car",
    sub: "The buyer pays into the seller's own Stripe account, where it stays locked. DriveLink never holds it, and it is only released when the buyer's handover code is entered.",
    play: "Play the video: how DriveLink works",
    note: "Example screens in the video use fictional data.",
    name: "How DriveLink works: protected payment for private car sales",
    desc: "A 70-second walkthrough of how DriveLink protects a private car sale: the buyer pays into the seller's own Stripe account, the money stays locked, and it is released when the buyer's handover code is entered.",
  },
  es: {
    badge: "Míralo en 70 segundos",
    title: "Dónde está tu dinero mientras compras un coche",
    sub: "El comprador paga a la cuenta de Stripe del propio vendedor, donde el dinero queda bloqueado. DriveLink nunca lo retiene, y solo se libera cuando se introduce el código de entrega del comprador.",
    play: "Reproducir el vídeo: cómo funciona DriveLink",
    note: "El vídeo está en inglés y sus pantallas de ejemplo usan datos ficticios.",
    name: "Cómo funciona DriveLink: pago protegido para ventas privadas de coches",
    desc: "Un recorrido de 70 segundos por cómo DriveLink protege la venta privada de un coche: el comprador paga a la cuenta de Stripe del vendedor, el dinero queda bloqueado y se libera cuando se introduce el código de entrega del comprador. Vídeo en inglés.",
  },
};

export default function HowItWorksVideo({ variant = "section" }) {
  const { lang } = useLang();
  const c = COPY[lang] || COPY.en;
  const [playing, setPlaying] = useState(false);
  const inline = variant === "inline";

  // VideoObject structured data, so the video can show up in search results.
  useEffect(() => {
    const el = document.createElement("script");
    el.type = "application/ld+json";
    const data = {
      "@context": "https://schema.org",
      "@type": "VideoObject",
      name: c.name,
      description: c.desc,
      thumbnailUrl: [SITE + POSTER_SRC],
      uploadDate: UPLOAD_DATE,
      duration: "PT1M11S",
      inLanguage: "en",
    };
    if (YOUTUBE_ID) data.embedUrl = "https://www.youtube-nocookie.com/embed/" + YOUTUBE_ID;
    else data.contentUrl = SITE + VIDEO_SRC;
    el.textContent = JSON.stringify(data);
    document.head.appendChild(el);
    return () => {
      if (el.parentNode) el.parentNode.removeChild(el);
    };
  }, [lang]);

  const player = playing ? (
    YOUTUBE_ID ? (
      <iframe
        style={S.media}
        src={"https://www.youtube-nocookie.com/embed/" + YOUTUBE_ID + "?autoplay=1&rel=0&modestbranding=1"}
        title={c.name}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
      />
    ) : (
      <video style={S.media} src={VIDEO_SRC} poster={POSTER_SRC} controls autoPlay playsInline preload="auto" aria-label={c.name} />
    )
  ) : (
    <button type="button" style={S.posterBtn} onClick={() => setPlaying(true)} aria-label={c.play}>
      <img src={POSTER_SRC} alt="" style={S.media} loading="lazy" width="1280" height="720" />
      <span style={S.playDisc} aria-hidden="true">
        <svg width="34" height="34" viewBox="0 0 24 24" fill="#0f172a"><path d="M8 5v14l11-7z" /></svg>
      </span>
    </button>
  );

  const body = (
    <>
      {!inline && <div style={S.badge}>{c.badge}</div>}
      {!inline && <h2 style={S.title}>{c.title}</h2>}
      {!inline && <p style={S.sub}>{c.sub}</p>}
      <div style={S.frame}>{player}</div>
      <p style={S.note}>{c.note}</p>
    </>
  );

  if (inline) return <div style={S.inline}>{body}</div>;
  return (
    <section style={S.section} aria-label={c.name}>
      <div style={S.inner}>{body}</div>
    </section>
  );
}

const S = {
  section: { padding: "72px 24px", background: "#fff", textAlign: "center" },
  inner: { maxWidth: 880, margin: "0 auto" },
  inline: { margin: "28px 0 8px" },
  badge: { display: "inline-block", background: "#eff6ff", color: "#1d4ed8", fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 20, marginBottom: 16 },
  title: { fontSize: 34, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em", margin: "0 0 12px" },
  sub: { fontSize: 16, color: "#475569", lineHeight: 1.65, maxWidth: "62ch", margin: "0 auto 28px" },
  frame: { position: "relative", aspectRatio: "16 / 9", borderRadius: 18, overflow: "hidden", background: "#0b1220", boxShadow: "0 18px 50px rgba(15,23,42,.22)" },
  media: { position: "absolute", inset: 0, width: "100%", height: "100%", border: 0, display: "block", objectFit: "cover" },
  posterBtn: { position: "absolute", inset: 0, width: "100%", height: "100%", padding: 0, border: 0, background: "transparent", cursor: "pointer" },
  playDisc: { position: "absolute", left: "50%", top: "50%", width: 84, height: 84, marginLeft: -42, marginTop: -42, borderRadius: "50%", background: "#FFB020", display: "flex", alignItems: "center", justifyContent: "center", paddingLeft: 6, boxShadow: "0 8px 28px rgba(0,0,0,.35)" },
  note: { fontSize: 13, color: "#94a3b8", margin: "14px 0 0" },
};
