# IIMA MBA Scrapbook Portal

A private end-of-MBA scrapbook portal where users with `@iima.ac.in` accounts can leave text/audio/image posts on each other's pages.

## Features

- Google OAuth login restricted to `iima.ac.in` domain
- Personal scrapbook wall (private visibility to page owner)
- Write flow for others to post on a user's page
- Supported post types: text, image, audio (video blocked)
- Search people by name/email and post on their pages
- QR code for quick sharing of write link
- Light/Dark theme toggle
- Separate statistics page
- Admin dashboard with allowlisted email management
- TT game with global leaderboard
- Admin-gated first-time access request workflow

## Tech Stack

- Node.js + Express
- EJS templates
- SQLite (`better-sqlite3`)
- Passport Google OAuth 2.0
- Multer for file uploads

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create environment variables:

```bash
# edit the existing .env file in project root
```

3. In Google Cloud Console OAuth settings:
- Add authorized redirect URI matching `GOOGLE_CALLBACK_URL`
- Configure your Google Workspace app and ensure only institutional users are allowed

## API Keys / Secrets You Need

1. `GOOGLE_CLIENT_ID`
- Where from: Google Cloud Console -> APIs & Services -> Credentials -> OAuth 2.0 Client IDs
- What to set: client ID of your web OAuth app

2. `GOOGLE_CLIENT_SECRET`
- Where from: Same OAuth client in Google Cloud Console
- What to set: client secret for that OAuth app

3. `SESSION_SECRET`
- Where from: generate locally (example: `openssl rand -base64 48`)
- What to set: long random secret used by `express-session`

## Google Console Setup (Where to Put URLs)

In your OAuth client configuration:
- Authorized redirect URI: value of `GOOGLE_CALLBACK_URL`
  Example local: `http://localhost:3000/auth/google/callback`
- Authorized JavaScript origins:
  Example local: `http://localhost:3000`

Also ensure your OAuth consent/app audience is restricted to your institution users as required by your IIMA admin policy.

4. Run server:

```bash
npm run dev
```

5. Open:

- `http://localhost:3000`

## Notes

- This implementation enforces email ending in `@iima.ac.in` during OAuth callback.
- First-time Google users create an access request; admin approval is required before access.
- Uploaded media is stored in `src/uploads` and served from `/uploads`.
- For production, use a persistent session store and secure cookies.
- Set `ALLOW_DEV_LOGIN=true` only for local development if you need non-OAuth testing.
- Admin master credentials are read from `.env` (`ADMIN_LOGIN_ID`, `ADMIN_LOGIN_PASS`).
