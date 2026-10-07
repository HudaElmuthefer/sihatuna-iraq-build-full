# SIHATUNA IRAQ ERP — Production Release

A self-contained, ready-to-run copy of SIHATUNA IRAQ ERP. Everything needed
to run it is already inside this folder — no `npm install`, no separate
Node.js installation, and no development tooling.

## What's inside

```
backend/            Backend source + production dependencies (pre-installed)
frontend/build/     Pre-built frontend (static files) + a small static server
database/           Base PostgreSQL schema
node-runtime/        Portable Node.js — every script here uses this, not any
                     Node.js you may already have installed
start.bat / stop.bat Launcher scripts
logs/                Created automatically on first start
```

## Requirements

- Windows x64.
- A PostgreSQL 18 server already installed and reachable (not included —
  see `backend/.env.example` for connection settings). Nothing else to
  install: Node.js is bundled, and all backend dependencies are already
  installed inside `backend/node_modules`.
- Redis is optional — only the AI prescription-reader's background queue
  needs it; everything else works without it.

## Deploy

1. Copy this entire folder to the target server.
2. In `backend/`, copy `.env.example` to `.env` and fill in real values —
   at minimum `PG_HOST`/`PG_PORT`/`PG_USER`/`PG_PASSWORD`/`PG_DATABASE`
   (pointing at your PostgreSQL server), `JWT_SECRET`, and
   `CREDENTIALS_ENCRYPTION_KEY`. Every variable is explained inline in that
   file. Never commit the real `.env` — it's already excluded by
   `.gitignore`.
3. Double-click `start.bat`.

On first start, the database schema is created automatically and a single
admin account is created with a randomly generated password, printed once
to the console — **copy it immediately, it will not be shown again.** A
password change is required the first time that account logs in. (If you
set `ADMIN_USERNAME`/`ADMIN_PASSWORD` in `.env` before the first start
instead, that account is created with those values rather than a random
password — still with a forced password change on first login.)

`start.bat` waits until both the backend (port 8000) and the frontend
(port 3000) respond, then opens the browser automatically. If a port is
already in use, `.env` is missing, or the database can't be reached, it
prints a clear message explaining which and exits without leaving anything
half-started.

## Stop

Double-click `stop.bat`. Stops both processes cleanly and frees ports 8000
and 3000.

## Update

This is a snapshot release — to deploy a newer version, build a new release
folder the same way and replace the old one (keep the old `backend/.env`
and reuse it; the database itself is untouched by a folder swap). There is
no in-place auto-update mechanism.

## Logs

Written to `logs/`: `backend.log`, `backend-error.log`, `frontend.log`,
`frontend-error.log`. Each is capped at 10 MB — `start.bat` rotates one
backup copy (`<name>.old`) the next time it starts if a log has grown past
that, so disk usage stays bounded without needing a separate log-management
tool.
