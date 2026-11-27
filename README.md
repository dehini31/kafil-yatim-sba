# كافل اليتيم · Plateforme des cartes d'adhérents

Bureau wilaya de Sidi Bel Abbès — الجمعية الخيرية كافل اليتيم الوطنية.

- Site public : <https://dehini31.github.io/kafil-yatim-sba/> (GitHub Pages, inchangé)
- Carte d'exemple : <https://dehini31.github.io/kafil-yatim-sba/members/preview/>

## Architecture

```
Admin (navigateur) ──HTTPS──▶ Serveur d'administration (Node)  ──commit API──▶ GitHub (main) ──▶ GitHub Pages
  /admin/                      • authentification + sessions                      /members/<slug>/
                               • données privées (.data / DATA_DIR)
                               • photo, QR, PDF (Chromium)
```

- **Site public** : pages statiques. Chaque carte vit à `/members/<slug>/` ; `data/members.json` ne contient que `slug`, `active`, `expiresAt` (pour afficher Actif / Expiré / Désactivé sans republier) et `data/contacts.json` les coordonnées du bureau.
- **Serveur d'administration** (`server/`, dossier `admin/` pour l'interface) : seul composant qui détient des secrets. Il stocke les données administratives dans `DATA_DIR` (`db.json`, `photos/`, `pdf/`, hors dépôt), publie en un seul commit atomique par l'API Git de GitHub, vérifie que l'URL publique sert bien la carte, puis génère QR et PDF.
- Le jeton GitHub n'existe que dans les variables d'environnement du serveur. Rien de secret dans le dépôt ni dans le code frontend. Le public ne peut ni créer ni modifier une carte : toute route `/api` (hors connexion) exige une session valide, vérifiée côté serveur à chaque appel.

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

Variables d'environnement (voir `.env.example`) :

| Variable | Rôle |
| --- | --- |
| `PUBLISHER` | `github` (production) ou `local` (développement : écrit le site dans `SITE_DIR` et le sert sous `/site/`) |
| `GITHUB_TOKEN`, `GITHUB_REPO`, `GITHUB_BRANCH` | Publication. Jeton « fine-grained » limité à ce dépôt, permission **Contents : Read and write** |
| `PUBLIC_BASE_URL` | URL publique du site, terminée par `/` |
| `DATA_DIR` | Disque persistant (à sauvegarder) |
| `ADMIN_URL` | URL du serveur ; en `https://` les cookies sont `Secure` |
| `PORT`, `HOST`, `SESSION_HOURS` | Réseau et durée de session (12 h) |

Le serveur d'administration doit tourner derrière HTTPS (proxy du fournisseur d'hébergement ou Caddy/nginx).

## Déploiement

1. Héberger le serveur (Docker, voir `Dockerfile`) avec un volume persistant monté sur `/data` et les variables ci-dessus.
2. GitHub Pages reste en **Deploy from a branch → main → /(root)**.
3. Créer le premier administrateur (ci-dessous), ouvrir `/admin/`, renseigner **Réglages**.

```bash
docker build -t kafil-admin .
docker run -d --name kafil-admin -p 8787:8787 -v kafil-data:/data --env-file .env kafil-admin
```

Développement local :

```bash
npm install
npm run admin:add -- --email vous@exemple.org --name "Votre nom"
PUBLISHER=local npm start        # http://127.0.0.1:8787/admin/
```

## Ajouter ou retirer un administrateur

Pas d'inscription publique : les comptes se créent en ligne de commande sur le serveur (dans le conteneur : `docker exec -it kafil-admin node server/cli.js …`).

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

17 tests : parcours complet création → publication → scan du QR → page ; PDF 100 × 135, 85,6 × 54 paysage et 120 × 120 (taille réelle, QR décodé depuis le PDF, police arabe, noms longs, champs masqués, format trop petit) ; renouvellement avec QR identique ; désactivation et expiration ; échec et relance sans doublon ; refus des requêtes non autorisées ou forgées ; publieur GitHub contre une API simulée ; interfaces admin et publique à 320/360 px et sur ordinateur. Les fiches de test portent « (TEST) » et n'existent que dans des dossiers temporaires.

## Fichiers

- `templates/member.html`, `assets/render.js` : page publique d'une carte (référencement et Open Graph personnalisés par carte).
- `assets/` : logo, polices Tajawal (OFL), `qrcode.js` (Kazuhiko Arase, MIT).
- `server/print.js` : modèle recto imprimable ; `server/pdf.js` : rendu Chromium ; `server/publisher/` : publication locale ou GitHub.
- Vert `#173F39`, or `#E9BD76`, fond `#F6F5EF`, police Tajawal.
