import { useState } from "react";

// The browse filters, dressed as an aircraft instrument panel: bezeled modules,
// rocker switches with indicator lamps, amber/green readouts. Everything is
// tap, toggle or slide; nothing needs typing. It is purely presentational:
// HomeView owns the filter state and does the filtering.
//
// "Miles away" uses the browser's location once, on a tap, and keeps the
// position in memory only. It is never sent anywhere or stored.

const COPY = {
  en: {
    deck: "FLIGHT DECK", title: "Filters", sight: "cars in sight", openPanel: "More filters", closePanel: "Hide filters",
    price: "Price", anyPrice: "Any", under: "Under", from: "From", to: "To",
    make: "Make", allMakes: "All", type: "Type", allTypes: "All",
    odo: "Odometer", upTo: "up to", mi: "mi", anyMiles: "any",
    range: "Range", gps: "Use my location", gpsOn: "Location locked", gpsErr: "Location blocked. Allow it in your browser to use range.", within: "Within", away: "mi away",
    sort: "Sort", newest: "Newest", low: "Price ↑", high: "Price ↓", view: "View", grid: "Grid", map: "Map",
    reset: "Reset", alert: "Set alert", model: "Model",
  },
  es: {
    deck: "CABINA", title: "Filtros", sight: "autos a la vista", openPanel: "Más filtros", closePanel: "Ocultar filtros",
    price: "Precio", anyPrice: "Cualquiera", under: "Menos de", from: "Desde", to: "Hasta",
    make: "Marca", allMakes: "Todas", type: "Tipo", allTypes: "Todos",
    odo: "Odómetro", upTo: "hasta", mi: "mi", anyMiles: "cualquiera",
    range: "Alcance", gps: "Usar mi ubicación", gpsOn: "Ubicación fijada", gpsErr: "Ubicación bloqueada. Permítela en tu navegador para usar el alcance.", within: "A menos de", away: "mi",
    sort: "Orden", newest: "Recientes", low: "Precio ↑", high: "Precio ↓", view: "Vista", grid: "Lista", map: "Mapa",
    reset: "Reiniciar", alert: "Crear alerta", model: "Modelo",
  },
};

const MAX_PRICE = 20000000; // cents
const MAX_MILES = 300000;
const usd = (cents) => "$" + Math.round(cents / 100).toLocaleString("en-US");
const pad = (n) => String(Math.max(0, n)).padStart(2, "0");

