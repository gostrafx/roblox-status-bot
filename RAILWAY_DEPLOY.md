# Deploying the bot on Railway

## 1. Prepare the repo
Put these files in a GitHub repo (or a local folder if you're using the CLI):
- `index.js`
- `db.js`
- `package.json`
- `railway.json`
- `.gitignore`
- (do NOT commit `.env` or `games.db*` — already excluded by `.gitignore`)

## 2. Create the Railway project
1. Go to https://railway.app → **New Project**
2. Pick **Deploy from GitHub repo** (connect your repo) — or **Empty Project** and use the Railway CLI (`railway up`) if you'd rather skip GitHub.
3. Railway auto-detects Node.js via `package.json`, runs `npm install`, then the start command defined in `railway.json`.

## 3. Set environment variables
In Railway → your service → **Variables** tab, add (see `.env.example`):

| Variable        | Value                                   |
|------------------|------------------------------------------|
| `DISCORD_TOKEN`  | Bot token (Developer Portal → Bot)       |
| `CLIENT_ID`      | Application ID (Developer Portal)        |
| `GUILD_ID`       | Your Discord server ID                   |

Tracked games (name, universeId, placeId, channel, interval) aren't hardcoded — you add them straight from Discord with `/addgame`, `/removegame`, and `/setinterval` (see below).

## 4. Persistent storage (important)
The bot uses **SQLite** (`games.db`, via `better-sqlite3`) to store tracked games. It's stored on the container's local disk, and **Railway's disk is ephemeral by default**: on every redeploy, the database resets and you'll need to re-run `/addgame` for every game.

To make it persist across deployments:
1. In your Railway service → **Settings** → **Volumes** → **+ New Volume**
2. Mount path: `/data`
3. Add the environment variable:
   ```
   DB_FILE_PATH=/data/games.db
   ```
   (the code already reads this variable in `db.js` — nothing else to change)

   If you skip this, the bot still works fine — you'll just need to redo `/addgame` for each game after a redeploy.

**Note on Nixpacks**: `better-sqlite3` compiles a native module during `npm install`. Nixpacks (Railway's default builder) already includes the necessary build tools (Python, make, gcc), so `npm install` works with no extra config. If the build fails with a compile error, check in Railway → Settings that the builder is set to **Nixpacks** (not a custom Dockerfile missing build tools).

**Note on deploys**: by default, Railway briefly runs the old and new container side by side during a redeploy (zero-downtime deploy). With a single SQLite file on a single Volume, that means two processes could write to the database at the same time. `railway.json` already sets `"overlapSeconds": 0`, which forces Railway to stop the old container before starting the new one — so there's never a concurrent write to `games.db`.

## 5. Automatic retries
If a call to the Roblox API fails (network hiccup, timeout, rate limit, temporary 5xx), the bot automatically retries up to **3 times** with exponential backoff (2s → 4s → 8s) before giving up and logging the final error. You'll see this in the logs as:
```
[Casbah] Attempt 1 failed (Roblox API error: 429), retrying in 2000ms...
[Casbah] Attempt 2 failed (Roblox API error: 429), retrying in 4000ms...
```
If all retries fail, the game's status message simply isn't updated that cycle — it'll try again on the next scheduled interval. No extra config needed.

## 6. Deploy
- With GitHub: every `git push` triggers an automatic redeploy.
- With the CLI: `railway up` from the project folder.

## 7. Verify
In Railway **Logs**, you should see:
```
Logged in as YourBot#1234
Commands registered on the server (instant).
```
Then, in Discord, run `/addgame` to start tracking a game.

## 8. Available commands
- `/addgame name:<text> universe_id:<id> place_id:<id> channel:<#channel> [interval_minutes:<n>]` — tracks a new game, posts its status immediately in the chosen channel (with the game's Roblox icon as thumbnail).
- `/removegame name:<text>` — stops tracking a game (autocomplete available).
- `/setinterval name:<text> interval_minutes:<n>` — changes how often a tracked game's status is refreshed.
- `/listgames` — lists all tracked games, their channels, and update intervals.
- `/joinvoice channel:<#voice-channel>` — bot joins and stays in that voice channel 24/7. Auto-reconnects if disconnected, and auto-rejoins the same channel after a bot restart (saved in the database).
- `/leavevoice` — bot leaves the voice channel.

Each tracked game has its own message and its own independent update timer.

## 9. Notes on 24/7 voice presence
- The bot joins self-muted and self-deafened (`selfMute: true`, `selfDeaf: true`) — it doesn't play or listen to any audio, it just occupies the channel.
- If Discord drops the connection (network blip, Discord restart, etc.), the bot automatically attempts to rejoin the same channel after a short delay.
- The target voice channel is saved in the database (`settings` table), so after a Railway redeploy or crash, the bot automatically rejoins on startup — **as long as you're using a persistent Volume** (see section 4). Without a Volume, you'll need to re-run `/joinvoice` after each redeploy.
- `libsodium-wrappers` is a pure-JS/WASM encryption library (no native compilation needed), used by `@discordjs/voice` to encrypt the voice connection — required even though the bot never sends audio.
