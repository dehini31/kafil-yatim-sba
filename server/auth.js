"use strict";
const crypto = require("node:crypto");
const {promisify} = require("node:util");
const scrypt = promisify(crypto.scrypt);
const {id, sha} = require("./util");

const COOKIE = "kafil_sid";
const attempts = new Map(); // key -> {count, until}
const SCRYPT = {N: 16384, r: 8, p: 1};

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64, SCRYPT);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}
async function verifyPassword(password, stored) {
  const [kind, salt, key] = String(stored).split("$");
  if (kind !== "scrypt") return false;
  const derived = await scrypt(password, Buffer.from(salt, "hex"), 64, SCRYPT);
  const expected = Buffer.from(key, "hex");
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}
async function addAdmin(store, {email, name, password}) {
  email = String(email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Adresse e-mail invalide.");
  if (typeof password !== "string" || password.length < 12) throw new Error("Mot de passe : 12 caractères minimum.");
  const existing = store.db.admins.find(a => a.email === email);
  const hash = await hashPassword(password);
  if (existing) {
    existing.hash = hash; existing.disabled = false; if (name) existing.name = name;
    store.db.sessions = store.db.sessions.filter(s => s.adminId !== existing.id);
  } else {
    store.db.admins.push({id: id(), email, name: name || email, hash, createdAt: new Date().toISOString(), disabled: false});
  }
  store.audit("cli", existing ? "admin.password-reset" : "admin.add", {email});
  store.save();
  return !existing;
}
function tooMany(key) {
  const a = attempts.get(key);
  return a && a.until > Date.now() && a.count >= 5;
}
function noteFailure(key) {
  const a = attempts.get(key);
  if (!a || a.until < Date.now()) attempts.set(key, {count: 1, until: Date.now() + 15 * 60 * 1000});
  else a.count++;
}
const DUMMY = "scrypt$00000000000000000000000000000000$" + "00".repeat(64);
async function login(store, config, email, password, ip) {
  email = String(email || "").trim().toLowerCase();
  const key = ip + "|" + email;
  if (tooMany(key)) return {error: "Trop de tentatives. Réessayez dans 15 minutes.", status: 429};
  const admin = store.db.admins.find(a => a.email === email && !a.disabled);
  const ok = await verifyPassword(String(password || ""), admin ? admin.hash : DUMMY);
  if (!admin || !ok) { noteFailure(key); return {error: "Identifiants incorrects.", status: 401}; }
  attempts.delete(key);
  const token = crypto.randomBytes(32).toString("base64url");
  store.db.sessions = store.db.sessions.filter(s => s.expires > Date.now());
  store.db.sessions.push({hash: sha(token, 64), adminId: admin.id, expires: Date.now() + config.sessionHours * 3600e3});
  store.audit(admin.email, "login");
  store.save();
  return {token, admin};
}
function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
function sessionAdmin(store, req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  const h = sha(token, 64);
  const s = store.db.sessions.find(x => x.hash === h && x.expires > Date.now());
  if (!s) return null;
  return store.db.admins.find(a => a.id === s.adminId && !a.disabled) || null;
}
function logout(store, req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) { const h = sha(token, 64); store.db.sessions = store.db.sessions.filter(s => s.hash !== h); store.save(); }
}
function cookie(config, token, maxAge) {
  return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=${config.basePath || "/"}; Max-Age=${maxAge}${config.secureCookies ? "; Secure" : ""}`;
}
module.exports = {addAdmin, login, logout, sessionAdmin, cookie};
