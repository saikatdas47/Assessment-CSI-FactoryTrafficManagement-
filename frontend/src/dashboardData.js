const directions = ["NORTH", "SOUTH", "EAST", "WEST"];
function require(condition, message) {
  if (!condition) throw new Error("Incomplete backend data: " + message);
}
export function validateStatus(data) {
  require(data && typeof data === "object", "junction status missing");
  require(typeof data.junction_id === "string", "junction ID missing");
  require(["AUTOMATIC", "MANUAL", "EMERGENCY", "FAILURE", "RECOVERY"].includes(data.mode), "unknown mode");
  require(["GREEN", "YELLOW", "ALL_RED"].includes(data.stage), "transition stage missing");
  require(data.phase === null || ["NORTH_SOUTH", "EAST_WEST"].includes(data.phase), "invalid phase");
  require(typeof data.controller_status === "string", "controller status missing");
  require(data.queues && data.desired_signals && data.actual_signals, "queues or signals missing");
  for (const direction of directions) {
    require(Number.isSafeInteger(data.queues[direction]) && data.queues[direction] >= 0, "invalid queue count");
    require(["RED", "YELLOW", "GREEN"].includes(data.desired_signals[direction]), "invalid requested signal");
    require(["RED", "YELLOW", "GREEN", "UNKNOWN"].includes(data.actual_signals[direction]), "invalid confirmed signal");
  }
  require(Array.isArray(data.vehicles), "vehicles missing");
  for (const vehicle of data.vehicles) {
    require(vehicle && typeof vehicle.vehicle_id === "string" && directions.includes(vehicle.direction), "invalid vehicle");
    require(["TRUCK", "FORKLIFT", "MATERIAL_VEHICLE", "EMPLOYEE_VEHICLE", "EMERGENCY"].includes(vehicle.vehicle_type), "invalid vehicle type");
    require(Number.isFinite(vehicle.received_at), "vehicle waiting time missing");
  }
  if (data.pending) {
    require(typeof data.pending.command_id === "string" && data.pending.signals, "invalid pending command");
    require(Number.isFinite(data.pending.expires_at), "command deadline missing");
    for (const direction of directions) require(["RED", "YELLOW", "GREEN"].includes(data.pending.signals[direction]), "pending signals incomplete");
  }
  const normalized = Object.assign({}, data);
  if (!Array.isArray(normalized.alerts)) normalized.alerts = [];
  if (!normalized.sensor_status) normalized.sensor_status = {};
  if (!normalized.signal_status) normalized.signal_status = {};
  if (!normalized.sensor_sequences) normalized.sensor_sequences = {};
  if (!normalized.manual) normalized.manual = null;
  return normalized;
}
export function validateHistory(data) {
  require(Array.isArray(data), "history missing");
  for (const event of data) {
    require(event && typeof event.event_type === "string" && Number.isFinite(Date.parse(event.timestamp)), "invalid history event");
  }
  return data;
}
export function nextSequence(serverValue, savedValue) {
  let server = Number(serverValue);
  let saved = Number(savedValue);
  if (!Number.isSafeInteger(server) || server < 0) server = 0;
  if (!Number.isSafeInteger(saved) || saved < 0) saved = 0;
  const next = Math.max(server, saved) + 1;
  if (!Number.isSafeInteger(next)) throw new Error("Sensor sequence exhausted");
  return next;
}
