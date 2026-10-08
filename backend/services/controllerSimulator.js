import { acknowledge } from "./trafficEngine.js";
let automatic = process.env.AUTO_ACK === "true";
export function isAutomatic() { return automatic; }
export function setAutomatic(value) { automatic = value; }
export function simulateController(j, now) {
  if (automatic && j.pending && j.controller_status !== "OFFLINE") {
    if (j.mode === "FAILURE") {
      if (j.controller_status !== "ONLINE") return;
      if (Object.values(j.signal_status).includes("OFFLINE")) return;
      if (Object.values(j.pending.signals).some(function(color) { return color !== "RED"; })) return;
    }
    acknowledge(j, { command_id: j.pending.command_id, status: "ACK", actual_signals: j.pending.signals }, now);
  }
}
