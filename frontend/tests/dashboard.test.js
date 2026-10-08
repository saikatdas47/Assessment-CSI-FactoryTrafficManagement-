import test from "node:test";
import assert from "node:assert/strict";
import { validateStatus, validateHistory, nextSequence } from "../src/dashboardData.js";
import { api } from "../src/api.js";
function state() {
  return { junction_id: "A", mode: "AUTOMATIC", stage: "GREEN", phase: "NORTH_SOUTH", controller_status: "ONLINE",
    queues: { NORTH: 0, SOUTH: 0, EAST: 0, WEST: 0 }, desired_signals: { NORTH: "GREEN", SOUTH: "GREEN", EAST: "RED", WEST: "RED" },
    actual_signals: { NORTH: "GREEN", SOUTH: "GREEN", EAST: "RED", WEST: "RED" }, vehicles: [] };
}
test("optional alerts and device maps are safely defaulted", function() {
  const result = validateStatus(state()); assert.deepEqual(result.alerts, []); assert.deepEqual(result.sensor_status, {}); assert.equal(result.manual, null);
});
test("missing critical signals or negative queue is reported before rendering", function() {
  for (const key of ["actual_signals", "desired_signals", "queues", "vehicles", "stage"]) {
    const data = state(); delete data[key]; assert.throws(function() { validateStatus(data); });
  }
  const data = state(); data.queues.NORTH = -1; assert.throws(function() { validateStatus(data); });
});
test("unknown physical state is supported without inventing a confirmed signal", function() {
  const data = state(); data.mode = "FAILURE"; data.actual_signals.NORTH = "UNKNOWN";
  assert.equal(validateStatus(data).actual_signals.NORTH, "UNKNOWN");
});
test("malformed vehicle or pending command is rejected safely", function() {
  const data = state(); data.vehicles = [null]; assert.throws(function() { validateStatus(data); });
  data.vehicles = []; data.pending = { command_id: "one" }; assert.throws(function() { validateStatus(data); });
});
test("history missing or malformed cannot crash rendering", function() {
  assert.throws(function() { validateHistory(null); }); assert.throws(function() { validateHistory([{}]); });
  assert.deepEqual(validateHistory([]), []);
});
test("simulator sequence follows backend across restart and clock changes", function() {
  assert.equal(nextSequence(1000, 3), 1001); assert.equal(nextSequence(3, 1000), 1001);
  assert.equal(nextSequence(undefined, "not-a-number"), 1);
  assert.throws(function() { nextSequence(Number.MAX_SAFE_INTEGER, 0); });
});
test("API propagates validation errors and restores fetch after test", async function(t) {
  t.mock.method(globalThis, "fetch", async function() { return { ok: false, status: 409, json: async function() { return { message: "Vehicle already waiting" }; } }; });
  await assert.rejects(api("/api/test", {}), /Vehicle already waiting/);
});
test("API handles unreadable proxy responses", async function(t) {
  t.mock.method(globalThis, "fetch", async function() { return { ok: false, status: 502, json: async function() { throw new Error("html"); } }; });
  await assert.rejects(api("/api/test"), /unreadable response/);
});
test("API handles unavailable backend", async function(t) {
  t.mock.method(globalThis, "fetch", async function() { throw new Error("Failed to fetch"); });
  await assert.rejects(api("/api/test"), /Failed to fetch/);
});
test("API bounds a hanging request with an eight-second timeout", async function(t) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(globalThis, "fetch", function(path, options) {
    return new Promise(function(resolve, reject) {
      options.signal.addEventListener("abort", function() { const error = new Error("aborted"); error.name = "AbortError"; reject(error); });
    });
  });
  const request = api("/api/test"); t.mock.timers.tick(8000); await assert.rejects(request, /timed out/);
});

test("dashboard accepts and clearly names all five factory vehicle categories", async function() {
  const { vehicleName } = await import("../src/displayText.js");
  for (const type of ["FORKLIFT", "TRUCK", "MATERIAL_VEHICLE", "EMPLOYEE_VEHICLE", "EMERGENCY"]) {
    const data = state(); data.vehicles = [{ vehicle_id: "one", direction: "NORTH", vehicle_type: type, received_at: 1 }];
    assert.doesNotThrow(function() { validateStatus(data); });
    assert.notEqual(vehicleName(type), type);
  }
});
test("unknown or pending physical signals are never described as confirmed red", async function() {
  const { transitionText } = await import("../src/displayText.js");
  const data = state(); data.stage = "ALL_RED"; data.phase = null; data.actual_signals.NORTH = "UNKNOWN";
  assert.match(transitionText(data), /unconfirmed/);
  data.pending = { command_id: "one" }; assert.match(transitionText(data), /not a confirmed/);
  data.mode = "FAILURE"; assert.match(transitionText(data), /paused/);
});
test("activity description explains emergency arrival without raw JSON", async function() {
  const { activityText, activityTitle } = await import("../src/displayText.js");
  assert.equal(activityTitle("VEHICLE_DETECTED"), "Vehicle arrived");
  assert.equal(activityText({ details: { vehicle_id: "AMB-1", direction: "WEST", vehicle_type: "EMERGENCY" } }), "AMB-1 · West · Emergency vehicle");
});

test("action feedback distinguishes safe requests from applied or ignored events", async function() {
  const { actionMessage } = await import("../src/displayText.js");
  assert.match(actionMessage("manual", {}), /requested/);
  assert.match(actionMessage("recover", {}), /confirmation is required/);
  assert.match(actionMessage("arrive", { message: "Event processed" }), /arrival recorded/);
  assert.equal(actionMessage("duplicate", { message: "Duplicate ignored" }), "Duplicate ignored");
  assert.equal(actionMessage("clear", { message: "No matching vehicle; queue unchanged" }), "No matching vehicle; queue unchanged");
});
