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

## Langue et coordonnées par défaut

L'interface d'administration et les messages du serveur sont en arabe (RTL) ; la ligne de commande (`cli.js`, assistant d'installation) et ce README restent en français. **Réglages → بيانات التواصل الرسمية** fixe les coordonnées affichées sur toutes les cartes : adresse du bureau, page Facebook (nom affiché + lien), téléphone, WhatsApp, e-mail, horaires (les champs vides sont masqués) et le bloc « المكتب الوطني للجمعية » (téléphones et e-mail nationaux, clairement présentés comme ne pas être les numéros du bureau de Sidi Bel Abbès). Valeurs initiales : adresse, nom de la page Facebook et contacts nationaux ; après mise à jour de l'application, les bases existantes reçoivent une fois ces valeurs dans leurs champs encore vides, puis les modifications de l'administrateur sont conservées.

## Fonctionnement

« Créer et publier » : validation → enregistrement → URL `/members/<slug>/` (slug aléatoire de 8 caractères, stable, non devinable) → commit → **vérification** que l'URL affiche la carte (contenu et révision) → QR à partir du lien vérifié → PDF initial. États : Enregistrement, Publication en cours, Publiée, Échec. En cas d'échec la fiche reste ; « Relancer la publication » est idempotent (même slug, pas de doublon ; un commit sans changement est ignoré). Le délai de GitHub Pages est d'environ 1 à 2 minutes.

- Modifier nom / poste / photo / expiration, renouveler, désactiver, réactiver : l'URL et le QR ne changent jamais. Une carte expirée ou désactivée reste en ligne avec un statut clair.
- Le QR encode uniquement l'URL publique (correction d'erreurs M, marge de 4 modules).
- PDF : 100 × 135 mm par défaut ; largeur, hauteur, orientation et champs réglables, par défaut (Réglages) ou par carte. Le recto reprend le modèle de l'association (logo, association, bureau, QR, poste, « صالحة إلى » + date ; photo et nom en option). **Le PDF est dessiné directement (texte arabe vectoriel, QR vectoriel) : aucun navigateur n'est nécessaire, il fonctionne sur tout hébergement Node.** L'aperçu et le PDF sortent du même modèle de mise en page. Le serveur bloque la génération et explique pourquoi si le contenu ne tient pas (le texte se réduit d'abord automatiquement) ou si le QR serait trop petit (module < 0,33 mm).

## Configuration

Variables d'environnement (voir `.env.example`) : `PUBLISHER` (`local` = hébergement sur dehini.com ; `github` = publication vers GitHub Pages), `BASE_PATH=/kafil`, `PUBLIC_BASE_URL=https://dehini.com/kafil/`, `ADMIN_URL` (https ⇒ cookies `Secure`), `TRUST_PROXY=true` derrière votre proxy, `DATA_DIR`, `SITE_DIR`, `SESSION_HOURS`. Avec `PUBLISHER=github` : `GITHUB_TOKEN` (fine-grained, ce dépôt, Contents : Read and write), `GITHUB_REPO`, `GITHUB_BRANCH`.

## Déploiement sur dehini.com/kafil

Prérequis : un serveur où dehini.com est servi par nginx ou Caddy en HTTPS, avec Docker (ou Node ≥ 22) — un hébergement mutualisé (cPanel) ne convient pas.

1. Cloner le dépôt sur le serveur, copier `.env.example` en `.env`.
2. `docker compose up -d --build` (le volume `kafil-data` contient tout ; sauvegardez-le).
3. Ajouter `deploy-nginx.conf` au bloc `server` de dehini.com puis recharger nginx (Caddy : `handle /kafil/* { reverse_proxy 127.0.0.1:8787 }`).
4. Créer le premier administrateur : `docker compose exec kafil node server/cli.js add-admin --email vous@exemple.org --name "Nom"`.
5. Ouvrir <https://dehini.com/kafil/admin/>, renseigner **Réglages**, créer une fiche d'essai et scanner son QR.

Mise à jour : `git pull && docker compose up -d --build` (les pages statiques et les ressources sont resynchronisées au démarrage ; les cartes publiées sont conservées).

Développement local : `npm install`, `npm run admin:add -- --email vous@exemple.org`, `npm start` puis <http://127.0.0.1:8787/admin/> (sans `BASE_PATH`).

## Admin en ligne sur dehini.com/kafil/admin (cPanel « Setup Node.js App »)

Le serveur d'administration tourne comme application Node de cPanel (Passenger) ; il écrit directement les cartes dans le dossier public `~/public_html/kafil` (aucun GitHub ni cron nécessaire pour publier).

