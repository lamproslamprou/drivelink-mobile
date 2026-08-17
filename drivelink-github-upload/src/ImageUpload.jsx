import { useState } from "react";
import { supabase } from "./supabase.js";

const MAX_PHOTOS = 20;

// Ceiling on what we accept from the file picker, before compression. This is
// deliberately generous — a modern phone shoots 8-12MB, and rejecting those
// outright is the wrong answer when we are about to shrink them anyway. It
// exists only to stop someone dragging in a 200MB RAW file and freezing the
// tab while canvas decodes it.
const MAX_INPUT_SIZE = 25 * 1024 * 1024;

// What we actually upload. A listing photo is displayed at ~800px wide in the
// gallery and never larger than the viewport, so 1600 on the long edge is
// generous and survives a full-screen view on a retina display.
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;

// Bypass compression for images already small enough to not be worth the
// round trip through canvas. Re-encoding a 400KB photo mostly just loses
// quality for no benefit.
const COMPRESS_ABOVE = 600 * 1024;

const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

// Uploading twenty photos one at a time on a phone connection is a very long
// spinner. Six at a time is roughly where browsers stop parallelising HTTP
// requests anyway, so going wider buys nothing.
const CONCURRENCY = 6;

/**
 * Downscale and re-encode in the browser.
 *
 * Returns a Blob, or the original File if anything goes wrong. Never throws —
 * a compression failure must degrade to "upload the original", not to a broken
 * upload button. That matters more than the bandwidth saving.
 *
 * PNG inputs come back as JPEG, which is intentional: a photo saved as PNG is
 * usually a screenshot of a photo and is enormous for no reason. Transparency
 * is irrelevant for car photos.
 */
async function compress(file) {
  if (file.size <= COMPRESS_ABOVE) return { blob: file, type: file.type, ext: extFor(file.type) };

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));

    // Already small enough in pixel terms. Re-encoding would only lose data.
    if (scale === 1 && file.type === "image/jpeg") {
      bitmap.close?.();
      return { blob: file, type: file.type, ext: "jpg" };
    }

    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const blob = await new Promise(res => canvas.toBlob(res, "image/jpeg", JPEG_QUALITY));
    if (!blob) return { blob: file, type: file.type, ext: extFor(file.type) };

    // If compression made it bigger — possible on small or already-optimised
    // images — keep the original.
    if (blob.size >= file.size) return { blob: file, type: file.type, ext: extFor(file.type) };

    return { blob, type: "image/jpeg", ext: "jpg" };
  } catch {
    return { blob: file, type: file.type, ext: extFor(file.type) };
  }
}

// Derived from the MIME type, never from the filename. A file called "photo"
// with no extension previously produced an object key ending in ".photo", and
// "IMG_1234.JPG" produced ".JPG" — both harmless but untidy, and the first
// breaks any tooling that keys off extension.
function extFor(type) {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "jpg";
}

