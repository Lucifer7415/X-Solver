# MealBridge

MealBridge helps food donors, recipient organizations, and delivery partners coordinate surplus-food rescue from donation through verified delivery.

## Run locally

Requires Node.js 20 or newer. The local demo uses Node.js built-ins and requires no third-party packages.

```powershell
cd mealbridge
npm start
```

Open [http://localhost:3000](http://localhost:3000). The app seeds clearly labeled demo data on first run and persists changes in `data/store.json` (ignored by Git).

To use a different local port or data file, set `PORT`, `HOST`, or `MEALBRIDGE_DATA_FILE` in the process environment. `.env.example` documents the variables; the app intentionally does not parse `.env` files.

### Docker

From this directory, run:

```powershell
docker compose up --build
```

The app is available at [http://localhost:3000](http://localhost:3000); its demo database is stored in the `mealbridge-data` Docker volume.

### Demo accounts

All demo accounts use the password `demo1234`:

| Role | Email |
| --- | --- |
| Administrator | `admin@mealbridge.test` |
| Restaurant / hostel | `donor@mealbridge.test` |
| Food bank / NGO | `recipient@mealbridge.test` |
| Delivery partner | `driver@mealbridge.test` |
| Volunteer | `volunteer@mealbridge.test` |

Demo accounts and data are for local testing only. Passwords are hashed with Node.js `scrypt`; signed-in sessions are random, in-memory, HttpOnly and SameSite cookies. Sessions expire after eight hours and are lost when the process restarts. Login attempts are rate limited in memory.

## Included workflows

- Role-aware login and dashboard navigation.
- Donation creation with expiry, dietary and donor-provided handling fields.
- Demand-aware matching with expiry, distance, dietary, recipient capacity, vehicle-capacity and availability checks; allocations are serialized in the single application process.
- Delivery assignment, status history, recipient confirmation, issue reporting and automatic reassignment when a feasible alternative is available.
- Rule-based surplus estimates with an explicit demo-data confidence label.
- Partner verification, in-app notifications, activity history, profile and vehicle settings, and impact summaries.
- Responsive layouts for desktop and mobile.

## Project structure

- `mealbridge/server/` — dependency-free Node.js HTTP API, validation, session handling, and local JSON persistence.
- `mealbridge/data/` — generated local demo store (not committed).
- `public/` — responsive dashboard and browser client.
- `mealbridge/test/` — API, authorization, allocation, registration, and delivery workflow tests.
- `mealbridge/Dockerfile` and `mealbridge/docker-compose.yml` — local container setup.

## API overview

All API routes return JSON. Sign in at `POST /api/login`; the same-origin browser client stores the HttpOnly cookie. Public routes are `GET /api/health`, `POST /api/login`, `POST /api/register`, and `POST /api/password-reset` (returns `501` because email delivery is not configured). Authenticated routes include:

- `GET /api/session`, `POST /api/logout`, `GET|PUT /api/profile`
- `GET|POST /api/donations`, `POST /api/donations/:id/match`
- `GET /api/deliveries`, `POST /api/deliveries/:id/status`, `POST /api/deliveries/:id/reassign`
- `GET /api/recipients`, `PUT /api/demand`, `POST /api/partners/:id/verify`
- `GET /api/driver-profile`, `PUT /api/driver-profile`
- `GET /api/predictions`, `GET /api/analytics`, `GET /api/notifications`, `POST /api/notifications/read`

## Tests

```powershell
npm test
```

## Demo limits and production follow-up

This repository was an empty ZIP snapshot, so this implementation is a lightweight, integrated local demo—not the production architecture proposed in the shared requirements. It uses a single-process JSON file rather than PostgreSQL/Prisma transactions; there is no separate Python ML service, trained prediction model, real-time GPS, live map/traffic provider, email/password-reset delivery, file upload/proof-of-delivery, external monitoring, or production multi-instance session store. Map positions and route/ETA calculations are illustrative. The prediction baseline is a transparent estimate, not AI. Food storage and safety notes are donor supplied and require independent verification; delivery completion does not certify food safety.

Before real operations, migrate to a transactional database, add robust account recovery and verification workflows, integrate configured mapping/email/storage services, strengthen monitoring and operational security, and review applicable food-safety and privacy requirements. The local JSON store and seeded credentials are not suitable for production or concurrent multi-process deployments.