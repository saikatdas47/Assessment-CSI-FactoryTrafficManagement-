import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
const backend = fileURLToPath(new URL("../", import.meta.url));
async function start(directory) {
  const child = spawn(process.execPath, ["index.js"], {
    cwd: backend,
    env: Object.assign({}, process.env, { PORT: "4011", STORAGE: "local", AUTO_ACK: "false", DATA_DIRECTORY: directory }),
    stdio: ["ignore", "pipe", "pipe"]
  });
  await new Promise(function(resolve, reject) {
    const timer = setTimeout(function() { reject(new Error("Server startup timed out")); }, 5000);
    child.stdout.on("data", function(data) {
      if (data.toString().includes("Factory traffic API")) { clearTimeout(timer); resolve(); }
    });
    child.on("error", function(error) { clearTimeout(timer); reject(error); });
    child.on("exit", function(code) { clearTimeout(timer); reject(new Error("Server exited: " + code)); });
  });
  return child;
}
async function stop(child) {
  if (!child || child.exitCode !== null) return;
  const done = once(child, "exit"); child.kill("SIGINT"); await done;
}
async function api(path, body) {
  const options = {};
  if (body !== undefined) { options.method = "POST"; options.headers = { "Content-Type": "application/json" }; options.body = JSON.stringify(body); }
  const response = await fetch("http://localhost:4011" + path, options);
  return { code: response.status, data: await response.json() };
}
test("REST validation, concurrent duplicate events, device failure and actual process restart", async function() {
  const base = new URL("../data/", import.meta.url); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(fileURLToPath(base) + "test-");
  let child;
  try {
    child = await start(directory);
    assert.equal((await api("/api/sensor-events", null)).code, 400);
    assert.equal((await api("/api/junctions/MISSING/status")).code, 404);
    assert.equal((await api("/api/junctions", { id: "../bad" })).code, 400);
    const event = { event_id: "truck", junction_id: "A", direction: "NORTH", vehicle_id: "VH-1", vehicle_type: "TRUCK", event_type: "VEHICLE_ARRIVED", sequence_no: 1, timestamp: new Date().toISOString() };
    const results = await Promise.all([api("/api/sensor-events", event), api("/api/sensor-events", event)]);
    assert.deepEqual(results.map(function(result) { return result.code; }).sort(), [200, 201]);
    let state = (await api("/api/junctions/A/status")).data;
    assert.equal(state.queues.NORTH, 1); assert.equal(state.mode, "RECOVERY");
    const old = state.pending.command_id;
    await stop(child); child = await start(directory);
    state = (await api("/api/junctions/A/status")).data;
    assert.equal(state.queues.NORTH, 1); assert.equal(state.mode, "RECOVERY");
    assert.notEqual(state.pending.command_id, old); assert.equal(state.actual_signals.NORTH, "UNKNOWN");
    assert.equal((await api("/api/controller-events", { junction_id: "A", command_id: old, status: "ACK", actual_signals: state.desired_signals })).code, 200);
    state = (await api("/api/junctions/A/status")).data;
    assert.equal(state.mode, "RECOVERY");
    await api("/api/controller-events", { junction_id: "A", command_id: state.pending.command_id, status: "ACK", actual_signals: state.pending.signals });
    state = (await api("/api/junctions/A/status")).data;
    assert.equal(state.mode, "AUTOMATIC"); assert.equal(state.stage, "ALL_RED");
    await api("/api/controller-events", { junction_id: "A", device_type: "SIGNAL_CONTROLLER", status: "OFFLINE" });
    state = (await api("/api/junctions/A/status")).data;
    assert.equal(state.mode, "FAILURE"); assert.equal(state.actual_signals.EAST, "UNKNOWN");
    assert.ok((await api("/api/junctions/A/history")).data.length > 0);
    const creation = await Promise.all([api("/api/junctions", { id: "B" }), api("/api/junctions", { id: "B" })]);
    assert.deepEqual(creation.map(function(result) { return result.code; }).sort(), [201, 409]);
  } finally { await stop(child); await rm(directory, { recursive: true, force: true }); }
});

