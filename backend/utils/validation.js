import { directions, weights } from "../config/trafficConfig.js";
export function check(condition, message) {
  if (!condition) {
    const error = new Error(message);
    error.status = 400;
    throw error;
  }
}
export function text(value) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 100;
}
export function validTimestamp(value) {
  if (typeof value !== "string") {
    return false;
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value)) {
    return false;
  }
  if (!Number.isFinite(Date.parse(value))) {
    return false;
  }
  const normalized = new Date(value).toISOString();
  let expected = value;
  if (!value.includes(".")) {
    expected = value.replace("Z", ".000Z");
  } else {
    const parts = value.split(".");
    expected = parts[0] + "." + parts[1].replace("Z", "").padEnd(3, "0") + "Z";
  }
  return normalized === expected;
}
export function validateSensor(event) {
  check(
    event.simulated === undefined || typeof event.simulated === "boolean",
    "simulated must be boolean"
  );
  check(
    text(event.event_id) && text(event.junction_id) && text(event.vehicle_id),
    "event_id, junction_id and vehicle_id are required nonblank strings"
  );
  check(directions.includes(event.direction), "Invalid direction");
  check(
    ["VEHICLE_ARRIVED", "VEHICLE_CLEARED"].includes(event.event_type),
    "Invalid event_type"
  );
  if (event.event_type === "VEHICLE_ARRIVED" || event.vehicle_type !== undefined) {
    check(Object.hasOwn(weights, event.vehicle_type), "Invalid vehicle_type");
  }
  check(
    Number.isSafeInteger(event.sequence_no) && event.sequence_no >= 0,
    "sequence_no must be a nonnegative integer"
  );
  check(validTimestamp(event.timestamp), "Valid ISO UTC timestamp required");
  check(Date.parse(event.timestamp) <= Date.now() + 60000, "Timestamp too far in future");
}
