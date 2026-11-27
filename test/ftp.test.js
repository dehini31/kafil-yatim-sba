"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const FtpSrv = require("ftp-srv");
const {FtpPublisher} = require("../server/publisher/ftp");

test("ftp publisher mirrors the site incrementally to a web host", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kafil-ftp-"));
  const remoteRoot = path.join(dir, "remote");
  fs.mkdirSync(path.join(remoteRoot, "public_html"), {recursive: true});
  const server = new FtpSrv({url: "ftp://127.0.0.1:2121", anonymous: false, pasv_url: "127.0.0.1", pasv_min: 2200, pasv_max: 2250});
  server.on("login", ({username, password}, resolve, reject) => username === "u" && password === "p" ? resolve({root: remoteRoot}) : reject(new Error("bad login")));
  await server.listen();
  const config = {siteDir: path.join(dir, "site"), dataDir: dir, ftp: {host: "127.0.0.1", port: 2121, user: "u", password: "p", secure: false, remoteDir: "/public_html/kafil"}};
  const publisher = new FtpPublisher(config);
  await publisher.publish({files: {"members/abc/index.html": "<html>carte</html>", "data/members.json": "[]\n", "assets/members/abc.jpg": Buffer.from([1, 2, 255])}});
  const remote = file => path.join(remoteRoot, "public_html/kafil", file);
  assert.equal(fs.readFileSync(remote("members/abc/index.html"), "utf8"), "<html>carte</html>");
  assert.deepEqual(fs.readFileSync(remote("assets/members/abc.jpg")), Buffer.from([1, 2, 255]));
  assert.ok(fs.existsSync(remote("index.html")) && fs.existsSync(remote("assets/style.css")), "static site uploaded too");
  assert.deepEqual(await publisher.sync(), {uploaded: 0, removed: 0}, "nothing to do when in sync");
  const result = await publisher.publish({files: {"data/members.json": "[1]\n", "assets/members/abc.jpg": null}});
  assert.equal(fs.readFileSync(remote("data/members.json"), "utf8"), "[1]\n");
  assert.ok(!fs.existsSync(remote("assets/members/abc.jpg")));
  // wrong password -> clear failure
  const bad = new FtpPublisher({...config, ftp: {...config.ftp, password: "x"}, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "k2-"))});
  await assert.rejects(bad.publish({files: {"a.txt": "a"}}), /Envoi FTP impossible/);
  await server.close();
});
