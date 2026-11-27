"use strict";
const fs = require("node:fs");
const path = require("node:path");
const {root} = require("./config");
const {renderMember} = require("../assets/render.js");
const {statusOf, sha} = require("./util");

const template = () => fs.readFileSync(path.join(root, "templates/member.html"), "utf8");

// Only explicitly authorised fields leave the protected store. Name is always public (it is the card).
function publicView(member, settings, photo) {
  const p = settings.publicFields;
  const view = {
    slug: member.slug, fullName: member.fullName, active: !member.disabled, expiresAt: member.expiresAt,
    state: statusOf(member), expiryPublic: !!p.expiry
  };
  if (p.role && member.role) view.role = member.role;
  if (p.memberNumber && member.memberNumber) view.memberNumber = member.memberNumber;
  if (p.photo && photo) { view.photo = `assets/members/${member.slug}.jpg`; view.photoVersion = sha(photo, 8); }
  return view;
}

function renderPage(member, settings, photo, baseUrl) {
  const view = publicView(member, settings, photo);
  const first = renderMember(template(), view, baseUrl);
  const rev = sha(first, 12);
  return {html: renderMember(template(), {...view, rev}, baseUrl), rev};
}

// Public registry: nothing but what the page needs to display validity.
function registry(members) {
  return members.map(m => ({slug: m.slug, active: !m.disabled, expiresAt: m.expiresAt}))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}
function contactsFile(settings) {
  return JSON.stringify(settings.contacts, null, 2) + "\n";
}
const json = value => JSON.stringify(value, null, 2) + "\n";

module.exports = {renderPage, publicView, registry, contactsFile, json};
