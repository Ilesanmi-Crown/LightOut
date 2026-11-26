import { useRef } from "react";

const ALLOWED = ["image/jpeg", "image/png"];
const MAX_SIDE = 1280;

/** Downscale to save data and keep the on-device model fast. Output stays JPEG/PNG. */
async function toInlineImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("Couldn't read that image."));
      i.src = url;
    });
    const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    const mimeType = "image/jpeg";
    const dataUrl = canvas.toDataURL(mimeType, 0.85);
    return { mimeType, base64: dataUrl.split(",")[1], previewUrl: dataUrl, name: file.name };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function PhotoPicker({ image, onChange, onError }) {
  const input = useRef(null);

  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!ALLOWED.includes(file.type)) {
      onError("Only JPEG or PNG photos are supported (the on-device model can't read other formats).");
      return;
    }
    try {
      onError("");
      onChange(await toInlineImage(file));
    } catch (err) {
      onError(err.message);
    }
  }

  return (
    <div className="photo">
      <input ref={input} type="file" accept="image/jpeg,image/png" capture="environment" onChange={pick} hidden />
      {image ? (
        <div className="photo-preview">
          <img src={image.previewUrl} alt="Your notes" />
          <div>
            <p>{image.name}</p>
            <button className="ghost" onClick={() => onChange(null)}>
              Remove photo
            </button>
          </div>
        </div>
      ) : (
        <button className="ghost photo-add" onClick={() => input.current?.click()}>
          <span aria-hidden="true">＋</span> Add a photo of your notes <em>optional · JPEG/PNG</em>
        </button>
      )}
    </div>
  );
}
