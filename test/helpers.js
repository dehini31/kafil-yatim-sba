"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const auth = require("../server/auth");
const {createApp} = require("../server/app");

const PASSWORD = "correct-horse-battery";
async function startApp(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kafil-test-"));
  const app = createApp({dataDir: path.join(dir, "data"), siteDir: path.join(dir, "site"), verifyTimeoutMs: 4000, verifyIntervalMs: 100, ...extra});
  await auth.addAdmin(app.store, {email: "admin@example.test", name: "Admin Test", password: PASSWORD});
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  app.config.baseUrl = origin + "/site/";
  app.origin = origin;
  app.dir = dir;
  return app;
}
// Minimal HTTP client with a cookie jar.
function client(origin) {
  let cookie = "";
  async function call(method, url, body, {csrf = true, raw = false} = {}) {
    const headers = {};
    if (cookie) headers.cookie = cookie;
    if (csrf) headers["x-requested-with"] = "kafil-admin";
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await fetch(origin + url, {method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual"});
    const set = response.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0].endsWith("=") ? "" : set.split(";")[0];
    if (raw) return response;
    const text = await response.text();
    let json; try { json = JSON.parse(text); } catch {}
    return {status: response.status, json, text, headers: response.headers};
  }
  return {call, login: (email = "admin@example.test", password = PASSWORD) => call("POST", "/api/login", {email, password})};
}
async function photoDataUrl(color = "#7a5c3e") {
  const buffer = await sharp({create: {width: 640, height: 800, channels: 3, background: color}})
    .composite([{input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><circle cx="150" cy="150" r="140" fill="#d9b38c"/></svg>'), top: 150, left: 170}])
    .jpeg().toBuffer();
  return "data:image/jpeg;base64," + buffer.toString("base64");
}
async function waitFor(fn, {timeout = 15000, every = 100} = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > end) throw new Error("waitFor timeout");
    await new Promise(r => setTimeout(r, every));
  }
}
module.exports = {startApp, client, photoDataUrl, waitFor, PASSWORD};
