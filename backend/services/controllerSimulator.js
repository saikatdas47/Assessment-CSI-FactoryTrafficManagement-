import { acknowledge } from "./trafficEngine.js";
let automatic = process.env.AUTO_ACK === "true";
export function isAutomatic() {
  return automatic;
}
export function setAutomatic(value) {
  automatic = value;
}
export function simulateController(junction, now) {
  if (automatic && junction.pending && junction.controller_status !== "OFFLINE") {
    if (junction.mode === "FAILURE") {
      if (junction.controller_status !== "ONLINE") {
        return;
      }
      if (Object.values(junction.signal_status).includes("OFFLINE")) {
        return;
      }
      if (
        Object.values(junction.pending.signals).some(function (color) {
          return color !== "RED";
        })
      ) {
        return;
      }
    }
    acknowledge(
      junction,
      {
        command_id: junction.pending.command_id,
        status: "ACK",
        actual_signals: junction.pending.signals
      },
      now
    );
  }
}
