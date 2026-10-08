import { directions, weights } from "../config/trafficConfig.js";
export function check(condition, message) {
  if (!condition) { const error = new Error(message); error.status = 400; throw error; }
}
export function text(value) { return typeof value === "string" && value.trim().length > 0 && value.length <= 100; }
export function validTimestamp(value) {
  if (typeof value !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value)) return false;
  if (!Number.isFinite(Date.parse(value))) return false;
  const normalized = new Date(value).toISOString();
  let expected = value;
  if (!value.includes(".")) expected = value.replace("Z", ".000Z");
  else {
    const parts = value.split(".");
    expected = parts[0] + "." + parts[1].replace("Z", "").padEnd(3, "0") + "Z";
  }
  return normalized === expected;
}
export function validateSensor(e) {
  check(e.simulated === undefined || typeof e.simulated === "boolean", "simulated must be boolean");
  check(text(e.event_id) && text(e.junction_id) && text(e.vehicle_id), "event_id, junction_id and vehicle_id are required nonblank strings");
  check(directions.includes(e.direction), "Invalid direction");
  check(["VEHICLE_ARRIVED", "VEHICLE_CLEARED"].includes(e.event_type), "Invalid event_type");
  if (e.event_type === "VEHICLE_ARRIVED" || e.vehicle_type !== undefined) check(Object.hasOwn(weights, e.vehicle_type), "Invalid vehicle_type");
  check(Number.isSafeInteger(e.sequence_no) && e.sequence_no >= 0, "sequence_no must be a nonnegative integer");
  check(validTimestamp(e.timestamp), "Valid ISO UTC timestamp required");
  check(Date.parse(e.timestamp) <= Date.now() + 60000, "Timestamp too far in future");
}
