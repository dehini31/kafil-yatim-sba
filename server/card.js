"use strict";
// Layout model of the printed card. One model feeds both the PDF drawing and the HTML preview,
// so what you preview is what prints. Units: millimetres, origin top-left, y down.
const qr = require("./qr");
const {loadFaces, wrap} = require("./text");

const ASSOCIATION = "الجمعية الخيرية كافل اليتيم الوطنية";
const OFFICE = "المكتب الولائي سيدي بلعباس";
const MIN_MODULE_MM = 0.33; // below this a phone camera struggles to resolve the QR on paper
const dmy = d => d.split("-").reverse().join("/");
const GOLD = "#e9bd76", LIGHT_GOLD = "#f5d299", WHITE = "#fffefa", SOFT = "#e3eee8";

function layoutCard({member, config, publicUrl, photoBuffer, size}) {
  const {w, h} = size;
  const landscape = w > h;
  const short = Math.min(w, h), long = Math.max(w, h);
  const u = Math.min(short / 100, long / 135);
  const f = config.fields;
  const faces = loadFaces();
  const qrMm = Math.round(36 * u * 10) / 10;
  const modules = qr.modules(publicUrl) + 8;
  const left = (3.2 + 0.4 + 2.4) * u, top = (3.2 + 0.4 + 3.5) * u;
  const cw = w - 2 * left, ch = h - 2 * top;
  const mainW = landscape ? cw - qrMm - 2 * u : cw;
  const showRole = !!(f.role && member.role);
  const issues = [];

  function text(face, str, sizeMm, lhf, color, bold, maxW) {
    const lines = wrap(face, str, sizeMm, maxW);
    return {kind: "text", lines, size: sizeMm, lh: sizeMm * lhf, bold, color, face, h: lines.length * sizeMm * lhf};
  }

  function build(k) {
    const regular = faces.regular, bold = faces.bold;
    const groups = [];
    const head = [], who = [], tail = [];
    if (f.logo) head.push({kind: "logo", d: 19 * k * u, h: 19 * k * u});
    if (f.association) head.push(text(bold, ASSOCIATION, 4.9 * k * u, 1.3, WHITE, true, mainW));
    if (f.office) head.push(text(regular, OFFICE, 4 * k * u, 1.3, GOLD, false, mainW));
    if (f.photo) who.push({kind: "photo", d: 24 * k * u, h: 24 * k * u});
    let nameWrapped = false;
    if (f.name) {
      let size = 6.4 * k * u;
      const min = size * 0.55;
      let item = text(bold, member.fullName, size, 1.25, WHITE, true, mainW);
      while (item.lines.length > 2 && size > min) { size *= 0.96; item = text(bold, member.fullName, size, 1.25, WHITE, true, mainW); }
      nameWrapped = item.lines.length > 3;
      who.push(item);
    }
    if (showRole) tail.push(f.name
      ? text(bold, member.role, 4.6 * k * u, 1.3, LIGHT_GOLD, true, mainW)
      : text(bold, member.role, 7.4 * k * u, 1.3, WHITE, true, mainW));
    if ((showRole || f.expiry) && (f.expiry || f.number)) tail.push({kind: "rule", w: 14 * u, h: 0.35 * u});
    if (f.expiry) tail.push({
      kind: "stack", gap: 0,
      items: [text(regular, "صالحة إلى", 3.4 * k * u, 1.5, SOFT, false, mainW), text(bold, dmy(member.expiresAt), 6.2 * k * u, 1.3, WHITE, true, mainW)]
    });
    if (f.number && member.memberNumber) tail.push(text(regular, "رقم العضوية : " + member.memberNumber, 3.3 * k * u, 1.5, SOFT, false, mainW));
    const packs = [["head", head], ["who", who]];
    if (!landscape && f.qr) packs.push(["qr", [{kind: "qr", s: qrMm, h: qrMm}]]);
    packs.push(["tail", tail]);
    for (const [name, items] of packs) {
      if (!items.length) continue;
      const gap = 1.2 * k * u;
      const heightOf = it => it.kind === "stack" ? it.items.reduce((s, x) => s + x.h, 0) : it.h;
      const gh = items.reduce((s, it) => s + heightOf(it), 0) + gap * (items.length - 1);
      groups.push({name, items, gap, h: gh, heightOf});
    }
    const gapBetween = 1.6 * k * u;
    const total = groups.reduce((s, g) => s + g.h, 0) + gapBetween * Math.max(groups.length - 1, 0);
    const qrTooTall = landscape && f.qr && qrMm > ch + 0.01;
    return {groups, gapBetween, total, fits: total <= ch + 0.01 && !qrTooTall, nameWrapped};
  }

  let k = 1;
  let built = build(k);
  while (!built.fits && k > 0.55) { k = Math.round((k - 0.04) * 100) / 100; built = build(k); }
  if (!built.fits) issues.push({code: "overflow", blocking: true, message: "المحتوى المختار لا يتسع في هذا المقاس : كبّر البطاقة أو عطّل بعض الحقول."});
  if (built.nameWrapped) issues.push({code: "name-wrap", blocking: false, message: "الاسم طويل جداً : يشغل أكثر من 3 أسطر."});
  const moduleMm = f.qr ? qrMm / modules : 0;
  if (f.qr && moduleMm < MIN_MODULE_MM) issues.push({code: "qr-small", blocking: true, message: `رمز QR صغير جداً فلا يُقرأ بشكل موثوق (الوحدة < ${MIN_MODULE_MM} ملم).`});

  // Positions: groups spread with equal space (CSS "space-evenly"), centred horizontally.
  const boxes = [];
  const mainCx = cw / 2 + left - (landscape && f.qr ? (qrMm + 2 * u) / 2 : 0) * 1; // main column centre
  const regionLeft = left;
  const cx = landscape ? regionLeft + mainW / 2 : left + cw / 2;
  const free = Math.max(0, ch - built.groups.reduce((s, g) => s + g.h, 0) - built.gapBetween * Math.max(built.groups.length - 1, 0));
  const edge = free / (built.groups.length + 1);
  let y = top + edge;
  const place = (it, ity) => {
    if (it.kind === "text") {
      boxes.push({kind: "text", cx, y: ity, lines: it.lines, size: it.size, lh: it.lh, bold: it.bold, color: it.color, w: mainW});
    } else if (it.kind === "logo") boxes.push({kind: "logo", x: cx - it.d / 2, y: ity, d: it.d});
    else if (it.kind === "photo") boxes.push({kind: "photo", x: cx - it.d / 2, y: ity, d: it.d, u: it.d / 24});
    else if (it.kind === "rule") boxes.push({kind: "rule", x: cx - it.w / 2, y: ity, w: it.w, h: it.h});
    else if (it.kind === "qr") boxes.push({kind: "qr", x: cx - it.s / 2, y: ity, s: it.s});
    else if (it.kind === "stack") { let yy = ity; for (const sub of it.items) { place(sub, yy); yy += sub.h; } }
  };
  for (const group of built.groups) {
    let yy = y;
    for (const it of group.items) { place(it, yy); yy += group.heightOf(it) + group.gap; }
    y += group.h + built.gapBetween + edge;
  }
  if (landscape && f.qr) boxes.push({kind: "qr", x: left + cw - qrMm, y: top + (ch - qrMm) / 2, s: qrMm});

  return {
    w, h, u, k, landscape, boxes, issues, faces, photoBuffer, publicUrl,
    frame: {x: 3.2 * u, y: 3.2 * u, w: w - 6.4 * u, h: h - 6.4 * u, r: 5 * u, bw: 0.4 * u},
    layout: {ready: true, issues, qrMm: f.qr ? qrMm : 0, moduleMm, scale: k, fits: !issues.some(i => i.blocking)}
  };
}
module.exports = {layoutCard, MIN_MODULE_MM, ASSOCIATION, OFFICE, GOLD};
