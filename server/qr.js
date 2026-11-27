"use strict";
const sharp = require("sharp");
const qrcode = require("../assets/qrcode.js");

// QR encodes the public URL only. Error correction M, 4-module quiet zone.
function matrix(url) {
  const code = qrcode(0, "M");
  code.addData(url);
  code.make();
  const n = code.getModuleCount();
  const rows = [];
  for (let r = 0; r < n; r++) { const row = []; for (let c = 0; c < n; c++) row.push(code.isDark(r, c)); rows.push(row); }
  return rows;
}
function svg(url, {quiet = 4} = {}) {
  const m = matrix(url);
  const n = m.length, total = n + quiet * 2;
  let path = "";
  m.forEach((row, r) => row.forEach((dark, c) => { if (dark) path += `M${c + quiet} ${r + quiet}h1v1h-1z`; }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
async function png(url, size = 1000) {
  const total = matrix(url).length + 8;
  const cell = Math.max(1, Math.floor(size / total));
  const px = cell * total;
  return sharp(Buffer.from(svg(url)), {density: 72}).resize(px, px, {kernel: "nearest"}).png().toBuffer();
}
const modules = url => matrix(url).length;
module.exports = {svg, png, modules, matrix};
