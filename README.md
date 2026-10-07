# Lucky Drop scratch-card platform

Manage multiple businesses, branches, business login accounts and one-time scratch-card rewards from one portal. WABA and JustConnect are design references; this project has its own implementation and data.

## Project structure

```
client/       React + Vite frontend
server/       Express API and MongoDB models
shared/       Shared validation and public URL helpers
api/          Legacy Vercel serverless API entry point
netlify/      Netlify function entry point
```

The root `package.json` is the workspace controller. Use root commands such as `npm run dev` and `npm run build`; the frontend package is in `client/package.json`.

## Run locally

```powershell
npm install
npm run dev
```

Copy `.env.example` to `.env` and set `AUTH_SECRET`, `SUPER_ADMIN_LOGIN_ID` and `SUPER_ADMIN_PASSWORD`. `SUPER_ADMIN_EMAIL` remains supported for existing installations. Set `IMPACT_VIBES_EMAIL` and `IMPACT_VIBES_PASSWORD` to provision the initial business owner. Open the frontend URL printed in the terminal (normally `http://localhost:5174`; Vite picks the next free port if it is occupied).

The API defaults to port 5051. The client proxies `/api` to that port. The `npm run dev` command must show both `API` and `WEB` processes; running only the frontend will not enable sign-in or card creation. If you change `PORT`, also change the Vite proxy target. Stop the old Scratch-card terminal process before restarting; leave other projects running.

For local development without Atlas, leave `MONGODB_URI` empty. Cards, business records and control settings then persist under the ignored `server/data` directory. Local JSON storage is for development; deployed functions require MongoDB Atlas.

Atlas startup reuses equivalent existing unique indexes even when older deployments used different names, such as `unique_business_id`. It creates missing indexes without dropping or renaming existing ones. A naming-only conflict does not require deleting data or rebuilding your database; restart the development server after updating the code.

## Portal access and controls

The root URL opens the login screen with **Login ID** and Password. Existing email-based accounts can still enter their email in the Login ID field. Super administrators see the platform overview, all businesses and all rewards. **Create business** asks for business details and scratch-card, branch and business-account limits; the server generates a random owner login ID and strong password. A small **Login credentials** popup appears after creation with separate copy buttons and **Copy credentials**. Save the password before closing: it is shown only once, never saved in browser storage or audit logs, and only a salted password hash is persisted. Use **Businesses → Manage** to change limits, business details, password or access status, and **Open workspace** to manage rewards and branches. Login IDs are read-only in Manage. The workspace banner returns to platform management, where Business accounts and the other administrative controls remain available. Sign out is always available in the top bar and sidebar.

Business owners see only their business. The workspace menu contains Overview, Create scratch card, Campaigns, Coupons and Branches; viewers do not see the creation option. Owners and staff administrators manage branches; editors create and manage rewards; viewers can read and export. Separate Scratch cards, Team accounts, Analytics, Plans & limits, Security, Audit and Brand settings sections are not shown in business workspaces. The API checks permissions on every request. The creator's first field selects an active branch (or All branches), replacing the locked From field. The business name stays at the top of previews and the shared page; the branch name appears only inside the scratch-card reward area. The server saves a verified branch-name snapshot and retains business ownership internally; older cards without a snapshot keep their original sender display.

