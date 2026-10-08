import { randomUUID } from "node:crypto";
import { sensorEvent, record } from "./trafficEngine.js";
import { directions } from "../config/trafficConfig.js";

export function markSimulated(j, vehicleId) {
  if (!j.simulated_vehicles) j.simulated_vehicles = [];
  if (!j.simulated_vehicles.includes(vehicleId)) j.simulated_vehicles.push(vehicleId);
}
function eventFor(j, vehicleId, direction, type, now, eventType) {
  return { event_id: randomUUID(), junction_id: j.id, vehicle_id: vehicleId,
    direction: direction, vehicle_type: type, event_type: eventType,
    sequence_no: (j.sequences[direction] || 0) + 1, timestamp: new Date(now).toISOString() };
}
export function startScenario(j, name, now) {
  if (!["NORMAL", "PRIORITY", "EMERGENCY"].includes(name)) return { status: 400, message: "Invalid scenario" };
  if (j.mode === "FAILURE" || j.mode === "RECOVERY") return { status: 409, message: "Recover the junction before starting a scenario" };
  for (const direction of directions) {
    if (j.sensor_status[direction] === "OFFLINE") return { status: 409, message: "Restore offline sensors first" };
  }
  let groups = [["NORTH", "EMPLOYEE_VEHICLE", 3], ["SOUTH", "MATERIAL_VEHICLE", 2], ["EAST", "EMPLOYEE_VEHICLE", 3], ["WEST", "FORKLIFT", 2]];
  if (name === "PRIORITY") groups = [["NORTH", "EMPLOYEE_VEHICLE", 4], ["EAST", "TRUCK", 3], ["WEST", "FORKLIFT", 2]];
  if (name === "EMERGENCY") {
    const opposite = j.phase === "EAST_WEST" ? "NORTH" : "EAST";
    groups = [[opposite, "EMERGENCY", 1]];
  }
  let count = 0;
  for (const group of groups) {
    for (let i = 0; i < group[2]; i++) {
      const id = "DEMO-" + randomUUID().slice(0, 8);
      const result = sensorEvent(j, { ...eventFor(j, id, group[0], group[1], now, "VEHICLE_ARRIVED"), simulated: true }, now);
      if (result.status !== 201) throw new Error(result.message);
      markSimulated(j, id); count++;
    }
  }
  record(j, "SIMULATION_STARTED", { scenario: name, vehicles: count }, now);
  return { status: 201, message: count + " simulated vehicles added. They leave automatically on confirmed green." };
}
export function simulateDepartures(j, now) {
  if (!j.simulated_vehicles || !j.simulated_vehicles.length) return;
  j.simulated_vehicles = j.simulated_vehicles.filter(function(id) { return j.vehicles.some(function(v) { return v.vehicle_id === id; }); });
  if (!j.simulation_green_since) j.simulation_green_since = {};
  for (const direction of directions) {
    if (!j.green_confirmation || j.pending || j.stage !== "GREEN" || ["FAILURE", "RECOVERY"].includes(j.mode) || j.actual_signals[direction] !== "GREEN" || j.sensor_status[direction] === "OFFLINE") {
      delete j.simulation_green_since[direction]; continue;
    }
    let timer = j.simulation_green_since[direction];
    if (!timer || timer.command_id !== j.green_confirmation.command_id) {
      timer = { command_id: j.green_confirmation.command_id, since: now };
      j.simulation_green_since[direction] = timer;
    }
    if (now - timer.since < 3000) continue;
    const vehicle = j.vehicles.find(function(v) { return v.direction === direction && j.simulated_vehicles.includes(v.vehicle_id); });
    if (vehicle) sensorEvent(j, eventFor(j, vehicle.vehicle_id, direction, vehicle.vehicle_type, now, "VEHICLE_CLEARED"), now);
    timer.since = now;
  }
}
