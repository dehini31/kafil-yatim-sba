"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {Readable} = require("node:stream");
const {LocalPublisher} = require("./local");

// Builds the public site locally (SITE_DIR), then mirrors it to an ordinary web host over FTP/FTPS.
// A manifest of uploaded hashes makes every run incremental and safe to repeat after a failure.
class FtpPublisher extends LocalPublisher {
  constructor(config) {
    super(config);
    this.ftp = config.ftp;
    if (!this.ftp.host || !this.ftp.user || !this.ftp.password) throw new Error("FTP_HOST, FTP_USER and FTP_PASSWORD are required when PUBLISHER=ftp");
    this.manifestFile = path.join(config.dataDir, "ftp-manifest.json");
  }
  manifest() { return fs.existsSync(this.manifestFile) ? JSON.parse(fs.readFileSync(this.manifestFile, "utf8")) : {}; }
  walk(dir = this.dir, out = []) {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) this.walk(full, out); else out.push(full);
    }
    return out;
  }
  async publish(args) {
    const result = await super.publish(args);
    await this.sync();
    return result;
  }
  async sync() {
    const {Client} = require("basic-ftp");
    const known = this.manifest();
    const local = {};
    for (const file of this.walk()) {
      const rel = path.relative(this.dir, file).split(path.sep).join("/");
      local[rel] = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    }
    const upload = Object.keys(local).filter(rel => known[rel] !== local[rel]);
    const remove = Object.keys(known).filter(rel => !(rel in local));
    if (!upload.length && !remove.length) return {uploaded: 0, removed: 0};
    const client = new Client(30000);
    try {
      await client.access({host: this.ftp.host, port: this.ftp.port, user: this.ftp.user, password: this.ftp.password,
        secure: this.ftp.secure, secureOptions: {rejectUnauthorized: !this.ftp.insecureTls}});
      const remote = rel => path.posix.join(this.ftp.remoteDir, rel);
      // Cards first, registry and contacts last, so the page never refers to a missing photo.
      upload.sort((a, b) => Number(a.startsWith("data/")) - Number(b.startsWith("data/")));
      for (const rel of upload) {
        await client.ensureDir(path.posix.dirname(remote(rel)));
        await client.uploadFrom(Readable.from(fs.readFileSync(path.join(this.dir, rel))), path.posix.basename(rel));
        known[rel] = local[rel];
        this.saveManifest(known);
      }
      for (const rel of remove) {
        try { await client.remove(remote(rel)); } catch { /* already gone */ }
        delete known[rel];
        this.saveManifest(known);
      }
    } catch (error) {
      throw new Error("Envoi FTP impossible : " + error.message);
    } finally {
      client.close();
    }
    return {uploaded: upload.length, removed: remove.length};
  }
  saveManifest(known) { fs.writeFileSync(this.manifestFile, JSON.stringify(known)); }
}
module.exports = {FtpPublisher};
