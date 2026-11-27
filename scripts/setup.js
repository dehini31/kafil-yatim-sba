"use strict";
// Interactive first-time setup: FTP access to dehini.com/kafil + first administrator.
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const {Writable} = require("node:stream");

const root = path.join(__dirname, "..");
let muted = false;
const rl = readline.createInterface({input: process.stdin, output: new Writable({write(chunk, enc, cb) { if (!muted) process.stdout.write(chunk, enc); cb(); }}), terminal: !!process.stdin.isTTY});
// Lines are queued so answers are never lost, whether typed or piped.
const lines = [], waiting = [];
rl.on("line", line => (waiting.length ? waiting.shift()(line) : lines.push(line)));
const next = () => new Promise(resolve => (lines.length ? resolve(lines.shift()) : waiting.push(resolve)));
const ask = async (question, {secret = false, fallback = ""} = {}) => {
  process.stdout.write(question + (fallback ? ` [${fallback}] ` : " "));
  muted = secret;
  const answer = await next();
  muted = false;
  if (secret) process.stdout.write("\n");
  return answer.trim() || fallback;
};

(async () => {
  console.log("\n=== Configuration de l'administration Kafil El Yatim ===\n");
  console.log("1/2  Envoi des cartes vers dehini.com/kafil (compte FTP de votre hébergeur)\n");
  const ftp = {
    FTP_HOST: await ask("Serveur FTP (ex. ftp.dehini.com) :"),
    FTP_USER: await ask("Identifiant FTP :"),
    FTP_PASSWORD: await ask("Mot de passe FTP (invisible) :", {secret: true}),
    FTP_REMOTE_DIR: await ask("Dossier du site sur l'hébergement :", {fallback: "/public_html/kafil"})
  };
  const secure = (await ask("Connexion chiffrée FTPS ? (o/n) :", {fallback: "o"})).toLowerCase().startsWith("o");
  const env = {PUBLISHER: "ftp", PUBLIC_BASE_URL: "https://dehini.com/kafil/", ...ftp, FTP_SECURE: secure ? "true" : "false"};
  if (ftp.FTP_HOST) {
    process.stdout.write("\nTest de la connexion FTP… ");
    try {
      const {Client} = require("basic-ftp");
      const client = new Client(15000);
      await client.access({host: ftp.FTP_HOST, user: ftp.FTP_USER, password: ftp.FTP_PASSWORD, secure});
      await client.ensureDir(ftp.FTP_REMOTE_DIR);
      client.close();
      console.log("OK");
    } catch (error) {
      console.log("ÉCHEC : " + error.message);
      console.log("Vous pourrez corriger le fichier .env puis relancer ; la configuration est tout de même enregistrée.");
    }
  } else {
    env.PUBLISHER = "local";
    console.log("\nAucun FTP : mode manuel (le site est écrit dans .data/site, à envoyer vous-même).");
  }
  fs.writeFileSync(path.join(root, ".env"), Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n") + "\n", {mode: 0o600});
  console.log("\n2/2  Compte administrateur\n");
  process.env.PUBLISHER = env.PUBLISHER;
  const {load} = require("../server/config");
  const {Store} = require("../server/store");
  const auth = require("../server/auth");
  const store = new Store(load().dataDir);
  for (;;) {
    const email = await ask("E-mail de l'administrateur :");
    const name = await ask("Nom affiché :", {fallback: email});
    const password = await ask("Mot de passe (12 caractères minimum, invisible) :", {secret: true});
    try { await auth.addAdmin(store, {email, name, password}); console.log("Administrateur enregistré."); break; }
    catch (error) { console.log(error.message); }
  }
  console.log("\nTerminé. Lancez maintenant start-admin (double-clic) pour ouvrir l'administration.\n");
  rl.close();
})();
