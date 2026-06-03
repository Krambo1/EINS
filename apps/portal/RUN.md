# Portal — How to start it

Run order from a cold boot.

## 0. Open a terminal in the project folder
Open powershell as admin, then `cd D:\Desktop\EINSWebsite`.

Every command below runs in that terminal. When a step says "open a second
terminal", open another PowerShell window the same way.

> ℹ️ **How to read code blocks below:** the word at the top (`powershell`) is
> just a label for syntax coloring — **do not type it**. Only type the lines
> inside the box.

## 1. Start Docker Desktop

## 2. Bring up Postgres + Dev-Server

```powershell
pnpm db:up
pnpm db:migrate    # applies 0042_password_auth.sql on first run after the rewrite
pnpm db:seed       # optional — only needed once to populate demo data
pnpm dev:portal
```

Containers persist across reboots, so step 1 + db:up usually says "already up".
That's fine. Wait for `✓ Ready in Xs`. **Leave the dev-server terminal open** —
console-driver emails print here, and closing it kills the server.

## 3. Open the admin portal in your browser
**http://admin.localhost:3001/login**

> ⚠️ **NOT** `localhost:3001/admin/login` — that 404s. The middleware only allows
> `/admin/*` when the hostname starts with `admin.`. Browsers auto-resolve
> `*.localhost` to 127.0.0.1, so no hosts-file edit is needed.

## 4. Anmelden

Default-Pfad: **E-Mail + Passwort**.

- **Admin (Karam):** `karam8issa@gmail.com` + Passwort, das beim ersten Versuch
  per Mail an dich rausging. Falls noch keins gesetzt: einfach Email + irgendein
  Passwort eingeben → das System schickt automatisch einen *Set-Password*-Link
  in deine Inbox (im console-driver erscheint er hier im Terminal).
- **Clinic-User (Demo-Seed):** `inhaber@praxis-demo.de` / `marketing@praxis-demo.de`
  / `frontdesk@praxis-demo.de`, Passwort jeweils **`DemoPasswort123!`** (siehe
  `src/db/seed.ts` → `DEMO_PASSWORD`).

Kein TOTP / Authenticator-App mehr. Admin-Schutz: Allowlist (`ADMIN_EMAILS`)
plus optionale IP-Allowlist (`ADMIN_IP_ALLOWLIST`).

### Fallback-Pfade
- **"Passwort vergessen"** unter dem Login-Formular → Email-Link → neues
  Passwort setzen.
- **"Lieber per E-Mail-Link anmelden"** unter dem Formular → klassischer
  Magic-Link-Flow (für Cases wo das Passwort gerade nicht zur Hand ist).

## 5. Magic-Link aus dem Terminal abgreifen (Dev)
Wenn ein Set-Password / Reset / Login-Link verschickt wird, taucht im
`pnpm dev:portal` Terminal ein `─────` Banner mit einer URL auf:
```
http://admin.localhost:3001/admin/set-password?token=...
```
Klicken oder kopieren → die Page erlaubt das Passwort zu setzen.

Magic-Links laufen nach **15 Minuten** ab und sind single-use.

---

## Optional: background worker
Queues + cron run inside the pg-boss worker (Postgres-backed, no Redis). The
worker creates its own `pgboss` schema on first boot. In a second terminal:
```powershell
pnpm dev:worker
```

## Daily reference
| URL | What |
|---|---|
| http://admin.localhost:3001/login | Admin-Login (Email + Passwort) |
| http://admin.localhost:3001/forgot-password | Admin-Passwort vergessen |
| http://localhost:3001/login | Clinic-User-Login (Demo-Seed: `inhaber@praxis-demo.de` / `DemoPasswort123!`) |
| http://localhost:3001/forgot-password | Clinic-Passwort vergessen |
| http://localhost:3001/einstellungen/sicherheit | Passwort + Session-Verwaltung |
| http://localhost:3000 | Marketing site (`pnpm dev:website`) |

## Stopping
- Ctrl+C in the dev-server terminal
- `pnpm db:down` to stop containers (or just leave them running)
