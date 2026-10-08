import test from "node:test";
import assert from "node:assert/strict";
import {
  createJunction,
  recover,
  acknowledge,
  advance,
  sensorEvent
} from "../services/trafficEngine.js";
import { startScenario, simulateDepartures } from "../services/trafficSimulator.js";
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
test("one-click presets create the advertised counts through sensor events", function () {
  const j = ready();
  assert.equal(startScenario(j, "NORMAL", 2100).status, 201);
  assert.equal(j.vehicles.length, 10);
  for (const pair of [
    ["NORTH", 3],
    ["SOUTH", 2],
    ["EAST", 3],
    ["WEST", 2]
  ]) {
    assert.equal(
      j.vehicles.filter(function (v) {
        return v.direction === pair[0];
      }).length,
      pair[1]
    );
  }
  const k = ready();
  startScenario(k, "PRIORITY", 2100);
  assert.equal(k.vehicles.length, 9);
  assert.equal(
    k.vehicles.filter(function (v) {
      return v.vehicle_type === "TRUCK";
    }).length,
    3
  );
});
test("simulated departures require three uninterrupted seconds of confirmed green", function () {
  const j = ready();
  startScenario(j, "NORMAL", 2100);
  simulateDepartures(j, 2100);
  simulateDepartures(j, 5099);
  assert.equal(j.vehicles.length, 10);
  simulateDepartures(j, 5100);
  assert.equal(j.vehicles.length, 8);
  assert.equal(
    j.vehicles.filter(function (v) {
      return v.direction === "EAST";
    }).length,
    3
  );
  assert.equal(
    j.history.filter(function (e) {
      return e.event_type === "VEHICLE_CLEARED";
    }).length,
    2
  );
});
test("pending commands, red, failure and recovery cannot invent vehicle departures", function () {
  for (const mode of ["FAILURE", "RECOVERY"]) {
    const j = ready();
    startScenario(j, "NORMAL", 2100);
    simulateDepartures(j, 2100);
    j.mode = mode;
    simulateDepartures(j, 10000);
    assert.equal(j.vehicles.length, 10);
  }
  const j = ready();
  startScenario(j, "NORMAL", 2100);
  simulateDepartures(j, 2100);
  j.pending = { command_id: "pending" };
  simulateDepartures(j, 10000);
  assert.equal(j.vehicles.length, 10);
  j.pending = null;
  simulateDepartures(j, 10001);
  simulateDepartures(j, 13000);
  assert.equal(j.vehicles.length, 10);
  simulateDepartures(j, 13001);
  assert.equal(j.vehicles.length, 8);
});
test("emergency preset uses the opposing phase and still requires safe clearance", function () {
  const j = ready();
  startScenario(j, "EMERGENCY", 2100);
  assert.equal(j.vehicles[0].direction, "EAST");
  assert.equal(j.stage, "YELLOW");
  simulateDepartures(j, 10000);
  assert.equal(j.vehicles.length, 1);
  ack(j, 2100);
  advance(j, 7100);
  ack(j, 7100);
  advance(j, 9100);
  ack(j, 9100);
  simulateDepartures(j, 9100);
  simulateDepartures(j, 12100);
  assert.equal(j.vehicles.length, 0);
});
test("old unmarked and new preset vehicles follow the same departure rule", function () {
  const junction = ready();
  sensorEvent(
    junction,
    {
      event_id: "old-arrival",
      vehicle_id: "OLD-VEHICLE",
      direction: "NORTH",
      vehicle_type: "TRUCK",
      event_type: "VEHICLE_ARRIVED",
      sequence_no: 1,
      timestamp: new Date(2100).toISOString()
    },
    2100
  );
  const restored = JSON.parse(JSON.stringify(junction));
  restored.simulated_vehicles = []; // Older snapshots had no eligible marker.
  startScenario(restored, "NORMAL", 2100);
  simulateDepartures(restored, 2100);
  simulateDepartures(restored, 5100);
  assert.equal(restored.vehicles.length, 9);
  assert.equal(
    restored.vehicles.some(function (vehicle) {
      return vehicle.vehicle_id === "OLD-VEHICLE";
    }),
    false
  );
  assert.equal(restored.sequences.NORTH, 5);
  assert.equal(
    restored.history.filter(function (event) {
      return event.event_type === "VEHICLE_CLEARED";
    }).length,
    2
  );
});
test("invalid presets and unhealthy junctions add no vehicles", function () {
  const j = ready();
  assert.equal(startScenario(j, "BAD", 2100).status, 400);
  j.sensor_status.WEST = "OFFLINE";
  assert.equal(startScenario(j, "NORMAL", 2100).status, 409);
  assert.equal(j.vehicles.length, 0);
});

