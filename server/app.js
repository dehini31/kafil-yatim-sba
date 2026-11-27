"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const {root, load} = require("./config");
const {Store} = require("./store");
const auth = require("./auth");
const {Service} = require("./service");
const pdf = require("./pdf");
const qr = require("./qr");

const MIME = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".ttf": "font/ttf", ".txt": "text/plain", ".svg": "image/svg+xml"};
const ADMIN_CSP = "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'";
const PREVIEW_CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:; frame-ancestors 'self'";

function createApp(options = {}) {
  const config = {...load(), ...options};
  const store = new Store(config.dataDir);
  let publisher = options.publisher;
  if (!publisher) {
    const {LocalPublisher} = require("./publisher/local");
    const {GithubPublisher} = require("./publisher/github");
    publisher = config.publisher === "github" ? new GithubPublisher(config) : new LocalPublisher(config);
  }
  const service = new Service({config, store, publisher, pdf, fetchImpl: options.fetchImpl});

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, {"x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "cache-control": "no-store", ...headers});
    res.end(body);
  };
  const json = (res, status, data, headers) => send(res, status, JSON.stringify(data), {"content-type": "application/json", ...headers});

  async function body(req) {
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 14 * 1024 * 1024) throw Object.assign(new Error("Requête trop volumineuse."), {status: 413});
      chunks.push(chunk);
    }
    if (!chunks.length) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw Object.assign(new Error("JSON invalide."), {status: 400}); }
  }

  function serveFile(res, base, rel, headers = {}) {
    const file = path.resolve(base, "." + path.sep + decodeURIComponent(rel));
    if (!file.startsWith(base + path.sep) && file !== base) return send(res, 403, "Forbidden");
    let target = file;
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, "index.html");
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return send(res, 404, "Not found");
    send(res, 200, fs.readFileSync(target), {"content-type": MIME[path.extname(target)] || "application/octet-stream", ...headers});
  }

  // Every /api route except login/health passes through here: authentication is checked server-side on each call.
  async function api(req, res, url) {
    const route = url.pathname.slice(4);
    const method = req.method;
    if (route === "/health") return json(res, 200, {ok: true});
    if (route === "/login" && method === "POST") {
      guardCsrf(req);
      const {email, password} = await body(req);
      const result = await auth.login(store, config, email, password, req.socket.remoteAddress);
      if (result.error) return json(res, result.status, {error: result.error});
      return json(res, 200, {email: result.admin.email, name: result.admin.name}, {"set-cookie": auth.cookie(config, result.token, config.sessionHours * 3600)});
    }
    const admin = auth.sessionAdmin(store, req);
    if (!admin) return json(res, 401, {error: "Authentification requise."});
    if (method !== "GET") guardCsrf(req);
    const actor = admin.email;
    let m;

    if (route === "/me") return json(res, 200, {email: admin.email, name: admin.name, baseUrl: config.baseUrl});
    if (route === "/logout" && method === "POST") { auth.logout(store, req); return json(res, 200, {ok: true}, {"set-cookie": auth.cookie(config, "", 0)}); }
    if (route === "/settings") {
      if (method === "GET") return json(res, 200, {settings: service.getSettings(), publication: store.db.settingsPublication || null});
      if (method === "PUT") { service.updateSettings(await body(req), actor); return json(res, 200, {settings: service.getSettings(), publication: store.db.settingsPublication || null}); }
    }
    if (route === "/members" && method === "GET") return json(res, 200, {members: service.list({q: url.searchParams.get("q"), status: url.searchParams.get("status")})});
    if (route === "/members" && method === "POST") return json(res, 202, {member: await service.create(await body(req), actor)});
    if (route === "/print-preview" && method === "POST") return json(res, 200, await service.preview(await body(req)));
    if ((m = /^\/print-preview\/([0-9a-f-]{36})$/.exec(route)) && method === "GET") {
      const entry = service.previews.get(m[1]);
      if (!entry) return send(res, 404, "Expired");
      return send(res, 200, entry.html, {"content-type": "text/html; charset=utf-8", "content-security-policy": PREVIEW_CSP});
    }
    if ((m = /^\/members\/([0-9a-f-]{36})(?:\/([a-z.-]+))?$/.exec(route))) {
      const [, id, action] = m;
      const member = service.find(id);
      if (!action && method === "GET") return json(res, 200, {member: service.view(member)});
      if (!action && method === "PUT") return json(res, 200, {member: await service.update(id, await body(req), actor)});
      if (action === "renew" && method === "POST") return json(res, 202, {member: await service.renew(id, (await body(req)).expiresAt, actor)});
      if (action === "disable" && method === "POST") return json(res, 202, {member: await service.setDisabled(id, true, actor)});
      if (action === "enable" && method === "POST") return json(res, 202, {member: await service.setDisabled(id, false, actor)});
      if (action === "publish" && method === "POST") return json(res, 202, {member: service.retry(id, actor)});
      if (action === "pdf" && method === "POST") return json(res, 200, {member: await service.regeneratePdf(id, actor)});
      if (action === "print" && method === "PUT") return json(res, 200, {member: await service.setPrint(id, (await body(req)).config ?? null, actor)});
      if (action === "photo" && method === "GET") {
        const photo = service.photoBuffer(member);
        return photo ? send(res, 200, photo, {"content-type": "image/jpeg"}) : send(res, 404, "No photo");
      }
      // Downloads need a verified public URL: the QR only ever encodes that URL.
      if (action === "qr.png" && method === "GET") {
        if (!member.verifiedUrl) return json(res, 409, {error: "Carte non publiée : QR indisponible."});
        return send(res, 200, await qr.png(member.verifiedUrl), {"content-type": "image/png", "content-disposition": `attachment; filename="${member.slug}-qr.png"`});
      }
      if (action === "qr.svg" && method === "GET") {
        if (!member.verifiedUrl) return json(res, 409, {error: "Carte non publiée : QR indisponible."});
        return send(res, 200, qr.svg(member.verifiedUrl), {"content-type": "image/svg+xml", "content-disposition": `attachment; filename="${member.slug}-qr.svg"`});
      }
      if (action === "card.pdf" && method === "GET") {
        if (member.pdf?.state !== "ready" || !fs.existsSync(service.pdfFile(member))) return json(res, 409, {error: "PDF non disponible."});
        return send(res, 200, fs.readFileSync(service.pdfFile(member)), {"content-type": "application/pdf", "content-disposition": `attachment; filename="${member.slug}.pdf"`});
      }
    }
    return json(res, 404, {error: "Route inconnue."});
  }

  // Same-origin only: SameSite=Strict cookie + custom header + Origin check on every state-changing call.
  function guardCsrf(req) {
    const origin = req.headers.origin;
    if (req.headers["x-requested-with"] !== "kafil-admin" || (origin && new URL(origin).host !== req.headers.host)) {
      throw Object.assign(new Error("Requête refusée."), {status: 403});
    }
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname.startsWith("/api/")) return await api(req, res, url);
      if (url.pathname === "/") return send(res, 302, "", {location: "/admin/"});
      if (url.pathname.startsWith("/admin/")) return serveFile(res, path.join(root, "admin"), url.pathname.slice(7), {"content-security-policy": ADMIN_CSP});
      if (url.pathname.startsWith("/assets/")) return serveFile(res, path.join(root, "assets"), url.pathname.slice(8));
      // Local publisher only: serve the generated public site so URLs can be verified end to end.
      if (config.publisher === "local" && url.pathname.startsWith("/site/")) {
        return serveFile(res, config.siteDir, url.pathname.slice(6), {"cache-control": "no-store"});
      }
      return send(res, 404, "Not found");
    } catch (error) {
      const status = error.status || 500;
      if (status === 500) console.error(error);
      json(res, status, {error: status === 500 ? "Erreur interne." : error.message});
    }
  });
  return {server, service, store, config, async close() { await new Promise(r => server.close(r)); await pdf.close(); }};
}
module.exports = {createApp};
