"use strict";
// Draws the card model straight into a PDF (vector text with real Arabic shaping, vector QR).
// No browser needed: works on any Node host.
const {PDFDocument, PDFHexString, rgb, pushGraphicsState, popGraphicsState, beginText, endText,
  setFontAndSize, setTextMatrix, setFillingColor, showText, moveTo, appendBezierCurve, closePath, clip, endPath} = require("pdf-lib");
const fontkit = require("@pdf-lib/fontkit");
const fs = require("node:fs");
const path = require("node:path");
const qr = require("./qr");
const {root} = require("./config");

const PT = 72 / 25.4;
const color = hex => rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);
const GREEN = "#163f38", GOLD = "#e9bd76", PHOTO_BG = "#21483f";

function circleOps(cx, cy, r) {
  const c = 0.5522847498 * r;
  return [moveTo(cx + r, cy), appendBezierCurve(cx + r, cy + c, cx + c, cy + r, cx, cy + r), appendBezierCurve(cx - c, cy + r, cx - r, cy + c, cx - r, cy),
    appendBezierCurve(cx - r, cy - c, cx - c, cy - r, cx, cy - r), appendBezierCurve(cx + c, cy - r, cx + r, cy - c, cx + r, cy), closePath()];
}

async function render(model) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle("بطاقة عضو · كافل اليتيم");
  doc.setProducer("Kafil El Yatim");
  const W = model.w * PT, H = model.h * PT;
  const page = doc.addPage([W, H]);
  const X = mm => mm * PT, Y = mm => H - mm * PT;
  const fonts = {
    regular: await doc.embedFont(model.faces.regular.bytes, {subset: false}),
    bold: await doc.embedFont(model.faces.bold.bytes, {subset: false})
  };
  const fontKeys = {regular: page.node.newFontDictionary(fonts.regular.name, fonts.regular.ref), bold: page.node.newFontDictionary(fonts.bold.name, fonts.bold.ref)};
  // pdf-lib reads `.buffer` and ignores byteOffset: small Node Buffers are views on a shared pool, so give it private copies.
  const own = buffer => Uint8Array.from(buffer);
  const logo = await doc.embedJpg(own(fs.readFileSync(path.join(root, "assets/logo.jpg"))));
  const photo = model.photoBuffer ? await doc.embedJpg(own(model.photoBuffer)) : logo;

  page.drawRectangle({x: 0, y: 0, width: W, height: H, color: color(GREEN)});

  // Gold rounded frame.
  const fr = model.frame, half = fr.bw / 2;
  const x0 = fr.x + half, y0 = fr.y + half, x1 = fr.x + fr.w - half, y1 = fr.y + fr.h - half, r = fr.r - half;
  const p = n => (n * PT).toFixed(3);
  page.drawSvgPath(`M ${p(x0 + r)} ${p(y0)} H ${p(x1 - r)} A ${p(r)} ${p(r)} 0 0 1 ${p(x1)} ${p(y0 + r)} V ${p(y1 - r)} A ${p(r)} ${p(r)} 0 0 1 ${p(x1 - r)} ${p(y1)} H ${p(x0 + r)} A ${p(r)} ${p(r)} 0 0 1 ${p(x0)} ${p(y1 - r)} V ${p(y0 + r)} A ${p(r)} ${p(r)} 0 0 1 ${p(x0 + r)} ${p(y0)} Z`,
    {x: 0, y: H, borderColor: color(GOLD), borderWidth: fr.bw * PT});

  for (const b of model.boxes) {
    if (b.kind === "text") {
      const face = b.bold ? model.faces.bold : model.faces.regular;
      const key = b.bold ? fontKeys.bold : fontKeys.regular;
      b.lines.forEach((line, i) => {
        const shaped = face.shape(line);
        const top = b.y + i * b.lh;
        const baseline = top + (b.lh - (face.ascent + face.descent) * b.size) / 2 + face.ascent * b.size;
        let pen = b.cx - shaped.width * b.size / 2;
        const ops = [beginText(), setFillingColor(color(b.color)), setFontAndSize(key, b.size * PT)];
        for (const g of shaped.glyphs) {
          if (g.id !== 0 || g.adv) {
            ops.push(setTextMatrix(1, 0, 0, 1, X(pen + g.dx * b.size), Y(baseline - g.dy * b.size)), showText(PDFHexString.of(g.id.toString(16).padStart(4, "0"))));
          }
          pen += g.adv * b.size;
        }
        ops.push(endText());
        page.pushOperators(...ops);
      });
    } else if (b.kind === "logo") {
      const cx = X(b.x + b.d / 2), cy = Y(b.y + b.d / 2), rr = b.d * PT / 2;
      page.drawCircle({x: cx, y: cy, size: rr, color: color("#ffffff")});
      const side = b.d * (1 - 1.2 / 19) * PT;
      page.pushOperators(pushGraphicsState(), ...circleOps(cx, cy, rr), clip(), endPath());
      page.drawImage(logo, {x: cx - side / 2, y: cy - side / 2, width: side, height: side});
      page.pushOperators(popGraphicsState());
    } else if (b.kind === "photo") {
      const cx = X(b.x + b.d / 2), cy = Y(b.y + b.d / 2), R = b.d * PT / 2, bw = b.d * 0.7 / 24 * PT;
      page.drawCircle({x: cx, y: cy, size: R - bw / 2, color: color(PHOTO_BG), borderColor: color(GOLD), borderWidth: bw});
      const clipR = b.d * 22.6 / 48 * PT, box = b.d * 21.4 / 24 * PT;
      const scale = Math.max(box / photo.width, box / photo.height);
      const dw = photo.width * scale, dh = photo.height * scale;
      const left = cx - box / 2 + (box - dw) * 0.5, topY = cy + box / 2 - (box - dh) * 0.25; // object-position: 50% 25%
      page.pushOperators(pushGraphicsState(), ...circleOps(cx, cy, clipR), clip(), endPath());
      page.drawImage(photo, {x: left, y: topY - dh, width: dw, height: dh});
      page.pushOperators(popGraphicsState());
    } else if (b.kind === "rule") {
      page.drawRectangle({x: X(b.x), y: Y(b.y + b.h), width: b.w * PT, height: b.h * PT, color: color(GOLD)});
    } else if (b.kind === "qr") {
      const m = qr.matrix(model.publicUrl), n = m.length, total = n + 8, cell = b.s / total;
      page.drawRectangle({x: X(b.x), y: Y(b.y + b.s), width: b.s * PT, height: b.s * PT, color: color("#ffffff")});
      let d = "";
      m.forEach((row, ry) => {
        let cx = 0;
        while (cx < n) {
          if (!row[cx]) { cx++; continue; }
          let end = cx;
          while (end < n && row[end]) end++;
          d += `M ${p(b.x + (cx + 4) * cell)} ${p(b.y + (ry + 4) * cell)} h ${p((end - cx) * cell)} v ${p(cell)} h ${p(-(end - cx) * cell)} Z `;
          cx = end;
        }
      });
      page.drawSvgPath(d, {x: 0, y: H, color: color("#000000"), borderWidth: 0});
    }
  }
  return {pdf: Buffer.from(await doc.save()), layout: model.layout};
}
module.exports = {render, close: async () => {}};
