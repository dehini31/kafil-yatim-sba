"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const crypto = require("node:crypto");
const {GithubPublisher, blobSha} = require("../server/publisher/github");

// Tiny in-memory implementation of the Git Data API endpoints the publisher uses.
function mockGithub() {
  const blobs = new Map(), trees = new Map(), commits = new Map();
  const id = () => crypto.randomBytes(20).toString("hex");
  const state = {head: null, commitsMade: 0, conflicts: 0, auth: []};
  const rootTree = {tree: [], truncated: false};
  const seed = id(); trees.set(seed, new Map([["index.html", blobSha(Buffer.from("home"))]]));
  blobs.set(blobSha(Buffer.from("home")), Buffer.from("home"));
  const c0 = id(); commits.set(c0, {tree: seed, parents: []}); state.head = c0;
  const server = http.createServer(async (req, res) => {
    state.auth.push(req.headers.authorization);
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : {};
    const reply = (code, data) => { res.writeHead(code, {"content-type": "application/json"}); res.end(JSON.stringify(data)); };
    const url = req.url.replace("/repos/o/r", "");
    let m;
    if (url === "/git/ref/heads/main") return reply(200, {object: {sha: state.head}});
    if ((m = /^\/git\/commits\/(\w+)$/.exec(url))) return reply(200, {tree: {sha: commits.get(m[1]).tree}});
    if ((m = /^\/git\/trees\/(\w+)\?recursive=1$/.exec(url))) {
      return reply(200, {truncated: false, tree: [...trees.get(m[1])].map(([path, sha]) => ({path, sha, type: "blob"}))});
    }
    if (url === "/git/blobs") { const buf = Buffer.from(body.content, "base64"); const sha = blobSha(buf); blobs.set(sha, buf); return reply(201, {sha}); }
    if (url === "/git/trees") {
      const next = new Map(trees.get(body.base_tree));
      for (const e of body.tree) e.sha === null ? next.delete(e.path) : next.set(e.path, e.sha);
      const sha = id(); trees.set(sha, next); return reply(201, {sha});
    }
    if (url === "/git/commits") { const sha = id(); commits.set(sha, {tree: body.tree, parents: body.parents}); return reply(201, {sha}); }
    if (url === "/git/refs/heads/main" && req.method === "PATCH") {
      if (state.conflicts > 0) { state.conflicts--; return reply(422, {message: "Update is not a fast forward"}); }
      state.head = body.sha; state.commitsMade++; return reply(200, {});
    }
    reply(404, {message: "no route " + url});
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve({
    server, state, blobs, trees, commits, api: `http://127.0.0.1:${server.address().port}`
  })));
}

test("github publisher commits files atomically, is idempotent, retries conflicts, deletes", async () => {
  const gh = await mockGithub();
  const publisher = new GithubPublisher({github: {repo: "o/r", branch: "main", token: "tok", api: gh.api}});
  const files = {"members/abc/index.html": "<html>é</html>", "data/members.json": "[]\n", "assets/members/abc.jpg": Buffer.from([1, 2, 3, 255])};
  const first = await publisher.publish({files, message: "m"});
  assert.equal(first.changed, true);
  assert.equal(gh.state.commitsMade, 1);
  const tree = gh.trees.get(gh.commits.get(gh.state.head).tree);
  assert.deepEqual([...tree.keys()].sort(), ["assets/members/abc.jpg", "data/members.json", "index.html", "members/abc/index.html"]);
  assert.deepEqual(gh.blobs.get(tree.get("assets/members/abc.jpg")), Buffer.from([1, 2, 3, 255]));
  assert.ok(gh.state.auth.every(a => a === "Bearer tok"));
  // same content again: no empty commit (safe retry)
  assert.equal((await publisher.publish({files, message: "m"})).changed, false);
  assert.equal(gh.state.commitsMade, 1);
  // concurrent push -> 422 on ref update -> retried
  gh.state.conflicts = 2;
  assert.equal((await publisher.publish({files: {"data/members.json": "[1]\n"}, message: "m2"})).changed, true);
  assert.equal(gh.state.commitsMade, 2);
  // deletion
  await publisher.publish({files: {"assets/members/abc.jpg": null}, message: "m3"});
  assert.ok(!gh.trees.get(gh.commits.get(gh.state.head).tree).has("assets/members/abc.jpg"));
  gh.server.close();
});

test("github publisher refuses to start without a token", () => {
  assert.throws(() => new GithubPublisher({github: {repo: "o/r", branch: "main", token: "", api: "x"}}), /GITHUB_TOKEN/);
});
