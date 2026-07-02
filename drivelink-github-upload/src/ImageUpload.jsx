import { useState } from "react";
import { supabase } from "./supabase.js";

const MAX_PHOTOS = 20;
const MAX_SIZE = 5 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

export default function ImageUpload({ images = [], onChange }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const handleFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    if (images.length + files.length > MAX_PHOTOS) {
      setError(`You can upload up to ${MAX_PHOTOS} photos.`);
      return;
    }
    for (const f of files) {
      if (!ALLOWED.includes(f.type)) { setError("Only JPG, PNG, or WEBP images are allowed."); return; }
      if (f.size > MAX_SIZE) { setError("Each photo must be under 5MB."); return; }
    }
    setError("");
    setUploading(true);
    const uploaded = [];
    for (const file of files) {
      const ext = file.name.split(".").pop();
      const fileName = `car-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("car-images").upload(fileName, file, { contentType: file.type });
      if (uploadError) { setError("Upload failed: " + uploadError.message); continue; }
      const { data: { publicUrl } } = supabase.storage.from("car-images").getPublicUrl(fileName);
      uploaded.push(publicUrl);
    }
    onChange([...images, ...uploaded]);
    setUploading(false);
  };

  const removeAt = (i) => onChange(images.filter((_, idx) => idx !== i));

  return (
    <div style={styles.wrap}>
      <label style={styles.label}>Car Photos ({images.length}/{MAX_PHOTOS})</label>
      {images.length > 0 && (
        <div style={styles.grid}>
          {images.map((url, i) => (
            <div key={i} style={styles.thumbWrap}>
              <img src={url} alt="" style={styles.thumb} />
              <button type="button" style={styles.removeBtn} onClick={() => removeAt(i)}>✕</button>
              {i === 0 && <span style={styles.coverTag}>Cover</span>}
            </div>
          ))}
        </div>
      )}
      {images.length < MAX_PHOTOS && (
        <label style={styles.dropZone}>
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={handleFiles} style={{ display: "none" }} />
          <div style={styles.dropIcon}>{uploading ? "⏳" : "📷"}</div>
          <div style={styles.dropText}>{uploading ? "Uploading…" : "Click to add photo(s)"}</div>
          <div style={styles.dropSub}>JPG, PNG or WEBP • Max 5MB each • Up to {MAX_PHOTOS} photos</div>
        </label>
      )}
      {error && <div style={styles.error}>{error}</div>}
    </div>
  );
}

const styles = {
  wrap: { marginBottom: 16 },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6, textTransform: "uppercase", letterSpacing: ".04em" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(90px,1fr))", gap: 10, marginBottom: 10 },
  thumbWrap: { position: "relative", borderRadius: 10, overflow: "hidden", height: 90 },
  thumb: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  removeBtn: { position: "absolute", top: 4, right: 4, background: "rgba(0,0,0,.65)", color: "#fff", border: "none", width: 22, height: 22, borderRadius: "50%", cursor: "pointer", fontSize: 11, lineHeight: 1 },
  coverTag: { position: "absolute", bottom: 4, left: 4, background: "rgba(15,23,42,.8)", color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 6 },
  dropZone: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", border: "2px dashed #e5e7eb", borderRadius: 12, padding: "28px 24px", cursor: "pointer", background: "#f8fafc" },
  dropIcon: { fontSize: 32, marginBottom: 8 },
  dropText: { fontSize: 14, fontWeight: 600, color: "#374151", marginBottom: 4 },
  dropSub: { fontSize: 12, color: "#9ca3af", textAlign: "center" },
  error: { background: "#fee2e2", color: "#dc2626", fontSize: 12, padding: "8px 12px", borderRadius: 8, marginTop: 8 },
};
