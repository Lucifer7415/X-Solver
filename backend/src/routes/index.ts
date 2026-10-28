import { Router } from "express";

export const router = Router();
router.get("/health", (_request, response) => response.json({ status: "ok" }));

// Domain routes are intentionally not exposed until auth, validation and database access are implemented.
