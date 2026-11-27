"use strict";

const app = document.getElementById("app");
const L = {
  status: {active: "Actif", expired: "Expiré", disabled: "Désactivé"},
  pub: {saving: "Enregistrement", publishing: "Publication en cours", published: "Publiée", failed: "Échec"},
  pdf: {none: "PDF : —", building: "PDF en cours", ready: "PDF prêt", blocked: "PDF bloqué", failed: "PDF : échec"}
};
const PRINT_FIELDS = [
  ["logo", "Logo", null], ["association", "Nom de l'association", null], ["office", "Bureau wilaya", null],
  ["photo", "Photo", "photo"], ["name", "Nom complet", "always"], ["role", "Poste", "role"],
  ["expiry", "Date d'expiration", "expiry"], ["number", "Numéro d'adhérent", "memberNumber"], ["qr", "QR code", null]
];
let state = {me: null, members: [], settings: null, q: "", status: "", tab: "members", timer: null};

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === false || value == null) continue;
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (key === "value") node.value = value;
    else if (key === "style") node.style.cssText = value; // CSSOM: allowed by the page CSP, unlike a style attribute
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) if (child != null && child !== false) node.append(child.nodeType ? child : document.createTextNode(child));
  return node;
}
const badge = (kind, text) => h("span", {class: "badge b-" + kind}, text);

