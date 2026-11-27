# كافل اليتيم · Plateforme des cartes d'adhérents

Bureau wilaya de Sidi Bel Abbès — الجمعية الخيرية كافل اليتيم الوطنية.

- Site public : <https://dehini.com/kafil/>
- Administration : <https://dehini.com/kafil/admin/>
- Carte d'exemple : <https://dehini.com/kafil/members/preview/>

## Architecture

```
Navigateur ──HTTPS──▶ dehini.com (nginx/Caddy) ──/kafil/──▶ Serveur Node (Docker)
                                                              • /kafil/            site public (cartes statiques)
                                                              • /kafil/admin/      administration
                                                              • /kafil/api/        API protégée
                                                              • DATA_DIR           données privées + site publié
```

- **Un seul serveur** sert le site public et l'administration sous `https://dehini.com/kafil/`. GitHub Pages n'est plus nécessaire (le publieur GitHub reste disponible : `PUBLISHER=github`).
- **Cartes publiques** : fichiers statiques `/kafil/members/<slug>/`, écrits dans `SITE_DIR` ; `data/members.json` ne contient que `slug`, `active`, `expiresAt` (statut Actif / Expiré / Désactivé sans republier) et `data/contacts.json` les coordonnées du bureau.
- **Données privées** (`DATA_DIR/db.json`, `photos/`, `pdf/`) : jamais servies. Le public ne peut ni créer ni modifier une carte : toute route `/api` (hors connexion) exige une session valide, vérifiée côté serveur à chaque appel. Aucun secret dans le dépôt ni dans le frontend.
- Publication : écriture atomique des fichiers, puis **vérification par requête HTTP sur l'URL publique** avant de fournir le QR et le PDF.

### Ce qui est public, ce qui est privé

| Donnée | Public ? |
| --- | --- |
| Nom complet | toujours (c'est la carte) |
| Photo, poste, date d'expiration, n° d'adhérent | selon **Réglages → Champs publics** (par défaut : photo, poste, expiration) |
| Statut Actif/Expiré/Désactivé + date d'expiration (registre) | oui, nécessaire pour la vérification |
| Identifiants admin, journal, PDF, photos sources | jamais publiés |

Imprimer un champ sur le PDF ne le rend pas public (réglages distincts). Attention : le dépôt est public, l'historique Git conserve les anciennes versions d'une photo publiée.

## Fonctionnement

« Créer et publier » : validation → enregistrement → URL `/members/<slug>/` (slug aléatoire de 8 caractères, stable, non devinable) → commit → **vérification** que l'URL affiche la carte (contenu et révision) → QR à partir du lien vérifié → PDF initial. États : Enregistrement, Publication en cours, Publiée, Échec. En cas d'échec la fiche reste ; « Relancer la publication » est idempotent (même slug, pas de doublon ; un commit sans changement est ignoré). Le délai de GitHub Pages est d'environ 1 à 2 minutes.

- Modifier nom / poste / photo / expiration, renouveler, désactiver, réactiver : l'URL et le QR ne changent jamais. Une carte expirée ou désactivée reste en ligne avec un statut clair.
- Le QR encode uniquement l'URL publique (correction d'erreurs M, marge de 4 modules).
- PDF : 100 × 135 mm par défaut ; largeur, hauteur, orientation et champs réglables, par défaut (Réglages) ou par carte. L'aperçu est le même document HTML que celui imprimé par Chromium. Le serveur bloque la génération et explique pourquoi si le contenu ne tient pas ou si le QR serait trop petit (module < 0,33 mm).

## Configuration

Variables d'environnement (voir `.env.example`) : `PUBLISHER` (`local` = hébergement sur dehini.com ; `github` = publication vers GitHub Pages), `BASE_PATH=/kafil`, `PUBLIC_BASE_URL=https://dehini.com/kafil/`, `ADMIN_URL` (https ⇒ cookies `Secure`), `TRUST_PROXY=true` derrière votre proxy, `DATA_DIR`, `SITE_DIR`, `SESSION_HOURS`. Avec `PUBLISHER=github` : `GITHUB_TOKEN` (fine-grained, ce dépôt, Contents : Read and write), `GITHUB_REPO`, `GITHUB_BRANCH`.

## Déploiement sur dehini.com/kafil

Prérequis : un serveur où dehini.com est servi par nginx ou Caddy en HTTPS, avec Docker (ou Node ≥ 22 + Chromium) — un hébergement mutualisé (cPanel) ne convient pas.

