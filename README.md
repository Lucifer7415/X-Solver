# MealBridge

**Every Meal Finds Its Way.** This directory includes the working local demo at its root (`public/` and `server/`) plus the requested frontend/backend/AI-service architectural scaffold.

## Status

The directories `frontend/`, `backend/`, and `ai-service/` mirror the proposed architecture but contain placeholders, not complete implementations. The runnable demo, API, local JSON persistence, and tested delivery flows are `public/`, `server/`, and `test/` in this directory.

To run and test the working demo:

```powershell
cd mealbridge
npm start
npm test
```

Demo sign-in: `admin@mealbridge.test` / `demo1234`. See the repository [`README.md`](../README.md) for implemented workflows and known limitations.

## Target architecture

- `frontend/`: React, TypeScript and Vite application.
- `backend/`: TypeScript REST API with Prisma/PostgreSQL.
- `ai-service/`: FastAPI prediction and allocation service.
- `database/`: SQL bootstrap and seed locations.
- `tests/`: unit, integration and end-to-end test suites.
- `deployment/`: container images, reverse proxy and monitoring configuration.
- `docs/`: architecture, API, schema, role and setup notes.

The Vite starter can be developed with `cd frontend`, `npm install`, `npm run dev`. It proxies `/api` to the demo server at `http://127.0.0.1:3000`; start the demo in a separate terminal first. The backend and AI files are initial scaffolding, not production services. Docker Compose in this directory still starts the tested demo; the proposed multi-service containers are not wired into that compose file.

Before deploying the proposed full-stack architecture, finish the role-specific pages, domain modules, Prisma migrations, AI routes, account recovery, authorization and tests. Review and test container/deployment configuration before using it outside a local demo.
