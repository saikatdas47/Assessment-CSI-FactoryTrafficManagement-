export const settingFields = [
  ["timing", "green", "Normal green", "seconds", 1, 300],
  ["timing", "yellow", "Yellow", "seconds", 5, 30],
  ["timing", "clearance", "All-red clearance", "seconds", 2, 30],
  ["timing", "ack", "Controller ACK timeout", "seconds", 1, 60],
  ["timing", "manual", "Manual request lifetime", "seconds", 1, 600],
  ["timing", "starvation", "Starvation threshold", "seconds", 1, 600],
  ["timing", "emergency", "Emergency clearance timeout", "seconds", 1, 600],
  ["weights", "EMPLOYEE_VEHICLE", "Employee weight", "weight", 1, 100],
  ["weights", "FORKLIFT", "Forklift weight", "weight", 1, 100],
  ["weights", "MATERIAL_VEHICLE", "Material vehicle weight", "weight", 1, 100],
  ["weights", "TRUCK", "Truck weight", "weight", 1, 100],
  ["scheduling", "weight_scale", "Priority score scale", "score", 1, 100000],
  ["scheduling", "waiting_multiplier", "Waiting-time multiplier", "multiplier", 1, 100],
  ["demo", "departure_interval", "Vehicle departure interval", "seconds", 1, 60],
  ["demo", "automatic_ack", "Automatic controller confirmation", "boolean"],
  ["demo", "automatic_departures", "Automatic vehicle departures", "boolean"]
];
export function fieldValue(field, value) {
  if (field[3] === "seconds") return value / 1000;
  return value;
}
export function storedValue(field, value) {
  if (field[3] === "boolean") return value;
  if (field[3] === "seconds") return Math.round(Number(value) * 1000);
  return Number(value);
}
