# Lucky Drop scratch-card platform

Create personalised scratch-card links and share them on WhatsApp.

## Run locally

```powershell
npm install
npm run dev
```

Open `http://localhost:5174`. Without environment configuration, cards are stored in `server/data/cards.json`, so the full flow works locally.

The scratch-card frontend uses port 5174 and its API uses port 5050 so it can run alongside the WABA project. The `npm run dev` command must show both `API` and `WEB` processes; running only `npm run dev:client` will not enable card creation.

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

## Run the production build locally

```powershell
npm run build
npm start
```
