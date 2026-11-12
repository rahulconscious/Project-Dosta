# Project Aura: beginner setup guide

Aura is an AI companion website. You only need ONE paid credential: an Anthropic API key.

## 1. Get your API key (the only credential needed)
1. Go to https://console.anthropic.com and create an account.
2. Add a small amount of credit under Billing (chat costs a few cents per conversation).
3. Open "API Keys", create a key, and copy it. Treat it like a password. Never share it or put it in a public place.

## 2. Try it on your computer (optional)
1. Install Node.js version 22.13 or newer from https://nodejs.org (choose the LTS or latest).
2. Unzip this project. Make a copy of `.env.example` and name the copy `.env`.
3. Open `.env` in Notepad/TextEdit and paste your key after `ANTHROPIC_API_KEY=`.
4. In a terminal inside the folder, run: `npm start`
5. Open http://localhost:3000, create an account, and chat.
Check the backend: with the server running, open a second terminal and run `npm test`.

## 3. Put it online so you can open it on your phone
Aura stores data in a small database file, so the host must give it a **persistent disk/volume**. Without one, accounts and memories vanish on every restart. Easiest path (no coding):

**Option A: Railway (https://railway.com)**
1. Create a free GitHub account, make a new PRIVATE repository, and upload every file from this folder (GitHub's "Add file > Upload files"). Do NOT upload a `.env` file.
2. In Railway: New Project > Deploy from GitHub repo > pick your repository. It will detect the `Dockerfile` automatically.
3. Open the service > Variables, and add: `ANTHROPIC_API_KEY` (your key), `NODE_ENV` = `production`, `DB_PATH` = `/data/aura.db`.
4. Service > Volumes > add a volume mounted at `/data`.
5. Service > Settings > Networking > Generate Domain. Open that https:// link on your phone. Done.

**Option B: Render (https://render.com)**: New > Web Service > connect the GitHub repo, runtime Docker, add the same three variables, and add a Disk mounted at `/data`. (Disks require a paid instance.)

Check each host's current pricing; plans change. Use HTTPS links only: phone microphones don't work on plain http.

## 4. On your phone
Open your link in Chrome (Android) or Safari (iPhone), log in, tap "Start voice", and allow the microphone. Use headphones. To make it feel like an app: browser menu > "Add to Home Screen".

## 5. What works
- Without the key: accounts, multiple companions with separate memory, memory editing, diary, goals, privacy tools.
- With the key: conversation, personality, mood reading, auto-memory, stories, greetings.

## Known limits
Voice relies on your phone's built-in speech engine (quality varies; Kannada/Hindi depend on installed voices). Memory search is keyword-based. One server instance only (SQLite). Not yet tested in a real browser by me, so report any problem you see.

## Files
`server.js` backend and AI logic, `schema.sql` database, `public/index.html` the whole interface, `.env.example` settings template, `Dockerfile` for hosting, `test.mjs` backend tests.