1. **Libérer le dossier public** (l'application le gère elle-même) : `rm -rf ~/public_html/kafil` puis `mkdir -p ~/public_html/kafil` ; supprimer la tâche cron `deploy-host.sh`.
2. **Cloner l'application hors du dossier public** : `cd ~ && git clone https://github.com/dehini31/kafil-yatim-sba.git kafil-admin`
3. **Créer `~/kafil-admin/.env`** (adapter `/home/dehini91`) :

```
PUBLISHER=local
BASE_PATH=/kafil
PUBLIC_BASE_URL=https://dehini.com/kafil/
ADMIN_URL=https://dehini.com/kafil/admin/
TRUST_PROXY=true
SITE_DIR=/home/dehini91/public_html/kafil
DATA_DIR=/home/dehini91/kafil-data
```

4. **cPanel → Setup Node.js App → Create Application** : Node 22 ou plus, mode *Production*, *Application root* `kafil-admin`, *Application URL* `dehini.com` + `kafil/admin`, *Startup file* `server/index.js`. Cliquer **Run NPM Install**, puis **Restart**.
5. **Créer l'administrateur** dans le terminal (après la commande `source …/activate` affichée par cPanel en haut de la page de l'application) : `cd ~/kafil-admin && node server/cli.js add-admin --email vous@exemple.org --name "Nom"`
6. Ouvrir <https://dehini.com/kafil/admin/>. Au démarrage, l'application recopie le site statique (accueil, ressources, carte d'exemple) dans `~/public_html/kafil` et conserve les cartes publiées.

PDF : généré par le serveur lui-même, sans navigateur, donc sans réglage particulier. Le bouton **طباعة / PDF (المتصفح)** reste disponible pour imprimer depuis le navigateur.

Mise à jour : `cd ~/kafil-admin && git pull && npm install`, puis **Restart** dans cPanel. Sauvegarder `~/kafil-data`.

## Démarrage rapide (ordinateur du bureau, Windows / Mac / Linux)

1. Installer **Node.js 22 (LTS)** depuis <https://nodejs.org>.
2. Extraire `kafil-admin.zip`, puis **double-cliquer sur `start-admin.bat`** (Mac/Linux : `./start-admin.sh`).
3. Au premier lancement, l'assistant demande le compte FTP de dehini.com (voir plus bas) puis crée votre compte administrateur. Il teste la connexion FTP.
4. Le navigateur s'ouvre sur <http://127.0.0.1:8787/admin/> : se connecter, **Réglages** (contacts du bureau), puis **+ Nouvel adhérent → Créer et publier**. La fenêtre noire doit rester ouverte pendant l'utilisation.
5. Dans la fiche : **Télécharger le PDF** (impression), **Télécharger le QR**, **Voir la carte**, **Copier le lien**. Dimensions et champs d'impression se règlent dans la fiche (par carte) ou dans Réglages (par défaut).

Pour changer la configuration plus tard : supprimer le fichier `.env` et relancer, ou `npm run setup`.

## Déploiement par Git sur l'hébergeur (sans envoi manuel)

L'admin (sur l'ordinateur du bureau) publie chaque carte par un commit sur GitHub (`PUBLISHER=github`, `GITHUB_TOKEN` dans `.env`) ; l'hébergeur récupère le dépôt avec `git pull`. Le fichier `.htaccess` masque le code de l'application, les tests et les secrets.

Une seule fois, dans le terminal de l'hébergeur :

```bash
cd ~/public_html
git clone https://github.com/dehini31/kafil-yatim-sba.git kafil
cd kafil && chmod +x deploy-host.sh
```

Mise à jour automatique : ajouter dans **cPanel → Tâches Cron** (chaque minute) `cd ~/public_html/kafil && ./deploy-host.sh >> ~/kafil-deploy.log 2>&1`. Sinon, lancer `./deploy-host.sh` à la main après chaque publication. Le dépôt doit être public ou l'hébergeur doit avoir une clé de déploiement en lecture seule.

## Sans VPS : admin sur votre ordinateur, site sur dehini.com/kafil (FTP)

Le site public (cartes, QR, pages) est statique : il n'a besoin que de l'hébergement actuel de dehini.com. Seule l'administration (connexion, PDF) demande Node ; elle tourne sur un ordinateur du bureau et **envoie automatiquement chaque carte publiée par FTP** vers `dehini.com/kafil`.

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

20 tests : parcours complet création → publication → scan du QR → page ; PDF 100 × 135, 85,6 × 54 paysage et 120 × 120 (taille réelle, QR décodé depuis le PDF, police arabe, noms longs, champs masqués, format trop petit) ; renouvellement avec QR identique ; désactivation et expiration ; échec et relance sans doublon ; refus des requêtes non autorisées ou forgées ; publieur GitHub contre une API simulée ; interfaces admin et publique à 320/360 px et sur ordinateur. Les fiches de test portent « (TEST) » et n'existent que dans des dossiers temporaires.

## Fichiers

- `templates/member.html`, `assets/render.js` : page publique d'une carte (référencement et Open Graph personnalisés par carte).
- `assets/` : logo, polices Tajawal (OFL), `qrcode.js` (Kazuhiko Arase, MIT).
- `server/card.js` : mise en page du recto (modèle commun) ; `server/text.js` : formes arabes (fontkit) et bidi ; `server/pdf.js` : dessin du PDF (pdf-lib) ; `server/print.js` : réglages et aperçu HTML ; `server/publisher/` : publication locale, GitHub ou FTP.
- Vert `#173F39`, or `#E9BD76`, fond `#F6F5EF`, police Tajawal.