1. Cloner le dépôt sur le serveur, copier `.env.example` en `.env`.
2. `docker compose up -d --build` (le volume `kafil-data` contient tout ; sauvegardez-le).
3. Ajouter `deploy-nginx.conf` au bloc `server` de dehini.com puis recharger nginx (Caddy : `handle /kafil/* { reverse_proxy 127.0.0.1:8787 }`).
4. Créer le premier administrateur : `docker compose exec kafil node server/cli.js add-admin --email vous@exemple.org --name "Nom"`.
5. Ouvrir <https://dehini.com/kafil/admin/>, renseigner **Réglages**, créer une fiche d'essai et scanner son QR.

Mise à jour : `git pull && docker compose up -d --build` (les pages statiques et les ressources sont resynchronisées au démarrage ; les cartes publiées sont conservées).

Développement local : `npm install`, `npm run admin:add -- --email vous@exemple.org`, `npm start` puis <http://127.0.0.1:8787/admin/> (sans `BASE_PATH`).

## Sans VPS : admin sur votre ordinateur, site sur dehini.com/kafil (FTP)

Le site public (cartes, QR, pages) est statique : il n'a besoin que de l'hébergement actuel de dehini.com. Seule l'administration (connexion, PDF) demande Node et Chromium ; elle tourne sur un ordinateur du bureau et **envoie automatiquement chaque carte publiée par FTP** vers `dehini.com/kafil`.

1. Dans le panneau de l'hébergeur (cPanel → *Comptes FTP*), créer un compte FTP limité au dossier `kafil` du site (ou noter l'hôte, l'identifiant et le mot de passe).
2. Sur l'ordinateur : installer Docker Desktop (ou Node ≥ 22), cloner ce dépôt, copier `.env.example` en `.env` et régler :

```
PUBLISHER=ftp
PUBLIC_BASE_URL=https://dehini.com/kafil/
FTP_HOST=ftp.dehini.com
FTP_USER=...            FTP_PASSWORD=...
FTP_REMOTE_DIR=/public_html/kafil     # dossier du site sur l'hébergement
# FTP_SECURE=false      # seulement si l'hébergeur ne gère pas FTPS
```

3. `npm install`, puis `npm run admin:add -- --email vous@exemple.org --name "Nom"`, puis `npm start` et ouvrir <http://127.0.0.1:8787/admin/>.
4. `node server/cli.js ftp-sync` envoie une première fois le site complet ; ensuite chaque publication envoie seulement ce qui a changé. Un échec FTP apparaît comme « Échec » dans l'admin et « Relancer la publication » reprend sans doublon.

L'ordinateur doit être allumé et la base `.data/` sauvegardée pour ajouter ou modifier des adhérents ; les cartes déjà publiées restent en ligne sans lui.

## Ajouter ou retirer un administrateur

Pas d'inscription publique : les comptes se créent en ligne de commande sur le serveur (dans le conteneur : `docker compose exec kafil node server/cli.js …`).

```bash
node server/cli.js add-admin --email nouveau@exemple.org --name "Nom"   # mot de passe demandé (12 caractères min.)
node server/cli.js add-admin --email existant@exemple.org               # réinitialise le mot de passe, révoque ses sessions
node server/cli.js list-admins
node server/cli.js disable-admin --email ancien@exemple.org
```

Mots de passe hachés (scrypt), cookie de session `HttpOnly` + `SameSite=Strict`, en-tête anti-CSRF obligatoire, verrouillage après 5 échecs pendant 15 minutes. Tous les administrateurs ont les mêmes droits.

## Tests

```bash
npm test
```

19 tests : parcours complet création → publication → scan du QR → page ; PDF 100 × 135, 85,6 × 54 paysage et 120 × 120 (taille réelle, QR décodé depuis le PDF, police arabe, noms longs, champs masqués, format trop petit) ; renouvellement avec QR identique ; désactivation et expiration ; échec et relance sans doublon ; refus des requêtes non autorisées ou forgées ; publieur GitHub contre une API simulée ; interfaces admin et publique à 320/360 px et sur ordinateur. Les fiches de test portent « (TEST) » et n'existent que dans des dossiers temporaires.

## Fichiers

- `templates/member.html`, `assets/render.js` : page publique d'une carte (référencement et Open Graph personnalisés par carte).
- `assets/` : logo, polices Tajawal (OFL), `qrcode.js` (Kazuhiko Arase, MIT).
- `server/print.js` : modèle recto imprimable ; `server/pdf.js` : rendu Chromium ; `server/publisher/` : publication locale ou GitHub.
- Vert `#173F39`, or `#E9BD76`, fond `#F6F5EF`, police Tajawal.
