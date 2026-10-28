import express from "express";
import { router } from "./routes/index.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));
  app.get("/health", (_request, response) => response.json({ status: "ok", service: "mealbridge-api-scaffold" }));
  app.use("/api", router);
  app.use((_request, response) => response.status(404).json({ error: "Route not found." }));
  return app;
}
