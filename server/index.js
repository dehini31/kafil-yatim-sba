"use strict";
const {createApp} = require("./app");

const app = createApp();
app.server.listen(app.config.port, app.config.host, () => {
  console.log(`Admin : http://${app.config.host}:${app.config.port}/admin/  (publisher: ${app.config.publisher}, public base: ${app.config.baseUrl})`);
  if (!app.store.db.admins.length) console.log("Aucun administrateur : npm run admin:add -- --email you@example.org --name \"Nom\"");
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => app.close().then(() => process.exit(0)));
