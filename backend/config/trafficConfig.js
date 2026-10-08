export const directions = ["NORTH", "SOUTH", "EAST", "WEST"];
export const phases = { NORTH_SOUTH: ["NORTH", "SOUTH"], EAST_WEST: ["EAST", "WEST"] };
export const weights = {
  EMPLOYEE_VEHICLE: 1,
  FORKLIFT: 2,
  MATERIAL_VEHICLE: 2,
  TRUCK: 3
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
export const scheduling = { weight_scale: 10000, waiting_multiplier: 1 };
export const demo = {
  automatic_ack: process.env.AUTO_ACK === "true",
  automatic_departures: process.env.TRAFFIC_SIMULATION !== "false",
  departure_interval: 3000
};
export function getSettings() {
  return JSON.parse(JSON.stringify({ timing: timing, weights: {
    EMPLOYEE_VEHICLE: weights.EMPLOYEE_VEHICLE, FORKLIFT: weights.FORKLIFT,
    MATERIAL_VEHICLE: weights.MATERIAL_VEHICLE, TRUCK: weights.TRUCK
  }, scheduling: scheduling, demo: demo }));
}
export function applySettings(settings) {
  Object.assign(timing, settings.timing);
  Object.assign(weights, settings.weights);
  Object.assign(scheduling, settings.scheduling);
  Object.assign(demo, settings.demo);
}
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