test("new arrival cannot use a departure slot accumulated by an empty road", function () {
  const junction = ready();
  simulateDepartures(junction, 10000);
  sensorEvent(
    junction,
    {
      event_id: "late-arrival",
      vehicle_id: "LATE",
      direction: "NORTH",
      vehicle_type: "TRUCK",
      event_type: "VEHICLE_ARRIVED",
      sequence_no: 1
    },
    12000
  );
  simulateDepartures(junction, 12000);
  simulateDepartures(junction, 14999);
  assert.equal(junction.vehicles.length, 1);
  simulateDepartures(junction, 15000);
  assert.equal(junction.vehicles.length, 0);
});

test("demo off keeps all vehicles until explicit clearance", function () {
  const junction = ready();
  startScenario(junction, "NORMAL", 2100);
  simulateDepartures(junction, 10000, false);
  assert.equal(junction.vehicles.length, 10);
  assert.deepEqual(junction.simulation_green_since, {});
});

test("a delayed tick clears one per green road without catching up a whole queue", function () {
  const junction = ready();
  startScenario(junction, "NORMAL", 2100);
  simulateDepartures(junction, 2100);
  simulateDepartures(junction, 20000);
  assert.equal(junction.vehicles.length, 8);
  simulateDepartures(junction, 20000);
  assert.equal(junction.vehicles.length, 8);
  simulateDepartures(junction, 22999);
  assert.equal(junction.vehicles.length, 8);
  simulateDepartures(junction, 23000);
  assert.equal(junction.vehicles.length, 6);
});

test("offline sensor pauses departure and restarting its timer waits a full interval", function () {
  const junction = ready();
  startScenario(junction, "NORMAL", 2100);
  simulateDepartures(junction, 2100);
  junction.sensor_status.NORTH = "OFFLINE";
  simulateDepartures(junction, 5100);
  assert.equal(
    junction.vehicles.filter(function (vehicle) {
      return vehicle.direction === "NORTH";
    }).length,
    3
  );
  junction.sensor_status.NORTH = "ONLINE";
  simulateDepartures(junction, 6000);
  simulateDepartures(junction, 8999);
  assert.equal(
    junction.vehicles.filter(function (vehicle) {
      return vehicle.direction === "NORTH";
    }).length,
    3
  );
  simulateDepartures(junction, 9000);
  assert.equal(
    junction.vehicles.filter(function (vehicle) {
      return vehicle.direction === "NORTH";
    }).length,
    2
  );
});

test("FIFO departure uses fresh unique sensor events and never replays arrivals", function () {
  const junction = ready();
  for (let i = 1; i <= 3; i++) {
    sensorEvent(
      junction,
      {
        event_id: "arrival-" + i,
        vehicle_id: "VEHICLE-" + i,
        direction: "NORTH",
        vehicle_type: "EMPLOYEE_VEHICLE",
        event_type: "VEHICLE_ARRIVED",
        sequence_no: i
      },
      2100
    );
  }
  simulateDepartures(junction, 2100);
  for (const now of [5100, 8100, 11100]) {
    simulateDepartures(junction, now);
  }
  const cleared = junction.history.filter(function (event) {
    return event.event_type === "VEHICLE_CLEARED";
  });
  assert.deepEqual(
    cleared.map(function (event) {
      return event.details.vehicle_id;
    }),
    ["VEHICLE-1", "VEHICLE-2", "VEHICLE-3"]
  );
  assert.equal(junction.sequences.NORTH, 6);
  assert.equal(
    new Set(
      cleared.map(function (event) {
        return event.details.event_id;
      })
    ).size,
    3
  );
  simulateDepartures(junction, 20000);
  assert.equal(junction.vehicles.length, 0);
});