- Scratch cards: live preview, unique coupon codes, WhatsApp/share links, branch assignment, campaign names, optional expiry, enable/disable controls and one-time redemption.
- Card language: the creator has an independent English/Hindi/Telugu selector. It translates built-in labels, default messages and percentage-discount offers, without changing the dashboard language. Custom wording and business/branch names are preserved; enter custom messages in the desired language. The saved language is used by coupon previews and shared cards. The shared card has no recipient language dropdown.
- Business interface language: every business workspace has a top-bar English/Hindi/Telugu dropdown, including workspaces opened by a super administrator. It translates navigation, dashboard metrics, tables, filters, branch dialogs, creation-form labels, notifications and common errors. The browser remembers the selection after refresh. Business-authored names, offers and card content are preserved; the separate Card language selector controls the card itself. The global super-admin pages always use English and have no interface-language dropdown; returning from a business workspace restores the English administrative interface.
- WhatsApp number: required for single-card creation; optional for bulk generation. Numbers are validated in both the form and API and saved privately beside their coupons in authorized Coupons/Scratch cards lists. Enter a 10-digit Indian mobile number (automatically prefixed with `+91`) or a full international number with country code. Spaces, parentheses and hyphens are removed. The single-card field clears after creation to avoid reusing the previous recipient's number. Numbers never appear in previews, public card responses or claim responses; cards without a number show a dash. The existing storage field is retained for compatibility.
- Direct send: beside Create scratch-card link, this action creates the card and opens the entered customer's WhatsApp chat with the new link prefilled. A blank tab is reserved during the click to avoid popup blocking; it closes if creation fails. If WhatsApp cannot open, the result popup provides a manual Share on WhatsApp retry without creating another card. The regular Create link action opens only the result popup, whose WhatsApp action also targets the entered number. Review the message and confirm Send in WhatsApp; this is not an automatic WhatsApp API sender.
- Campaigns: reports group scratch cards by campaign name within each business, with separate branch rows showing created-card totals, redeemed totals and conversion rates. All branches is a separate bucket for cards with no specific branch; these cards are not counted again under every branch. A total scratch-card summary includes all campaigns, and authorized business users can open the card creator from Campaigns. Branch names are searchable. Export campaigns downloads the currently searched rows as a real `.xlsx` workbook with translated headings, numeric card/redemption counts and percentage conversion cells.
- Coupons: search, filter by status, and export an actual `.xlsx` workbook with English, Hindi or Telugu headings and status labels. The table and workbook include the WhatsApp number and expiry date; cards without an expiry show No expiry. Business-authored offer text and coupon identifiers are preserved.
- Coupon filters: use the dedicated WhatsApp-number search (full number or partial digits), branch and campaign dropdowns, and creation-date ranges: All time, Today, Last 7 days, Last 30 days or Custom dates. Custom From/To dates are inclusive local calendar days and support one-sided ranges. Invalid reversed ranges show an error and disable export. All filters combine with the existing text search and coupon status; Excel exports only matching rows. No specific branch finds unassigned cards, while Any branch removes branch filtering. Clear filters resets all selections and searches; the Refresh data button retains them. Filter labels are translated and controls stack on mobile. The same controls are available on the super-admin Scratch cards page, with business-qualified branch names.
- Branches and business accounts: create, edit, pause and reactivate records; set admin/editor/viewer permissions for additional logins and reset passwords.
- Branch export: Export branches downloads the visible, searched branch rows as an `.xlsx` workbook with branch name, business, address and access status. Business workspaces export only their own branches; super administrators can export across businesses. Headings and status labels follow the interface language, while business-authored names and addresses are preserved.
- Generated accounts: additional business accounts also receive random login IDs and passwords in the one-time credentials popup. The API retains compatibility with older email/password provisioning clients; the new creation forms always generate credentials.
- Super admins: the global **Super admins → Create super admin** action creates additional full-access platform administrators with generated credentials. Only an authenticated super administrator can list or create these accounts. Other super admins can be paused/reactivated; you cannot pause yourself or the primary account. Password changes update the signed-in account only and revoke its existing sessions. The initial environment-configured super-admin credentials remain unchanged; `SUPER_ADMIN_LOGIN_ID` optionally replaces `SUPER_ADMIN_EMAIL` for that bootstrap account.
- Business limits: configure allowances directly when creating or managing each business. New businesses default to 100 scratch cards, 2 branches and 1 account. The account count includes the owner login. Zero means unlimited; all existing records, including paused accounts and redeemed cards, count toward their respective totals. Reducing a limit never deletes records. Only the super administrator can change these limits. The plans/billing screen and subscription selection have been removed.
- Analytics: actual card counts, redemption rates, seven-day activity and branch performance.
- Security: change passwords, revoke other sessions and suspend account access. Password changes sign out existing sessions. The latest 2,000 administrative audit events are retained.
- Platform settings: portal name, support email/website, login welcome message, default card/branch/account allowances for new businesses, session duration, business-access switch and card-creation switch. New-business defaults initially use 100 cards, 2 branches and 1 account; changing these prefills the creation form but never changes existing businesses. Support links accept only HTTP(S) URLs without credentials. Only super administrators can save settings.
- Appearance: the dashboard top bar switches between light and dark mode and remembers the choice in this browser. Card themes continue to use their own colors. The super-admin overview includes a total scratch-card count across all businesses, and Scratch cards is the single global rewards menu; business workspaces retain their Coupons menu.
- Delete business: super administrators can delete a workspace from Businesses by typing its exact name. Deletion archives the workspace and its records for recovery, hides its cards, branches and login accounts from the portal, and disables sessions and public scratch-card links. Archived records remain in storage and do not contribute to dashboard totals; the seeded Impact Vibes workspace is not recreated after deletion. No existing workspace is deleted automatically by this update.
- Delete all businesses: the Businesses page has a top action beside Create business. It requires typing `DELETE ALL BUSINESSES` and confirms the exact business list; if that list changes, refresh and confirm again. It uses the same archival behavior as individual deletion.
- Navigation: the current section and selected business are saved in the URL, so refreshing reopens the same page instead of resetting to Overview.

