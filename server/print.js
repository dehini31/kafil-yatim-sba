"use strict";
const fs = require("node:fs");
const path = require("node:path");
const {root} = require("./config");
const qr = require("./qr");

const FIELD_KEYS = ["logo", "association", "office", "photo", "name", "role", "expiry", "number", "qr"];
const MIN_MM = 40, MAX_MM = 300;
const MIN_MODULE_MM = 0.33; // below this a phone camera struggles to resolve the QR on paper
const ASSOCIATION = "الجمعية الخيرية كافل اليتيم الوطنية";
const OFFICE = "المكتب الولائي سيدي بلعباس";

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
const dmy = d => d.split("-").reverse().join("/");

// Self-contained HTML (fonts, images, QR inlined). The admin preview and the PDF use this exact document.
// Layout follows the association's recto: logo, association, office, QR, role, divider, "valid until" + date.
// Name and photo are optional extras (off by default: the card is verified through the QR).
function buildHtml({member, config, publicUrl, photoBuffer}) {
  const {w, h} = pageSize(config);
  const landscape = w > h;
  const short = Math.min(w, h), long = Math.max(w, h);
  const u = Math.min(short / 100, long / 135);
  const f = config.fields;
  const qrMm = Math.round(36 * u * 10) / 10;
  const modules = qr.modules(publicUrl) + 8;
  const head = [], identity = [], tail = [];
  if (f.logo) head.push(`<img class="logo" src="${logo()}" alt="">`);
  if (f.association) head.push(`<p class="assoc">${ASSOCIATION}</p>`);
  if (f.office) head.push(`<p class="office">${OFFICE}</p>`);
  if (f.photo) {
    const src = photoBuffer ? "data:image/jpeg;base64," + photoBuffer.toString("base64") : logo();
    identity.push(`<img class="photo" src="${src}" alt="">`);
  }
  if (f.name) identity.push(`<h1 id="name" dir="auto">${esc(member.fullName)}</h1>`);
  const showRole = f.role && member.role;
  if (showRole) tail.push(`<p class="role${f.name ? " sub" : ""}" dir="auto" id="role">${esc(member.role)}</p>`);
  if ((showRole || f.expiry) && (f.expiry || f.number)) tail.push(`<span class="rule"></span>`);
  if (f.expiry) tail.push(`<div class="valid"><p class="label">صالحة إلى</p><p class="date"><bdi dir="ltr">${dmy(member.expiresAt)}</bdi></p></div>`);
  if (f.number && member.memberNumber) tail.push(`<p class="meta">رقم العضوية : <bdi dir="ltr">${esc(member.memberNumber)}</bdi></p>`);
  const group = (cls, items) => items.length ? `<div class="${cls}">${items.join("")}</div>` : "";
  const qrHtml = f.qr ? `<div class="qr"><div class="qrbox" id="qr">${qr.svg(publicUrl)}</div></div>` : "";
  const body = landscape
    ? `${qrHtml}<div class="main" id="main">${group("head", head)}${group("who", identity)}${group("tail", tail)}</div>`
    : `<div class="main" id="main">${group("head", head)}${group("who", identity)}${qrHtml}${group("tail", tail)}</div>`;

  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<style>${fonts()}
@page{size:${w}mm ${h}mm;margin:0}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${w}mm;height:${h}mm;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font-family:Tajawal,Arial,sans-serif;overflow:hidden}
.card{--u:${u}mm;--k:1;position:relative;width:${w}mm;height:${h}mm;overflow:hidden;color:#fffefa;
 background:radial-gradient(ellipse at 50% 30%,#1c4a42,#163f38 75%)}
.frame{position:absolute;inset:calc(var(--u)*3.2);border:calc(var(--u)*.4) solid #e9bd76;border-radius:calc(var(--u)*5);
 padding:calc(var(--u)*3.5) calc(var(--u)*2.4);display:flex;flex-direction:${landscape ? "row" : "column"};align-items:stretch;gap:calc(var(--u)*2)}
.main{flex:1 1 auto;min-width:0;min-height:0;display:flex;flex-direction:column;justify-content:space-evenly;align-items:center;gap:calc(var(--u)*1.6*var(--k));text-align:center}
.head,.who,.tail{display:flex;flex-direction:column;align-items:center;width:100%;gap:calc(var(--u)*1.2*var(--k))}
.logo{flex:none;width:calc(var(--u)*19*var(--k));height:calc(var(--u)*19*var(--k));object-fit:contain;background:#fff;border-radius:50%;padding:calc(var(--u)*.6)}
.assoc{font-size:calc(var(--u)*4.9*var(--k));font-weight:800;line-height:1.3;color:#fffefa}
.office{font-size:calc(var(--u)*4*var(--k));line-height:1.3;color:#e9bd76}
.photo{flex:none;width:calc(var(--u)*24*var(--k));height:calc(var(--u)*24*var(--k));border-radius:50%;object-fit:cover;object-position:50% 25%;
 border:calc(var(--u)*.7) solid #e9bd76;padding:calc(var(--u)*.6);background:#21483f}
h1{font-size:calc(var(--u)*6.4*var(--k));line-height:1.25;font-weight:800;max-width:100%;overflow-wrap:anywhere}
.role{font-size:calc(var(--u)*7.4*var(--k));font-weight:800;line-height:1.3;max-width:100%;overflow-wrap:anywhere}
.role.sub{font-size:calc(var(--u)*4.6*var(--k));color:#f5d299;font-weight:700}
.rule{display:block;width:calc(var(--u)*14);height:calc(var(--u)*.35);background:#e9bd76;flex:none}
.valid{display:flex;flex-direction:column;align-items:center}
.label{font-size:calc(var(--u)*3.4*var(--k));color:#e3eee8;line-height:1.5}
.date{font-size:calc(var(--u)*6.2*var(--k));font-weight:700;line-height:1.3}
.meta{font-size:calc(var(--u)*3.3*var(--k));color:#e3eee8;line-height:1.5}
.qr{flex:none;display:flex;align-items:center;justify-content:center}
.qrbox{width:${qrMm}mm;height:${qrMm}mm;background:#fff}
.qrbox svg{display:block;width:100%;height:100%}
</style></head><body><div class="card" id="card"><div class="frame" id="frame">${body}</div></div>
<script>
window.__layout={ready:false};
(async function(){
 try{await document.fonts.ready;}catch(e){}
 var mm=function(v){return v/(96/25.4)};
 var card=document.getElementById("card"),frame=document.getElementById("frame"),main=document.getElementById("main");
 var name=document.getElementById("name"),issues=[];
 function lines(el){return Math.round(el.getBoundingClientRect().height/parseFloat(getComputedStyle(el).lineHeight))}
 function overflows(){
  var fr=frame.getBoundingClientRect(),bad=false;
  [].forEach.call(frame.querySelectorAll(".head,.who,.tail,.qr,.photo,.logo,.assoc,.office,#name,.role,.valid,.meta"),function(el){
   var r=el.getBoundingClientRect();
   if(r.bottom>fr.bottom+0.5||r.right>fr.right+0.5||r.left<fr.left-0.5||r.top<fr.top-0.5)bad=true;
  });
  return bad||main.scrollHeight>main.clientHeight+1||main.scrollWidth>main.clientWidth+1;
 }
 if(name){
  var size=parseFloat(getComputedStyle(name).fontSize),min=size*0.55;
  while((lines(name)>2||name.scrollWidth>name.clientWidth+1)&&size>min){size-=size*0.04;name.style.fontSize=size+"px";}
  if(lines(name)>3)issues.push({code:"name-wrap",blocking:false,message:"الاسم طويل جداً : يشغل أكثر من 3 أسطر."});
 }
 // Shrink everything but the QR a little at a time until the content fits the card.
 var k=1;
 while(overflows()&&k>0.55){k-=0.04;card.style.setProperty("--k",k.toFixed(2));}
 var over=overflows();
 if(over)issues.push({code:"overflow",blocking:true,message:"المحتوى المختار لا يتسع في هذا المقاس : كبّر البطاقة أو عطّل بعض الحقول."});
 var qrEl=document.getElementById("qr");
 var qrMm=qrEl?mm(qrEl.getBoundingClientRect().width):0;
 var moduleMm=qrEl?qrMm/${modules}:0;
 if(qrEl&&moduleMm<${MIN_MODULE_MM})issues.push({code:"qr-small",blocking:true,message:"رمز QR صغير جداً فلا يُقرأ بشكل موثوق (الوحدة < ${MIN_MODULE_MM} ملم)."});
 window.__layout={ready:true,issues:issues,qrMm:qrMm,moduleMm:moduleMm,scale:k,fits:!issues.some(function(i){return i.blocking})};
})();
</script></body></html>`;
}

module.exports = {buildHtml, normalizeConfig, pageSize, FIELD_KEYS, MIN_MODULE_MM};
