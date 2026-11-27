"use strict";
const path = require("node:path");

const root = path.join(__dirname, "..");

function load(env = process.env) {
  const baseUrl = env.PUBLIC_BASE_URL || require("../data/site.json").baseUrl;
  if (!/^https?:\/\/.+\/$/.test(baseUrl)) throw new Error("PUBLIC_BASE_URL must end with /");
  // Everything can live under a sub-path of a domain, e.g. https://dehini.com/kafil/
  const basePath = (env.BASE_PATH ?? "").replace(/\/+$/, "");
  if (basePath && !/^\/[\w./-]*$/.test(basePath)) throw new Error("BASE_PATH must look like /kafil");
  return {
    root, basePath, trustProxy: env.TRUST_PROXY === "true",
    port: Number(env.PORT || 8787),
    host: env.HOST || "127.0.0.1",
    dataDir: path.resolve(env.DATA_DIR || path.join(root, ".data")),
    baseUrl,
    publisher: env.PUBLISHER || "local", // "local" | "ftp" | "github"
    siteDir: path.resolve(env.SITE_DIR || path.join(root, ".data", "site")),
    github: {
      repo: env.GITHUB_REPO || "dehini31/kafil-yatim-sba",
      branch: env.GITHUB_BRANCH || "main",
      token: env.GITHUB_TOKEN || "",
      api: env.GITHUB_API_URL || "https://api.github.com"
    },
    ftp: {
      host: env.FTP_HOST || "", port: Number(env.FTP_PORT || 21), user: env.FTP_USER || "", password: env.FTP_PASSWORD || "",
      secure: env.FTP_SECURE === "false" ? false : env.FTP_SECURE === "implicit" ? "implicit" : true, // FTPS by default
      insecureTls: env.FTP_INSECURE_TLS === "true", remoteDir: env.FTP_REMOTE_DIR || "/public_html/kafil"
    },
    verifyTimeoutMs: Number(env.VERIFY_TIMEOUT_MS || 6 * 60 * 1000),
    verifyIntervalMs: Number(env.VERIFY_INTERVAL_MS || 5000),
    secureCookies: env.COOKIE_SECURE ? env.COOKIE_SECURE === "true" : (env.ADMIN_URL || "").startsWith("https://"),
    sessionHours: Number(env.SESSION_HOURS || 12),
    timezone: "Africa/Algiers"
  };
}
module.exports = {load, root};
