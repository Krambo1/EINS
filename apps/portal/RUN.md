# Portal — How to start it

Run order from a cold boot.

## 0. Open a terminal in the project folder
Open powershell as admin, then run cd D:\Desktop\EINSWebsite.


Every command below runs in that terminal. When a step says "open a second
terminal", open another PowerShell window the same way.

> ℹ️ **How to read code blocks below:** the word at the top (`powershell`) is
> just a label for syntax coloring — **do not type it**. Only type the lines
> inside the box.

## 1. Start Docker Desktop

## 2. Bring up Postgres + Redis
In the terminal:

pnpm db:up
pnpm dev:portal

Containers persist across reboots, so this usually says "already up". That's fine.

Wait for `✓ Ready in Xs`. **Leave this terminal open** — magic-link emails
print here, and closing it kills the server.

## 4. Open the admin portal in your browser
**http://admin.localhost:3001/login**

> ⚠️ **NOT** `localhost:3001/admin/login` — that 404s. The middleware only allows
> `/admin/*` when the hostname starts with `admin.`. Browsers auto-resolve
> `*.localhost` to 127.0.0.1, so no hosts-file edit is needed.

## 5. Request a magic link
Enter `karam8issa@gmail.com` → click "Anmeldelink senden".

## 6. Get the link from the terminal
Look in the `pnpm dev:portal` terminal for a `─────` banner with a URL like:
```
http://admin.localhost:3001/admin/login/callback?token=...
```
Click it (or paste it into the browser) → you're in.

Magic links expire in **15 minutes** and are single-use. If you missed the
window, request a new one from `http://admin.localhost:3001/login`.

---

## Optional: background worker
For BullMQ jobs / cron (in a second terminal):
```powershell
pnpm dev:worker
```

## Daily reference
| URL | What |
|---|---|
| http://admin.localhost:3001/login | Admin login |
| http://localhost:3001/login | Clinic-user login (needs a real `clinic_users` row) |
| http://localhost:3000 | Marketing site (`pnpm dev:website`) |

## Stopping
- Ctrl+C in the dev-server terminal
- `pnpm db:down` to stop containers (or just leave them running)
