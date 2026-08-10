// ============================================================================
// DriveLink — i18n
//
// Deliberately dependency-free: a dictionary, a lookup, and a hook. No
// i18next, no ICU parser, no translation service. That means no bundle weight,
// no API calls, and no per-word billing — the cost of Spanish is the cost of
// writing it once.
//
// Spanish here is neutral Latin American, written for a US audience (primarily
// Mexican-American in California, which is where DriveLink's traffic
// concentrates). "Tú" rather than "usted": a peer-to-peer marketplace between
// private individuals reads as stiff and corporate in the formal register.
//
// NOT translated, on purpose:
//   - Terms of Service and Privacy Policy. A translated contract with no
//     governing-language clause is a real legal problem. If those are ever
//     translated, they need "the English version governs" stated explicitly
//     and a lawyer's eyes on it.
//   - Vehicle data (make, model, color) — user-entered, not ours to translate.
//   - Currency. fmt() already renders en-US dollars, which is what a US buyer
//     expects to see regardless of interface language.
//
// Adding a string: add it to `en`, add it to `es`, use t("key"). A key missing
// from `es` falls back to English rather than rendering blank — a visible
// English word is a much smaller failure than an empty button.
// ============================================================================

import { createContext, useContext, useEffect, useState } from "react";

export const LANGS = { en: "English", es: "Español" };
const STORAGE_KEY = "drivelink_lang";