async function api(method, url, data) {
  const response = await fetch("/api" + url, {
    method, credentials: "same-origin",
    headers: {"content-type": "application/json", "x-requested-with": "kafil-admin"},
    body: data === undefined ? undefined : JSON.stringify(data)
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 && url !== "/login") { state.me = null; render(); throw new Error(body.error || "Session expirée."); }
  if (!response.ok) throw new Error(body.error || "Erreur " + response.status);
  return body;
}
function notify(container, kind, message) {
  container.replaceChildren(h("div", {class: "notice " + kind, role: kind === "err" ? "alert" : "status"}, message));
}

async function readPhoto(file) {
  // Downscale in the browser to keep uploads light; the server re-encodes and validates anyway.
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = h("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.9);
}

/* ---------- login ---------- */
function renderLogin() {
  const msg = h("div");
  const form = h("form", {class: "card login", onsubmit: async event => {
    event.preventDefault();
    try {
      state.me = await api("POST", "/login", {email: form.email.value, password: form.password.value});
      await boot();
    } catch (error) { notify(msg, "err", error.message); }
  }},
  h("div", {class: "row"}, h("img", {src: "/assets/logo.jpg", alt: "", width: 48, height: 48}), h("h2", {}, "Administration")),
  h("p", {class: "muted"}, "Kafil El Yatim · Sidi Bel Abbès"),
  h("label", {class: "field"}, "E-mail", h("input", {type: "email", name: "email", required: true, autocomplete: "username"})),
  h("label", {class: "field"}, "Mot de passe", h("input", {type: "password", name: "password", required: true, autocomplete: "current-password"})),
  h("button", {class: "btn primary", type: "submit"}, "Se connecter"), msg);
  app.replaceChildren(form);
}

/* ---------- shell ---------- */
function render() {
  if (!state.me) return renderLogin();
  const tab = (id, label) => h("button", {class: "tab", "aria-current": String(state.tab === id), onclick: () => { state.tab = id; render(); if (id === "settings") loadSettings(); }}, label);
  app.replaceChildren(
    h("header", {class: "top"}, h("img", {src: "/assets/logo.jpg", alt: ""}), h("h1", {}, "Kafil El Yatim · Sidi Bel Abbès"),
      h("nav", {}, tab("members", "Adhérents"), tab("settings", "Réglages"),
        h("button", {class: "tab", onclick: async () => { await api("POST", "/logout"); state.me = null; render(); }}, "Déconnexion"))),
    h("main", {id: "main"}));
  if (state.tab === "members") renderMembers(); else renderSettings();
}

/* ---------- members list ---------- */
function renderMembers() {
  const main = document.getElementById("main");
  const search = h("input", {type: "search", placeholder: "Rechercher par nom ou numéro", "aria-label": "Recherche", value: state.q,
    oninput: debounce(event => { state.q = event.target.value; loadMembers(); }, 250)});
  const select = h("select", {"aria-label": "Filtrer par statut", onchange: event => { state.status = event.target.value; loadMembers(); }},
    h("option", {value: ""}, "Tous les statuts"), ...Object.entries(L.status).map(([k, v]) => h("option", {value: k, selected: state.status === k}, v)));
  main.replaceChildren(
    h("div", {class: "card"}, h("div", {class: "row grow"}, search, select,
      h("button", {class: "btn primary", onclick: () => openForm()}, "+ Nouvel adhérent"))),
    h("div", {class: "card", id: "list"}));
  drawList();
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
async function loadMembers() {
  const params = new URLSearchParams({q: state.q, status: state.status});
  state.members = (await api("GET", "/members?" + params)).members;
  drawList();
  clearTimeout(state.timer);
  if (state.members.some(m => ["saving", "publishing"].includes(m.publication.state) || m.pdf.state === "building")) state.timer = setTimeout(() => loadMembers().catch(() => {}), 1500);
}
function drawList() {
  const box = document.getElementById("list");
  if (!box) return;
  if (!state.members.length) return box.replaceChildren(h("p", {class: "muted"}, "Aucun adhérent."));
  box.replaceChildren(h("table", {},
    h("thead", {}, h("tr", {}, ...["", "Nom", "N°", "Validité", "Publication", ""].map(t => h("th", {}, t)))),
    h("tbody", {}, state.members.map(m => h("tr", {"data-id": m.id},
      h("td", {}, h("img", {class: "avatar", src: `/api/members/${m.id}/photo`, alt: ""})),
      h("td", {class: "name", dir: "auto"}, m.fullName, h("div", {class: "muted", dir: "auto", style: "font-weight:400"}, m.role)),
      h("td", {}, m.memberNumber || "—"),
      h("td", {}, badge(m.status, L.status[m.status]), " ", h("span", {class: "muted"}, m.expiresAt)),
      h("td", {}, badge(m.publication.state, L.pub[m.publication.state])),
      h("td", {}, h("button", {class: "btn", onclick: () => openDetail(m.id)}, "Ouvrir")))))));
}

/* ---------- create / edit ---------- */
function openForm(member) {
  const editing = !!member;
  const dialog = h("dialog");
  const msg = h("div");
  let photo = null;
  const preview = h("img", {class: "thumb", alt: "", src: editing ? `/api/members/${member.id}/photo` : "", hidden: !editing});
  const requestId = crypto.randomUUID();
  const form = h("form", {onsubmit: async event => {
    event.preventDefault();
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    notify(msg, "warn", "Enregistrement…");
    try {
      const data = {fullName: form.fullName.value, role: form.role.value, expiresAt: form.expiresAt.value, memberNumber: form.memberNumber.value};
      if (photo) data.photo = photo;
      if (!editing && !photo) throw new Error("Photo requise.");
      const out = editing ? await api("PUT", "/members/" + member.id, data) : await api("POST", "/members", {...data, requestId});
      dialog.close(); dialog.remove();
      await loadMembers();
      openDetail(out.member.id);
    } catch (error) { notify(msg, "err", error.message); button.disabled = false; }
  }},
  h("div", {class: "grid2"},
    h("label", {class: "field"}, "Nom et prénom", h("input", {type: "text", name: "fullName", dir: "rtl", required: true, maxlength: 120, value: member?.fullName || ""})),
    h("label", {class: "field"}, "Poste au sein de l'association", h("input", {type: "text", name: "role", dir: "rtl", required: true, maxlength: 120, value: member?.role || ""})),
    h("label", {class: "field"}, "Date d'expiration", h("input", {type: "date", name: "expiresAt", required: true, value: member?.expiresAt || ""})),
    h("label", {class: "field"}, "Numéro d'adhérent ", h("small", {}, "(optionnel, interne)"), h("input", {type: "text", name: "memberNumber", maxlength: 40, value: member?.memberNumber || ""}))),
  h("label", {class: "field"}, "Photo", h("small", {}, "JPEG, PNG ou WebP. Recadrée automatiquement à l'affichage, jamais déformée."),
    h("input", {type: "file", name: "photo", accept: "image/jpeg,image/png,image/webp", onchange: async event => {
      const file = event.target.files[0];
      if (!file) return;
      try { photo = await readPhoto(file); preview.src = photo; preview.hidden = false; } catch { notify(msg, "err", "Image illisible."); }
    }})), preview,
  h("div", {class: "actions"}, h("button", {class: "btn primary", type: "submit"}, editing ? "Enregistrer et republier" : "Créer et publier"),
    h("button", {class: "btn", type: "button", onclick: () => { dialog.close(); dialog.remove(); }}, "Annuler")), msg);
  dialog.append(h("div", {class: "dlg-head"}, h("h2", {}, editing ? "Modifier la fiche" : "Nouvel adhérent")), h("div", {class: "dlg-body"}, form));
  document.body.append(dialog);
  dialog.showModal();
}

/* ---------- member detail ---------- */
let detailTimer;
async function openDetail(id) {
  document.querySelectorAll("dialog[data-detail]").forEach(d => d.remove());
  clearTimeout(detailTimer);
  const dialog = h("dialog", {"data-detail": id});
  dialog.addEventListener("close", () => { clearTimeout(detailTimer); dialog.remove(); loadMembers().catch(() => {}); });
  document.body.append(dialog);
  dialog.showModal();
  const refresh = async () => {
    const {member} = await api("GET", "/members/" + id);
    if (!dialog.isConnected) return;
    drawDetail(dialog, member);
    clearTimeout(detailTimer);
    if (["saving", "publishing"].includes(member.publication.state) || member.pdf.state === "building") detailTimer = setTimeout(() => refresh().catch(() => {}), 1500);
  };
  dialog.refresh = refresh;
  await refresh();
}

function drawDetail(dialog, m) {
  const msg = h("div");
  const act = (label, fn, cls = "btn", disabled = false) => h("button", {class: cls, disabled, onclick: async event => {
    event.target.disabled = true;
    try { await fn(); await dialog.refresh(); } catch (error) { notify(msg, "err", error.message); event.target.disabled = false; }
  }}, label);
  const published = m.publication.state === "published" && m.verified;
  const download = (href, label) => published || href.endsWith("card.pdf") && m.pdf.state === "ready"
    ? h("a", {class: "btn", href}, label) : h("button", {class: "btn", disabled: true}, label);
  const pdfReady = m.pdf.state === "ready";
  const keepScroll = dialog.querySelector(".dlg-body")?.scrollTop || 0;

  dialog.replaceChildren(
    h("div", {class: "dlg-head"}, h("h2", {dir: "auto"}, m.fullName), h("button", {class: "btn", onclick: () => dialog.close()}, "Fermer")),
    h("div", {class: "dlg-body"},
      h("div", {class: "row"}, h("img", {class: "thumb", src: `/api/members/${m.id}/photo?${m.updatedAt}`, alt: ""}),
        h("div", {}, h("div", {dir: "auto"}, m.role), h("div", {class: "muted"}, "N° " + (m.memberNumber || "—") + " · expire le " + m.expiresAt),
          h("div", {class: "steps"}, badge(m.status, L.status[m.status]), badge(m.publication.state, L.pub[m.publication.state]), badge(m.pdf.state, L.pdf[m.pdf.state])))),
      m.publication.state === "failed" ? h("div", {class: "notice err", role: "alert"}, "La fiche est enregistrée mais la publication a échoué : " + m.publication.error) : null,
      ["saving", "publishing"].includes(m.publication.state) ? h("div", {class: "notice warn", role: "status"}, L.pub[m.publication.state] + "… (la vérification de l'URL publique peut prendre une à deux minutes)") : null,
      m.pdf.state === "failed" ? h("div", {class: "notice err"}, "PDF : " + m.pdf.error) : null,
      m.pdf.state === "blocked" ? h("div", {class: "notice err"}, "PDF non généré : " + m.pdf.issues.map(i => i.message).join(" ")) : null,
      (m.pdf.issues || []).filter(i => !i.blocking).map(i => h("div", {class: "notice warn"}, i.message)),
      h("div", {class: "card"}, h("h2", {}, "Lien public"), h("div", {class: "link"}, m.url),
        h("div", {class: "actions"},
          published ? h("a", {class: "btn primary", href: m.url, target: "_blank", rel: "noopener"}, "Voir la carte") : h("button", {class: "btn primary", disabled: true}, "Voir la carte"),
          act("Copier le lien", async () => { await navigator.clipboard.writeText(m.url); notify(msg, "ok", "Lien copié."); }, "btn", !published),
          download(`/api/members/${m.id}/qr.png`, "Télécharger le QR"),
          download(`/api/members/${m.id}/card.pdf`, "Télécharger le PDF")),
        msg),
      h("div", {class: "actions"},
        m.publication.state === "failed" ? act("Relancer la publication", () => api("POST", `/members/${m.id}/publish`), "btn primary") : null,
        act("Modifier", async () => openForm(m)),
        m.disabled ? act("Réactiver", () => api("POST", `/members/${m.id}/enable`)) : act("Désactiver", () => api("POST", `/members/${m.id}/disable`), "btn danger"),
        h("form", {class: "row", onsubmit: async event => {
          event.preventDefault();
          try { await api("POST", `/members/${m.id}/renew`, {expiresAt: event.target.date.value}); await dialog.refresh(); } catch (error) { notify(msg, "err", error.message); }
        }}, h("input", {type: "date", name: "date", required: true, "aria-label": "Nouvelle date d'expiration", style: "width:auto"}), h("button", {class: "btn", type: "submit"}, "Renouveler (même QR)"))),
      printPanel(dialog, m)));
  dialog.querySelector(".dlg-body").scrollTop = keepScroll;
}

/* ---------- print configuration + preview ---------- */
function printForm(config, settings, onchange) {
  const fieldBoxes = {};
  const mk = (name, label, value) => h("label", {class: "field"}, label, h("input", {type: "number", name, min: 40, max: 300, step: "0.1", value, onchange}));
  const width = mk("widthMm", "Largeur (mm)", config.widthMm);
  const height = mk("heightMm", "Hauteur (mm)", config.heightMm);
  const orientation = h("select", {name: "orientation", onchange}, h("option", {value: "portrait", selected: config.orientation === "portrait"}, "Portrait"),
    h("option", {value: "landscape", selected: config.orientation === "landscape"}, "Paysage"));
  const list = h("div", {class: "fieldlist"}, PRINT_FIELDS.map(([key, label, pub]) => {
    const box = h("input", {type: "checkbox", checked: !!config.fields[key], onchange});
    fieldBoxes[key] = box;
    const online = pub === "always" || (pub && settings.publicFields[pub]);
    return h("label", {}, box, label, h("span", {class: "tag"}, online ? "Imprimé · aussi visible en ligne" : "Imprimé uniquement"));
  }));
  const root = h("div", {}, h("div", {class: "grid2"}, width.parentNode ? width : width, height,
    h("label", {class: "field"}, "Orientation", orientation)), h("p", {class: "muted"}, "Cocher un champ l'imprime sur le PDF ; cela ne le rend pas public. Les champs visibles en ligne se règlent dans Réglages."), list);
  root.read = () => ({widthMm: Number(width.querySelector("input").value), heightMm: Number(height.querySelector("input").value), orientation: orientation.value,
    fields: Object.fromEntries(Object.entries(fieldBoxes).map(([k, b]) => [k, b.checked]))});
  return root;
}
function previewPane(request) {
  const box = h("div", {class: "preview-box"});
  const notes = h("div");
  const wrap = h("div", {class: "preview-wrap"}, box);
  let counter = 0;
  const update = async () => {
    const mine = ++counter;
    try {
      const data = await request();
      if (mine !== counter) return;
      const px = mm => mm * 96 / 25.4;
      const scale = Math.min(1, 300 / px(data.widthMm), 420 / px(data.heightMm)) || 1;
      box.style.width = px(data.widthMm) * scale + "px";
      box.style.height = px(data.heightMm) * scale + "px";
      const frame = h("iframe", {src: "/api/print-preview/" + data.token, title: "Aperçu", scrolling: "no", sandbox: "allow-scripts allow-same-origin",
        style: `width:${px(data.widthMm)}px;height:${px(data.heightMm)}px;transform:scale(${scale})`});
      box.replaceChildren(frame);
      const info = [h("div", {class: "muted"}, `Format ${data.widthMm} × ${data.heightMm} mm · QR ${data.layout.qrMm ? data.layout.qrMm.toFixed(1) + " mm" : "absent"}`)];
      for (const issue of data.layout.issues) info.push(h("div", {class: "notice " + (issue.blocking ? "err" : "warn")}, issue.message));
      notes.replaceChildren(...info);
    } catch (error) { notify(notes, "err", error.message); }
  };
  return {node: h("div", {}, wrap, notes), update};
}
function printPanel(dialog, m) {
  const settings = state.settings || {publicFields: {}, printDefaults: {}};
  const effective = m.pdf.config || m.print || settings.printDefaults;
  const msg = h("div");
  const trigger = debounce(() => pane.update(), 300);
  const form = printForm(m.print || effective, settings, trigger);
  const pane = previewPane(() => api("POST", "/print-preview", {memberId: m.id, config: form.read()}));
  pane.update();
  const run = (label, fn, cls = "btn") => h("button", {class: cls, onclick: async event => {
    event.target.disabled = true;
    try { await fn(); await dialog.refresh(); } catch (error) { notify(msg, "err", error.message); event.target.disabled = false; }
  }}, label);
  return h("div", {class: "card"}, h("h2", {}, "Impression (PDF)"),
    h("div", {class: "grid2"}, form, pane.node),
    h("div", {class: "actions"},
      run("Enregistrer pour cette carte et régénérer le PDF", () => api("PUT", `/members/${m.id}/print`, {config: form.read()}), "btn primary"),
      run("Utiliser les réglages par défaut", () => api("PUT", `/members/${m.id}/print`, {config: null})),
      run("Régénérer le PDF", () => api("POST", `/members/${m.id}/pdf`))), msg,
    h("p", {class: "muted"}, m.print ? "Cette carte a sa propre configuration." : "Cette carte suit la configuration par défaut."));
}

/* ---------- settings ---------- */
async function loadSettings() {
  const data = await api("GET", "/settings");
  state.settings = data.settings;
  state.settingsPublication = data.publication;
  if (state.tab === "settings") renderSettings();
}
function renderSettings() {
  const main = document.getElementById("main");
  const s = state.settings;
  if (!s) return main.replaceChildren(h("p", {}, "Chargement…"));
  const msg = h("div");
  const contactLabels = {phone: "Téléphone (+213…)", whatsapp: "WhatsApp", facebook: "Facebook (URL https)", instagram: "Instagram (URL https)", email: "E-mail",
    maps: "Lien Google Maps (https)", address: "Adresse", hours: "Horaires", nationalWebsite: "Site national (https)"};
  const contacts = h("div", {class: "grid2"}, Object.keys(s.contacts).map(key => h("label", {class: "field"}, contactLabels[key] || key,
    h("input", {type: "text", name: key, dir: ["phone", "whatsapp", "email", "facebook", "instagram", "maps", "nationalWebsite"].includes(key) ? "ltr" : "auto", value: s.contacts[key]}))));
  const pf = {photo: "Photo", role: "Poste", expiry: "Date d'expiration", memberNumber: "Numéro d'adhérent"};
  const publicBoxes = {};
  const publicList = h("div", {class: "fieldlist"}, h("label", {}, h("input", {type: "checkbox", checked: true, disabled: true}), "Nom complet", h("span", {class: "tag"}, "toujours visible")),
    Object.entries(pf).map(([k, label]) => { publicBoxes[k] = h("input", {type: "checkbox", checked: !!s.publicFields[k]}); return h("label", {}, publicBoxes[k], label, h("span", {class: "tag"}, "visible en ligne")); }));
  const printUI = printForm(s.printDefaults, s, () => {});
  const job = state.settingsPublication;
  main.replaceChildren(h("form", {onsubmit: async event => {
    event.preventDefault();
    try {
      const body = {contacts: Object.fromEntries([...contacts.querySelectorAll("input")].map(i => [i.name, i.value])),
        publicFields: Object.fromEntries(Object.entries(publicBoxes).map(([k, b]) => [k, b.checked])), printDefaults: printUI.read()};
      const out = await api("PUT", "/settings", body);
      state.settings = out.settings; state.settingsPublication = out.publication;
      notify(msg, "ok", "Réglages enregistrés. Les pages publiques sont republiées si nécessaire.");
      pollSettings();
    } catch (error) { notify(msg, "err", error.message); }
  }},
  job ? h("div", {class: "notice " + (job.state === "failed" ? "err" : job.state === "published" ? "ok" : "warn")}, "Publication des réglages : " + L.pub[job.state] + (job.error ? " — " + job.error : "")) : null,
  h("div", {class: "card"}, h("h2", {}, "Coordonnées officielles du bureau"), h("p", {class: "muted"}, "Centralisées : elles s'affichent sur toutes les cartes. Les champs vides sont masqués."), contacts),
  h("div", {class: "card"}, h("h2", {}, "Champs publics des cartes"), h("p", {class: "muted"}, "Seuls ces champs sont publiés sur la page de la carte."), publicList),
  h("div", {class: "card"}, h("h2", {}, "Impression par défaut (nouvelles cartes)"), printUI),
  h("button", {class: "btn primary", type: "submit"}, "Enregistrer les réglages"), msg));
}
function pollSettings() {
  setTimeout(async () => {
    const data = await api("GET", "/settings").catch(() => null);
    if (!data) return;
    state.settingsPublication = data.publication;
    if (state.tab === "settings") renderSettings();
    if (data.publication?.state === "publishing") pollSettings();
  }, 2000);
}

async function boot() {
  try { state.me = await api("GET", "/me"); } catch { state.me = null; }
  render();
  if (state.me) { state.settings = (await api("GET", "/settings")).settings; await loadMembers(); }
}
boot();