Existing businesses retain their saved allowances through a compatibility read of legacy plan data until their limits are saved directly in **Manage business**. Businesses that previously had no plan remain unlimited until edited. Legacy staff allowances are converted to total account allowances by including the owner login; unlimited stays unlimited. Initial owner credentials are seeded once; restarting does not overwrite a password changed in the portal. Super-admin password changes are stored in the database and take precedence over the original environment password.

## Branch-wise bulk generation

Open **Create scratch card → Bulk Generate**. The shared language, message, offer, details, optional claim URL, campaign, expiry and card theme apply to newly generated coupons. Add distinct active branches and positive whole-number quantities; every new branch row defaults to 25. Use a row's Preview button to view that branch's card. The business name remains at the top and the verified branch name appears inside the reward. WhatsApp assignment is optional and never displayed publicly; when supplied it applies to the coupons in that generation. Single Card retains its required WhatsApp and Direct send flow.

**+ Add Branch** adds an existing, unused active branch to the draft; each branch can appear only once. If the business has only one active branch, that button cannot add a duplicate. Administrators can use **Create new branch** beside it to open the existing branch dialog without leaving the draft. Saving adds the persisted branch as a 25-coupon row (or fills an empty row while keeping its quantity), preserving shared fields and other rows. **Manage branches** opens branch management. Existing business branch limits still apply, and the page explains when the allowance is reached.

The form stays editable after successful generation. Add another branch and generate again using the same draft. Each quantity is the **total wanted for that branch in this draft**: if Sales already has 25 coupons, adding Service with 25 generates only the 25 Service coupons. Increasing Sales to 30 generates only five additional Sales coupons. Generated/remaining counts appear beside rows and in the summary; the button counts only remaining coupons. Removing/re-adding a row does not forget that branch's saved coupons. You cannot lower its target below the saved count. Changes to shared offer fields apply only to new coupons; existing coupons retain their original details.

Each generation is limited to 1,000 **new** coupons and must fit the business's remaining card allowance. A continuous draft can accumulate multiple successful generations. Each generation remains all-or-nothing: validation, capacity or storage failures save zero new coupons, preserving previously saved generations. MongoDB transactions commit the new coupons and unique batch retry key together. Both single and bulk creators serialize capacity checks by updating the same business document inside the transaction. Local development uses the existing serialized, atomic JSON replacement; use only one API process with local JSON storage.

Repeated clicks are disabled while saving. The browser stores the exact pending generation request and retry key in session storage until it receives confirmation. After a lost response or refresh, **Retry saved batch** returns the already-saved coupons without creating duplicates; those coupons merge into the existing draft results once. API clients must reuse `idempotencyKey` when retrying `POST /api/cards/bulk`; reusing it with different details returns a conflict. The authenticated response includes the actual `savedCount` and every saved coupon.

Only saving, recovery reads, and pending unconfirmed requests temporarily lock the creation fields. Successful generation immediately unlocks them; no reset is needed to add another branch. **Start new draft** is an optional separate action for deliberately clearing the current result grouping and starting fresh targets. It never deletes saved coupons. The current shared fields, quantity rows, preview branch and all successful generation IDs persist in this tab's session storage. Refresh reloads every generation through the scoped authenticated API before allowing more generation. A failed/incomplete recovery stays locked and offers retry, so missing counts cannot silently produce duplicates.

Results combine every saved generation from the same draft, with branch filtering, 25-row pagination and copy-link actions. **Download Excel** always exports every coupon in the draft, including earlier generations, filtered-out branches and other pages. The `.xlsx` columns are Branch, Coupon Code, Main Offer, Offer Details, Campaign Name, Scratch Link, Expiry Date, Status and Created At. Codes and links are explicitly stored as text; timestamps use ISO format and missing expiry is blank.

### Share a batch Excel file through WhatsApp

The Excel-import section has been removed from the creation page. In **Generated coupons**, click **Send via WhatsApp**, enter the **Recipient WhatsApp number**, confirm permission to share the coupons/contact details, then choose **Download Excel & open WhatsApp**. A single shared saved number is prefilled when available; mixed or unassigned contacts require you to choose the recipient. The recipient is a delivery target only: changing it does not change any coupon's saved customer assignment.