const dict = {
  en: {
    // ── Language switcher ────────────────────────────────────────────────
    "lang.label": "Language",
    // Shown to English readers, written in Spanish on purpose: someone who
    // needs the Spanish site cannot read an English offer of it.
    "lang.switchPrompt": "¿Prefieres español? Cambia el idioma →",

    // ── Navigation ───────────────────────────────────────────────────────
    // The nav was hardcoded English until 2026-08-07: switching to Spanish
    // translated the page body and left every way of getting to another page
    // in English, which is worse than not translating at all.
    "nav.browse": "Browse",
    "nav.myListings": "My Listings",
    "nav.postListing": "Post a Car",
    "nav.startDeal": "Secure a Deal",
    "nav.advertise": "Advertise",
    "nav.messages": "Messages",
    "nav.myPurchases": "My Purchases",
    "nav.myOffers": "My Offers",
    "nav.favorites": "Saved Cars",
    "nav.savedSearches": "Saved Searches",
    "nav.dashboard": "Earnings",
    "nav.blocked": "Blocked",
    "nav.profile": "Profile",
    "nav.admin": "Admin",
    "nav.signOut": "Sign Out",
    "nav.member": "member",
    "nav.adminRole": "admin",

    // ── Listing cards & browse ───────────────────────────────────────────
    // Chrome around a listing. The seller's own words (description, location
    // text, colour if free-typed) stay in whatever language they wrote them —
    // machine-translating "no rust" into a car listing is a liability, not a
    // feature. A per-listing translate button is the right answer for that.
    "card.salePending": "Sale Pending",
    "card.sellerInactive": "Seller Inactive",
    "card.verified": "Verified",
    "card.verifiedTitle": "Verified seller",
    "card.unverifiedSeller": "Unverified Seller",
    "card.unverifiedTitle": "This seller hasn't completed identity verification",
    "card.mi": "mi",
    "card.linkCopied": "Link copied!",
    "card.shareAgain": "Share Again",
    "card.shareEarn": "Share & Earn 1%",
    "card.makeOffer": "Make an Offer",
    "card.messageSeller": "Message seller",
    "card.report": "Report",
    "card.reportSeller": "Report seller",
    "card.blockSeller": "Block seller",
    "card.unblockSeller": "Unblock seller",
    "card.completePurchase": "Complete Purchase",
    "card.offerPending": "Your offer of {amount} is pending",
    "card.offerCountered": "Seller countered at {amount}",
    "card.offerAccepted": "Offer of {amount} accepted!",
    "card.offerAcceptedShort": "Offer accepted!",
    "card.offerDeclined": "Offer declined",
    "card.offerWithdrawn": "Offer withdrawn",
    "card.awaitingPayouts": "Waiting on the seller to finish payout setup before you can pay.",

    "browse.allTypes": "All types",
    "browse.allMakes": "All makes",
    "browse.maxPrice": "Max price",
    "browse.maxMileage": "Max mileage",
    "browse.locationPlaceholder": "City or ZIP…",
    "browse.sortNewest": "Newest first",
    "browse.sortPriceLow": "Price: low to high",
    "browse.sortPriceHigh": "Price: high to low",
    "browse.noMatch": "No listings match your filters",
    "browse.widenSearch": "Try widening your search.",
    "browse.clear": "Clear",
    "browse.backToBrowse": "Back to Browse",
    "browse.paymentSuccess": "Payment Successful!",

    // ── Listing detail modal ─────────────────────────────────────────────
    "detail.close": "Close",
    "detail.soldBy": "Sold by",
    "detail.copyLink": "Copy link",
    "detail.vinVerified": "VIN Verified",
    "detail.carfax": "Look up history on Carfax",
    "detail.nicb": "Free theft & salvage check",
    "translate.toEnglish": "Translate to English",
    "translate.toSpanish": "Traducir al español",
    "translate.working": "Translating…",
    "translate.showOriginal": "Show original",
    "translate.notice": "Translated automatically — the seller wrote this in another language.",
    "translate.failed": "Couldn't translate this listing — try again.",
    "detail.payoutsPending": "This seller hasn't finished payout setup with our payments partner. You can still message them and make an offer — checkout opens once they're set up.",

    // ── AI price check ───────────────────────────────────────────────────
    // assessment.summary itself comes back from assess-deal as English prose.
    // Only the chrome is translated here; the verdict text needs the same
    // on-demand translation path as a seller's description.
    "deal.check": "AI Price Check",
    "deal.checking": "Checking market data…",
    "deal.greatDeal": "Great Deal",
    "deal.fairPrice": "Fair Price",
    "deal.aboveMarket": "Above Market",
    "deal.notEnoughData": "Not Enough Data Yet",
    "deal.liveResearch": "Live market research",
    "deal.basedOn": "Based on {count} DriveLink listings",
    "deal.basedOnOne": "Based on 1 DriveLink listing",
    "deal.marketRange": "Estimated market range",

    // ── Report modals ────────────────────────────────────────────────────
    "report.listingTitle": "Report this listing",
    "report.userTitle": "Report this user",
    "report.reason": "Reason",
    "report.details": "Details (optional)",
    "report.detailsPlaceholder": "Anything else we should know?",
    "common.cancel": "Cancel",
    "common.other": "Other",
    "report.submit": "Submit Report",
    "report.r.misleading": "Misleading listing",
    "report.r.scam": "Suspected scam",
    "report.r.bait": "Wrong price / bait and switch",
    "report.r.soldElsewhere": "Car already sold elsewhere",
    "report.r.inappropriate": "Inappropriate content",
    "report.r.other": "Other",
    "report.u.suspicious": "Suspicious / scam behavior",
    "report.u.harassment": "Harassment or abusive messages",
    "report.u.noShow": "Never showed up / wasted my time",
    "report.u.offPlatform": "Asked to pay outside the platform",



    // ── Auth ─────────────────────────────────────────────────────────────
    "auth.signin": "Sign In",
    "auth.createAccount": "Create Account",
    "auth.createAccountCta": "Create Account — It's Free",
    "auth.yourName": "Your Name",
    "auth.namePlaceholder": "e.g. John Smith",
    "auth.nameHint": "Buyers and sellers see this name on your listings and messages.",
    "auth.email": "Email",
    "auth.emailPlaceholder": "you@example.com",
    "auth.password": "Password",
    "auth.pleaseWait": "Please wait…",
    "auth.perkSell": "**Sell** your car — list for free",
    "auth.perkBuy": "**Buy** directly from owners",
    "auth.perkEarn": "**Earn 1%** sharing any listing",

    "auth.err.nameRequired": "Please enter your name.",
    "auth.err.nameFull": "Please enter your full name.",
    "auth.err.nameLong": "That name is too long — please shorten it.",
    "auth.err.nameLetters": "Please enter your name using letters.",
    "auth.err.nameReal": "Please enter your real name — buyers see this on your listings.",

    "auth.confirm.title": "Check your email",
    "auth.confirm.sentTo": "We sent a confirmation link to",
    "auth.confirm.instruction": "Click the link in that email to confirm your account, then come back and sign in.",
    "auth.confirm.resent": "Confirmation email resent!",
    "auth.confirm.resendError": "Couldn't resend — try again in a moment.",
    "auth.confirm.resend": "Resend confirmation email",
    "auth.confirm.sending": "Sending…",
    "auth.confirm.back": "← Back to sign in",
    "auth.confirm.spam": "Don't see it? Check your spam folder — it can take a minute or two to arrive.",

    "auth.forgot.link": "Forgot your password?",
    "auth.forgot.title": "Reset your password",
    "auth.forgot.intro": "Enter the email you signed up with and we'll send you a link to set a new password.",
    "auth.forgot.send": "Send reset link",
    "auth.forgot.sending": "Sending\u2026",
    "auth.forgot.sentTitle": "Check your email",
    "auth.forgot.sentTo": "If an account exists for",
    "auth.forgot.sentRest": "we've sent a link to reset your password. The link works once and expires in an hour.",
    "auth.forgot.back": "\u2190 Back to sign in",
    "auth.forgot.needEmail": "Please enter your email address.",
    "auth.reset.title": "Set a new password",
    "auth.reset.intro": "Choose a new password for your account.",
    "auth.reset.newPassword": "New password",
    "auth.reset.confirmPassword": "Confirm new password",
    "auth.reset.save": "Save new password",
    "auth.reset.saving": "Saving\u2026",
    "auth.reset.mismatch": "Those two passwords don't match.",
    "auth.reset.tooShort": "Please use at least 8 characters.",
    "auth.reset.done": "Password updated \u2014 you're signed in.",
    "auth.reset.expired": "That reset link has expired or has already been used. Request a new one from the sign-in page.",
    "auth.reset.checking": "Checking your link\u2026",


    // ── Home / hero ──────────────────────────────────────────────────────
    "home.badge": "Peer-to-peer • Commission-backed",
    "home.title": "Find your next car.",
    "home.titleAccent": "Share and earn 1%.",
    "home.sub": "Buy directly from owners. Promote listings to your network and earn 1% of every sale you unlock.",
    "home.statListings": "Active listings",
    "home.statSold": "Cars sold",
    "home.statPromoter": "Promoter cut",
    "home.searchPlaceholder": "Search make, model, year…",

    // ── Escrow / trust ───────────────────────────────────────────────────
    "escrow.title": "🔒 Escrow protected",
    "escrow.body": "Your payment is held securely — it isn't released to the seller until you confirm you have the car and the signed title.",
    // Appended only when this specific seller completed Stripe Identity. Was
    // referenced in App.jsx and never defined here, so t() fell back to
    // printing the key name to users: "...their listings. escrow.idVerified".
    "escrow.idVerified": "This seller has verified their identity with Stripe.",
    "escrow.notReady.title": "⏳ Checkout not available yet",

    // ── Selling / fees ───────────────────────────────────────────────────
    "sell.pageTitle": "Post a Car for Sale",
    "sell.make": "Make",
    "sell.makeSelect": "Select make…",
    "sell.model": "Model",
    "sell.modelSelect": "Select model…",
    "sell.pickMakeFirst": "Choose a make first",
    "sell.pickYearFirst": "Choose a year first",
    "sell.loading": "Loading…",
    "sell.other": "Other / not listed",
    "sell.year": "Year",
    "sell.yearSelect": "Select year…",
    "sell.price": "Price ($)",
    "sell.mileage": "Mileage",
    "sell.color": "Color",
    "sell.location": "Location (city or ZIP)",
    "sell.vinOptional": "VIN (optional)",
    "sell.decodeVin": "Decode VIN",
    "sell.checking": "Checking…",

    "fee.youReceive": "You'll receive about {amount}",
    "fee.breakdown": "Sale price {price} − DriveLink fee 1% ({platform}) − card processing ({processing})",
    "fee.promoterNote": "If the buyer arrives through a Promoter's shared link, a further 1% ({promoter}) goes to that Promoter and you'd receive about {netWithPromoter}. Processing is charged by our payment provider, not by DriveLink, and is an estimate until the sale completes.",

    // ── Payout timing ────────────────────────────────────────────────────
    "payout.held": "The buyer's payment is held safely. Once they confirm they've received the car, {amount} is released to you — or automatically after 7 days if they don't. Bank arrival typically takes another few business days after that.",
    "payout.released": "💸 {amount} released to your Stripe account. Card payments take a few business days to settle before Stripe pays out to your bank — expect it within about 5–7 business days of the sale. New accounts can take longer on the first payout.",

    // ── Common actions ───────────────────────────────────────────────────
    "action.buyNow": "Buy Now",
    "action.shareEarn": "Share & Earn 1%",
    "action.messageSeller": "Message seller",
    "action.report": "Report",
    "action.blockSeller": "Block seller",
    "action.backToBrowse": "Back to Browse",
    "action.confirmReceipt": "Confirm Receipt",
    "action.reportProblem": "Report a Problem",
    "action.save": "Save Details",
    "action.signInToBuy": "Sign in to buy or share →",
  },

  es: {
    "lang.label": "Idioma",
    "lang.switchPrompt": "Prefer English? Switch language →",

    "nav.browse": "Explorar",
    "nav.myListings": "Mis anuncios",
    "nav.postListing": "Publicar un carro",
    "nav.startDeal": "Asegurar un trato",
    "nav.advertise": "Anunciarse",
    "nav.messages": "Mensajes",
    "nav.myPurchases": "Mis compras",
    "nav.myOffers": "Mis ofertas",
    "nav.favorites": "Carros guardados",
    "nav.savedSearches": "Búsquedas guardadas",
    "nav.dashboard": "Ganancias",
    "nav.blocked": "Bloqueados",
    "nav.profile": "Perfil",
    "nav.admin": "Administración",
    "nav.signOut": "Cerrar sesión",
    "nav.member": "miembro",
    "nav.adminRole": "administrador",

    "card.salePending": "Venta pendiente",
    "card.sellerInactive": "Vendedor inactivo",
    "card.verified": "Verificado",
    "card.verifiedTitle": "Vendedor verificado",
    "card.unverifiedSeller": "Vendedor sin verificar",
    "card.unverifiedTitle": "Este vendedor no ha completado la verificación de identidad",
    "card.mi": "mi",
    "card.linkCopied": "¡Enlace copiado!",
    "card.shareAgain": "Compartir de nuevo",
    "card.shareEarn": "Comparte y gana 1%",
    "card.makeOffer": "Hacer una oferta",
    "card.messageSeller": "Enviar mensaje al vendedor",
    "card.report": "Reportar",
    "card.reportSeller": "Reportar vendedor",
    "card.blockSeller": "Bloquear vendedor",
    "card.unblockSeller": "Desbloquear vendedor",
    "card.completePurchase": "Completar compra",
    "card.offerPending": "Tu oferta de {amount} está pendiente",
    "card.offerCountered": "El vendedor contraofertó {amount}",
    "card.offerAccepted": "¡Oferta de {amount} aceptada!",
    "card.offerAcceptedShort": "¡Oferta aceptada!",
    "card.offerDeclined": "Oferta rechazada",
    "card.offerWithdrawn": "Oferta retirada",
    "card.awaitingPayouts": "Esperando a que el vendedor termine de configurar sus pagos para que puedas pagar.",

    "browse.allTypes": "Todos los tipos",
    "browse.allMakes": "Todas las marcas",
    "browse.maxPrice": "Precio máximo",
    "browse.maxMileage": "Millaje máximo",
    "browse.locationPlaceholder": "Ciudad o código postal…",
    "browse.sortNewest": "Más recientes",
    "browse.sortPriceLow": "Precio: de menor a mayor",
    "browse.sortPriceHigh": "Precio: de mayor a menor",
    "browse.noMatch": "Ningún anuncio coincide con tus filtros",
    "browse.widenSearch": "Prueba a ampliar tu búsqueda.",
    "browse.clear": "Limpiar",
    "browse.backToBrowse": "Volver a explorar",
    "browse.paymentSuccess": "¡Pago exitoso!",

    "detail.close": "Cerrar",
    "detail.soldBy": "Vendido por",
    "detail.copyLink": "Copiar enlace",
    "detail.vinVerified": "VIN verificado",
    "detail.carfax": "Consultar historial en Carfax",
    "detail.nicb": "Verificación gratuita de robo y pérdida total",
    "translate.toEnglish": "Translate to English",
    "translate.toSpanish": "Traducir al español",
    "translate.working": "Traduciendo…",
    "translate.showOriginal": "Ver original",
    "translate.notice": "Traducido automáticamente — el vendedor escribió esto en otro idioma.",
    "translate.failed": "No se pudo traducir este anuncio — inténtalo de nuevo.",
    "detail.payoutsPending": "Este vendedor no ha terminado de configurar sus pagos con nuestro socio de pagos. Aún puedes enviarle un mensaje y hacer una oferta — la compra se habilita cuando termine.",

    "deal.check": "Análisis de precio con IA",
    "deal.checking": "Consultando datos del mercado…",
    "deal.greatDeal": "Muy buen precio",
    "deal.fairPrice": "Precio justo",
    "deal.aboveMarket": "Por encima del mercado",
    "deal.notEnoughData": "Aún no hay suficientes datos",
    "deal.liveResearch": "Investigación de mercado en vivo",
    "deal.basedOn": "Basado en {count} anuncios de DriveLink",
    "deal.basedOnOne": "Basado en 1 anuncio de DriveLink",
    "deal.marketRange": "Rango de mercado estimado",

    "report.listingTitle": "Reportar este anuncio",
    "report.userTitle": "Reportar a este usuario",
    "report.reason": "Motivo",
    "report.details": "Detalles (opcional)",
    "report.detailsPlaceholder": "¿Algo más que debamos saber?",
    "common.cancel": "Cancelar",
    "common.other": "Otro",
    "report.submit": "Enviar reporte",
    "report.r.misleading": "Anuncio engañoso",
    "report.r.scam": "Sospecha de estafa",
    "report.r.bait": "Precio incorrecto / cebo y cambio",
    "report.r.soldElsewhere": "El carro ya se vendió en otro lugar",
    "report.r.inappropriate": "Contenido inapropiado",
    "report.r.other": "Otro",
    "report.u.suspicious": "Comportamiento sospechoso / estafa",
    "report.u.harassment": "Acoso o mensajes abusivos",
    "report.u.noShow": "Nunca se presentó / me hizo perder el tiempo",
    "report.u.offPlatform": "Pidió pagar fuera de la plataforma",



    "auth.signin": "Iniciar sesión",
    "auth.createAccount": "Crear cuenta",
    "auth.createAccountCta": "Crear cuenta — es gratis",
    "auth.yourName": "Tu nombre",
    "auth.namePlaceholder": "ej. Juan Pérez",
    "auth.nameHint": "Los compradores y vendedores verán este nombre en tus anuncios y mensajes.",
    "auth.email": "Correo electrónico",
    "auth.emailPlaceholder": "tu@ejemplo.com",
    "auth.password": "Contraseña",
    "auth.pleaseWait": "Un momento…",
    "auth.perkSell": "**Vende** tu carro — publicar es gratis",
    "auth.perkBuy": "**Compra** directamente a los dueños",
    "auth.perkEarn": "**Gana 1%** al compartir cualquier anuncio",

    "auth.err.nameRequired": "Por favor escribe tu nombre.",
    "auth.err.nameFull": "Por favor escribe tu nombre completo.",
    "auth.err.nameLong": "Ese nombre es demasiado largo — por favor acórtalo.",
    "auth.err.nameLetters": "Por favor escribe tu nombre con letras.",
    "auth.err.nameReal": "Por favor escribe tu nombre real — los compradores lo verán en tus anuncios.",

    "auth.confirm.title": "Revisa tu correo",
    "auth.confirm.sentTo": "Enviamos un enlace de confirmación a",
    "auth.confirm.instruction": "Haz clic en el enlace de ese correo para confirmar tu cuenta, y luego regresa para iniciar sesión.",
    "auth.confirm.resent": "¡Correo de confirmación reenviado!",
    "auth.confirm.resendError": "No se pudo reenviar — inténtalo de nuevo en un momento.",
    "auth.confirm.resend": "Reenviar correo de confirmación",
    "auth.confirm.sending": "Enviando…",
    "auth.confirm.back": "← Volver a iniciar sesión",
    "auth.confirm.spam": "¿No lo ves? Revisa tu carpeta de spam — puede tardar uno o dos minutos en llegar.",

    "auth.forgot.link": "\u00bfOlvidaste tu contrase\u00f1a?",
    "auth.forgot.title": "Restablecer tu contrase\u00f1a",
    "auth.forgot.intro": "Escribe el correo con el que te registraste y te enviaremos un enlace para crear una nueva contrase\u00f1a.",
    "auth.forgot.send": "Enviar enlace",
    "auth.forgot.sending": "Enviando\u2026",
    "auth.forgot.sentTitle": "Revisa tu correo",
    "auth.forgot.sentTo": "Si existe una cuenta para",
    "auth.forgot.sentRest": "te enviamos un enlace para restablecer tu contrase\u00f1a. El enlace funciona una sola vez y vence en una hora.",
    "auth.forgot.back": "\u2190 Volver a iniciar sesi\u00f3n",
    "auth.forgot.needEmail": "Por favor escribe tu correo electr\u00f3nico.",
    "auth.reset.title": "Crea una nueva contrase\u00f1a",
    "auth.reset.intro": "Elige una nueva contrase\u00f1a para tu cuenta.",
    "auth.reset.newPassword": "Nueva contrase\u00f1a",
    "auth.reset.confirmPassword": "Confirma la nueva contrase\u00f1a",
    "auth.reset.save": "Guardar contrase\u00f1a",
    "auth.reset.saving": "Guardando\u2026",
    "auth.reset.mismatch": "Las dos contrase\u00f1as no coinciden.",
    "auth.reset.tooShort": "Usa al menos 8 caracteres.",
    "auth.reset.done": "Contrase\u00f1a actualizada \u2014 ya iniciaste sesi\u00f3n.",
    "auth.reset.expired": "Ese enlace venci\u00f3 o ya se us\u00f3. Pide uno nuevo desde la p\u00e1gina de inicio de sesi\u00f3n.",
    "auth.reset.checking": "Verificando tu enlace\u2026",


    "home.badge": "De persona a persona • Con comisión",
    "home.title": "Encuentra tu próximo carro.",
    "home.titleAccent": "Comparte y gana 1%.",
    "home.sub": "Compra directamente a los dueños. Comparte anuncios con tu gente y gana 1% de cada venta que logres.",
    "home.statListings": "Anuncios activos",
    "home.statSold": "Carros vendidos",
    "home.statPromoter": "Comisión",
    "home.searchPlaceholder": "Busca marca, modelo, año…",

    "escrow.title": "🔒 Pago protegido",
    "escrow.body": "Tu pago se guarda de forma segura — no se le entrega al vendedor hasta que confirmes que tienes el carro y el título firmado.",
    "escrow.idVerified": "Este vendedor ha verificado su identidad con Stripe.",
    "escrow.notReady.title": "⏳ La compra aún no está disponible",

    "sell.pageTitle": "Publica un carro en venta",
    "sell.make": "Marca",
    "sell.makeSelect": "Selecciona la marca…",
    "sell.model": "Modelo",
    "sell.modelSelect": "Selecciona el modelo…",
    "sell.pickMakeFirst": "Primero elige la marca",
    "sell.pickYearFirst": "Primero elige el año",
    "sell.loading": "Cargando…",
    "sell.other": "Otro / no aparece",
    "sell.year": "Año",
    "sell.yearSelect": "Selecciona el año…",
    "sell.price": "Precio ($)",
    "sell.mileage": "Millaje",
    "sell.color": "Color",
    "sell.location": "Ubicación (ciudad o código postal)",
    "sell.vinOptional": "VIN (opcional)",
    "sell.decodeVin": "Verificar VIN",
    "sell.checking": "Verificando…",

    "fee.youReceive": "Recibirás aproximadamente {amount}",
    "fee.breakdown": "Precio de venta {price} − comisión DriveLink 1% ({platform}) − procesamiento de tarjeta ({processing})",
    "fee.promoterNote": "Si el comprador llega por el enlace de un Promoter, un 1% adicional ({promoter}) va para esa persona y tú recibirías aproximadamente {netWithPromoter}. El procesamiento lo cobra nuestro proveedor de pagos, no DriveLink, y es un estimado hasta que se complete la venta.",

    "payout.held": "El pago del comprador está resguardado. Cuando confirme que recibió el carro, se te entregan {amount} — o automáticamente a los 7 días si no lo hace. Después de eso, el dinero suele tardar unos días hábiles más en llegar a tu banco.",
    "payout.released": "💸 Se te entregaron {amount} a tu cuenta de Stripe. Los pagos con tarjeta tardan unos días hábiles en liquidarse antes de que Stripe los deposite en tu banco — cuenta con unos 5 a 7 días hábiles desde la venta. Las cuentas nuevas pueden tardar más en el primer depósito.",

    "action.buyNow": "Comprar ahora",
    "action.shareEarn": "Comparte y gana 1%",
    "action.messageSeller": "Enviar mensaje",
    "action.report": "Reportar",
    "action.blockSeller": "Bloquear vendedor",
    "action.backToBrowse": "Volver a explorar",
    "action.confirmReceipt": "Confirmar recepción",
    "action.reportProblem": "Reportar un problema",
    "action.save": "Guardar datos",
    "action.signInToBuy": "Inicia sesión para comprar o compartir →",
  },
};

