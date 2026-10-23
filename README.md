# Mousejutsu Shenanigans — Online Server Package

This folder contains the actual game website and its Node.js server for accounts and friends.

## Publish it at a public URL (Render)

I cannot create a public URL inside your hosting account without you signing in and authorizing deployment. This package includes `render.yaml` to make the setup easier.

1. Create/sign in to a GitHub account at https://github.com.
2. Create a new repository (for example `mousejutsu-shenanigans`).
3. Upload the **contents of this folder** to the repository root (including `server.js`, `package.json`, `public/`, `data/`, and `render.yaml`). Do not upload only the ZIP file.
4. Sign in at https://render.com and choose **New → Blueprint**.
5. Connect your GitHub repository and deploy the blueprint. Render reads `render.yaml` and creates the Node.js web service.
6. When deployment finishes, open the `onrender.com` URL Render displays. That is your public website URL.

**Cost note:** This configuration uses a Starter web service and a 1 GB persistent disk so account data can survive restarts. Render may charge for these resources; check its current pricing before confirming deployment. Do not share your hosting password or secret keys with anyone.

## Run locally

1. Install Node.js 18 or newer.
2. Open a terminal in this folder.
3. Run `npm start` (no third-party npm dependencies are required).
4. Open `http://localhost:3000`.

## Included

- Server-hosted game page.
- Shared account registration/sign-in; passwords are stored as salted scrypt hashes.
- Server-stored friend lists.
- Existing private-room combat still uses PeerJS/WebRTC peer-to-peer data connections. The package does not run an authoritative dedicated game simulation server.

## Prototype limitation

This is a prototype backend, not a production service. Before broad public use, it should receive a security review and stronger database, moderation, and monitoring features.
