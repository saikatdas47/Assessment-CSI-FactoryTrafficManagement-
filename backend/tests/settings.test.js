import test from "node:test";
import assert from "node:assert/strict";
import { getSettings, applySettings } from "../config/trafficConfig.js";
import { validateSettings } from "../services/settingsService.js";
import { createJunction, recover, acknowledge, advance, command, sensorEvent } from "../services/trafficEngine.js";
import { simulateDepartures } from "../services/trafficSimulator.js";
function ack(junction, now) {
  return acknowledge(junction, { command_id: junction.pending.command_id, status: "ACK", actual_signals: junction.pending.signals }, now);
}
function ready() {
  const junction = createJunction("A", 0);
  recover(junction, 0); ack(junction, 0); advance(junction, 2000); ack(junction, 2000);
  return junction;
}
function arrive(junction, direction, type, now) {
  const event = { event_id: direction, vehicle_id: direction, direction: direction, vehicle_type: type, event_type: "VEHICLE_ARRIVED", sequence_no: 1 };
  return sensorEvent(junction, event, now);
}
test("settings validate every field, preserve safe clearance and vehicle order", function() {
  assert.doesNotThrow(function() { validateSettings(getSettings()); });
  for (const group of ["timing", "weights", "scheduling", "demo"]) {
    for (const key of Object.keys(getSettings()[group])) {
      const values = getSettings();
      values[group][key] = "bad";
      assert.throws(function() { validateSettings(values); }, /must be/);
    }
  }
  for (const change of [["yellow", 4999], ["clearance", 1999], ["green", 0], ["ack", 60001]]) {
    const values = getSettings(); values.timing[change[0]] = change[1];
    assert.throws(function() { validateSettings(values); });
  }
  const values = getSettings(); values.weights.EMPLOYEE_VEHICLE = 4;
  assert.throws(function() { validateSettings(values); }, /priority/);
  values.weights.EMPLOYEE_VEHICLE = 1; values.weights.EMERGENCY = 0;
  assert.throws(function() { validateSettings(values); }, /fields/);
  assert.throws(function() { validateSettings({}); });
});
test("settings change cannot shorten pending ACK or active signal transition timers", function() {
  const defaults = getSettings();
  try {
    const junction = ready();
    command(junction, { command: "MANUAL_GREEN_REQUEST", direction: "EAST" }, 2100);
    const ackDeadline = junction.pending.expires_at;
    const values = getSettings(); values.timing.yellow = 10000; values.timing.clearance = 4000;
    values.timing.green = 45000; values.timing.ack = 1000;
    applySettings(values);
    assert.equal(junction.pending.expires_at, ackDeadline);
    ack(junction, 2200);
    assert.equal(junction.deadline, 7200);
    advance(junction, 7199); assert.equal(junction.stage, "YELLOW");
    advance(junction, 7200); ack(junction, 7200);
    assert.equal(junction.deadline, 9200);
    advance(junction, 9200); ack(junction, 9200);
    assert.equal(junction.deadline, 39200);
    command(junction, { command: "MANUAL_GREEN_REQUEST", direction: "NORTH" }, 9300);
    ack(junction, 9300);
    assert.equal(junction.deadline, 19300);
  } finally { applySettings(defaults); }
});
test("manual and emergency lifetimes stay fixed after acceptance", function() {
  const defaults = getSettings();
  try {
    const junction = ready();
    command(junction, { command: "MANUAL_GREEN_REQUEST", direction: "NORTH" }, 2100);
    arrive(junction, "NORTH", "EMERGENCY", 2200);
    const values = getSettings(); values.timing.manual = 1000; values.timing.emergency = 1000;
    applySettings(values);
    advance(junction, 5000);
    assert.equal(junction.mode, "EMERGENCY");
    assert.equal(junction.manual.expires_at, 62100);
    assert.equal(junction.vehicles[0].emergency_expires_at, 182200);
  } finally { applySettings(defaults); }
});
test("live configured weights and waiting multiplier affect the next safe decision", function() {
  const defaults = getSettings();
  try {
    const junction = ready();
    arrive(junction, "NORTH", "EMPLOYEE_VEHICLE", 2100);
    arrive(junction, "EAST", "TRUCK", 2100);
    const values = getSettings(); values.weights.TRUCK = 10;
    applySettings(values);
    advance(junction, 32000);
    assert.equal(junction.stage, "YELLOW");
    assert.equal(junction.phase, "NORTH_SOUTH");
    ack(junction, 32000); advance(junction, 37000); ack(junction, 37000);
    advance(junction, 39000); ack(junction, 39000);
    assert.equal(junction.phase, "EAST_WEST");
    assert.equal(junction.actual_signals.NORTH, "RED");
    assert.equal(junction.actual_signals.EAST, "GREEN");
  } finally { applySettings(defaults); }
});
test("demo interval changes apply after the already scheduled departure", function() {
  const defaults = getSettings();
  try {
    const junction = ready();
    arrive(junction, "NORTH", "EMPLOYEE_VEHICLE", 2100);
    sensorEvent(junction, { event_id: "second", vehicle_id: "second", direction: "NORTH", vehicle_type: "EMPLOYEE_VEHICLE", event_type: "VEHICLE_ARRIVED", sequence_no: 2 }, 2100);
    const values = getSettings(); values.demo.departure_interval = 6000;
    applySettings(values);
    simulateDepartures(junction, 5100, true); assert.equal(junction.vehicles.length, 1);
    simulateDepartures(junction, 8100, true); assert.equal(junction.vehicles.length, 1);
    simulateDepartures(junction, 11100, true); assert.equal(junction.vehicles.length, 0);
  } finally { applySettings(defaults); }
});


test("waiting multiplier changes normal phase selection without changing safety", function() {
  const defaults = getSettings();
  try {
    const junction = ready();
    arrive(junction, "EAST", "EMPLOYEE_VEHICLE", 2100);
    arrive(junction, "NORTH", "TRUCK", 31000);
    const values = getSettings(); values.scheduling.waiting_multiplier = 10;
    applySettings(values);
    advance(junction, 32000);
    assert.equal(junction.stage, "YELLOW");
    ack(junction, 32000); advance(junction, 37000); ack(junction, 37000);
    advance(junction, 39000); ack(junction, 39000);
    assert.equal(junction.phase, "EAST_WEST");
    assert.equal(junction.actual_signals.NORTH, "RED");
  } finally { applySettings(defaults); }
});