// Browser preference on a first visit, so a Spanish speaker doesn't have to
// find the toggle before reading anything. navigator.language is "es-MX",
// "es-US", "es-419" and so on — only the primary subtag matters here.
function detectLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && dict[saved]) return saved;
  } catch {
    // Private browsing can throw on localStorage access. Fall through.
  }
  const nav = typeof navigator !== "undefined" ? (navigator.language || "") : "";
  return nav.toLowerCase().startsWith("es") ? "es" : "en";
}

const LangContext = createContext({ lang: "en", setLang: () => {}, t: (k) => k });

export function LangProvider({ children }) {
  const [lang, setLangState] = useState(detectLang);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* ignore */ }
    if (typeof document !== "undefined") document.documentElement.lang = lang;
  }, [lang]);

  const t = (key, vars) => {
    // English is the fallback, never a blank string: a stray English word is a
    // far smaller failure than an empty button or a missing price.
    let s = dict[lang]?.[key] ?? dict.en[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        s = s.replaceAll(`{${k}}`, String(v));
      }
    }
    return s;
  };

  return (
    <LangContext.Provider value={{ lang, setLang: setLangState, t }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang() {
  return useContext(LangContext);
}

// Renders **bold** segments, which a few marketing strings need. Kept trivial
// on purpose — this is not a markdown parser and shouldn't become one.
export function Rich({ text }) {
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**")
          ? <b key={i}>{p.slice(2, -2)}</b>
          : <span key={i}>{p}</span>
      )}
    </>
  );
}

