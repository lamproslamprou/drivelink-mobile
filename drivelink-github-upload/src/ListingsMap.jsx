import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

// Default Leaflet marker icons don't load correctly with bundlers — point them at CDN assets.
const icon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

const fmt = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

export default function ListingsMap({ listings, onSelect }) {
  const withCoords = listings.filter(l => l.lat && l.lng);
  const center = withCoords.length
    ? [withCoords.reduce((s, l) => s + l.lat, 0) / withCoords.length, withCoords.reduce((s, l) => s + l.lng, 0) / withCoords.length]
    : [39.8283, -98.5795]; // continental US center fallback

  if (withCoords.length === 0) {
    return <div style={{ padding: 40, textAlign: "center", color: "#6b7280", background: "#fff", borderRadius: 16 }}>No listings have a location set yet.</div>;
  }

  return (
    <div style={{ borderRadius: 16, overflow: "hidden", height: 460 }}>
      <MapContainer center={center} zoom={withCoords.length === 1 ? 10 : 4} style={{ height: "100%", width: "100%" }}>
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {withCoords.map(l => (
          <Marker key={l.id} position={[l.lat, l.lng]} icon={icon} eventHandlers={{ click: () => onSelect?.(l) }}>
            <Popup>
              <b>{l.year} {l.make} {l.model}</b><br />
              {fmt(l.price)} · {l.location_text || ""}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}

// Free geocoding via OpenStreetMap's Nominatim — no API key required.
export async function geocode(locationText) {
  if (!locationText?.trim()) return null;
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(locationText)}`, {
      headers: { "Accept-Language": "en" },
    });
    const data = await res.json();
    if (data?.[0]) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch {
    // Geocoding is a nice-to-have; fail silently and let the listing save without coordinates.
  }
  return null;
}
