import test from "node:test";
import assert from "node:assert/strict";
import {
  createJunction,
  recover,
  acknowledge,
  advance,
  deviceEvent,
  sensorEvent
} from "../services/trafficEngine.js";
import { simulateController, setAutomatic } from "../services/controllerSimulator.js";
import { startScenario, simulateDepartures } from "../services/trafficSimulator.js";
import { validateSensor } from "../utils/validation.js";
function ack(j, now, pending) {
  if (!pending) {
    pending = j.pending;
  }
  return acknowledge(
    j,
    { command_id: pending.command_id, status: "ACK", actual_signals: pending.signals },
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
function event() {
  return {
    event_id: "one",
    junction_id: "A",
    vehicle_id: "one",
    direction: "NORTH",
    vehicle_type: "TRUCK",
    event_type: "VEHICLE_ARRIVED",
    sequence_no: 1,
    timestamp: new Date().toISOString()
  };
}
test("known OFFLINE controller rejects recovery and ACK; ONLINE alone cannot resume", function () {
  const j = ready();
  deviceEvent(j, { device_type: "SIGNAL_CONTROLLER", status: "OFFLINE" }, 3000);
  const before = JSON.stringify(j.actual_signals);
  assert.equal(ack(j, 3001).status, 409);
  assert.equal(JSON.stringify(j.actual_signals), before);
  assert.ok(
    j.history.some(function (e) {
      return e.event_type === "ACK_REJECTED";
    })
  );
  assert.equal(recover(j, 3002).status, 409);
  assert.equal(j.controller_status, "OFFLINE");
  setAutomatic(true);
  simulateController(j, 3003);
  assert.equal(j.actual_signals.NORTH, "UNKNOWN");
  deviceEvent(j, { device_type: "SIGNAL_CONTROLLER", status: "ONLINE" }, 3004);
  assert.equal(j.mode, "FAILURE");
  recover(j, 3005);
  ack(j, 3006);
  advance(j, 5005);
  assert.equal(j.stage, "ALL_RED");
  advance(j, 5006);
  assert.equal(j.stage, "GREEN");
  setAutomatic(false);
});
for (const type of ["SIGNAL_CONTROLLER", "SENSOR", "SIGNAL"]) {
  test("restart supersedes pending ALL_RED with offline " + type, function () {
    let j = ready();
    sensorEvent(j, event(), 2500);
    j.manual = { phase: "NORTH_SOUTH", expires_at: 9000 };
    deviceEvent(j, { device_type: type, direction: "NORTH", status: "OFFLINE" }, 3000);
    const old = j.pending;
    j.simulation_green_since = { NORTH: 2000 };
    j = JSON.parse(JSON.stringify(j));
    recover(j, 3100, true);
    assert.notEqual(j.pending.command_id, old.command_id);
    assert.equal(j.mode, "FAILURE");
    assert.equal(j.deadline, null);
    assert.equal(j.actual_signals.NORTH, "UNKNOWN");
    assert.deepEqual(j.simulation_green_since, {});
    assert.equal(j.vehicles.length, 1);
    assert.ok(j.processed.one);
    assert.ok(j.manual);
    assert.equal(ack(j, 3101, old).status, 200);
    assert.equal(j.actual_signals.NORTH, "UNKNOWN");
    if (type === "SIGNAL_CONTROLLER") {
      assert.equal(j.controller_status, "OFFLINE");
    } else if (type === "SENSOR") {
      assert.equal(j.sensor_status.NORTH, "OFFLINE");
    } else {
      assert.equal(j.signal_status.NORTH, "OFFLINE");
    }
    ack(j, 3102);
    advance(j, 5200);
    assert.equal(j.mode, "FAILURE");
    assert.equal(j.stage, "ALL_RED");
  });
}
test("startup expires manual but retains queues and fresh UNKNOWN supports red confirmation", function () {
  const j = ready();
  j.manual = { phase: "NORTH_SOUTH", expires_at: 3000 };
  recover(j, 4000, true);
  assert.equal(j.manual, null);
  assert.equal(j.controller_status, "UNKNOWN");
  ack(j, 4001);
  advance(j, 6000);
  assert.equal(j.stage, "ALL_RED");
});
test("departure waits for new GREEN identity without unhealthy simulator ticks", function () {
  const j = ready();
  startScenario(j, "NORMAL", 2100);
  simulateDepartures(j, 2100);
  deviceEvent(j, { device_type: "SENSOR", direction: "NORTH", status: "OFFLINE" }, 4900);
  deviceEvent(j, { device_type: "SENSOR", direction: "NORTH", status: "ONLINE" }, 4901);
  recover(j, 4902);
  ack(j, 4903);
  advance(j, 6903);
  const green = j.pending;
  ack(j, 6903);
  const count = j.vehicles.length;
  simulateDepartures(j, 6903);
  assert.equal(j.vehicles.length, count);
  ack(j, 7903, green);
  simulateDepartures(j, 9902);
  assert.equal(j.vehicles.length, count);
  simulateDepartures(j, 9903);
  assert.equal(j.vehicles.length, count - 2);
  assert.equal(
    j.history.filter(function (e) {
      return e.event_type === "VEHICLE_CLEARED";
    }).length,
    2
  );
});
test("simulated is boolean and normalized false participates in fingerprint", function () {
  const j = ready(),
    e = event();
  for (const bad of [null, 0, 1, "true", {}, []]) {
    assert.throws(function () {
      validateSensor(Object.assign({}, e, { simulated: bad }));
    });
    const before = JSON.stringify(j);
    assert.throws(function () {
      sensorEvent(j, Object.assign({}, e, { simulated: bad }), 3000);
    });
    assert.equal(JSON.stringify(j), before);
  }
  assert.equal(sensorEvent(j, e, 3000).status, 201);
  assert.equal(sensorEvent(j, Object.assign({}, e, { simulated: false }), 3001).status, 200);
  assert.equal(sensorEvent(j, Object.assign({}, e, { simulated: true }), 3002).status, 409);
  assert.equal(j.vehicles.length, 1);
  assert.equal(j.simulated_vehicles, undefined);
});
test("legacy fingerprints never permit replay or uncertain simulated promotion", function () {
  const j = ready(),
    e = event();
  j.processed.one = JSON.stringify([
    e.direction,
    e.event_type,
    e.vehicle_id,
    e.vehicle_type,
    e.sequence_no,
    e.timestamp
  ]);
  assert.equal(sensorEvent(j, e, 3000).status, 200);
  assert.equal(sensorEvent(j, Object.assign({}, e, { simulated: true }), 3001).status, 409);
  assert.equal(
    sensorEvent(j, Object.assign({}, e, { vehicle_type: "FORKLIFT" }), 3002).status,
    409
  );
  assert.equal(j.vehicles.length, 0);
  assert.ok(j.processed.one);
});
