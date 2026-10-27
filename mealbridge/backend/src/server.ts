import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "127.0.0.1";

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

createApp().listen(port, host, () => {
  console.log(`MealBridge scaffold API listening on http://${host}:${port}`);
});
