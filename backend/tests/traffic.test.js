import test from "node:test";
import assert from "node:assert/strict";
import {
  createJunction,
  recover,
  acknowledge,
  advance,
  sensorEvent,
  command,
  fail
} from "../services/trafficEngine.js";
function ack(j, now) {
  acknowledge(
    j,
    { command_id: j.pending.command_id, status: "ACK", actual_signals: j.pending.signals },
    now
  );
}
function ready() {
  const j = createJunction("A", 0);
  recover(j, 0);
  ack(j, 0);
  advance(j, 2000);
  ack(j, 2000);
  return j;
}
function arrival(id, direction, type, seq) {
  return {
    event_id: id,
    junction_id: "A",
    direction: direction,
    event_type: "VEHICLE_ARRIVED",
    vehicle_id: id,
    vehicle_type: type,
    sequence_no: seq,
    timestamp: "2026-10-08T00:00:00Z"
  };
}
function safe(j) {
  for (const signals of [j.desired_signals, j.actual_signals]) {
    const ns = signals.NORTH === "GREEN" || signals.SOUTH === "GREEN";
    const ew = signals.EAST === "GREEN" || signals.WEST === "GREEN";
    assert.ok(!(ns && ew));
  }
}
test("fresh recovery requires confirmed RED and clearance", function () {
  const j = createJunction("A", 0);
  recover(j, 0);
  advance(j, 1000);
  assert.equal(j.actual_signals.NORTH, "UNKNOWN");
  assert.equal(j.mode, "RECOVERY");
  ack(j, 1000);
  advance(j, 2999);
  assert.equal(j.stage, "ALL_RED");
  advance(j, 3000);
  assert.equal(j.stage, "GREEN");
  safe(j);
});
test("emergency never bypasses yellow and confirmed all-red", function () {
  const j = ready();
  sensorEvent(j, arrival("e", "EAST", "EMERGENCY", 1), 3000);
  assert.equal(j.stage, "YELLOW");
  ack(j, 3000);
  advance(j, 7999);
  assert.equal(j.stage, "YELLOW");
  advance(j, 8000);
  assert.equal(j.stage, "ALL_RED");
  ack(j, 8100);
  advance(j, 10099);
  assert.equal(j.stage, "ALL_RED");
  advance(j, 10100);
  assert.equal(j.phase, "EAST_WEST");
  safe(j);
});
test("duplicate, conflicting ID, old sequence and clearance keep queue correct", function () {
  const j = ready();
  const event = arrival("one", "NORTH", "TRUCK", 2);
  sensorEvent(j, event, 3000);
  sensorEvent(j, event, 3001);
  assert.equal(j.vehicles.length, 1);
  event.vehicle_type = "FORKLIFT";
  assert.equal(sensorEvent(j, event, 3002).status, 409);
  sensorEvent(j, arrival("old", "NORTH", "TRUCK", 1), 3003);
  assert.equal(j.vehicles.length, 1);
  const clear = {
    event_id: "clear",
    direction: "NORTH",
    event_type: "VEHICLE_CLEARED",
    vehicle_id: "one",
    sequence_no: 3,
    timestamp: event.timestamp
  };
  sensorEvent(j, clear, 3004);
  sensorEvent(j, clear, 3005);
  assert.equal(j.vehicles.length, 0);
});
test("unknown clearance advances sequence so delayed arrival cannot resurrect vehicle", function () {
  const j = ready();
  sensorEvent(
    j,
    {
      event_id: "clear",
      direction: "EAST",
      event_type: "VEHICLE_CLEARED",
      vehicle_id: "v",
      sequence_no: 3
    },
    3000
  );
  const e = arrival("v", "EAST", "TRUCK", 2);
  sensorEvent(j, e, 3001);
  assert.equal(j.vehicles.length, 0);
});
test("timeout never assumes physical execution; expired ACK ignored", function () {
  const j = ready();
  command(j, { command: "MANUAL_GREEN_REQUEST", direction: "WEST" }, 3000);
  const old = j.pending;
  acknowledge(
    j,
    { command_id: old.command_id, status: "ACK", actual_signals: old.signals },
    8000
  );
  assert.equal(j.mode, "FAILURE");
  assert.equal(j.actual_signals.NORTH, "UNKNOWN");
  safe(j);
});
test("restart preserves vehicles and ignores pre-restart ACK", function () {
  const j = ready();
  sensorEvent(j, arrival("truck", "NORTH", "TRUCK", 1), 3000);
  command(j, { command: "MANUAL_GREEN_REQUEST", direction: "WEST" }, 4000);
  const old = j.pending;
  const restored = JSON.parse(JSON.stringify(j));
  recover(restored, 5000);
  acknowledge(
    restored,
    { command_id: old.command_id, status: "ACK", actual_signals: old.signals },
    5001
  );
  assert.equal(restored.mode, "RECOVERY");
  assert.equal(restored.vehicles.length, 1);
  assert.ok(restored.pending);
  safe(restored);
});
test("emergency overrides manual; oldest competing emergency wins", function () {
  const j = ready();
  command(j, { command: "MANUAL_GREEN_REQUEST", direction: "NORTH" }, 3000);
  sensorEvent(j, arrival("east", "EAST", "EMERGENCY", 1), 4000);
  sensorEvent(j, arrival("north", "NORTH", "EMERGENCY", 1), 4001);
  assert.equal(j.mode, "EMERGENCY");
  assert.equal(j.stage, "YELLOW");
  safe(j);
});
test("mismatched physical confirmation enters failure", function () {
  const j = ready();
  command(j, { command: "MANUAL_GREEN_REQUEST", direction: "EAST" }, 3000);
  acknowledge(
    j,
    {
      command_id: j.pending.command_id,
      status: "ACK",
      actual_signals: { NORTH: "GREEN", SOUTH: "GREEN", EAST: "GREEN", WEST: "GREEN" }
    },
    3001
  );
  assert.equal(j.mode, "FAILURE");
  safe(j);
});
test("manual expires and stale emergency enters failure", function () {
  const j = ready();
  command(j, { command: "MANUAL_GREEN_REQUEST", direction: "NORTH" }, 3000);
  advance(j, 64000);
  assert.equal(j.mode, "AUTOMATIC");
  sensorEvent(j, arrival("ambulance", "NORTH", "EMERGENCY", 1), 65000);
  advance(j, 245001);
  assert.equal(j.mode, "FAILURE");
});
test("priority selects truck phase and waiting protection selects neglected phase", function () {
  const j = ready();
  sensorEvent(j, arrival("car", "NORTH", "EMPLOYEE_VEHICLE", 1), 3000);
  sensorEvent(j, arrival("truck", "EAST", "TRUCK", 1), 3000);
  advance(j, 32000);
  assert.equal(j.stage, "YELLOW");
  const k = ready();
  sensorEvent(k, arrival("oldcar", "EAST", "EMPLOYEE_VEHICLE", 1), 3000);
  for (let i = 0; i < 20; i++) {
    sensorEvent(k, arrival("t" + i, "NORTH", "TRUCK", i + 1), 92000);
  }
  advance(k, 94000);
  assert.equal(k.stage, "YELLOW");
});
test("many interleaved requests preserve safety", function () {
  const j = ready();
  for (let i = 1; i <= 200; i++) {
    const now = 3000 + i * 1000;
    if (i % 4 === 0) {
      command(j, { command: "MANUAL_GREEN_REQUEST", direction: "EAST" }, now);
    }
    if (i % 7 === 0) {
      command(j, { command: "RETURN_TO_AUTOMATIC" }, now);
    }
    advance(j, now);
    if (j.pending) {
      ack(j, now);
    }
    safe(j);
  }
});
test("offline device prevents recovery from enabling traffic", function () {
  const j = ready();
  j.sensor_status.NORTH = "OFFLINE";
  fail(j, "sensor", 3000);
  recover(j, 4000);
  assert.equal(j.mode, "FAILURE");
  safe(j);
});