test("MongoDB snapshot serialization preserves empty recovery maps", async function() {
  const { default: Junction } = await import("../models/Junction.js");
  const document = new Junction({ _id: "TEST", state: { sensor_status: {}, signal_status: {}, processed: {}, sequences: {} } });
  const saved = document.toObject();
  assert.deepEqual(saved.state.sensor_status, {});
  assert.deepEqual(saved.state.signal_status, {});
  assert.deepEqual(saved.state.processed, {});
  assert.deepEqual(saved.state.sequences, {});
});
async function waitStatus(predicate) {
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    const state = (await api("/api/junctions/A/status")).data;
    if (predicate(state)) return state;
    await new Promise(function(resolve) { setTimeout(resolve, 30); });
  }
  throw new Error("Expected junction state did not arrive");
}
async function confirm(state) {
  return api("/api/controller-events", { junction_id: "A", command_id: state.pending.command_id, status: "ACK", actual_signals: state.pending.signals });
}
test("REST rejects malformed inputs and unsafe control requests", async function() {
  const base = new URL("../data/", import.meta.url); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(fileURLToPath(base) + "validation-"); let child;
  try {
    child = await start(directory);
    const event = { event_id: "good", junction_id: "A", direction: "NORTH", vehicle_id: "VH", vehicle_type: "TRUCK", event_type: "VEHICLE_ARRIVED", sequence_no: 1, timestamp: new Date().toISOString() };
    for (const bad of [{}, [], null, Object.assign({}, event, { vehicle_id: " " }), Object.assign({}, event, { vehicle_type: "BUS" }), Object.assign({}, event, { sequence_no: -1 }), Object.assign({}, event, { sequence_no: 1.5 }), Object.assign({}, event, { timestamp: "2026-02-30T00:00:00Z" }), Object.assign({}, event, { timestamp: new Date(Date.now() + 120000).toISOString() })]) {
      assert.equal((await api("/api/sensor-events", bad)).code, 400);
    }
    assert.equal((await api("/api/sensor-events", Object.assign({}, event, { junction_id: "MISSING" }))).code, 404);
    assert.equal((await api("/api/junctions/A/commands", { command: "FORCE_GREEN" })).code, 400);
    assert.equal((await api("/api/junctions/A/commands", { command: "MANUAL_GREEN_REQUEST", direction: "UP" })).code, 400);
    assert.equal((await api("/api/junctions/A/commands", { command: "MANUAL_GREEN_REQUEST", direction: "WEST" })).code, 409);
    assert.equal((await api("/api/controller-events", { junction_id: "A", command_id: "x", status: "ACK", actual_signals: { NORTH: "GREEN" } })).code, 400);
    assert.equal((await api("/api/controller-events", { junction_id: "A", device_type: "SENSOR", status: "OFFLINE" })).code, 400);
    assert.equal((await api("/api/simulator", { automatic_ack: "yes" })).code, 400);
    assert.equal((await api("/api/missing")).code, 404);
    assert.equal((await api("/api/sensor-events", { value: "x".repeat(33000) })).code, 413);
    const state = (await api("/api/junctions/A/status")).data;
    assert.equal(state.mode, "RECOVERY"); assert.equal(state.queues.NORTH, 0);
  } finally { await stop(child); await rm(directory, { recursive: true, force: true }); }
});
test("REST concurrent truck/emergency/manual/duplicate/ACK stays safe and restart supersedes pending command", async function() {
  const base = new URL("../data/", import.meta.url); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(fileURLToPath(base) + "concurrency-"); let child;
  try {
    child = await start(directory);
    await confirm((await api("/api/junctions/A/status")).data);
    let state = await waitStatus(function(s) { return s.pending && s.stage === "GREEN"; });
    await confirm(state);
    const truck = { event_id: "t1", junction_id: "A", direction: "NORTH", vehicle_id: "truck", vehicle_type: "TRUCK", event_type: "VEHICLE_ARRIVED", sequence_no: 1, timestamp: new Date().toISOString() };
    const emergency = Object.assign({}, truck, { event_id: "e1", vehicle_id: "ambulance", direction: "EAST", vehicle_type: "EMERGENCY" });
    function delayed(ms, action) { return new Promise(function(resolve) { setTimeout(resolve, ms); }).then(action); }
    const results = await Promise.all([
      delayed(0, function() { return api("/api/sensor-events", truck); }),
      delayed(4, function() { return api("/api/sensor-events", emergency); }),
      delayed(8, function() { return api("/api/junctions/A/commands", { command: "MANUAL_GREEN_REQUEST", direction: "WEST" }); }),
      delayed(12, function() { return api("/api/sensor-events", emergency); }),
      delayed(17, async function() { const s = (await api("/api/junctions/A/status")).data; return confirm(s); })
    ]);
    assert.deepEqual(results.map(function(result) { return result.code; }), [201, 201, 200, 200, 200]);
    state = (await api("/api/junctions/A/status")).data;
    assert.equal(state.mode, "EMERGENCY"); assert.equal(state.stage, "YELLOW");
    assert.equal(state.queues.NORTH, 1); assert.equal(state.queues.EAST, 1);
    assert.equal(state.actual_signals.NORTH, "YELLOW"); assert.equal(state.actual_signals.EAST, "RED");
    const oldConfirmedId = results[4].data.command_id;
    await stop(child); child = await start(directory);
    state = (await api("/api/junctions/A/status")).data;
    assert.equal(state.mode, "RECOVERY"); assert.equal(state.actual_signals.NORTH, "UNKNOWN");
    assert.equal(state.queues.NORTH, 1); assert.equal(state.queues.EAST, 1); assert.ok(state.manual);
    assert.ok((await api("/api/junctions/A/history")).data.some(function(e) { return e.event_type === "CONTROLLER_ACKNOWLEDGEMENT"; }));
    await api("/api/controller-events", { junction_id: "A", command_id: oldConfirmedId || "old", status: "ACK", actual_signals: { NORTH: "YELLOW", SOUTH: "YELLOW", EAST: "RED", WEST: "RED" } });
    assert.equal((await api("/api/junctions/A/status")).data.mode, "RECOVERY");
  } finally { await stop(child); await rm(directory, { recursive: true, force: true }); }
});
test("REST repeated device reports, offline sensor and explicit recovery obey failure policy", async function() {
  const base = new URL("../data/", import.meta.url); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(fileURLToPath(base) + "devices-"); let child;
  try {
    child = await start(directory); await confirm((await api("/api/junctions/A/status")).data);
    const report = { junction_id: "A", device_type: "SENSOR", direction: "NORTH", status: "OFFLINE", event_id: "s1", timestamp: new Date().toISOString() };
    await api("/api/controller-events", report);
    let state = (await api("/api/junctions/A/status")).data; const id = state.pending.command_id;
    const duplicate = await api("/api/controller-events", report); assert.match(duplicate.data.message, /Duplicate/);
    assert.equal((await api("/api/junctions/A/status")).data.pending.command_id, id);
    assert.equal((await api("/api/controller-events", Object.assign({}, report, { status: "ONLINE" }))).code, 409);
    const event = { event_id: "v1", junction_id: "A", direction: "NORTH", vehicle_id: "VH", vehicle_type: "TRUCK", event_type: "VEHICLE_ARRIVED", sequence_no: 1, timestamp: new Date().toISOString() };
    assert.equal((await api("/api/sensor-events", event)).code, 409);
    await api("/api/controller-events", { junction_id: "A", device_type: "SENSOR", direction: "NORTH", status: "ONLINE" });
    assert.equal((await api("/api/junctions/A/status")).data.mode, "FAILURE");
    await api("/api/junctions/A/commands", { command: "RECOVER_CONTROLLER" });
    state = (await api("/api/junctions/A/status")).data; assert.equal(state.mode, "RECOVERY");
    await confirm(state); state = (await api("/api/junctions/A/status")).data;
    assert.equal(state.mode, "AUTOMATIC"); assert.equal(state.stage, "ALL_RED");
    assert.equal((await api("/api/sensor-events", event)).code, 201);
  } finally { await stop(child); await rm(directory, { recursive: true, force: true }); }
});
test("failed persistence does not commit queue or event ID and makes API unavailable", async function() {
  const base = new URL("../data/", import.meta.url); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(fileURLToPath(base) + "storage-failure-"); let child;
  try {
    child = await start(directory); await confirm((await api("/api/junctions/A/status")).data);
    // A directory at the temporary-file path forces a real write failure.
    await mkdir(directory + "/A.tmp");
    const event = { event_id: "failed", junction_id: "A", direction: "NORTH", vehicle_id: "VH", vehicle_type: "TRUCK", event_type: "VEHICLE_ARRIVED", sequence_no: 1, timestamp: new Date().toISOString() };
    const failed = await Promise.all([
      api("/api/sensor-events", event),
      api("/api/sensor-events", Object.assign({}, event, { event_id: "failed-2", vehicle_id: "VH-2", direction: "EAST" }))
    ]);
    assert.deepEqual(failed.map(function(result) { return result.code; }).sort(), [500, 503]);
    const { readFile } = await import("node:fs/promises");
    const state = JSON.parse(await readFile(directory + "/A.json", "utf8"));
    assert.equal(state.vehicles.length, 0); assert.equal(Object.hasOwn(state.processed, "failed"), false);
    assert.equal(Object.hasOwn(state.processed, "failed-2"), false);
    try { assert.equal((await api("/health")).code, 503); } catch (error) { assert.match(error.message, /fetch failed/); }
  } finally { await stop(child); await rm(directory, { recursive: true, force: true }); }
});