The app reads **every saved generation in the draft** again through the authenticated API and downloads `whatsapp-coupons-YYYY-MM-DD.xlsx`. It includes **every coupon**, across all generations, branches and pages, with current statuses. If any generation cannot be loaded completely, preparation fails instead of sharing a partial file. Its ten columns are Branch, Coupon Code, WhatsApp Number, Main Offer, Offer Details, Campaign Name, Scratch Link, Expiry Date, Status and Created At. Each row uses that coupon's saved WhatsApp number (blank if none). Phone numbers, codes and links are explicitly Excel Text; timestamps are ISO strings. The separate **Download Excel** action keeps its existing nine-column format.

One WhatsApp chat opens at your chosen number with a short explanation. **Attach the downloaded Excel file manually using WhatsApp's attachment button, then tap Send.** This website cannot attach files or send messages automatically through ordinary WhatsApp. No API sender is configured or required for this manual attachment workflow. You must be signed in to WhatsApp and only share private customer details with an authorized recipient.

If popups are blocked, the Excel download still works; allow popups and use **Open WhatsApp chat** to retry without downloading another file or generating more coupons. API/export failures report an error and close the reserved blank tab. Preparation and repeat-click controls are locked while processing. Sharing never changes scratch/redemption state or claims WhatsApp delivery.

All successful generation IDs remain in tab session storage until **Start new draft**; refreshing restores their saved coupons and current statuses through authenticated reads. Legacy single-batch references are restored too. Pending requests keep their exact payload for idempotent retry, including legacy imported assignments. Removing the import UI does not delete saved numbers/coupons or change those retry requests. Numbers remain absent from public card and scratch responses. No real WhatsApp chats or messages are opened/sent during automated tests.

### Scratching automatically redeems the coupon

The first successful public scratch atomically sets `scratchedAt` and `redeemedAt` to the same timestamp and reveals the code. It immediately counts as **Redeemed** in coupons, campaigns, analytics and Excel exports. There is no separate Scratched status or manual Redeem button. The server records the coupon's stored branch in `redeemedBranchId`; a caller cannot choose another branch. This records online redemption, not proof of a physical branch visit. Disabled/expired coupons and inactive businesses or assigned branches cannot be claimed. Repeated or concurrent claims cannot redeem a coupon twice. Reopening a consumed link shows the already-used screen. The old manual redemption endpoint returns HTTP 410 for authorized callers without changing any record. Coupon lists and reports refresh activity every 10 seconds while visible and when returning to the tab.

Super administrators can go to **Businesses → Reset password** to set and confirm a new owner password without knowing the old one. The login ID stays unchanged. Existing owner sessions are invalidated, only the password hash is stored, and the reset is recorded in the audit log without the password. Business owners and staff cannot use this administrator reset flow.

The platform-level **Campaigns**, **Scratch cards**, and **Branches** pages are intentionally broader than a business workspace. Super administrators can filter across businesses, see business and branch context together, review branch coupon/redemption totals, export the filtered platform data, pause or edit branches, disable available coupons, and open the selected business workspace directly. A business account sees only its own campaigns, coupons, and branches and never receives the cross-business filter or management links.

Business owner login IDs are visible to super administrators and can be copied. Existing passwords cannot be displayed: passwords are stored only as one-way hashes. If a password is forgotten, use **Reset password** to assign a new one; there is no secure way to recover the previous plaintext password.

### Migration and deployment

Restart the updated API locally or redeploy the complete project. Startup automatically adds the missing unique slug and batch-key indexes, the batch lookup index and backfills `scratchedAt` from legacy `redeemedAt`. It also converts existing scratched-but-unredeemed coupons to redeemed using their original scratch timestamp and assigned branch, including old disabled/expired records that were already scratched. Existing redemption timestamps are preserved; no cards are deleted or reactivated. This migration applies to MongoDB and local JSON storage and is safe to rerun. Existing equivalent uniquely named indexes are reused. MongoDB must support transactions (Atlas or a replica set); a standalone MongoDB instance is not supported for generation. Back up production data before deploying migrations. Tests use isolated local fixtures, not your configured production Atlas database.

## Checks

```powershell
npm test
npm run test:ui
```

The API tests use a temporary data directory, covering business isolation, roles, duplicate codes, simultaneous redemption, limits, settings, audit and session revocation. Browser tests use installed Google Chrome and a separate fixture server on port 5099, never the configured Atlas database. They check management flows, mobile layouts, public scratching and workbook contents in all three languages. Screenshots and test reports are ignored by Git.

## Responsive layout checks

The browser suite checks login, super-admin pages, business forms, dialogs, previews and public cards at 320, 360, 390, 430, 600, 768, 820, 844, 1024, 1440 and 1920 pixels wide, including phone landscape. It checks page overflow, dialog bounds, translated controls and mobile navigation keyboard behavior. Small-screen tables become labeled rows; wider tables keep contained horizontal scrolling. The navigation drawer locks background scrolling, supports Escape and returns keyboard focus when closed. These are browser viewport checks, not a guarantee for every physical device or browser engine.

