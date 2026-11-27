# كافل اليتيم · بطاقات الأعضاء الرقمية

Digital member cards for الجمعية الخيرية كافل اليتيم الوطنية, Sidi Bel Abbès regional office.

- [Public site](https://dehini31.github.io/kafil-yatim-sba/)
- [Clearly labeled sample](https://dehini31.github.io/kafil-yatim-sba/members/preview/)
- [Member card generator](https://dehini31.github.io/kafil-yatim-sba/generator/)

The site is static and uses GitHub Pages on the public repository. All public assets, including the logo, Tajawal fonts and QR library, are served locally. GitHub account permissions control repository changes. The generator works in the browser and exports files; it does not upload photos, store tokens, or sign into GitHub.

## Preview locally

From the repository root run `python3 -m http.server 8109`. Open `http://localhost:8109/` or `/generator/` on that server. Directory URLs work on Pages because every published card has its own `index.html`.

## Add a member

1. Open the generator. Enter the approved Arabic full name and role, select an approved JPEG, PNG or WebP portrait, and check the preview.
2. Keep the suggested lowercase slug or enter your own, such as `president`. A slug is permanent once shared. The generator checks the current registry for duplicates and reserves `preview`.
3. Export and extract the ZIP. It contains an updated `data/members.json`, the optimized photo at `assets/members/<slug>.jpg`, and the static page at `members/<slug>/index.html`.
4. With an authorized GitHub account, commit the three changes together to `main`. Use Git from a fresh clone, or GitHub's **Add file → Upload files** with the extracted directory structure. Submit the extracted files, not the ZIP. If someone added a member after you exported, merge the new entry into the latest registry or export again; keep existing entries.
5. Wait for **Actions → pages build and deployment**, open the card directly, then use the card or generator to download its QR PNG. Test the QR against the final URL before printing.

## Edit or deactivate a member

- Edit the corresponding entry in `data/members.json`. Keep the existing ID and slug. If replacing a photo, update the file at the existing path or update the JSON photo path.
- Run `node scripts/render-members.js` with Node.js 18+ from a local clone, then commit the JSON, generated page and changed photo together. The script reuses the same template as the browser generator and validates all records before writing. Without Node.js, use GitHub's editor to update both the JSON and the matching HTML, including its metadata.
- To deactivate, set `active` to `false` and run the same script or delete `members/<slug>/index.html` in the same commit. Removing the static page prevents direct HTTP access after deployment. The registry also disables sharing if an old page is still open. Public repository history and previously shared copies can retain old content.
- To reactivate, restore the approved photo if it was removed, set `active` to `true`, then regenerate and commit.
- Do not commit personal information or photographs without approval for publication. Both files and history in this public repository are publicly accessible.

## Update regional contacts

Edit only `data/contacts.json`. Once GitHub Pages deploys the edit, all cards load the same configuration automatically.

| Key | Expected value |
| --- | --- |
| `phone` | Official phone in international form, e.g. with `+213` |
| `whatsapp` | Official WhatsApp number in international form |
| `facebook`, `instagram` | Official profile URLs using HTTPS |
| `email` | Official office email |
| `maps` | Verified Google Maps HTTPS link |
| `address` | Office street address, shown as a Maps link |
| `hours` | Opening days and hours, shown as text |
| `nationalWebsite` | National association HTTPS website |

Empty and malformed contact methods are omitted. Office hours are informational. The national site is the only contact filled at launch.

## Deployment and files

In GitHub, open **Settings → Pages** and select **Deploy from a branch**, **main**, and **/(root)**. The `.nojekyll` file enables direct static hosting. If the domain or repository path changes, update `data/site.json` and the home page metadata, then regenerate member pages and any printed QR codes.

- `templates/member.html` and `assets/render.js` generate static cards and personalized SEO and Open Graph metadata.
- `assets/style.css` and `assets/common.js` are shared across the site.
- `data/members.json` is the central registry. The preview example is separate from member records and marked noindex.
- `assets/qrcode.js` is QR Code Generator by Kazuhiko Arase (MIT). `assets/fflate.js` is fflate (MIT). Tajawal is distributed under the SIL Open Font License.
