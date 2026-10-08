import { acknowledge } from "./trafficEngine.js";
import { demo } from "../config/trafficConfig.js";
export function isAutomatic() {
  return demo.automatic_ack;
}
export function setAutomatic(value) {
  demo.automatic_ack = value;
}
export function simulateController(junction, now) {
  if (demo.automatic_ack && junction.pending && junction.controller_status !== "OFFLINE") {
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
