"use strict";
const crypto = require("node:crypto");

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESERVED = new Set(["preview", "admin", "api", "assets", "new"]);

function randomSlug(length = 8) {
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join("");
}
function validSlug(slug) {
  return typeof slug === "string" && slug.length >= 3 && slug.length <= 64 && slugPattern.test(slug) && !RESERVED.has(slug);
}
function today(tz = "Africa/Algiers", now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit"}).format(now);
}
function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
// Actif / Expiré / Désactivé. A card stays valid through its expiry date.
function statusOf(member, now) {
  if (member.disabled) return "disabled";
  if (member.expiresAt < today(undefined, now)) return "expired";
  return "active";
}
function sha(value, len = 16) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, len);
}
function id() { return crypto.randomUUID(); }
module.exports = {randomSlug, validSlug, today, validDate, statusOf, sha, id, slugPattern};
