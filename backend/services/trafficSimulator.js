import { randomUUID } from "node:crypto";
import { sensorEvent, record } from "./trafficEngine.js";
import { directions, demo } from "../config/trafficConfig.js";

export function isTrafficSimulationEnabled() {
  return demo.automatic_departures;
}

function eventFor(junction, vehicle, now, eventType) {
  let sequence = junction.sequences[vehicle.direction];
  if (sequence === undefined) {
    sequence = 0;
  }

  return {
    event_id: randomUUID(),
    junction_id: junction.id,
    vehicle_id: vehicle.vehicle_id,
    direction: vehicle.direction,
    vehicle_type: vehicle.vehicle_type,
    event_type: eventType,
    sequence_no: sequence + 1,
    timestamp: new Date(now).toISOString()
  };
}

export function startScenario(junction, name, now) {
  if (!["NORMAL", "PRIORITY", "EMERGENCY"].includes(name)) {
    return { status: 400, message: "Invalid scenario" };
  }
  if (junction.mode === "FAILURE" || junction.mode === "RECOVERY") {
    return { status: 409, message: "Recover the junction before starting a scenario" };
  }
  for (const direction of directions) {
    if (junction.sensor_status[direction] === "OFFLINE") {
      return { status: 409, message: "Restore offline sensors first" };
    }
  }

  let groups = [
    ["NORTH", "EMPLOYEE_VEHICLE", 3],
    ["SOUTH", "MATERIAL_VEHICLE", 2],
    ["EAST", "EMPLOYEE_VEHICLE", 3],
    ["WEST", "FORKLIFT", 2]
  ];
  if (name === "PRIORITY") {
    groups = [
      ["NORTH", "EMPLOYEE_VEHICLE", 4],
      ["EAST", "TRUCK", 3],
      ["WEST", "FORKLIFT", 2]
    ];
  }
  if (name === "EMERGENCY") {
    let opposite = "EAST";
    if (junction.phase === "EAST_WEST") {
      opposite = "NORTH";
    }
    groups = [[opposite, "EMERGENCY", 1]];
  }

  let count = 0;
  for (const group of groups) {
    const direction = group[0];
    const vehicleType = group[1];
    const amount = group[2];
    for (let i = 0; i < amount; i++) {
      const vehicle = {
        vehicle_id: "DEMO-" + randomUUID().slice(0, 8),
        direction: direction,
        vehicle_type: vehicleType
      };
      const event = eventFor(junction, vehicle, now, "VEHICLE_ARRIVED");
      event.simulated = true;
      const result = sensorEvent(junction, event, now);
      if (result.status !== 201) {
        throw new Error(result.message);
      }
      count++;
    }
  }

  record(junction, "SIMULATION_STARTED", { scenario: name, vehicles: count }, now);
  let message = count + " vehicles added. They leave automatically on confirmed green.";
  if (!isTrafficSimulationEnabled()) {
    message = count + " vehicles added. Automatic departures are disabled.";
  }
  return { status: 201, message: message };
}

export function simulateDepartures(junction, now, enabled) {
  if (enabled === undefined) {
    enabled = isTrafficSimulationEnabled();
  }
  if (!enabled) {
    junction.simulation_green_since = {};
    return;
  }
  if (!junction.simulation_green_since) {
    junction.simulation_green_since = {};
  }

  for (const direction of directions) {
    // A request is not enough: departures need confirmed GREEN and healthy devices.
    if (!junction.green_confirmation || junction.pending || junction.stage !== "GREEN") {
      delete junction.simulation_green_since[direction];
      continue;
    }
    if (junction.mode === "FAILURE" || junction.mode === "RECOVERY") {
      delete junction.simulation_green_since[direction];
      continue;
    }
    if (
      junction.actual_signals[direction] !== "GREEN" ||
      junction.sensor_status[direction] === "OFFLINE"
    ) {
      delete junction.simulation_green_since[direction];
      continue;
    }

    let vehicle = null;
    for (const waiting of junction.vehicles) {
      if (waiting.direction === direction) {
        vehicle = waiting;
        break;
      }
    }
    if (!vehicle) {
      // Empty roads do not accumulate unused departure slots.
      delete junction.simulation_green_since[direction];
      continue;
    }

    const confirmation = junction.green_confirmation;
    let timer = junction.simulation_green_since[direction];
    if (!timer || timer.command_id !== confirmation.command_id) {
      timer = { command_id: confirmation.command_id, since: now, interval_ms: demo.departure_interval };
      junction.simulation_green_since[direction] = timer;
    }
    if (!timer.interval_ms) {
      timer.interval_ms = demo.departure_interval;
    }
    const readyAt = Math.max(timer.since, vehicle.received_at) + timer.interval_ms;
    if (now < readyAt) {
      continue;
    }

    // Simulate the exit sensor. The engine handles the actual queue removal.
    const event = eventFor(junction, vehicle, now, "VEHICLE_CLEARED");
    sensorEvent(junction, event, now);
    timer.since = now;
    timer.interval_ms = demo.departure_interval;
  }
}