// Prominent one-tap switch for the hero. The header pill is always present,
// but a small EN/ES control in a busy nav is easy to miss — and the visitor
// most likely to miss it is exactly the one who needs it. This states the
// offer in the OTHER language, so it reads as an invitation rather than a
// setting to go hunting for.
export function LangSwitchLink({ style }) {
  const { lang, setLang, t } = useLang();
  const other = lang === "en" ? "es" : "en";
  return (
    <button
      onClick={() => setLang(other)}
      lang={other}
      style={{
        background: "rgba(255,255,255,.12)",
        border: "1px solid rgba(255,255,255,.35)",
        color: "#fff",
        borderRadius: 999,
        padding: "7px 16px",
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
        // Tight to the subheadline it belongs with, well clear of the stats
        // row below — otherwise it reads as a fourth statistic.
        marginTop: 10,
        marginBottom: 26,
        ...style,
      }}
    >
      {t("lang.switchPrompt")}
    </button>
  );
}

// Compact two-option switch. Sits in the header on desktop and mobile alike.
export function LangToggle({ style }) {
  const { lang, setLang } = useLang();
  return (
    <div
      style={{
        display: "inline-flex", background: "#f1f5f9", borderRadius: 8,
        padding: 2, gap: 2, ...style,
      }}
      role="group"
      aria-label="Language"
    >
      {Object.keys(LANGS).map((code) => (
        <button
          key={code}
          onClick={() => setLang(code)}
          aria-pressed={lang === code}
          style={{
            border: "none",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 700,
            padding: "4px 10px",
            borderRadius: 6,
            background: lang === code ? "#fff" : "transparent",
            color: lang === code ? "#0f172a" : "#6b7280",
            boxShadow: lang === code ? "0 1px 3px rgba(0,0,0,.08)" : "none",
          }}
        >
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