// `label` and `max` exist because this component is reused for two different
// things. A car listing takes up to 20 photos; an ad placement takes exactly
// one, and rendering "Car Photos (0/20)" on the comp-an-ad form was both wrong
// and confusing. Defaults preserve the listing behaviour so no existing caller
// changes.
export default function ImageUpload({ images = [], onChange, label = "Car Photos", max = MAX_PHOTOS }) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState("");

  const handleFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;

    if (images.length + files.length > max) {
      setError(
        max === 1
          ? "Only one image can be added here."
          : `You can upload up to ${max} photos. You have room for ${max - images.length} more.`,
      );
      return;
    }
    for (const f of files) {
      if (!ALLOWED.includes(f.type)) { setError("Only JPG, PNG, or WEBP images are allowed."); return; }
      if (f.size > MAX_INPUT_SIZE) { setError(`"${f.name}" is too large. Photos must be under 25MB.`); return; }
    }

    setError("");
    setUploading(true);
    setProgress({ done: 0, total: files.length });

    // Results are written by index so the finished array preserves the order
    // the user picked. The previous version pushed as uploads completed, which
    // meant the cover photo was whichever one happened to finish first.
    const results = new Array(files.length).fill(null);
    const failures = [];
    let cursor = 0;
    let completed = 0;

    const worker = async () => {
      while (true) {
        const i = cursor++;
        if (i >= files.length) return;
        const file = files[i];
        try {
          const { blob, type, ext } = await compress(file);
          const fileName = `car-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
          const { error: uploadError } = await supabase
            .storage.from("car-images")
            .upload(fileName, blob, { contentType: type });
          if (uploadError) {
            failures.push(file.name);
          } else {
            const { data: { publicUrl } } = supabase.storage.from("car-images").getPublicUrl(fileName);
            results[i] = publicUrl;
          }
        } catch (err) {
          console.error("photo upload failed:", file.name, err);
          failures.push(file.name);
        }
        completed++;
        setProgress({ done: completed, total: files.length });
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));

    const uploaded = results.filter(Boolean);
    if (uploaded.length) onChange([...images, ...uploaded]);

    // Report partial failure honestly. The old version overwrote the error
    // message on each failed file and then called onChange anyway, so a user
    // whose 3rd of 5 photos failed saw no reliable indication of which.
    if (failures.length) {
      setError(
        failures.length === files.length
          ? "Upload failed. Check your connection and try again."
          : `${failures.length} of ${files.length} photos failed to upload. The rest were added.`,
      );
    }

    setUploading(false);
    setProgress({ done: 0, total: 0 });
  };

  const removeAt = (i) => onChange(images.filter((_, idx) => idx !== i));

  // Moving a photo to the front is the only reordering that matters — the
  // first image is the cover, and it is what a buyer sees in the grid.
  const makeCover = (i) => {
    if (i === 0) return;
    const next = [...images];
    const [picked] = next.splice(i, 1);
    onChange([picked, ...next]);
  };

  const remaining = max - images.length;

  return (
    <div style={styles.wrap}>
      <label style={styles.label}>{label} ({images.length}/{max})</label>

      {images.length > 0 && (
        <div style={styles.grid}>
          {images.map((url, i) => (
            <div key={url} style={styles.thumbWrap}>
              <img src={url} alt="" style={styles.thumb} loading="lazy" />
              <button
                type="button"
                style={styles.removeBtn}
                onClick={() => removeAt(i)}
                aria-label="Remove photo"
              >✕</button>
              {max === 1 ? null : i === 0
                ? <span style={styles.coverTag}>Cover</span>
                : (
                  <button
                    type="button"
                    style={styles.makeCoverBtn}
                    onClick={() => makeCover(i)}
                  >Make cover</button>
                )}
            </div>
          ))}
        </div>
      )}

      {images.length < max && (
        <label style={{ ...styles.dropZone, opacity: uploading ? 0.7 : 1, cursor: uploading ? "default" : "pointer" }}>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple={max > 1}
            disabled={uploading}
            onChange={handleFiles}
            style={{ display: "none" }}
          />
          <div style={styles.dropIcon}>{uploading ? "⏳" : "📷"}</div>
          <div style={styles.dropText}>
            {uploading
              ? `Uploading ${progress.done} of ${progress.total}…`
              : max === 1 ? "Click to add an image" : "Click to add photo(s)"}
          </div>
          <div style={styles.dropSub}>
            JPG, PNG or WEBP{max > 1 ? ` • ${remaining} ${remaining === 1 ? "photo" : "photos"} remaining` : ""}
            <br />
            Large photos are resized automatically
          </div>
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
  makeCoverBtn: { position: "absolute", bottom: 4, left: 4, background: "rgba(15,23,42,.55)", color: "#fff", fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 6, border: "none", cursor: "pointer" },
  dropZone: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", border: "2px dashed #e5e7eb", borderRadius: 12, padding: "28px 24px", background: "#f8fafc" },
  dropIcon: { fontSize: 32, marginBottom: 8 },
  dropText: { fontSize: 14, fontWeight: 600, color: "#374151", marginBottom: 4 },
  dropSub: { fontSize: 12, color: "#9ca3af", textAlign: "center", lineHeight: 1.5 },
  error: { background: "#fee2e2", color: "#dc2626", fontSize: 12, padding: "8px 12px", borderRadius: 8, marginTop: 8 },
};
