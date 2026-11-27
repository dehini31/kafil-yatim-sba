"use strict";
const fs = require("node:fs");
const path = require("node:path");
const {root} = require("./config");
const qr = require("./qr");
const {layoutCard, MIN_MODULE_MM, GOLD} = require("./card");

const FIELD_KEYS = ["logo", "association", "office", "photo", "name", "role", "expiry", "number", "qr"];
const MIN_MM = 40, MAX_MM = 300;

function normalizeConfig(input, defaults) {
  const base = defaults || {widthMm: 100, heightMm: 135, orientation: "portrait", fields: {}};
  const src = input && typeof input === "object" ? input : {};
  const num = (value, fallback) => {
    const n = Number(value ?? fallback);
    if (!Number.isFinite(n) || n < MIN_MM || n > MAX_MM) {
      throw Object.assign(new Error(`الأبعاد : بين ${MIN_MM} و${MAX_MM} ملم.`), {status: 422});
    }
    return Math.round(n * 10) / 10;
  };
  const orientation = src.orientation ?? base.orientation;
  if (!["portrait", "landscape"].includes(orientation)) throw Object.assign(new Error("الاتجاه غير صالح."), {status: 422});
  const fields = {};
  for (const key of FIELD_KEYS) fields[key] = typeof src.fields?.[key] === "boolean" ? src.fields[key] : !!base.fields?.[key];
  return {widthMm: num(src.widthMm, base.widthMm), heightMm: num(src.heightMm, base.heightMm), orientation, fields};
}
// Orientation decides which side is the long one: portrait => width <= height, landscape => width >= height.
function pageSize(config) {
  const a = Math.min(config.widthMm, config.heightMm), b = Math.max(config.widthMm, config.heightMm);
  return config.orientation === "landscape" ? {w: b, h: a} : {w: a, h: b};
}

let fontCss;
function fonts() {
  if (!fontCss) {
    const face = (file, weight) => `@font-face{font-family:Tajawal;font-weight:${weight};src:url(data:font/ttf;base64,${
      fs.readFileSync(path.join(root, "assets", file)).toString("base64")}) format("truetype")}`;
    fontCss = face("tajawal.ttf", 400) + face("tajawal-bold.ttf", "700 900");
  }
  return fontCss;
}
let logoUri;
function logo() {
  return logoUri ||= "data:image/jpeg;base64," + fs.readFileSync(path.join(root, "assets/logo.jpg")).toString("base64");
}
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const n = v => Math.round(v * 1000) / 1000;

// Layout model for a member + configuration (shared by the PDF and the preview).
function makeModel({member, config, publicUrl, photoBuffer}) {
  return layoutCard({member, config, publicUrl, photoBuffer, size: pageSize(config)});
}

// Self-contained, script-free HTML drawn from the same model as the PDF (also used for browser printing).
function buildHtml(model) {
  const photoSrc = model.photoBuffer ? "data:image/jpeg;base64," + model.photoBuffer.toString("base64") : logo();
  const parts = [];
  for (const b of model.boxes) {
    if (b.kind === "text") {
      b.lines.forEach((line, i) => parts.push(
        `<div class="t" style="left:${n(b.cx - b.w / 2)}mm;top:${n(b.y + i * b.lh)}mm;width:${n(b.w)}mm;height:${n(b.lh)}mm;line-height:${n(b.lh)}mm;font-size:${n(b.size)}mm;font-weight:${b.bold ? 800 : 400};color:${b.color}">${esc(line)}</div>`));
    } else if (b.kind === "logo") {
      const side = b.d * (1 - 1.2 / 19), off = (b.d - side) / 2;
      parts.push(`<div class="c" style="left:${n(b.x)}mm;top:${n(b.y)}mm;width:${n(b.d)}mm;height:${n(b.d)}mm;background:#fff"><img src="${logo()}" alt="" style="left:${n(off)}mm;top:${n(off)}mm;width:${n(side)}mm;height:${n(side)}mm"></div>`);
    } else if (b.kind === "photo") {
      const bw = b.d * 0.7 / 24, clip = b.d * 22.6 / 24, box = b.d * 21.4 / 24;
      parts.push(`<div class="c" style="left:${n(b.x)}mm;top:${n(b.y)}mm;width:${n(b.d)}mm;height:${n(b.d)}mm;background:#21483f;border:${n(bw)}mm solid ${GOLD}"></div>`
        + `<div class="c" style="left:${n(b.x + (b.d - clip) / 2)}mm;top:${n(b.y + (b.d - clip) / 2)}mm;width:${n(clip)}mm;height:${n(clip)}mm"><img class="ph" src="${photoSrc}" alt="" style="left:${n((clip - box) / 2)}mm;top:${n((clip - box) / 2)}mm;width:${n(box)}mm;height:${n(box)}mm"></div>`);
    } else if (b.kind === "rule") {
      parts.push(`<div style="position:absolute;left:${n(b.x)}mm;top:${n(b.y)}mm;width:${n(b.w)}mm;height:${n(b.h)}mm;background:${GOLD}"></div>`);
    } else if (b.kind === "qr") {
      parts.push(`<div id="qr" style="position:absolute;left:${n(b.x)}mm;top:${n(b.y)}mm;width:${n(b.s)}mm;height:${n(b.s)}mm">${qr.svg(model.publicUrl).replace("<svg ", '<svg style="display:block;width:100%;height:100%" ')}</div>`);
    }
  }
  const fr = model.frame;
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>بطاقة عضو</title>
<style>${fonts()}
@page{size:${model.w}mm ${model.h}mm;margin:0}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${model.w}mm;height:${model.h}mm;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font-family:Tajawal,Arial,sans-serif;overflow:hidden}
.card{position:relative;width:${model.w}mm;height:${model.h}mm;overflow:hidden;background:#163f38}
.frame{position:absolute;left:${n(fr.x)}mm;top:${n(fr.y)}mm;width:${n(fr.w)}mm;height:${n(fr.h)}mm;border:${n(fr.bw)}mm solid ${GOLD};border-radius:${n(fr.r)}mm}
.t{position:absolute;text-align:center;white-space:nowrap;direction:rtl}
.c{position:absolute;border-radius:50%;overflow:hidden}
.c img{position:absolute;object-fit:contain}
.c img.ph{object-fit:cover;object-position:50% 25%}
</style></head><body><div class="card" id="card"><div class="frame"></div>${parts.join("")}</div></body></html>`;
}

module.exports = {buildHtml, makeModel, normalizeConfig, pageSize, FIELD_KEYS, MIN_MODULE_MM};
