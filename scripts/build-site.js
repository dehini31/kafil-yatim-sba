"use strict";
// Builds the static public site (no admin, no private data) into dist/kafil/, ready to upload to dehini.com/kafil.
const fs = require("node:fs");
const path = require("node:path");
const {LocalPublisher} = require("../server/publisher/local");

const out = path.join(__dirname, "..", "dist", "kafil");
fs.rmSync(out, {recursive: true, force: true});
new LocalPublisher({siteDir: out});
console.log("Site statique prêt :", out);
