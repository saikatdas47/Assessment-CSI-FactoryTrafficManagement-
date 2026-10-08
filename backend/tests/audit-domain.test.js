import test from "node:test";
import assert from "node:assert/strict";
import { createJunction, recover, acknowledge, advance, sensorEvent, command, deviceEvent } from "../services/trafficEngine.js";
import { validateSensor, validTimestamp } from "../utils/validation.js";
function ack(j, now) {
  acknowledge(j, { command_id: j.pending.command_id, status: "ACK", actual_signals: j.pending.signals }, now);
}
function ready() {
  const j = createJunction("A", 0); recover(j, 0); ack(j, 0); advance(j, 2000); ack(j, 2000); return j;
}
function event(id, direction, type, sequence) {
  return { event_id: id, junction_id: "A", direction: direction, event_type: "VEHICLE_ARRIVED", vehicle_id: id, vehicle_type: type, sequence_no: sequence, timestamp: "2026-10-08T00:00:00Z" };
}
function clear(j, id, direction, sequence, now) {
  return sensorEvent(j, { event_id: "clear-" + id, junction_id: "A", direction: direction, event_type: "VEHICLE_CLEARED", vehicle_id: id, sequence_no: sequence, timestamp: "2026-10-08T00:00:01Z" }, now);
}
function safe(j) {
  for (const signals of [j.desired_signals, j.actual_signals]) {
    const ns = signals.NORTH === "GREEN" || signals.SOUTH === "GREEN";
    const ew = signals.EAST === "GREEN" || signals.WEST === "GREEN";
    assert.ok(!(ns && ew), "Conflicting GREEN states");
  }
}
test("starvation protection completes the whole transition to the waiting phase", function() {
  const j = ready();
  sensorEvent(j, event("old-north", "NORTH", "TRUCK", 1), 3000);
  sensorEvent(j, event("east", "EAST", "EMPLOYEE_VEHICLE", 1), 4000);
  for (let i = 2; i <= 15; i++) sensorEvent(j, event("truck-" + i, "NORTH", "TRUCK", i), 92000);
  advance(j, 94000); assert.equal(j.stage, "YELLOW"); ack(j, 94000);
  advance(j, 99000); ack(j, 99000); advance(j, 101000);
  assert.equal(j.phase, "EAST_WEST"); ack(j, 101000); safe(j);
});
test("empty queues retain current EAST/WEST phase without pointless switching", function() {
  const j = ready(); command(j, { command: "MANUAL_GREEN_REQUEST", direction: "WEST" }, 3000);
  ack(j, 3000); advance(j, 8000); ack(j, 8000); advance(j, 10000); ack(j, 10000);
  command(j, { command: "RETURN_TO_AUTOMATIC" }, 11000); advance(j, 100000);
  assert.equal(j.phase, "EAST_WEST"); assert.equal(j.stage, "GREEN"); assert.equal(j.pending, null);
});
test("normal traffic never switches before the confirmed 30-second minimum", function() {
  const j = ready(); sensorEvent(j, event("truck", "EAST", "TRUCK", 1), 3000);
  advance(j, 31999); assert.equal(j.stage, "GREEN"); advance(j, 32000); assert.equal(j.stage, "YELLOW");
});
test("yellow duration begins at confirmation, not request time", function() {
  const j = ready(); command(j, { command: "MANUAL_GREEN_REQUEST", direction: "EAST" }, 3000);
  ack(j, 7000); advance(j, 11999); assert.equal(j.stage, "YELLOW"); advance(j, 12000); assert.equal(j.stage, "ALL_RED");
});
test("ACK map key order does not change its physical meaning", function() {
  const j = createJunction("A", 0); recover(j, 0);
  acknowledge(j, { command_id: j.pending.command_id, status: "ACK", actual_signals: { WEST: "RED", EAST: "RED", SOUTH: "RED", NORTH: "RED" } }, 1);
  assert.equal(j.mode, "AUTOMATIC"); assert.equal(j.actual_signals.NORTH, "RED");
});
test("duplicate ACK cannot restart a confirmed signal timer", function() {
  const j = ready(); command(j, { command: "MANUAL_GREEN_REQUEST", direction: "EAST" }, 3000);
  const e = { command_id: j.pending.command_id, status: "ACK", actual_signals: j.pending.signals };
  acknowledge(j, e, 3001); const deadline = j.deadline; acknowledge(j, e, 5000);
  assert.equal(j.deadline, deadline); assert.equal(j.stage, "YELLOW");
});
test("competing emergencies are served in accepted order then safely switch", function() {
  const j = ready(); sensorEvent(j, event("first", "EAST", "EMERGENCY", 1), 3000);
  sensorEvent(j, event("second", "NORTH", "EMERGENCY", 1), 3001);
  ack(j, 3001); advance(j, 8001); ack(j, 8001); advance(j, 10001); ack(j, 10001);
  assert.equal(j.phase, "EAST_WEST");
  clear(j, "first", "EAST", 2, 11000); assert.equal(j.stage, "YELLOW");
  ack(j, 11000); advance(j, 16000); ack(j, 16000); advance(j, 18000);
  assert.equal(j.phase, "NORTH_SOUTH"); safe(j);
});
test("emergency completion restores still-valid manual intent", function() {
  const j = ready(); command(j, { command: "MANUAL_GREEN_REQUEST", direction: "NORTH" }, 3000);
  sensorEvent(j, event("ambulance", "EAST", "EMERGENCY", 1), 4000);
  ack(j, 4000); advance(j, 9000); ack(j, 9000); advance(j, 11000); ack(j, 11000);
  clear(j, "ambulance", "EAST", 2, 12000);
  assert.equal(j.mode, "MANUAL"); assert.equal(j.stage, "YELLOW"); safe(j);
});
test("clearing emergency during yellow never cancels safety clearance", function() {
  const j = ready(); sensorEvent(j, event("ambulance", "EAST", "EMERGENCY", 1), 3000); ack(j, 3000);
  clear(j, "ambulance", "EAST", 2, 3001); assert.equal(j.stage, "YELLOW");
  advance(j, 8000); assert.equal(j.stage, "ALL_RED"); safe(j);
});
test("repeated emergency does not create a second vehicle or restart transition", function() {
  const j = ready(); const e = event("ambulance", "EAST", "EMERGENCY", 1);
  sensorEvent(j, e, 3000); const id = j.pending.command_id; sensorEvent(j, e, 3001);
  assert.equal(j.pending.command_id, id); assert.equal(j.vehicles.length, 1);
});
test("manual intent expires even while junction is in failure", function() {
  const j = ready(); command(j, { command: "MANUAL_GREEN_REQUEST", direction: "NORTH" }, 3000);
  deviceEvent(j, { device_type: "SIGNAL", direction: "SOUTH", status: "OFFLINE" }, 4000);
  advance(j, 64000); assert.equal(j.manual, null); assert.equal(j.mode, "FAILURE");
});
test("repeated OFFLINE reports keep the same fail-safe command and timeout", function() {
  const j = ready(); const e = { device_type: "SIGNAL", direction: "SOUTH", status: "OFFLINE", event_id: "status-1" };
  deviceEvent(j, e, 3000); const id = j.pending.command_id; const expires = j.pending.expires_at;
  deviceEvent(j, e, 4000); deviceEvent(j, { device_type: "SIGNAL", direction: "SOUTH", status: "OFFLINE" }, 5000);
  assert.equal(j.pending.command_id, id); assert.equal(j.pending.expires_at, expires);
  advance(j, expires); assert.equal(j.pending, null); assert.equal(j.mode, "FAILURE"); safe(j);
});
test("device event ID reused with different status is rejected", function() {
  const j = ready(); deviceEvent(j, { device_type: "SENSOR", direction: "NORTH", status: "OFFLINE", event_id: "s1" }, 3000);
  const result = deviceEvent(j, { device_type: "SENSOR", direction: "NORTH", status: "ONLINE", event_id: "s1" }, 4000);
  assert.equal(result.status, 409); assert.equal(j.sensor_status.NORTH, "OFFLINE");
});
test("ONLINE report does not automatically exit failure", function() {
  const j = ready(); deviceEvent(j, { device_type: "SENSOR", direction: "NORTH", status: "OFFLINE" }, 3000);
  deviceEvent(j, { device_type: "SENSOR", direction: "NORTH", status: "ONLINE" }, 4000);
  advance(j, 4001); assert.equal(j.mode, "FAILURE");
  recover(j, 4500); assert.equal(j.mode, "RECOVERY"); assert.equal(j.desired_signals.NORTH, "RED");
});
test("offline sensor cannot introduce or clear new vehicles", function() {
  const j = ready(); deviceEvent(j, { device_type: "SENSOR", direction: "EAST", status: "OFFLINE" }, 3000);
  const e = event("truck", "EAST", "TRUCK", 1);
  assert.equal(sensorEvent(j, e, 3001).status, 409); assert.equal(j.vehicles.length, 0);
  deviceEvent(j, { device_type: "SENSOR", direction: "EAST", status: "ONLINE" }, 3002);
  assert.equal(sensorEvent(j, e, 3003).status, 201); assert.equal(j.vehicles.length, 1);
});
test("invalid domain commands cannot alter state; manual is rejected during failure", function() {
  const j = ready(); const before = JSON.stringify(j);
  assert.throws(function() { command(j, { command: "FORCE_GREEN", direction: "NORTH" }, 3000); });
  assert.throws(function() { command(j, { command: "MANUAL_GREEN_REQUEST", direction: "INVALID" }, 3000); });
  assert.equal(JSON.stringify(j), before);
  deviceEvent(j, { device_type: "SIGNAL_CONTROLLER", status: "OFFLINE" }, 4000);
  assert.throws(function() { command(j, { command: "MANUAL_GREEN_REQUEST", direction: "WEST" }, 4001); }); safe(j);
});
for (const stage of ["GREEN", "YELLOW", "ALL_RED"]) test("restart from " + stage + " requires a new confirmed all-red", function() {
  const j = ready();
  if (stage !== "GREEN") { command(j, { command: "MANUAL_GREEN_REQUEST", direction: "EAST" }, 3000); ack(j, 3000); }
  if (stage === "ALL_RED") advance(j, 8000);
  const restored = JSON.parse(JSON.stringify(j)); recover(restored, 9000);
  assert.equal(restored.mode, "RECOVERY"); assert.equal(restored.stage, "ALL_RED"); assert.equal(restored.actual_signals.NORTH, "UNKNOWN");
  advance(restored, 10000); assert.equal(restored.mode, "RECOVERY"); ack(restored, 10000);
  advance(restored, 11999); assert.equal(restored.stage, "ALL_RED"); safe(restored);
});
test("ISO timestamps reject impossible dates and ambiguous local time", function() {
  for (const value of ["2026-02-30T00:00:00Z", "1", "2026-10-08", "2026-10-08T10:00:00", "bad"]) assert.equal(validTimestamp(value), false);
  for (const value of ["2026-10-08T00:00:00Z", "2026-10-08T00:00:00.1Z", "2026-10-08T00:00:00.123Z"]) assert.equal(validTimestamp(value), true);
});
test("malformed vehicle types, blank identifiers and unsafe sequences are rejected", function() {
  const valid = event("test", "NORTH", "TRUCK", 1); valid.timestamp = new Date().toISOString();
  for (const change of [{ vehicle_id: " " }, { vehicle_type: "UNKNOWN" }, { sequence_no: -1 }, { sequence_no: 1.5 }, { sequence_no: Number.MAX_SAFE_INTEGER + 1 }, { direction: "UP" }]) {
    assert.throws(function() { validateSensor(Object.assign({}, valid, change)); });
  }
  assert.throws(function() { validateSensor(Object.assign({}, valid, { event_type: "VEHICLE_CLEARED", vehicle_type: "UNKNOWN" })); });
});
test("old emergency sensor timestamp does not bypass accepted-time safety", function() {
  const j = ready(); sensorEvent(j, event("late", "EAST", "EMERGENCY", 1), 3000);
  assert.equal(j.mode, "EMERGENCY"); assert.equal(j.stage, "YELLOW"); assert.equal(j.vehicles[0].received_at, 3000); safe(j);
});
test("special event IDs cannot modify object prototypes", function() {
  const j = ready(); let sequence = 1;
  for (const id of ["__proto__", "constructor", "toString"]) {
    const e = event(id, "NORTH", "TRUCK", sequence++); assert.equal(sensorEvent(j, e, 3000).status, 201);
    assert.equal(sensorEvent(j, e, 3001).message, "Duplicate ignored");
  }
  assert.equal(j.vehicles.length, 3); assert.equal(Object.getPrototypeOf(j.processed), Object.prototype);
});
test("deterministic mixed events preserve safety through 1000 steps", function() {
  const j = ready(); let number = 73; const sequences = { NORTH: 0, SOUTH: 0, EAST: 0, WEST: 0 };
  const directions = Object.keys(sequences);
  for (let i = 0; i < 1000; i++) {
    number = (number * 16807) % 2147483647;
    const now = 3000 + i * 500;
    const direction = directions[number % 4];
    if (j.mode === "FAILURE") recover(j, now);
    if (number % 7 === 0 && j.mode !== "RECOVERY") command(j, { command: "MANUAL_GREEN_REQUEST", direction: direction }, now);
    if (number % 11 === 0) sensorEvent(j, event("vehicle-" + i, direction, "TRUCK", ++sequences[direction]), now);
    if (number % 13 === 0 && j.vehicles.length) { const v = j.vehicles[0]; clear(j, v.vehicle_id, v.direction, ++sequences[v.direction], now); }
    advance(j, now); if (j.pending) ack(j, now); safe(j);
  }
});