export const COCKPIT_CSS = `
.cp { --bezel:#0a0f1a; --panel:#101826; --recess:#0b121d; --edge:#223048; --label:#7f93b0; --amber:#ffb020; --green:#35e08a; --ink:#e6edf7;
  position: relative; margin: 16px 0 8px; padding: 14px; border-radius: 18px; color: var(--ink);
  background: linear-gradient(180deg,#141d2d 0%, #0d1522 100%); border: 1px solid #2a3a55;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.06), inset 0 0 0 4px var(--bezel), 0 10px 30px rgba(8,12,22,.35);
  font-family: "Inter", -apple-system, "Segoe UI", sans-serif; }
.cp::before, .cp::after { content:""; position:absolute; top:7px; width:7px; height:7px; border-radius:50%; background: radial-gradient(circle at 35% 35%, #4b5d7c, #1a2436); }
.cp::before { left:7px; } .cp::after { right:7px; }
.cp-head { display:flex; align-items:center; justify-content:space-between; gap:12px; padding: 2px 6px 10px; }
.cp-title { display:flex; flex-direction:column; gap:2px; }
.cp-deck { font: 700 10px/1 ui-monospace,"SF Mono",Menlo,Consolas,monospace; letter-spacing:.22em; color: var(--amber); }
.cp-h { font-size: 18px; font-weight: 800; letter-spacing:.01em; }
.cp-readout { display:flex; align-items:center; gap:10px; }
.cp-digits { font: 700 26px/1 ui-monospace,"SF Mono",Menlo,Consolas,monospace; color: var(--green); background:#050a12; border:1px solid #1c2a40; border-radius:8px; padding: 6px 10px; text-shadow: 0 0 10px rgba(53,224,138,.55); letter-spacing:.06em; }
.cp-digits small { color:#2c7a55; font-size: 16px; text-shadow:none; }
.cp-sight { font: 600 10px/1.2 ui-monospace,Menlo,Consolas,monospace; letter-spacing:.14em; text-transform:uppercase; color: var(--label); max-width: 70px; }
.cp .cp-toggle { display:none; }
.cp-body { display:grid; grid-template-columns: repeat(auto-fit,minmax(230px,1fr)); gap: 10px; }
.cp-mod { background: var(--recess); border:1px solid var(--edge); border-radius:12px; padding: 10px 12px 12px; box-shadow: inset 0 2px 6px rgba(0,0,0,.45); min-width:0; }
.cp-lab { font: 700 10px/1 ui-monospace,"SF Mono",Menlo,Consolas,monospace; letter-spacing:.2em; text-transform:uppercase; color: var(--label); margin-bottom:9px; display:flex; justify-content:space-between; gap:8px; }
.cp-lab b { color: var(--amber); font-weight:700; letter-spacing:.06em; }
.cp-row { display:flex; flex-wrap:wrap; gap:6px; }
.cp-sw { display:inline-flex; align-items:center; gap:7px; min-height:40px; padding:0 12px 0 10px; border-radius:8px; cursor:pointer; user-select:none;
  background: linear-gradient(180deg,#1a2639,#121b2b); border:1px solid #2c3d59; color:#b7c5db; font: 700 12px/1 ui-monospace,"SF Mono",Menlo,Consolas,monospace; letter-spacing:.06em; text-transform:uppercase;
  box-shadow: 0 2px 0 #060a12, inset 0 1px 0 rgba(255,255,255,.07); transition: transform .06s, box-shadow .06s; }
.cp-sw:active { transform: translateY(2px); box-shadow: 0 0 0 #060a12, inset 0 1px 0 rgba(255,255,255,.05); }
.cp-sw i { width:8px; height:8px; border-radius:50%; background:#2a3447; box-shadow: inset 0 0 0 1px #3a4a66; flex:none; }
.cp-sw.on { color:#fff; border-color:#8a6a1c; background: linear-gradient(180deg,#2a2412,#1b170b); }
.cp-sw.on i { background: var(--amber); box-shadow: 0 0 8px var(--amber), inset 0 0 0 1px #ffd27a; }
.cp-sw.green.on { border-color:#1f7a50; background: linear-gradient(180deg,#0f2a1f,#0b1d16); }
.cp-sw.green.on i { background: var(--green); box-shadow: 0 0 8px var(--green); }
.cp-sw[disabled] { opacity:.4; cursor:not-allowed; }
.cp-range { width:100%; margin: 4px 0 2px; accent-color: var(--amber); height: 28px; }
.cp-sub { display:flex; justify-content:space-between; font: 600 11px/1 ui-monospace,Menlo,Consolas,monospace; color: var(--label); letter-spacing:.08em; }
.cp-note { font-size: 12px; color:#f0a4a4; margin-top:8px; line-height:1.4; }
.cp-foot { display:flex; flex-wrap:wrap; gap:8px; align-items:center; padding: 10px 6px 0; }
.cp-caution { background: linear-gradient(180deg,#3a2a08,#241a05); color:#ffd27a; border-color:#8a6a1c; }
.cp-tag { display:inline-flex; align-items:center; gap:6px; background:#050a12; border:1px solid #2c3d59; color:#b7c5db; border-radius:999px; padding:6px 10px; font-size:12px; }
.cp-tag button { background:none; border:none; color:#7f93b0; cursor:pointer; font-size:12px; padding:0; }
.cp-mobile-only { display:none; }
@media (max-width: 700px) {
  .cp { padding: 12px 10px; margin: 12px 0 4px; }
  .cp .cp-toggle { display:inline-flex; }
  .cp-body.cp-more { display:none; }
  .cp.open .cp-body.cp-more { display:grid; grid-template-columns: 1fr; margin-top: 10px; }
  .cp-foot.cp-more { display:none; }
  .cp.open .cp-foot.cp-more { display:flex; }
  .cp-mobile-only { display:block; }
  .cp-sight { display:none; }
  .cp-sw { min-height:44px; }
}
`;

