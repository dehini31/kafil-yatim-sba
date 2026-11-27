"use strict";
// Usage: node server/cli.js add-admin --email a@b.org [--name "Nom"]   (password read from ADMIN_PASSWORD or prompted)
const readline = require("node:readline");
const {load} = require("./config");
const {Store} = require("./store");
const auth = require("./auth");

function arg(name) {
  const i = process.argv.indexOf("--" + name);
  return i > 0 ? process.argv[i + 1] : undefined;
}
function ask(question) {
  const rl = readline.createInterface({input: process.stdin, output: process.stdout, terminal: true});
  rl._writeToOutput = text => { if (text.includes(question)) rl.output.write(text); };
  return new Promise(resolve => rl.question(question, answer => { rl.close(); process.stdout.write("\n"); resolve(answer); }));
}
(async () => {
  const command = process.argv[2];
  const store = new Store(load().dataDir);
  if (command === "add-admin") {
    const email = arg("email");
    if (!email) throw new Error("--email requis");
    const password = process.env.ADMIN_PASSWORD || await ask("Mot de passe (12 caractères min.) : ");
    const created = await auth.addAdmin(store, {email, name: arg("name"), password});
    console.log(created ? "Administrateur créé." : "Mot de passe mis à jour (sessions révoquées).");
  } else if (command === "list-admins") {
    for (const a of store.db.admins) console.log(a.email, a.disabled ? "(désactivé)" : "");
  } else if (command === "disable-admin") {
    const admin = store.db.admins.find(a => a.email === String(arg("email")).toLowerCase());
    if (!admin) throw new Error("Administrateur introuvable.");
    admin.disabled = true;
    store.db.sessions = store.db.sessions.filter(s => s.adminId !== admin.id);
    store.save();
    console.log("Administrateur désactivé.");
  } else {
    console.log("Commandes : add-admin --email X [--name Y] | list-admins | disable-admin --email X");
  }
})().catch(error => { console.error(error.message); process.exit(1); });