## Use MongoDB Atlas

1. Create an Atlas database and database user.
2. Copy `.env.example` to `.env`.
3. Replace `MONGODB_URI` with the Atlas connection string.
4. Restart `npm run dev`.

The API automatically uses Atlas when `MONGODB_URI` is present. MongoDB Compass is not required.

## Deploy to Netlify

The included `netlify.toml` builds the React site and deploys the Express API as a Netlify Function.

1. In Netlify, open **Site configuration → Environment variables**.
2. Add `MONGODB_URI` with your MongoDB Atlas connection string.
3. Optionally add `MONGODB_DB` (the default is `scratch_cards`).
4. Ensure MongoDB Atlas Network Access allows connections from your deployed Netlify Function.
5. Trigger a new Netlify deploy. The build command and publish directory are already configured.

The generated share link will automatically use your Netlify domain, such as `https://your-site.netlify.app/card/abc123`. Cards created only in the local JSON file are not copied to Atlas; cards created on the deployed site are stored in Atlas.

## Production: Vercel frontend and Render API

| Service | Production URL |
| --- | --- |
| Website and scratch-card links | `https://scratch.justconnect.biz` |
| API server | `https://api-scratch.justconnect.biz` |
| API health check | `https://api-scratch.justconnect.biz/api/health` |
| Frontend proxy health check | `https://scratch.justconnect.biz/api/health` |

The frontend calls relative `/api/*` paths. `client/vercel.json` forwards those requests to `https://api-scratch.justconnect.biz/api/*`, keeping login and card requests on the frontend's origin in the browser. The root `vercel.json` uses the same API destination for builds from the repository root. Both disable caching of API responses and retain the SPA fallback for `/card/:slug`. Do not remove the `/api` prefix from the destination or replace the local Vite proxy with the production database/API.

### Render backend

1. Connect the repository's production branch. Leave **Root Directory** empty; use **Build Command** `npm ci` and **Start Command** `npm start`.
2. Set the environment variables listed in `.env.production.example` in Render's **Environment** settings. In particular, set `CLIENT_ORIGIN=https://scratch.justconnect.biz`, `NODE_ENV=production`, and `NODE_VERSION=24.x`. Render supplies `PORT`.
3. Keep your existing MongoDB URI/database, auth secret and super-admin credentials. A domain change does not require creating a database or resetting users. An account password already changed in the portal still takes precedence over its bootstrap environment password.
4. Under **Settings → Custom Domains**, add `api-scratch.justconnect.biz` and configure the DNS record requested by Render. Wait for domain verification and HTTPS. Keep MongoDB Atlas Network Access configured to allow the Render service.
5. Set **Health Check Path** to `/api/health`, then deploy. The API root `/` does not host the frontend; use the health-check URL above to verify the backend. The JSON must show `"ok":true` and `"storage":"mongodb-atlas"`.

### Vercel frontend

1. Set **Root Directory** to `client`, **Framework Preset** to Vite, **Build Command** to `npm run build`, **Output Directory** to `dist`, and Node.js to `24.x`. Leave the install command automatic.
2. Enable **Include files outside the root directory in the Build Step**, because the client imports `shared/` modules.
3. Add `scratch.justconnect.biz` under **Settings → Domains** and configure the DNS record requested by Vercel. Wait for verification and HTTPS. Keep previous domains active if customers still have links using them.
4. Commit the configuration and push/merge it into the production branch, then wait for the deployment to be **Ready**. A redeploy of an older commit does not include new files.
5. Open the frontend proxy health URL above, then sign in and check existing businesses/coupons. Vercel's frontend does not need database credentials or an auth secret; those belong on Render. No `VITE_API_URL` setting is required.

`shared/urls.js` defines the public app/API addresses. Single-card sharing, copy-link actions, WhatsApp messages and Excel exports use the app domain on production and Vercel aliases/previews. Existing coupon slugs, codes and database records stay unchanged. Localhost and LAN builds keep local card links, so local tests never direct recipients to the production app. Alternative self-hosted/Netlify domains continue to use their own origin.

Preview deployments also proxy to this production API and share its data. Use a separate API/database and corresponding configuration if isolated staging is required. The tracked `.env.production.example` is only a reference: editing it does not update Render's saved environment variables. Keep `.env` configured for local development and do not commit its secrets.

## Run the production build locally

```powershell
npm run build
npm start
```
