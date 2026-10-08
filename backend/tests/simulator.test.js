import test from "node:test";
import assert from "node:assert/strict";
import { createJunction, recover, acknowledge, advance, sensorEvent } from "../services/trafficEngine.js";
import { startScenario, markSimulated, simulateDepartures } from "../services/trafficSimulator.js";
function ack(j, now) { acknowledge(j, { command_id: j.pending.command_id, status: "ACK", actual_signals: j.pending.signals }, now); }
function ready() { const j = createJunction("A", 0); recover(j, 0); ack(j, 0); advance(j, 2000); ack(j, 2000); return j; }
test("one-click presets create the advertised counts through sensor events", function() {
  const j = ready(); assert.equal(startScenario(j, "NORMAL", 2100).status, 201);
  assert.equal(j.vehicles.length, 10);
  for (const pair of [["NORTH",3],["SOUTH",2],["EAST",3],["WEST",2]]) assert.equal(j.vehicles.filter(function(v){return v.direction===pair[0];}).length,pair[1]);
  const k = ready(); startScenario(k, "PRIORITY", 2100); assert.equal(k.vehicles.length, 9); assert.equal(k.vehicles.filter(function(v){return v.vehicle_type === "TRUCK";}).length,3);
});
test("simulated departures require three uninterrupted seconds of confirmed green", function() {
  const j = ready(); startScenario(j,"NORMAL",2100); simulateDepartures(j,2100);
  simulateDepartures(j,4999); assert.equal(j.vehicles.length,10);
  simulateDepartures(j,5000); assert.equal(j.vehicles.length,8);
  assert.equal(j.vehicles.filter(function(v){return v.direction === "EAST";}).length,3);
  assert.equal(j.history.filter(function(e){return e.event_type === "VEHICLE_CLEARED";}).length,2);
});
test("pending commands, red, failure and recovery cannot invent vehicle departures", function() {
  for (const mode of ["FAILURE","RECOVERY"]) { const j = ready();startScenario(j,"NORMAL",2100);simulateDepartures(j,2100);j.mode=mode;simulateDepartures(j,10000);assert.equal(j.vehicles.length,10); }
  const j=ready();startScenario(j,"NORMAL",2100);simulateDepartures(j,2100);j.pending={command_id:"pending"};simulateDepartures(j,10000);assert.equal(j.vehicles.length,10);
  j.pending=null;simulateDepartures(j,10001);simulateDepartures(j,13000);assert.equal(j.vehicles.length,10);simulateDepartures(j,13001);assert.equal(j.vehicles.length,8);
});
test("emergency preset uses the opposing phase and still requires safe clearance", function() {
  const j=ready();startScenario(j,"EMERGENCY",2100);assert.equal(j.vehicles[0].direction,"EAST");assert.equal(j.stage,"YELLOW");simulateDepartures(j,10000);assert.equal(j.vehicles.length,1);
  ack(j,2100);advance(j,7100);ack(j,7100);advance(j,9100);ack(j,9100);simulateDepartures(j,9100);simulateDepartures(j,12100);assert.equal(j.vehicles.length,0);
});
test("unmarked sensor vehicles stay until an explicit clearance; simulator markers survive serialization", function() {
  const j=ready();sensorEvent(j,{event_id:"real",vehicle_id:"real",direction:"NORTH",vehicle_type:"TRUCK",event_type:"VEHICLE_ARRIVED",sequence_no:1,timestamp:new Date(2100).toISOString()},2100);
  startScenario(j,"NORMAL",2100);const k=JSON.parse(JSON.stringify(j));simulateDepartures(k,2100);simulateDepartures(k,5100);assert.ok(k.vehicles.some(function(v){return v.vehicle_id === "real";}));
  markSimulated(k,"real");simulateDepartures(k,8100);assert.ok(!k.vehicles.some(function(v){return v.vehicle_id === "real";}));
});
test("invalid presets and unhealthy junctions add no vehicles", function() {
 const j=ready();assert.equal(startScenario(j,"BAD",2100).status,400);j.sensor_status.WEST="OFFLINE";assert.equal(startScenario(j,"NORMAL",2100).status,409);assert.equal(j.vehicles.length,0);
});