function Sw({ on, onClick, children, green, disabled, label }) {
  return (
    <button type="button" className={"cp-sw" + (on ? " on" : "") + (green ? " green" : "")} onClick={onClick} aria-pressed={!!on} disabled={disabled} aria-label={label}>
      <i aria-hidden="true" />{children}
    </button>
  );
}

export default function CockpitFilters({
  lang, count, total,
  makes, make, setMake,
  types, vehicleType, setVehicleType,
  minPrice, setMinPrice, maxPrice, setMaxPrice,
  maxMileage, setMaxMileage,
  geo, setGeo, radius, setRadius,
  sort, setSort, mode, setMode,
  search, clearSearch,
  canSave, onSave, onReset,
}) {
  const c = COPY[lang === "es" ? "es" : "en"];
  const [open, setOpen] = useState(false);
  const [geoErr, setGeoErr] = useState(false);

  const toggleGeo = () => {
    if (geo) { setGeo(null); setRadius(null); setGeoErr(false); return; }
    if (!navigator.geolocation) { setGeoErr(true); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => { setGeoErr(false); setGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude }); if (!radius) setRadius(50); },
      () => setGeoErr(true),
      { timeout: 8000, maximumAge: 600000 },
    );
  };

  const quick = [[MAX_PRICE, c.anyPrice], [500000, `${c.under} $5k`], [1000000, `${c.under} $10k`], [2000000, `${c.under} $20k`]];

  return (
    <section className={"cp" + (open ? " open" : "")} aria-label={c.title}>
      <style>{COCKPIT_CSS}</style>
      <div className="cp-head">
        <div className="cp-title">
          <span className="cp-deck">✈ {c.deck}</span>
          <span className="cp-h">{c.title}</span>
        </div>
        <div className="cp-readout">
          <span className="cp-sight">{c.sight}</span>
          <span className="cp-digits" aria-live="polite">{pad(count)}<small>/{pad(total)}</small></span>
          <button type="button" className="cp-sw cp-toggle" onClick={() => setOpen(o => !o)} aria-expanded={open}>
            <i aria-hidden="true" />{open ? c.closePanel : c.openPanel}
          </button>
        </div>
      </div>

      {/* Quick price row: always visible, including on phones. */}
      <div className="cp-row" style={{ padding: "0 6px 2px" }} role="group" aria-label={c.price}>
        {quick.map(([cents, label]) => (
          <Sw key={cents} on={maxPrice === cents && minPrice === 0} onClick={() => { setMinPrice(0); setMaxPrice(cents); }}>{label}</Sw>
        ))}
      </div>

      <div className="cp-body cp-more">
        <div className="cp-mod">
          <div className="cp-lab"><span>{c.price}</span><b>{usd(minPrice)} – {maxPrice >= MAX_PRICE ? "∞" : usd(maxPrice)}</b></div>
          <div className="cp-sub"><span>{c.from}</span></div>
          <input className="cp-range" type="range" min={0} max={MAX_PRICE} step={100000} value={minPrice}
            onChange={(e) => { const v = +e.target.value; setMinPrice(Math.min(v, maxPrice)); }} aria-label={c.from} />
          <div className="cp-sub"><span>{c.to}</span></div>
          <input className="cp-range" type="range" min={500000} max={MAX_PRICE} step={100000} value={maxPrice}
            onChange={(e) => { const v = +e.target.value; setMaxPrice(Math.max(v, minPrice)); }} aria-label={c.to} />
        </div>

        <div className="cp-mod">
          <div className="cp-lab"><span>{c.make}</span><b>{make === "all" ? c.allMakes : make}</b></div>
          <div className="cp-row">
            <Sw on={make === "all"} onClick={() => setMake("all")}>{c.allMakes}</Sw>
            {makes.map((m) => <Sw key={m} on={make === m} onClick={() => setMake(make === m ? "all" : m)}>{m}</Sw>)}
          </div>
          {types.length > 1 && (
            <>
              <div className="cp-lab" style={{ marginTop: 12 }}><span>{c.type}</span></div>
              <div className="cp-row">
                <Sw on={vehicleType === "all"} onClick={() => setVehicleType("all")}>{c.allTypes}</Sw>
                {types.map((vt) => <Sw key={vt.value} on={vehicleType === vt.value} onClick={() => setVehicleType(vt.value)}>{vt.emoji} {vt.label}</Sw>)}
              </div>
            </>
          )}
        </div>

        <div className="cp-mod">
          <div className="cp-lab"><span>{c.odo}</span><b>{maxMileage >= MAX_MILES ? c.anyMiles : `${c.upTo} ${maxMileage.toLocaleString("en-US")} ${c.mi}`}</b></div>
          <input className="cp-range" type="range" min={0} max={MAX_MILES} step={5000} value={maxMileage} onChange={(e) => setMaxMileage(+e.target.value)} aria-label={c.odo} />
          <div className="cp-sub"><span>0</span><span>{(MAX_MILES / 1000)}k+</span></div>
        </div>

        <div className="cp-mod">
          <div className="cp-lab"><span>{c.range}</span><b>{geo && radius ? `${c.within} ${radius} ${c.away}` : "—"}</b></div>
          <div className="cp-row">
            <Sw green on={!!geo} onClick={toggleGeo}>{geo ? c.gpsOn : c.gps}</Sw>
          </div>
          <div className="cp-row" style={{ marginTop: 8 }}>
            {[25, 50, 100, 250].map((r) => (
              <Sw key={r} disabled={!geo} on={!!geo && radius === r} onClick={() => setRadius(r)}>{r} {c.mi}</Sw>
            ))}
          </div>
          {geoErr && <div className="cp-note">{c.gpsErr}</div>}
        </div>

        <div className="cp-mod">
          <div className="cp-lab"><span>{c.sort}</span></div>
          <div className="cp-row">
            <Sw on={sort === "newest"} onClick={() => setSort("newest")}>{c.newest}</Sw>
            <Sw on={sort === "priceLow"} onClick={() => setSort("priceLow")}>{c.low}</Sw>
            <Sw on={sort === "priceHigh"} onClick={() => setSort("priceHigh")}>{c.high}</Sw>
          </div>
          <div className="cp-lab" style={{ marginTop: 12 }}><span>{c.view}</span></div>
          <div className="cp-row">
            <Sw on={mode === "grid"} onClick={() => setMode("grid")}>{c.grid}</Sw>
            <Sw on={mode === "map"} onClick={() => setMode("map")}>📍 {c.map}</Sw>
          </div>
        </div>
      </div>

      <div className="cp-foot cp-more">
        <button type="button" className="cp-sw cp-caution" onClick={onReset}><i aria-hidden="true" style={{ background: "#ffb020", boxShadow: "0 0 8px #ffb020" }} />{c.reset}</button>
        {canSave && <button type="button" className="cp-sw" onClick={onSave}><i aria-hidden="true" />🔔 {c.alert}</button>}
        {search && <span className="cp-tag">{c.model}: {search} <button type="button" onClick={clearSearch} aria-label="Clear">✕</button></span>}
      </div>
    </section>
  );
}
