"use strict";
const crypto = require("node:crypto");

const blobSha = buffer => crypto.createHash("sha1").update(`blob ${buffer.length}\0`).update(buffer).digest("hex");

// Publishes by committing to the branch served by GitHub Pages, through the Git Data API
// (one atomic commit for all files). The token lives only in the server environment.
class GithubPublisher {
  constructor(config) {
    const {repo, branch, token, api} = config.github;
    if (!token) throw new Error("GITHUB_TOKEN is required when PUBLISHER=github");
    Object.assign(this, {repo, branch, token, api});
  }
  async call(method, route, body) {
    const response = await fetch(`${this.api}/repos/${this.repo}${route}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`, accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28", "content-type": "application/json", "user-agent": "kafil-yatim-publisher"
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) throw Object.assign(new Error(`GitHub ${method} ${route}: ${response.status} ${data.message || ""}`), {status: response.status});
    return data;
  }
  async publish({files, message}) {
    let lastError;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return await this.attempt(files, message);
      } catch (error) {
        lastError = error;
        // 422 on ref update = someone pushed in between: re-read the head and retry.
        if (![409, 422].includes(error.status)) throw error;
        await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
      }
    }
    throw lastError;
  }
  async attempt(files, message) {
    const ref = await this.call("GET", `/git/ref/heads/${this.branch}`);
    const head = ref.object.sha;
    const commit = await this.call("GET", `/git/commits/${head}`);
    const tree = await this.call("GET", `/git/trees/${commit.tree.sha}?recursive=1`);
    const existing = new Map(tree.tree.filter(e => e.type === "blob").map(e => [e.path, e.sha]));
    const entries = [];
    for (const [file, content] of Object.entries(files)) {
      if (content === null) {
        if (existing.has(file)) entries.push({path: file, mode: "100644", type: "blob", sha: null});
        continue;
      }
      const buffer = Buffer.from(content);
      if (!tree.truncated && existing.get(file) === blobSha(buffer)) continue; // unchanged: idempotent re-publish
      const blob = await this.call("POST", "/git/blobs", {content: buffer.toString("base64"), encoding: "base64"});
      entries.push({path: file, mode: "100644", type: "blob", sha: blob.sha});
    }
    if (!entries.length) return {changed: false, commit: head};
    const newTree = await this.call("POST", "/git/trees", {base_tree: commit.tree.sha, tree: entries});
    const created = await this.call("POST", "/git/commits", {message, tree: newTree.sha, parents: [head]});
    await this.call("PATCH", `/git/refs/heads/${this.branch}`, {sha: created.sha, force: false});
    return {changed: true, commit: created.sha};
  }
}
module.exports = {GithubPublisher, blobSha};
