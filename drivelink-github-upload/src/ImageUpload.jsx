import { useState } from "react";
import { supabase } from "./supabase.js";

export default function ImageUpload({ onUpload }) {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setError("Image must be under 5MB"); return; }
    setError("");
    setUploading(true);

    // Show preview immediately
    const reader = new FileReader();
    reader.onload = (ev) => setPreview(ev.target.result);
    reader.readAsDataURL(file);

    // Upload to Supabase Storage
    const ext = file.name.split(".").pop();
    const fileName = `car-${Date.now()}.${ext}`;
    const { data, error: uploadError } = await supabase.storage
      .from("car-images")
      .upload(fileName, file, { contentType: file.type });

    if (uploadError) {
      setError("Upload failed: " + uploadError.message);
      setUploading(false);
      return;
    }

    const { data: { publicUrl } } = supabase.storage.from("car-images").getPublicUrl(fileName);
    onUpload(publicUrl);
    setUploading(false);
  };

  return (
    <div style={styles.wrap}>
      <label style={styles.label}>Car Photo</label>
      <div style={styles.uploadBox}>
        {preview ? (
          <div style={styles.previewWrap}>
            <img src={preview} alt="preview" style={styles.preview} />
            <button style={styles.changeBtn} onClick={() => { setPreview(null); onUpload(""); }}>
              Change Photo
            </button>
          </div>
        ) : (
          <label style={styles.dropZone}>
            <input type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />
            <div style={styles.dropIcon}>{uploading ? "⏳" : "📷"}</div>
            <div style={styles.dropText}>{uploading ? "Uploading…" : "Click to upload a photo"}</div>
            <div style={styles.dropSub}>JPG, PNG or WEBP • Max 5MB</div>
          </label>
        )}
      </div>
      {error && <div style={styles.error}>{error}</div>}
    </div>
  );
}

const styles = {
  wrap: { marginBottom: 16 },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6, textTransform: "uppercase", letterSpacing: ".04em" },
  uploadBox: { borderRadius: 12, overflow: "hidden" },
  dropZone: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", border: "2px dashed #e5e7eb", borderRadius: 12, padding: "32px 24px", cursor: "pointer", background: "#f8fafc", transition: "border-color .2s" },
  dropIcon: { fontSize: 36, marginBottom: 8 },
  dropText: { fontSize: 14, fontWeight: 600, color: "#374151", marginBottom: 4 },
  dropSub: { fontSize: 12, color: "#9ca3af" },
  previewWrap: { position: "relative" },
  preview: { width: "100%", height: 200, objectFit: "cover", borderRadius: 12, display: "block" },
  changeBtn: { position: "absolute", top: 10, right: 10, background: "rgba(0,0,0,.6)", color: "#fff", border: "none", padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 },
  error: { background: "#fee2e2", color: "#dc2626", fontSize: 12, padding: "8px 12px", borderRadius: 8, marginTop: 8 },
};
