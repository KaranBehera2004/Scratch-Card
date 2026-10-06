# Lucky Drop scratch-card platform

Manage multiple businesses, branches, business login accounts and one-time scratch-card rewards from one portal. WABA and JustConnect are design references; this project has its own implementation and data.

## Project structure

```
client/       React + Vite frontend
server/       Express API and MongoDB models
api/          Vercel serverless API entry point
netlify/      Netlify function entry point
```

The root `package.json` is the workspace controller. Use root commands such as `npm run dev` and `npm run build`; the frontend package is in `client/package.json`.

## Run locally

```powershell
npm install
npm run dev
```

Copy `.env.example` to `.env` and set `AUTH_SECRET`, `SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_PASSWORD`. Set `IMPACT_VIBES_EMAIL` and `IMPACT_VIBES_PASSWORD` to provision the initial business owner. Open the frontend URL printed in the terminal (normally `http://localhost:5174`; Vite picks the next free port if it is occupied).

The API defaults to port 5051. The client proxies `/api` to that port. The `npm run dev` command must show both `API` and `WEB` processes; running only the frontend will not enable sign-in or card creation. If you change `PORT`, also change the Vite proxy target. Stop the old Scratch-card terminal process before restarting; leave other projects running.

For local development without Atlas, leave `MONGODB_URI` empty. Cards, business records and control settings then persist under the ignored `server/data` directory. Local JSON storage is for development; deployed functions require MongoDB Atlas.

Atlas startup reuses equivalent existing unique indexes even when older deployments used different names, such as `unique_business_id`. It creates missing indexes without dropping or renaming existing ones. A naming-only conflict does not require deleting data or rebuilding your database; restart the development server after updating the code.

## Portal access and controls

The root URL opens the login screen with **Login ID** and Password. Existing email-based accounts can still enter their email in the Login ID field. Super administrators see the platform overview, all businesses and all rewards. **Create business** asks for business details and scratch-card, branch and business-account limits; the server generates a random owner login ID and strong password. A small **Login credentials** popup appears after creation with separate copy buttons and **Copy credentials**. Save the password before closing: it is shown only once, never saved in browser storage or audit logs, and only a salted password hash is persisted. Use **Businesses → Manage** to change limits, business details, password or access status, and **Open workspace** to manage rewards and branches. Login IDs are read-only in Manage. The workspace banner returns to platform management, where Business accounts and the other administrative controls remain available. Sign out is always available in the top bar and sidebar.

Business owners see only their business. The workspace menu contains Overview, Create scratch card, Campaigns, Coupons and Branches; viewers do not see the creation option. Owners and staff administrators manage branches; editors create and manage rewards; viewers can read and export. Separate Scratch cards, Team accounts, Analytics, Plans & limits, Security, Audit and Brand settings sections are not shown in business workspaces. The API checks permissions on every request. The creator's first field selects an active branch (or All branches), replacing the locked From field. The business name stays at the top of previews and the shared page; the branch name appears only inside the scratch-card reward area. The server saves a verified branch-name snapshot and retains business ownership internally; older cards without a snapshot keep their original sender display.

- Scratch cards: live preview, unique coupon codes, WhatsApp/share links, branch assignment, campaign names, optional expiry, enable/disable controls and one-time redemption.
- Card language: the creator has an independent English/Hindi/Telugu selector. It translates built-in labels, default messages and percentage-discount offers, without changing the dashboard language. Custom wording and business/branch names are preserved; enter custom messages in the desired language. The saved language is used by coupon previews and shared cards. The shared card has no recipient language dropdown.
- Business interface language: every business workspace has a top-bar English/Hindi/Telugu dropdown, including workspaces opened by a super administrator. It translates navigation, dashboard metrics, tables, filters, branch dialogs, creation-form labels, notifications and common errors. The browser remembers the selection after refresh. Business-authored names, offers and card content are preserved; the separate Card language selector controls the card itself. The global super-admin pages always use English and have no interface-language dropdown; returning from a business workspace restores the English administrative interface.
- Campaigns: reports group scratch cards by campaign name within each business.
- Coupons: search, filter by status, and export an actual `.xlsx` workbook with English, Hindi or Telugu headings and status labels. Business-authored offer text and coupon identifiers are preserved.
- Branches and business accounts: create, edit, pause and reactivate records; set admin/editor/viewer permissions for additional logins and reset passwords.
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

## Checks

```powershell
npm test
npm run test:ui
```

The API tests use a temporary data directory, covering business isolation, roles, duplicate codes, simultaneous redemption, limits, settings, audit and session revocation. Browser tests use installed Google Chrome and a separate fixture server on port 5099, never the configured Atlas database. They check management flows, mobile layouts, public scratching and workbook contents in all three languages. Screenshots and test reports are ignored by Git.

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

## Deploy to Vercel

The included `vercel.json` builds the Vite frontend, keeps client-side routes working, and sends `/api/*` requests to the Express Vercel Function.

1. Import the complete `Scratch-card` project into Vercel.
2. Add `MONGODB_URI` under **Project Settings → Environment Variables** for Production, Preview, and Development as needed.
3. Optionally add `MONGODB_DB` (the default is `scratch_cards`).
4. Ensure MongoDB Atlas Network Access permits connections from Vercel Functions.
5. Add `AUTH_SECRET`, `SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_PASSWORD`. Add the initial business-owner variables only if you need to provision that account. Use the same authentication variables for Netlify.
6. Redeploy the project.

Do not deploy only the `client/dist` directory because it does not contain the API function.

## Run the production build locally

```powershell
npm run build
npm start
```
