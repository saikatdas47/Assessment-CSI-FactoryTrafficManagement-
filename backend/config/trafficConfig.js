export const directions = ["NORTH", "SOUTH", "EAST", "WEST"];
export const phases = { NORTH_SOUTH: ["NORTH", "SOUTH"], EAST_WEST: ["EAST", "WEST"] };
export const weights = {
  EMPLOYEE_VEHICLE: 1,
  FORKLIFT: 2,
  MATERIAL_VEHICLE: 2,
  TRUCK: 3,
  EMERGENCY: 10
};
export const timing = {
  green: 30000,
  yellow: 5000,
  clearance: 2000,
  ack: 5000,
  manual: 60000,
  starvation: 90000,
  emergency: 180000
};
export function phaseFor(direction) {
  if (direction === "NORTH" || direction === "SOUTH") {
    return "NORTH_SOUTH";
  }
  return "EAST_WEST";
}
export function signalsFor(phase, color) {
  const signals = {};
  for (const direction of directions) {
    signals[direction] = "RED";
    if (color === "UNKNOWN") {
      signals[direction] = "UNKNOWN";
    }
    if (phase && phases[phase].includes(direction)) {
      signals[direction] = color;
    }
  }
  return signals;
}
