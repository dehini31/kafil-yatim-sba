"use strict";
const fs = require("node:fs");
const path = require("node:path");

// Small JSON file store with atomic writes. Suitable for an association-sized registry.
const defaults = () => ({
  admins: [], sessions: [], members: [], audit: [],
  settings: {
    contactsVersion: 2,
    contacts: {"phone": "", "whatsapp": "", "facebook": "", "facebookName": "جمعية كافل اليتيم سيدي بلعباس الولائية", "instagram": "", "email": "", "maps": "", "address": "شارع ناصري عبد القادر، رقم 40، سيدي ياسين", "hours": "", "nationalWebsite": "https://kafilyatim.dz/", "nationalPhones": "0780 80 37 37\n0556 99 80 23\n0669 96 84 93", "nationalEmail": "contact@kafilyatim.dz"},
    publicFields: {photo: true, role: true, expiry: true, memberNumber: false},
    printDefaults: {
      widthMm: 100, heightMm: 135, orientation: "portrait",
      fields: {logo: true, association: true, office: true, photo: true, name: true, role: true, expiry: true, number: false, qr: true}
    }
  }
});

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, "db.json");
    fs.mkdirSync(path.join(dir, "photos"), {recursive: true, mode: 0o700});
    fs.mkdirSync(path.join(dir, "pdf"), {recursive: true, mode: 0o700});
    const existed = fs.existsSync(this.file);
    this.db = existed ? {...defaults(), ...JSON.parse(fs.readFileSync(this.file, "utf8"))} : defaults();
    this.migrated = existed && this.migrate();
    this.save();
  }
  // Older databases: add new contact keys and, once, fill still-empty ones with the official defaults.
  migrate() {
    const d = defaults().settings, s = this.db.settings;
    let changed = false;
    for (const key of Object.keys(d.contacts)) if (!(key in s.contacts)) { s.contacts[key] = d.contacts[key]; changed = true; }
    if (s.contactsVersion !== d.contactsVersion) {
      for (const key of Object.keys(d.contacts)) if (s.contacts[key] === "" && d.contacts[key]) s.contacts[key] = d.contacts[key];
      s.contactsVersion = d.contactsVersion;
      changed = true;
    }
    return changed;
  }
  save() {
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 1), {mode: 0o600});
    fs.renameSync(tmp, this.file);
  }
  audit(actor, action, detail = {}) {
    this.db.audit.push({at: new Date().toISOString(), actor, action, ...detail});
    if (this.db.audit.length > 2000) this.db.audit.splice(0, this.db.audit.length - 2000);
  }
}
module.exports = {Store, defaults};
