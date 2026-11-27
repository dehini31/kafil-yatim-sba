"use strict";
const sharp = require("sharp");

const MAX_BYTES = 8 * 1024 * 1024;
// Accepts a data URL (JPEG/PNG/WebP). Re-encodes to JPEG: strips EXIF/GPS, applies orientation, caps size.
async function normalize(dataUrl) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!m) throw Object.assign(new Error("الصورة : JPEG أو PNG أو WebP مطلوبة."), {status: 422});
  const input = Buffer.from(m[2], "base64");
  if (input.length > MAX_BYTES) throw Object.assign(new Error("الصورة كبيرة جداً (8 ميغابايت كحد أقصى)."), {status: 422});
  try {
    const img = sharp(input, {limitInputPixels: 50e6}).rotate();
    const meta = await img.metadata();
    if (!meta.width || meta.width < 200 || meta.height < 200) throw new Error("small");
    return await img.resize(900, 900, {fit: "inside", withoutEnlargement: true}).flatten({background: "#fff"})
      .jpeg({quality: 86, mozjpeg: true}).toBuffer();
  } catch (error) {
    const message = error.message === "small" ? "الصورة صغيرة جداً (200 بكسل على الأقل)." : "الصورة غير مقروءة.";
    throw Object.assign(new Error(message), {status: 422});
  }
}
module.exports = {normalize};
