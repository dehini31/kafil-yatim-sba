"use strict";
const fs = require("node:fs");
const path = require("node:path");
const {root} = require("../config");

// Writes the public site into a directory (development, tests, or self-hosting behind any web server).
class LocalPublisher {
  constructor(config) {
    this.dir = config.siteDir;
    fs.mkdirSync(this.dir, {recursive: true});
    if (!fs.existsSync(path.join(this.dir, "index.html"))) {
      for (const entry of [".nojekyll", "index.html", "assets", "data", "members"]) {
        const from = path.join(root, entry);
        if (fs.existsSync(from)) fs.cpSync(from, path.join(this.dir, entry), {recursive: true});
      }
    }
    this.fail = null; // test hook: set to an Error to simulate an outage
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