test('REST offline controller, simulated payload and restart confirmation', async function() {
 const base=new URL('../data/',import.meta.url);await mkdir(base,{recursive:true});const directory=await mkdtemp(fileURLToPath(base)+'correctness-');let child;
 try {
  child=await start(directory);await confirm((await api('/api/junctions/A/status')).data);
  const event={event_id:'normalized',junction_id:'A',vehicle_id:'EXTERNAL',direction:'NORTH',vehicle_type:'TRUCK',event_type:'VEHICLE_ARRIVED',sequence_no:1,timestamp:new Date().toISOString()};
  for(const simulated of [null,1,'true',{}])assert.equal((await api('/api/sensor-events',{...event,simulated})).code,400);
  assert.equal((await api('/api/sensor-events',event)).code,201);assert.equal((await api('/api/sensor-events',{...event,simulated:false})).code,200);assert.equal((await api('/api/sensor-events',{...event,simulated:true})).code,409);
  for(const device_type of ['SIGNAL_CONTROLLER','SENSOR','SIGNAL']) {
   await api('/api/controller-events',{junction_id:'A',device_type,direction:'NORTH',status:'OFFLINE'});
   let state=(await api('/api/junctions/A/status')).data;const old=state.pending;
   if(device_type==='SIGNAL_CONTROLLER') {assert.equal((await confirm(state)).code,409);assert.equal((await api('/api/junctions/A/commands',{command:'RECOVER_CONTROLLER'})).code,409);assert.equal((await api('/api/junctions/A/status')).data.controller_status,'OFFLINE');}
   await stop(child);child=await start(directory);state=(await api('/api/junctions/A/status')).data;
   assert.notEqual(state.pending.command_id,old.command_id);assert.equal(state.mode,'FAILURE');assert.equal(state.actual_signals.NORTH,'UNKNOWN');
   assert.equal((await api('/api/controller-events',{junction_id:'A',command_id:old.command_id,status:'ACK',actual_signals:old.signals})).code,200);assert.equal((await api('/api/junctions/A/status')).data.actual_signals.NORTH,'UNKNOWN');
   await api('/api/controller-events',{junction_id:'A',device_type,direction:'NORTH',status:'ONLINE'});assert.equal((await api('/api/junctions/A/status')).data.mode,'FAILURE');
   await api('/api/junctions/A/commands',{command:'RECOVER_CONTROLLER'});await confirm((await api('/api/junctions/A/status')).data);
  }
  const {readFile}=await import('node:fs/promises');const saved=JSON.parse(await readFile(directory+'/A.json','utf8'));assert.equal(saved.vehicles.length,1);assert.ok(saved.processed.normalized);assert.ok(!saved.simulated_vehicles?.includes('EXTERNAL'));
 }finally{await stop(child);await rm(directory,{recursive:true,force:true});}
});
