"use strict";
const fs = require("node:fs");
const path = require("node:path");
const {root} = require("../config");

// Writes the public site into a directory (development, tests, or self-hosting behind any web server).
class LocalPublisher {
  constructor(config) {
    this.dir = config.siteDir;
    fs.mkdirSync(this.dir, {recursive: true});
    this.syncStatic();
    this.fail = null; // test hook: set to an Error to simulate an outage
  }
  // Code and static pages follow the repository on every start; published data (cards, photos, registry, contacts) is preserved.
  syncStatic() {
    const copy = (from, to) => { fs.mkdirSync(path.dirname(to), {recursive: true}); fs.copyFileSync(from, to); };
    for (const file of [".nojekyll", "index.html", "members/preview/index.html"]) copy(path.join(root, file), path.join(this.dir, file));
    for (const file of fs.readdirSync(path.join(root, "assets"))) copy(path.join(root, "assets", file), path.join(this.dir, "assets", file));
    for (const file of ["data/members.json", "data/contacts.json"]) {
      if (!fs.existsSync(path.join(this.dir, file))) copy(path.join(root, file), path.join(this.dir, file));
    }
  }
  resolve(file) {
    const target = path.resolve(this.dir, file);
    if (!target.startsWith(this.dir + path.sep)) throw new Error("Unsafe path " + file);
    return target;
  }
  async publish({files}) {
    if (this.fail) throw this.fail;
    let changed = false;
    for (const [file, content] of Object.entries(files)) {
      const target = this.resolve(file);
      if (content === null) {
        if (fs.existsSync(target)) { fs.rmSync(target); changed = true; }
        continue;
      }
      const buffer = Buffer.from(content);
      if (fs.existsSync(target) && fs.readFileSync(target).equals(buffer)) continue;
      fs.mkdirSync(path.dirname(target), {recursive: true});
      fs.writeFileSync(target, buffer);
      changed = true;
    }
    return {changed};
  }
}
module.exports = {LocalPublisher};
