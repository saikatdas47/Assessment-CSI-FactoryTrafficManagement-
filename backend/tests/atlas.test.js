import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import mongoose from "mongoose";
import { fileURLToPath } from "node:url";
const backend = fileURLToPath(new URL("../", import.meta.url));
const database = "factory_traffic_audit_" + Date.now();
const base = "http://localhost:4014";
async function start() {
  const child = spawn(process.execPath, ["index.js"], {
    cwd: backend,
    env: Object.assign({}, process.env, { PORT: "4014", STORAGE: "mongodb", MONGODB_DB_NAME: database, AUTO_ACK: "false" }),
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stderr.on("data", function() {});
  await new Promise(function(resolve, reject) {
    const timer = setTimeout(function() { child.kill(); reject(new Error("Atlas server startup timed out")); }, 20000);
    child.stdout.on("data", function(data) {
      if (data.toString().includes("Factory traffic API")) { clearTimeout(timer); resolve(); }
    });
    child.on("error", function(error) { clearTimeout(timer); reject(error); });
    child.on("exit", function(code) { clearTimeout(timer); reject(new Error("Atlas test server exited: " + code)); });
  });
  return child;
}
async function stop(child) {
  if (!child || child.exitCode !== null) return;
  const ended = once(child, "exit"); child.kill("SIGINT"); await ended;
}
async function api(path, body) {
  const options = {};
  if (body !== undefined) { options.method = "POST"; options.headers = { "Content-Type": "application/json" }; options.body = JSON.stringify(body); }
  const response = await fetch(base + path, options);
  return { code: response.status, data: await response.json() };
}
function safe(state) {
  for (const signals of [state.desired_signals, state.actual_signals]) {
    assert.ok(!((signals.NORTH === "GREEN" || signals.SOUTH === "GREEN") && (signals.EAST === "GREEN" || signals.WEST === "GREEN")));
  }
}
async function confirm(state) {
  return api("/api/controller-events", { junction_id: "A", command_id: state.pending.command_id, status: "ACK", actual_signals: state.pending.signals });
}
test("live Atlas: atomic events, pending-command restart, legacy maps, idempotency and explicit recovery", { skip: process.env.RUN_ATLAS_TESTS !== "true", timeout: 60000 }, async function() {
  assert.ok(process.env.MONGODB_URI, "Set MONGODB_URI privately before running live Atlas tests");
  let child;
  try {
    child = await start();
    assert.equal((await api("/health")).data.storage, "mongodb");
    const truck = { event_id: "truck-1", junction_id: "A", direction: "NORTH", event_type: "VEHICLE_ARRIVED", vehicle_id: "TRUCK", vehicle_type: "TRUCK", sequence_no: 1, timestamp: new Date().toISOString() };
    const ambulance = Object.assign({}, truck, { event_id: "emergency-1", direction: "EAST", vehicle_id: "AMBULANCE", vehicle_type: "EMERGENCY" });
    const results = await Promise.all([api("/api/sensor-events", truck), api("/api/sensor-events", truck), api("/api/sensor-events", ambulance)]);
    assert.deepEqual(results.map(function(result) { return result.code; }).sort(), [200, 201, 201]);
    let state = (await api("/api/junctions/A/status")).data;
    await confirm(state);
    const end = Date.now() + 5000;
    while (Date.now() < end) {
      state = (await api("/api/junctions/A/status")).data;
      if (state.pending && state.stage === "GREEN") break;
      await new Promise(function(resolve) { setTimeout(resolve, 50); });
    }
    assert.equal(state.mode, "EMERGENCY"); assert.equal(state.phase, "EAST_WEST"); assert.ok(state.pending);
    safe(state);
    const oldCommand = state.pending;
    await mongoose.connect(process.env.MONGODB_URI, { dbName: database, serverSelectionTimeoutMS: 10000 });
    const collection = mongoose.connection.db.collection("junctions");
    let saved = await collection.findOne({ _id: "A" });
    assert.equal(saved.state.vehicles.length, 2); assert.ok(saved.state.processed[truck.event_id]);
    assert.equal(saved.state.pending.command_id, oldCommand.command_id);
    await stop(child); child = null;
    // Simulate a document saved before empty status maps were preserved.
    await collection.updateOne({ _id: "A" }, { $unset: { "state.sensor_status": "", "state.signal_status": "" } });
    child = await start(); state = (await api("/api/junctions/A/status")).data;
    assert.equal(state.mode, "RECOVERY"); assert.equal(state.actual_signals.NORTH, "UNKNOWN");
    assert.notEqual(state.pending.command_id, oldCommand.command_id); assert.equal(state.vehicles.length, 2);
    assert.deepEqual(state.sensor_status, {}); assert.deepEqual(state.signal_status, {});
    await api("/api/controller-events", { junction_id: "A", command_id: oldCommand.command_id, status: "ACK", actual_signals: oldCommand.signals });
    assert.equal((await api("/api/junctions/A/status")).data.mode, "RECOVERY");
    assert.equal((await api("/api/sensor-events", truck)).data.message, "Duplicate ignored");
    state = (await api("/api/junctions/A/status")).data; assert.equal(state.queues.NORTH, 1); assert.equal(state.queues.EAST, 1);
    await confirm(state);
    for (const vehicle of [truck, ambulance]) {
      const clearance = Object.assign({}, vehicle, { event_id: "clear-" + vehicle.event_id, event_type: "VEHICLE_CLEARED", sequence_no: 2, timestamp: new Date().toISOString() });
      assert.equal((await api("/api/sensor-events", clearance)).code, 201);
    }
    saved = await collection.findOne({ _id: "A" }); assert.equal(saved.state.vehicles.length, 0);
    assert.ok(saved.state.history.some(function(e) { return e.event_type === "EMERGENCY_CLEARED"; }));
    await api("/api/controller-events", { junction_id: "A", device_type: "SENSOR", direction: "NORTH", status: "OFFLINE", event_id: "status-1" });
    assert.equal((await api("/api/junctions/A/status")).data.mode, "FAILURE");
    await api("/api/controller-events", { junction_id: "A", device_type: "SENSOR", direction: "NORTH", status: "ONLINE", event_id: "status-2" });
    assert.equal((await api("/api/junctions/A/status")).data.mode, "FAILURE");
    await api("/api/junctions/A/commands", { command: "RECOVER_CONTROLLER" });
    state = (await api("/api/junctions/A/status")).data; await confirm(state);
    state = (await api("/api/junctions/A/status")).data;
    assert.equal(state.mode, "AUTOMATIC"); assert.equal(state.stage, "ALL_RED"); safe(state);
    const material = Object.assign({}, truck, { event_id: "material-1", vehicle_id: "MATERIAL-1", vehicle_type: "MATERIAL_VEHICLE", direction: "WEST", sequence_no: 1, timestamp: new Date().toISOString() });
    assert.equal((await api("/api/sensor-events", material)).code, 201);
    saved = await collection.findOne({ _id: "A" });
    assert.equal(saved.state.vehicles[0].vehicle_type, "MATERIAL_VEHICLE");
    assert.equal((await api("/api/sensor-events", Object.assign({}, material, { event_id: "material-clear", event_type: "VEHICLE_CLEARED", sequence_no: 2, timestamp: new Date().toISOString() }))).code, 201);
    // Restart regressions use only this dedicated, disposable database.
    for (const device_type of ["SIGNAL_CONTROLLER", "SENSOR", "SIGNAL"]) {
      await api("/api/controller-events", { junction_id: "A", device_type, direction: "NORTH", status: "OFFLINE" });
      state = (await api("/api/junctions/A/status")).data;
      const oldRed = state.pending;
      assert.ok(oldRed); assert.equal(state.stage, "ALL_RED");
      await stop(child); child = null;
      child = await start(); state = (await api("/api/junctions/A/status")).data;
      assert.notEqual(state.pending.command_id, oldRed.command_id);
      assert.equal(state.mode, "FAILURE"); assert.equal(state.actual_signals.NORTH, "UNKNOWN");
      assert.equal((await api("/api/controller-events", { junction_id: "A", command_id: oldRed.command_id, status: "ACK", actual_signals: oldRed.signals })).code, 200);
      assert.equal((await api("/api/junctions/A/status")).data.actual_signals.NORTH, "UNKNOWN");
      if (device_type === "SIGNAL_CONTROLLER") {
        assert.equal(state.controller_status, "OFFLINE"); assert.equal((await confirm(state)).code, 409);
        assert.equal((await api("/api/junctions/A/commands", { command: "RECOVER_CONTROLLER" })).code, 409);
      }
      await api("/api/controller-events", { junction_id: "A", device_type, direction: "NORTH", status: "ONLINE" });
      assert.equal((await api("/api/junctions/A/status")).data.mode, "FAILURE");
      await api("/api/junctions/A/commands", { command: "RECOVER_CONTROLLER" });
      await confirm((await api("/api/junctions/A/status")).data);
      saved = await collection.findOne({ _id: "A" });
      assert.ok(saved.state.processed[truck.event_id]); assert.equal(saved.state.vehicles.length, 0);
      assert.equal(saved.state.mode, "AUTOMATIC"); assert.equal(saved.state.stage, "ALL_RED");
    }
  } finally {
    await stop(child);
    if (mongoose.connection.readyState === 1) {
      assert.ok(mongoose.connection.name.startsWith("factory_traffic_audit_"));
      await mongoose.connection.dropDatabase();
    }
    await mongoose.disconnect();
  }
});
