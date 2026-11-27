"use strict";
const fs = require("node:fs");
const path = require("node:path");

// Small JSON file store with atomic writes. Suitable for an association-sized registry.
const defaults = () => ({
  admins: [], sessions: [], members: [], audit: [],
  settings: {
    contacts: {phone: "", whatsapp: "", facebook: "", instagram: "", email: "", maps: "", address: "", hours: "",
      nationalWebsite: "https://kafilyatim.dz/"},
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
    this.db = fs.existsSync(this.file) ? {...defaults(), ...JSON.parse(fs.readFileSync(this.file, "utf8"))} : defaults();
    this.save();
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
