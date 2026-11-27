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
      throw Object.assign(new Error(`Dimensions : entre ${MIN_MM} et ${MAX_MM} mm.`), {status: 422});
    }
    return Math.round(n * 10) / 10;
  };
  const orientation = src.orientation ?? base.orientation;
  if (!["portrait", "landscape"].includes(orientation)) throw Object.assign(new Error("Orientation invalide."), {status: 422});
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
function buildHtml({member, config, publicUrl, photoBuffer}) {
  const {w, h} = pageSize(config);
  const landscape = w > h;
  const short = Math.min(w, h), long = Math.max(w, h);
  const u = Math.min(short / 100, long / 135);
  const f = config.fields;
  const qrMm = Math.round(38 * u * 10) / 10; // scales with the card like everything else
  const modules = qr.modules(publicUrl) + 8;
  const parts = {
    head: [], who: [], qr: ""
  };
  if (f.logo) parts.head.push(`<img class="logo" src="${logo()}" alt="">`);
  const names = [];
  if (f.association) names.push(`<strong>${ASSOCIATION}</strong>`);
  if (f.office) names.push(`<span>${OFFICE}</span>`);
  if (names.length) parts.head.push(`<div class="org">${names.join("")}</div>`);
  if (f.photo) {
    const src = photoBuffer ? "data:image/jpeg;base64," + photoBuffer.toString("base64") : logo();
    parts.who.push(`<img class="photo" src="${src}" alt="">`);
  }
  if (f.name) parts.who.push(`<h1 id="name" dir="auto">${esc(member.fullName)}</h1>`);
  if (f.role && member.role) parts.who.push(`<p class="role" dir="auto">${esc(member.role)}</p>`);
  const small = [];
  if (f.expiry) small.push(`<p class="meta">صالحة إلى : <bdi dir="ltr">${dmy(member.expiresAt)}</bdi></p>`);
  if (f.number && member.memberNumber) small.push(`<p class="meta">رقم العضوية : <bdi dir="ltr">${esc(member.memberNumber)}</bdi></p>`);
  if (small.length) parts.who.push(`<div class="smalls">${small.join("")}</div>`);
  if (f.qr) parts.qr = `<div class="qr"><div class="qrbox" id="qr">${qr.svg(publicUrl)}</div></div>`;

  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<style>${fonts()}
@page{size:${w}mm ${h}mm;margin:0}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${w}mm;height:${h}mm;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font-family:Tajawal,Arial,sans-serif;overflow:hidden}
.card{--u:${u}mm;position:relative;width:${w}mm;height:${h}mm;overflow:hidden;color:#fffefa;
 background:radial-gradient(ellipse at top,#28564d,#173f39 70%)}
.card::before,.card::after{content:"";position:absolute;width:calc(var(--u)*70);height:calc(var(--u)*70);border-radius:50%;
 background:repeating-radial-gradient(circle,transparent 0 calc(var(--u)*3.6),#e9bd7633 calc(var(--u)*3.7) calc(var(--u)*3.9),transparent calc(var(--u)*4) calc(var(--u)*5.4))}
.card::before{top:calc(var(--u)*-38);right:calc(var(--u)*-30)}
.card::after{bottom:calc(var(--u)*-38);left:calc(var(--u)*-30)}
.frame{position:absolute;inset:calc(var(--u)*3.2);border:calc(var(--u)*.45) solid #e9bd76;border-radius:calc(var(--u)*5);
 padding:calc(var(--u)*3.5);display:flex;flex-direction:${landscape ? "row" : "column"};align-items:stretch;gap:calc(var(--u)*2);z-index:1}
.main{flex:1 1 auto;min-width:0;min-height:0;display:flex;flex-direction:column;justify-content:space-evenly;align-items:center;gap:calc(var(--u)*2);text-align:center}
.head{display:flex;align-items:center;justify-content:center;gap:calc(var(--u)*2.4);width:100%}
.logo{flex:none;width:calc(var(--u)*15);height:calc(var(--u)*15);object-fit:contain;background:#fff;border-radius:calc(var(--u)*3)}
.org{display:flex;flex-direction:column;text-align:start;line-height:1.35}
.org strong{font-size:calc(var(--u)*4.1);font-weight:800;color:#f5d299}
.org span{font-size:calc(var(--u)*3.4);color:#e3eee8}
.who{display:flex;flex-direction:column;align-items:center;gap:calc(var(--u)*1.4);width:100%}
.photo{flex:none;width:calc(var(--u)*34);height:calc(var(--u)*34);border-radius:50%;object-fit:cover;object-position:50% 25%;
 border:calc(var(--u)*.8) solid #e9bd76;padding:calc(var(--u)*.7);background:#21483f}
h1{font-size:calc(var(--u)*6.4);line-height:1.25;font-weight:800;max-width:100%;overflow-wrap:anywhere}
.role{font-size:calc(var(--u)*4.2);font-weight:700;color:#f5d299;line-height:1.35;max-width:100%}
.smalls{display:flex;flex-direction:column;align-items:center}
.meta{font-size:calc(var(--u)*3.3);color:#e3eee8;line-height:1.5}
.qr{flex:none;display:flex;align-items:center;justify-content:center}
.qrbox{width:${qrMm}mm;height:${qrMm}mm;background:#fff;border-radius:calc(var(--u)*2)}
.qrbox svg{display:block;width:100%;height:100%}
</style></head><body><div class="card" id="card"><div class="frame" id="frame">
<div class="main" id="main">${parts.head.length ? `<div class="head">${parts.head.join("")}</div>` : ""}${parts.who.length ? `<div class="who">${parts.who.join("")}</div>` : ""}</div>
${parts.qr}</div></div>
<script>
window.__layout={ready:false};
(async function(){
 try{await document.fonts.ready;}catch(e){}
 var mm=function(v){return v/(96/25.4)};
 var name=document.getElementById("name");
 var issues=[];
 if(name){
  var size=parseFloat(getComputedStyle(name).fontSize), min=size*0.55, lines=function(){return Math.round(name.getBoundingClientRect().height/parseFloat(getComputedStyle(name).lineHeight))};
  while((lines()>2||name.scrollWidth>name.clientWidth+1)&&size>min){size-=size*0.04;name.style.fontSize=size+"px";}
  if(lines()>3)issues.push({code:"name-wrap",blocking:false,message:"Nom très long : il occupe plus de 3 lignes."});
 }
 var frame=document.getElementById("frame"),fr=frame.getBoundingClientRect();
 var over=false;
 [].forEach.call(frame.querySelectorAll(".head,.who,.qr,.photo,#name,.role,.meta"),function(el){
  var r=el.getBoundingClientRect();
  if(r.bottom>fr.bottom+0.5||r.right>fr.right+0.5||r.left<fr.left-0.5||r.top<fr.top-0.5)over=true;
 });
 var main=document.getElementById("main"), mr=main.getBoundingClientRect(), total=0;
 [].forEach.call(main.children,function(c){total+=c.getBoundingClientRect().height});
 if(over||(${landscape ? "false" : "true"}&&total>mr.height+0.5))issues.push({code:"overflow",blocking:true,message:"Le contenu choisi ne tient pas dans ce format : agrandissez la carte ou désactivez des champs."});
 var qrEl=document.getElementById("qr");
 var qrMm=qrEl?mm(qrEl.getBoundingClientRect().width):0;
 var moduleMm=qrEl?qrMm/${modules}:0;
 if(qrEl&&moduleMm<${MIN_MODULE_MM})issues.push({code:"qr-small",blocking:true,message:"QR trop petit pour être scanné de façon fiable (module < ${MIN_MODULE_MM} mm)."});
 window.__layout={ready:true,issues:issues,qrMm:qrMm,moduleMm:moduleMm,fits:!issues.some(function(i){return i.blocking})};
})();
</script></body></html>`;
}

module.exports = {buildHtml, normalizeConfig, pageSize, FIELD_KEYS, MIN_MODULE_MM};