test("offline signal cannot confirm a whole-junction red command", function() {
  const j = ready(); deviceEvent(j, { device_type: "SIGNAL", direction: "SOUTH", status: "OFFLINE" }, 3000);
  ack(j, 3001); assert.equal(j.actual_signals.SOUTH, "UNKNOWN"); assert.equal(j.mode, "FAILURE"); assert.ok(j.pending);
});
test("failure simulation confirms red only when controller and signals are available", async function() {
  const simulator = await import("../services/controllerSimulator.js"); const previous = simulator.isAutomatic(); simulator.setAutomatic(true);
  try {
    const sensorFailure = ready(); deviceEvent(sensorFailure, { device_type: "SENSOR", direction: "NORTH", status: "OFFLINE" }, 3000);
    simulator.simulateController(sensorFailure, 3001); assert.equal(sensorFailure.mode, "FAILURE"); assert.equal(sensorFailure.actual_signals.NORTH, "RED");
    const signalFailure = ready(); deviceEvent(signalFailure, { device_type: "SIGNAL", direction: "SOUTH", status: "OFFLINE" }, 3000);
    simulator.simulateController(signalFailure, 3001); assert.equal(signalFailure.actual_signals.NORTH, "UNKNOWN");
    const offline = ready(); deviceEvent(offline, { device_type: "SIGNAL_CONTROLLER", status: "OFFLINE" }, 3000);
    simulator.simulateController(offline, 3001); assert.equal(offline.actual_signals.NORTH, "UNKNOWN");
  } finally { simulator.setAutomatic(previous); }
});

test("all five factory vehicle categories pass sensor validation", function() {
  for (const type of ["FORKLIFT", "TRUCK", "MATERIAL_VEHICLE", "EMPLOYEE_VEHICLE", "EMERGENCY"]) {
    const input = event("category-" + type, "EAST", type, 1);
    input.timestamp = new Date().toISOString();
    assert.doesNotThrow(function() { validateSensor(input); });
  }
});
test("material vehicle receives forklift-level priority and clears safely", function() {
  const j = ready();
  sensorEvent(j, event("employee", "NORTH", "EMPLOYEE_VEHICLE", 1), 3000);
  sensorEvent(j, event("material", "EAST", "MATERIAL_VEHICLE", 1), 3000);
  advance(j, 32000); assert.equal(j.stage, "YELLOW"); ack(j, 32000);
  advance(j, 37000); ack(j, 37000); advance(j, 39000); ack(j, 39000);
  assert.equal(j.phase, "EAST_WEST"); safe(j);
  clear(j, "material", "EAST", 2, 40000);
  assert.equal(j.vehicles.some(function(vehicle) { return vehicle.vehicle_id === "material"; }), false);
});
