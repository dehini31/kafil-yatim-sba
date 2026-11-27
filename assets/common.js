"use strict";

const siteRoot = new URL("../", document.currentScript.src);
const association = "الجمعية الخيرية كافل اليتيم الوطنية";
const region = "المكتب الولائي سيدي بلعباس";
const svgNamespace = "http://www.w3.org/2000/svg";
const iconPaths = {
  phone: "M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7l.7 3a2 2 0 0 1-.5 2.1l-1.3 1.3a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5l2.9.7a2 2 0 0 1 1.7 1.9Z",
  whatsapp: "M20.5 11.8a8.5 8.5 0 0 1-12.8 7.3L3 20.5l1.4-4.6a8.5 8.5 0 1 1 16.1-4.1Z M9 8l1 2-1 1c1 2 2 3 4 4l1-1 2 1",
  facebook: "M14 22v-9h3l.5-4H14V7c0-1 .5-2 2-2h2V2h-3a5 5 0 0 0-5 5v2H7v4h3v9",
  instagram: "M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4Z M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z M17.5 6.5h.01",
  email: "M3 5h18v14H3z M3 6l9 7 9-7",
  maps: "M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  address: "M3 21h18 M5 21V3h14v18 M9 7h1m4 0h1M9 11h1m4 0h1M10 21v-5h4v5",
  hours: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z M12 6v6l4 2",
  nationalWebsite: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z M2 12h20 M12 2c5 5 5 15 0 20-5-5-5-15 0-20Z",
  arrow: "M19 12H5m6 6-6-6 6-6",
  external: "M13 4h7v7m0-7-9 9 M19 13v7H4V5h7"
};

function icon(name, className = "") {
  const svg = document.createElementNS(svgNamespace, "svg");
  svg.setAttribute("class", "icon " + className);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.65");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const path = document.createElementNS(svgNamespace, "path");
  path.setAttribute("d", iconPaths[name]);
  svg.append(path);
  return svg;
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function brand(tag) {
  const wrapper = element(tag, "", "brand");
  if (tag === "a") wrapper.href = siteRoot.href;
  const logo = element("img");
  logo.src = new URL("assets/logo.jpg", siteRoot).href;
  logo.alt = "";
  logo.width = 54;
  logo.height = 54;
  const label = element("span");
  label.append(element("strong", association), element("small", region));
  wrapper.append(logo, label);
  return wrapper;
}

function readData(key) {
  return fetch(new URL("data/" + key + ".json", siteRoot), {cache:"no-cache"}).then(response => {
    if (!response.ok) throw new Error("Could not read " + key);
    return response.json();
  });
}

function httpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
}

function contactItems(config) {
  const phone = String(config.phone || "").replace(/[()\s-]/g, "");
  const whatsapp = String(config.whatsapp || "").replace(/[+()\s-]/g, "");
  const maps = httpsUrl(config.maps);
  const national = httpsUrl(config.nationalWebsite);
  return [
    ["phone", "الهاتف", /^\+?[0-9]{5,15}$/.test(phone) ? config.phone : "", "tel:" + phone, true],
    ["whatsapp", "واتساب", /^[1-9][0-9]{7,14}$/.test(whatsapp) ? config.whatsapp : "", "https://wa.me/" + whatsapp, true],
    ["facebook", "فيسبوك", httpsUrl(config.facebook) && (config.facebookName || "صفحة المكتب الولائي"), httpsUrl(config.facebook)],
    ["instagram", "إنستغرام", httpsUrl(config.instagram) && "حساب المكتب الولائي", httpsUrl(config.instagram)],
    ["email", "البريد الإلكتروني", /^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i.test(config.email) ? config.email : "", "mailto:" + config.email, true],
    ["maps", "الموقع على الخريطة", maps && "عرض الموقع في خرائط Google", maps],
    ["address", "عنوان المكتب", config.address, maps || (config.address ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(config.address) : "")],
    ["hours", "أوقات الاستقبال", config.hours, ""]
  ].filter(([, , value]) => typeof value === "string" && value.trim());
}

// National association block: shown on every page, clearly labelled as NOT the Sidi Bel Abbès office numbers.
function renderNational(config) {
  const phones = String(config.nationalPhones || "").split("\n").map(p => p.trim().replace(/\s+/g, " ")).filter(p => /^\+?[0-9 ]{6,20}$/.test(p));
  const email = /^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i.test(config.nationalEmail || "") ? config.nationalEmail : "";
  const site = httpsUrl(config.nationalWebsite);
  for (const section of document.querySelectorAll("[data-national]")) {
    section.replaceChildren();
    if (!phones.length && !email && !site) { section.hidden = true; continue; }
    const text = element("div", "", "national-text");
    text.append(element("h2", "المكتب الوطني للجمعية", "section-title"), element("p", "هذه بيانات التواصل الوطنية، وليست أرقام مكتب سيدي بلعباس.", "caption"));
    const links = element("p", "", "national-links");
    for (const phone of phones) {
      const a = element("a", phone);
      a.href = "tel:" + phone.replace(/\s/g, "");
      a.dir = "ltr";
      links.append(a);
    }
    if (email) { const a = element("a", email); a.href = "mailto:" + email; a.dir = "ltr"; links.append(a); }
    if (links.childNodes.length) text.append(links);
    section.append(text);
    if (site) {
      const button = element("a", "زيارة الموقع الوطني ↗", "button primary");
      button.href = site;
      button.rel = "noopener";
      section.append(button);
    }
    section.hidden = false;
  }
}

function renderContacts(config) {
  renderNational(config);
  const national = httpsUrl(config.nationalWebsite);
  if (national && document.querySelector("[data-header]")) {
    const link = element("a", "الموقع الوطني", "national-link");
    link.href = national;
    link.append(icon("external"));
    document.querySelector("[data-header]").append(link);
  }
  const items = contactItems(config);
  for (const section of document.querySelectorAll("[data-contacts]")) {
    for (const [key, title, value, url, ltr] of items) {
      if (key === "hours") {
        const disclosure = element("details", "", "contact");
        const summary = element("summary");
        summary.append(icon(key), element("span", title));
        const detail = element("small", value);
        detail.dir = "auto";
        disclosure.append(summary, detail);
        section.querySelector(".contact-grid").append(disclosure);
        continue;
      }
      const item = element("a", "", "contact");
      item.href = url;
      const label = element("span");
      const detail = element("small", value);
      detail.dir = ltr ? "ltr" : "auto";
      label.append(element("span", title), detail);
      item.append(icon(key), label);
      item.append(icon("arrow", "arrow"));
      section.querySelector(".contact-grid").append(item);
    }
    section.hidden = !items.length;
  }
}

function renderQR(canvas, url) {
  const code = qrcode(0, "M");
  code.addData(url);
  code.make();
  const size = code.getModuleCount();
  const cell = Math.max(8, Math.ceil(420 / (size + 8)));
  canvas.width = canvas.height = (size + 8) * cell;
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#000";
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      if (code.isDark(row, column)) context.fillRect((column + 4) * cell, (row + 4) * cell, cell, cell);
    }
  }
}

function download(url, name) {
  const link = element("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
}

document.querySelector("[data-header]")?.append(brand("a"));
document.querySelector("[data-footer]")?.append(brand("div"), element("small", "© " + new Date().getFullYear() + " جميع الحقوق محفوظة"));
readData("contacts").then(renderContacts).catch(() => {});
