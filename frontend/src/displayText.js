export const vehicleNames = {
  FORKLIFT: "Forklift",
  TRUCK: "Delivery truck",
  MATERIAL_VEHICLE: "Material-carrying vehicle",
  EMPLOYEE_VEHICLE: "Employee transport",
  EMERGENCY: "Emergency vehicle"
};
export function vehicleName(type) {
  return vehicleNames[type] || type;
}
export function roadName(direction) {
  if (!direction) return "all roads";
  return direction.charAt(0) + direction.slice(1).toLowerCase();
}
export function phaseName(phase) {
  if (phase === "NORTH_SOUTH") return "North + South";
  if (phase === "EAST_WEST") return "East + West";
  return "All-red stage";
}
export function modeName(mode) {
  const names = { AUTOMATIC: "Automatic", MANUAL: "Manual control", EMERGENCY: "Emergency priority", FAILURE: "Failure · traffic paused", RECOVERY: "Safe recovery" };
  return names[mode] || mode;
}
export function transitionText(state) {
  if (state.mode === "FAILURE") return "Traffic is paused. Restore any offline devices, then request safe recovery.";
  if (state.pending) return "Waiting for the controller to confirm requested signals. A request is not a confirmed physical change.";
  if (Object.values(state.actual_signals).includes("UNKNOWN")) return "Physical signals are unconfirmed. Do not assume the requested colours have been applied.";
  if (state.stage === "YELLOW") return "The current green roads are changing to red. Yellow must remain confirmed for 5 seconds.";
  if (state.stage === "ALL_RED") return "All roads are confirmed red. The backend waits 2 seconds before requesting the next green.";
  if (state.mode === "EMERGENCY") return phaseName(state.phase) + " have confirmed green for emergency priority. Report vehicle clearance after it leaves.";
  if (state.mode === "MANUAL") return phaseName(state.phase) + " have confirmed green under the active manual request.";
  return phaseName(state.phase) + " have confirmed green. Automatic traffic normally keeps green for at least 30 seconds.";
}
export function activityTitle(type) {
  const names = {
    VEHICLE_DETECTED: "Vehicle arrived", VEHICLE_CLEARED: "Vehicle cleared",
    DUPLICATE_SENSOR_EVENT: "Duplicate vehicle event ignored", SENSOR_REJECTED: "Vehicle event not applied",
    SIGNAL_TRANSITION_STARTED: "Safe signal switch started", SIGNAL_STATE_REQUESTED: "Signals requested",
    SIGNAL_STATE_CONFIRMED: "Signals confirmed", EMERGENCY_DETECTED: "Emergency vehicle detected",
    EMERGENCY_CLEARED: "Emergency vehicle cleared", MANUAL_OVERRIDE: "Manual control requested",
    MANUAL_EXPIRED: "Manual control expired", RETURN_TO_AUTOMATIC: "Automatic control requested",
    CONTROLLER_ACKNOWLEDGEMENT: "Controller response received", ACK_IGNORED: "Controller response ignored",
    CONTROLLER_TIMEOUT: "Controller response timed out", DEVICE_FAILURE: "Device failure",
    DEVICE_STATUS: "Device status reported", DEVICE_STATUS_IGNORED: "Repeated device report ignored",
    DEVICE_STATUS_REJECTED: "Device report rejected", MODE_CHANGED: "Control mode changed",
    RECOVERY_STARTED: "Safe recovery started", SIMULATION_STARTED: "Scenario added"
  };
  return names[type] || type.replaceAll("_", " ").toLowerCase();
}
export function signalSummary(signals) {
  const words = [];
  for (const direction of ["NORTH", "SOUTH", "EAST", "WEST"]) {
    words.push(roadName(direction) + ": " + signals[direction].toLowerCase());
  }
  return words.join(" · ");
}
export function activityText(event) {
  if (event.event_type === "CONTROLLER_TIMEOUT") return "No controller confirmation within 5 seconds.";
  if (event.event_type === "DUPLICATE_SENSOR_EVENT") return "Repeated event; queue unchanged.";
  const details = event.details;
  if (typeof details === "string") {
    if (event.event_type === "MODE_CHANGED") return modeName(details);
    return details;
  }
  if (!details || typeof details !== "object") return "Recorded by backend";
  if (details.scenario) return details.scenario.toLowerCase() + " · " + details.vehicles + " simulated vehicles";
  if (details.vehicle_id) return details.vehicle_id + " · " + roadName(details.direction) + (details.vehicle_type ? " · " + vehicleName(details.vehicle_type) : "");
  if (details.from || details.to) return phaseName(details.from) + " → " + phaseName(details.to);
  if (details.signals) return signalSummary(details.signals);
  if (details.phase) return phaseName(details.phase) + " requested";
  if (details.device_type) return roadName(details.direction) + " · " + details.device_type.toLowerCase().replaceAll("_", " ") + " · " + details.status.toLowerCase();
  if (details.command) return details.command.replaceAll("_", " ").toLowerCase();
  if (details.status) return "Controller replied " + details.status;
  return "Recorded by backend";
}

export function actionMessage(action, result) {
  if (result.message && result.message !== "Event processed") return result.message;
  const messages = {
    arrive: "Vehicle arrival recorded. Check the waiting queue.",
    clear: "Vehicle clearance recorded. Queue updated.",
    manual: "Manual priority requested. Signals will switch safely before green.",
    automatic: "Automatic control requested. Active emergencies or faults still take priority.",
    recover: "Safe recovery requested. Fresh signal confirmation is required.",
    "toggle-ack": "Controller confirmation mode updated."
  };
  return messages[action] || result.message || "Request accepted";
}
