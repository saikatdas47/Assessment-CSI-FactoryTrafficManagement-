import express from "express";
import { fileURLToPath } from "node:url";
import cors from "cors";
import routes from "./routes/junctionRoutes.js";
import { isAutomatic, setAutomatic } from "./services/controllerSimulator.js";
import { isStorageConnected } from "./services/storageService.js";
const app = express();
app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json({ limit: "32kb" }));
app.use(function(req, res, next) {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) req.body = {};
  next();
});
app.get("/health", function(req, res) {
  const connected = isStorageConnected();
  res.status(connected ? 200 : 503).json({ status: connected ? "ok" : "unavailable", storage: process.env.STORAGE || "local", auto_ack: isAutomatic() });
});
app.use("/api", function(req, res, next) {
  if (!isStorageConnected()) return res.status(503).json({ message: "Storage unavailable; traffic control is stopped" });
  next();
});
app.get("/api/simulator", function(req, res) { res.json({ automatic_ack: isAutomatic() }); });
app.post("/api/simulator", function(req, res) {
  if (typeof req.body.automatic_ack !== "boolean") return res.status(400).json({ message: "automatic_ack must be boolean" });
  setAutomatic(req.body.automatic_ack);
  res.json({ automatic_ack: isAutomatic() });
});
app.use("/api", routes);
// Serve the Vite build beside the API so deployment needs only one URL.
app.use(express.static(fileURLToPath(new URL("../frontend/dist/", import.meta.url))));
app.use(function(req, res) { res.status(404).json({ message: "Route not found" }); });
app.use(function(error, req, res, next) {
  let code = error.status || 500;
  if (error instanceof SyntaxError) code = 400;
  console.error(error.message);
  let message = error.message;
  if (code === 500) message = "Request failed; state was not committed";
  res.status(code).json({ message: message });
});
export default app;
