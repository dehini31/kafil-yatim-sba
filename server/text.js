"use strict";
const fs = require("node:fs");
const path = require("node:path");
const fontkit = require("@pdf-lib/fontkit");
const bidiFactory = require("bidi-js");
const {root} = require("./config");

const bidi = bidiFactory();

class Face {
  constructor(file) {
    this.bytes = fs.readFileSync(path.join(root, "assets", file));
    this.font = fontkit.create(this.bytes);
    this.upm = this.font.unitsPerEm;
    this.ascent = this.font.ascent / this.upm;
    this.descent = -this.font.descent / this.upm; // positive
    this.cache = new Map();
  }
  // One bidi run shaped with the font's OpenType rules (joining forms, ligatures, mark positioning).
  runGlyphs(text, rtl) {
    const run = this.font.layout(text, [], rtl ? "arab" : "latn", rtl ? "ARA" : "ENG", rtl ? "rtl" : "ltr");
    const glyphs = run.glyphs.map((g, i) => ({
      id: g.id, adv: run.positions[i].xAdvance / this.upm, dx: run.positions[i].xOffset / this.upm, dy: run.positions[i].yOffset / this.upm
    }));
    // For direction "rtl" fontkit already returns glyphs in visual (left→right) order.
    return glyphs;
  }
  // Visual glyph list for one line of logical text in an RTL paragraph, sizes in em.
  shape(text) {
    if (this.cache.has(text)) return this.cache.get(text);
    const {levels} = bidi.getEmbeddingLevels(text, "rtl");
    const mirrored = bidi.getMirroredCharactersMap(text, levels);
    const chars = Array.from(text);
    let runs = [];
    let index = 0;
    for (const ch of chars) {
      const level = levels[index];
      const last = runs[runs.length - 1];
      const out = level % 2 && mirrored.has(index) ? mirrored.get(index) : ch;
      if (last && last.level === level) last.text += out; else runs.push({level, text: out});
      index += ch.length;
    }
    // Reorder runs visually (UAX #9 rule L2).
    const max = Math.max(...runs.map(r => r.level), 0);
    const min = Math.min(...runs.filter(r => r.level % 2).map(r => r.level), max + 1);
    for (let level = max; level >= min; level--) {
      for (let i = 0; i < runs.length; i++) {
        if (runs[i].level < level) continue;
        let j = i;
        while (j + 1 < runs.length && runs[j + 1].level >= level) j++;
        runs = [...runs.slice(0, i), ...runs.slice(i, j + 1).reverse(), ...runs.slice(j + 1)];
        i = j;
      }
    }
    const glyphs = runs.flatMap(r => this.runGlyphs(r.text, r.level % 2 === 1));
    const result = {glyphs, width: glyphs.reduce((sum, g) => sum + g.adv, 0)};
    this.cache.set(text, result);
    return result;
  }
  width(text, size) { return this.shape(text).width * size; }
}

let faces;
function loadFaces() {
  return faces ||= {regular: new Face("tajawal.ttf"), bold: new Face("tajawal-bold.ttf")};
}

// Greedy word wrap (logical order); a single over-long word is broken by characters.
function wrap(face, text, size, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  const push = () => { if (current) lines.push(current); current = ""; };
  for (const word of words) {
    const candidate = current ? current + " " + word : word;
    if (face.width(candidate, size) <= maxWidth) { current = candidate; continue; }
    push();
    if (face.width(word, size) <= maxWidth) { current = word; continue; }
    let chunk = "";
    for (const ch of Array.from(word)) {
      if (chunk && face.width(chunk + ch, size) > maxWidth) { lines.push(chunk); chunk = ""; }
      chunk += ch;
    }
    current = chunk;
  }
  push();
  return lines.length ? lines : [""];
}
module.exports = {loadFaces, wrap, Face};
