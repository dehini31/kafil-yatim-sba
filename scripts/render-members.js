"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {renderMember, slugPattern} = require("../assets/render.js");

const root = path.join(__dirname, "..");
const members = require("../data/members.json");
const {baseUrl} = require("../data/site.json");
const template = fs.readFileSync(path.join(root, "templates/member.html"), "utf8");
const pages = new Map();
const seen = new Set(["preview"]);

for (const member of members) {
  const {slug, fullName, role, photo, active} = member;
  if (typeof slug !== "string" || slug.length > 64 || !slugPattern.test(slug) || seen.has(slug)
      || typeof fullName !== "string" || !fullName.trim() || typeof role !== "string" || !role.trim()
      || typeof active !== "boolean") throw new Error("Invalid member record: " + slug);
  seen.add(slug);
  if (!active) {
    pages.set(slug, null);
    continue;
  }
  const page = renderMember(template, member, baseUrl);
  if (!photo || !fs.existsSync(path.join(root, photo))) throw new Error("Missing photo: " + slug);
  pages.set(slug, page);
}

for (const [slug, page] of pages) {
  const directory = path.join(root, "members", slug);
  const file = path.join(directory, "index.html");
  if (page === null) {
    fs.rmSync(file, {force:true});
  } else {
    fs.mkdirSync(directory, {recursive:true});
    fs.writeFileSync(file, page);
  }
}
