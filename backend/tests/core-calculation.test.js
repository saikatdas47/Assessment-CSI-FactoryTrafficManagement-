import test from "node:test";
import assert from "node:assert/strict";
import { createJunction, recover, acknowledge, advance, sensorEvent, command, status, deviceEvent } from "../services/trafficEngine.js";

function ack(j, now) {
  const pending = j.pending;
  return acknowledge(j, { command_id: pending.command_id, status: "ACK", actual_signals: pending.signals }, now);
}
function ready() {
  const j = createJunction("A", 0);
  recover(j, 0); ack(j, 0); advance(j, 2000); ack(j, 2000);
  return j;
}
function arrival(j, id, direction, type, now) {
  const sequence = (j.sequences[direction] || 0) + 1;
  const event = { junction_id: j.id, event_id: id, vehicle_id: id, direction: direction,
    vehicle_type: type, event_type: "VEHICLE_ARRIVED", sequence_no: sequence,
    timestamp: new Date(now).toISOString() };
  sensorEvent(j, event, now);
  return event;
}
test("mathematically equal scores retain the current phase despite fractional rounding", function() {
  const j = ready();
  arrival(j, "truck", "NORTH", "TRUCK", 29000);
  for (let i = 0; i < 3; i++) arrival(j, "employee-" + i, "EAST", "EMPLOYEE_VEHICLE", 31000);
  // At 32000: truck = 3 + 3000/10000 = 3.3.
  // Three employees = 3 * (1 + 1000/10000) = 3.3.
  advance(j, 32000);
  assert.equal(j.stage, "GREEN", "Equal priority must not cause an unnecessary switch");
  assert.equal(j.phase, "NORTH_SOUTH");
});

const roads = ["NORTH", "SOUTH", "EAST", "WEST"];
const normalTypes = ["EMPLOYEE_VEHICLE", "FORKLIFT", "MATERIAL_VEHICLE", "TRUCK"];
const policyWeights = { EMPLOYEE_VEHICLE: 1, FORKLIFT: 2, MATERIAL_VEHICLE: 2, TRUCK: 3 };
function phase(direction) {
  return direction === "NORTH" || direction === "SOUTH" ? "NORTH_SOUTH" : "EAST_WEST";
}
function safe(j) {
  for (const signals of [j.desired_signals, j.actual_signals]) {
    assert.equal(signals.NORTH, signals.SOUTH);
    assert.equal(signals.EAST, signals.WEST);
    assert.ok(!(signals.NORTH === "GREEN" && signals.EAST === "GREEN"));
  }
}
function readyPhase(current) {
  const j = ready();
  if (current === "EAST_WEST") {
    command(j, { command: "MANUAL_GREEN_REQUEST", direction: "WEST" }, 3000);
    ack(j, 3000); advance(j, 8000); ack(j, 8000); advance(j, 10000); ack(j, 10000);
    command(j, { command: "RETURN_TO_AUTOMATIC" }, 11000);
  }
  return j;
}
function expectedWinner(current, north, east) {
  if (north === east) return current;
  return north > east ? "NORTH_SOUTH" : "EAST_WEST";
}

// Independent policy arithmetic: vehicle weight and elapsed server waiting time.
// Counts, type pairs and both initial phases give 1152 distinct decisions.
for (const current of ["NORTH_SOUTH", "EAST_WEST"]) {
  for (const northType of normalTypes) {
    for (const eastType of normalTypes) {
      for (let northCount = 0; northCount <= 5; northCount++) {
        for (let eastCount = 0; eastCount <= 5; eastCount++) {
          test("score matrix " + current + " NS " + northCount + " " + northType + " EW " + eastCount + " " + eastType, function() {
            const j = readyPhase(current);
            const decisionAt = j.deadline;
            const arrivedAt = decisionAt - 29000;
            for (let i = 0; i < northCount; i++) arrival(j, "n-" + i, i % 2 ? "SOUTH" : "NORTH", northType, arrivedAt);
            for (let i = 0; i < eastCount; i++) arrival(j, "e-" + i, i % 2 ? "WEST" : "EAST", eastType, arrivedAt);
            const north = northCount * (policyWeights[northType] * 10000 + 29000);
            const east = eastCount * (policyWeights[eastType] * 10000 + 29000);
            const winner = expectedWinner(current, north, east);
            advance(j, decisionAt); safe(j);
            if (winner === current) {
              assert.equal(j.stage, "GREEN"); assert.equal(j.pending, null);
            } else {
              assert.equal(j.stage, "YELLOW"); ack(j, decisionAt);
              advance(j, decisionAt + 4999); assert.equal(j.stage, "YELLOW");
              advance(j, decisionAt + 5000); ack(j, decisionAt + 5000);
              advance(j, decisionAt + 6999); assert.equal(j.stage, "ALL_RED");
              advance(j, decisionAt + 7000);
              // Queues can legitimately change their score during clearance.
              const nextNorth = northCount * (policyWeights[northType] * 10000 + 36000);
              const nextEast = eastCount * (policyWeights[eastType] * 10000 + 36000);
              assert.equal(j.phase, expectedWinner(current, nextNorth, nextEast));
              ack(j, decisionAt + 7000); safe(j);
            }
            assert.equal(j.vehicles.length, northCount + eastCount, "GREEN must not invent vehicle clearance");
          });
        }
      }
    }
  }
}

for (const direction of roads) {
  for (const other of roads) {
    test("emergency preemption " + direction + " followed by " + other, function() {
      const j = ready();
      const first = arrival(j, "first", direction, "EMERGENCY", 3000);
      arrival(j, "second", other, "EMERGENCY", 3001);
      let now = 3001;
      for (let i = 0; i < 10 && (j.pending || j.stage !== "GREEN"); i++) {
        if (j.pending) ack(j, now);
        else { now = j.deadline; advance(j, now); }
        safe(j);
      }
      assert.equal(j.phase, phase(direction));
      sensorEvent(j, { junction_id: j.id, event_id: "clear-first", vehicle_id: first.vehicle_id, direction: direction,
        event_type: "VEHICLE_CLEARED", sequence_no: (j.sequences[direction] || 0) + 1, timestamp: new Date(++now).toISOString() }, now);
      for (let i = 0; i < 10 && (j.pending || j.stage !== "GREEN"); i++) {
        if (j.pending) ack(j, now);
        else { now = j.deadline; advance(j, now); }
        safe(j);
      }
      assert.equal(j.phase, phase(other));
      assert.equal(j.vehicles.length, 1);
    });
  }
}

for (const yellowDelay of [0, 1, 250, 4999]) {
  for (const redDelay of [0, 1, 250, 4999]) {
    test("confirmed timing yellow delay " + yellowDelay + " red delay " + redDelay, function() {
      const j = ready();
      arrival(j, "ambulance", "EAST", "EMERGENCY", 3000);
      const yellowConfirmed = 3000 + yellowDelay;
      ack(j, yellowConfirmed);
      advance(j, yellowConfirmed + 4999); assert.equal(j.stage, "YELLOW");
      advance(j, yellowConfirmed + 5000);
      const redConfirmed = yellowConfirmed + 5000 + redDelay;
      ack(j, redConfirmed);
      advance(j, redConfirmed + 1999); assert.equal(j.stage, "ALL_RED");
      advance(j, redConfirmed + 2000); assert.equal(j.stage, "GREEN"); safe(j);
    });
  }
}
for (const delta of [-1, 0, 1]) {
  test("normal green boundary 30000 " + delta, function() {
    const j = ready();
    arrival(j, "truck", "WEST", "TRUCK", 3000);
    advance(j, 32000 + delta);
    assert.equal(j.stage, delta < 0 ? "GREEN" : "YELLOW"); safe(j);
  });
  test("starvation boundary 90000 " + delta, function() {
    const j = ready();
    arrival(j, "car", "WEST", "EMPLOYEE_VEHICLE", 10000);
    for (let i = 0; i < 30; i++) arrival(j, "truck-" + i, "NORTH", "TRUCK", 30000);
    advance(j, 100000 + delta);
    assert.equal(j.stage, delta < 0 ? "GREEN" : "YELLOW"); safe(j);
  });
  test("ACK expiry boundary 5000 " + delta, function() {
    const j = ready();
    command(j, { command: "MANUAL_GREEN_REQUEST", direction: "WEST" }, 3000);
    const result = ack(j, 8000 + delta);
    assert.equal(j.mode, delta < 0 ? "MANUAL" : "FAILURE");
    assert.match(result.message, delta < 0 ? /confirmed/ : /Expired/); safe(j);
  });
  test("manual expiry boundary 60000 " + delta, function() {
    const j = ready();
    command(j, { command: "MANUAL_GREEN_REQUEST", direction: "NORTH" }, 3000);
    advance(j, 63000 + delta);
    assert.equal(j.mode, delta < 0 ? "MANUAL" : "AUTOMATIC"); safe(j);
  });
}
test("arrival age uses server receipt, not a delayed sensor clock", function() {
  const j = ready();
  const old = { junction_id: j.id, event_id: "old", vehicle_id: "old", direction: "NORTH", vehicle_type: "EMPLOYEE_VEHICLE",
    event_type: "VEHICLE_ARRIVED", sequence_no: 1, timestamp: "2000-01-01T00:00:00Z" };
  sensorEvent(j, old, 31000); arrival(j, "truck", "WEST", "TRUCK", 31000);
  advance(j, 32000);
  assert.equal(j.stage, "YELLOW"); assert.equal(j.vehicles[0].received_at, 31000);
});
test("wrong-road clearance and new duplicate arrival cannot remove or add another vehicle", function() {
  const j = ready();
  arrival(j, "truck", "NORTH", "TRUCK", 3000);
  sensorEvent(j, { junction_id: j.id, event_id: "wrong-clear", vehicle_id: "truck", direction: "WEST", event_type: "VEHICLE_CLEARED", sequence_no: 1 }, 3001);
  assert.equal(j.vehicles.length, 1); assert.equal(status(j).queues.NORTH, 1);
  const again = { junction_id: j.id, event_id: "again", vehicle_id: "truck", direction: "EAST", vehicle_type: "FORKLIFT", event_type: "VEHICLE_ARRIVED", sequence_no: 1 };
  assert.equal(sensorEvent(j, again, 3002).status, 409); assert.equal(j.vehicles.length, 1);
});
test("an emergency during a pending GREEN still requires confirmed yellow and red before conflicting green", function() {
  const j = createJunction("A", 0); recover(j, 0); ack(j, 0); advance(j, 2000);
  arrival(j, "emergency", "EAST", "EMERGENCY", 2001);
  assert.equal(j.stage, "GREEN"); assert.equal(j.phase, "NORTH_SOUTH");
  ack(j, 2002); advance(j, 2003); assert.equal(j.stage, "YELLOW");
  ack(j, 2003); advance(j, 7003); ack(j, 7003); advance(j, 9003);
  assert.equal(j.phase, "EAST_WEST"); safe(j);
});

// This observer checks physical transitions from the outside, not desired stages.
function watchPhysical(j) {
  let previous = Object.assign({}, j.actual_signals);
  let redSince = null;
  let yellowSince = null;
  return function(state, now) {
    safe(state);
    const signals = state.actual_signals;
    if (JSON.stringify(signals) === JSON.stringify(previous)) return;
    if (signals.NORTH === "UNKNOWN") {
      redSince = null; yellowSince = null;
    } else if (signals.NORTH === "RED" && signals.EAST === "RED") {
      if (previous.NORTH === "YELLOW" || previous.EAST === "YELLOW") {
        assert.ok(yellowSince !== null && now - yellowSince >= 5000, "Physical yellow must last five seconds");
      }
      redSince = now;
    } else if (signals.NORTH === "YELLOW" || signals.EAST === "YELLOW") {
      assert.ok(previous.NORTH === "GREEN" || previous.EAST === "GREEN", "Yellow follows confirmed green");
      yellowSince = now;
    } else if (signals.NORTH === "GREEN" || signals.EAST === "GREEN") {
      assert.equal(previous.NORTH, "RED"); assert.equal(previous.EAST, "RED");
      assert.ok(redSince !== null && now - redSince >= 2000, "Conflicting green must follow confirmed red clearance");
      redSince = null; yellowSince = null;
    }
    previous = Object.assign({}, signals);
  };
}

for (let seed = 1; seed <= 100; seed++) {
  test("independent queue model and physical safety: seed " + seed + " / 1000 mixed operations", function() {
    let j = ready();
    let number = seed;
    function random(max) { number = (number * 16807) % 2147483647; return number % max; }
    let now = 3000;
    const queue = new Map();
    const seen = new Set();
    const sequences = {};
    const submitted = { NORTH: 0, SOUTH: 0, EAST: 0, WEST: 0 };
    const sensors = {};
    const packets = [];
    const observe = watchPhysical(j);
    const types = normalTypes.concat(["EMERGENCY"]);
    function submit(packet) {
      // Independent expected queue policy, before calling the engine.
      if (!seen.has(packet.event_id) && sensors[packet.direction] !== "OFFLINE") {
        seen.add(packet.event_id);
        if (sequences[packet.direction] === undefined || packet.sequence_no > sequences[packet.direction]) {
          sequences[packet.direction] = packet.sequence_no;
          sensors[packet.direction] = "ONLINE";
          if (packet.event_type === "VEHICLE_ARRIVED") {
            if (!queue.has(packet.vehicle_id)) queue.set(packet.vehicle_id, {
              vehicle_id: packet.vehicle_id, direction: packet.direction, vehicle_type: packet.vehicle_type, received_at: now
            });
          } else {
            const waiting = queue.get(packet.vehicle_id);
            if (waiting && waiting.direction === packet.direction) queue.delete(packet.vehicle_id);
          }
        }
      }
      sensorEvent(j, packet, now);
      observe(j, now);
    }
    for (let step = 0; step < 1000; step++) {
      now += random(2000) + 1;
      advance(j, now); observe(j, now);
      const operation = random(12);
      const direction = roads[random(4)];
      const waiting = Array.from(queue.values());
      if (operation <= 2 || operation === 3) {
        let vehicle = null;
        if (waiting.length && (operation === 3 || queue.size >= 30 || random(5) === 0)) vehicle = waiting[random(waiting.length)];
        let road = direction;
        if (vehicle && random(4) !== 0) road = vehicle.direction;
        submitted[road]++;
        const packet = {
          junction_id: j.id, event_id: seed + "-event-" + step, direction: road,
          vehicle_id: vehicle ? vehicle.vehicle_id : seed + "-vehicle-" + step,
          vehicle_type: vehicle ? vehicle.vehicle_type : types[random(types.length)],
          event_type: vehicle ? "VEHICLE_CLEARED" : "VEHICLE_ARRIVED",
          sequence_no: submitted[road], timestamp: new Date(now - random(100000)).toISOString()
        };
        if (random(10) === 0) packet.sequence_no = Math.max(0, packet.sequence_no - 2);
        packets.push(packet); submit(packet);
      } else if (operation === 4 && packets.length) {
        submit(packets[random(packets.length)]);
      } else if (operation === 5) {
        if (j.mode !== "FAILURE" && j.mode !== "RECOVERY") command(j, { command: "MANUAL_GREEN_REQUEST", direction: direction }, now);
      } else if (operation === 6) {
        command(j, { command: "RETURN_TO_AUTOMATIC" }, now);
      } else if (operation === 7 && j.pending) {
        ack(j, now);
      } else if (operation === 8 && j.pending) {
        acknowledge(j, { command_id: j.pending.command_id, status: "NACK" }, now);
      } else if (operation === 9) {
        const device = random(2) ? "SENSOR" : "SIGNAL";
        const deviceStatus = random(2) ? "ONLINE" : "OFFLINE";
        deviceEvent(j, { device_type: device, direction: direction, status: deviceStatus }, now);
        if (device === "SENSOR") sensors[direction] = deviceStatus;
      } else if (operation === 10) {
        recover(j, now);
      } else if (operation === 11) {
        // Model a restart: queues/IDs survive, old physical state does not.
        j = JSON.parse(JSON.stringify(j));
        recover(j, now);
      }
      observe(j, now);
      const expected = Array.from(queue.values()).sort(function(a, b) { return a.vehicle_id.localeCompare(b.vehicle_id); });
      const actual = j.vehicles.map(function(v) { return { vehicle_id: v.vehicle_id, direction: v.direction, vehicle_type: v.vehicle_type, received_at: v.received_at }; })
        .sort(function(a, b) { return a.vehicle_id.localeCompare(b.vehicle_id); });
      assert.deepEqual(actual, expected, "Independent queue mismatch at seed " + seed + " step " + step);
      const counts = { NORTH: 0, SOUTH: 0, EAST: 0, WEST: 0 };
      for (const v of expected) counts[v.direction]++;
      assert.deepEqual(status(j).queues, counts);
      if (j.mode === "FAILURE" || j.mode === "RECOVERY") assert.ok(j.desired_signals.NORTH !== "GREEN" && j.desired_signals.EAST !== "GREEN");
    }
  });
}

for (const delay of [0, 250, 1000]) {
  test("continuous trucks cannot starve employee traffic; ACK delay " + delay, function() {
    const j = ready();
    arrival(j, "employee", "WEST", "EMPLOYEE_VEHICLE", 3000);
    for (let i = 0; i < 10; i++) arrival(j, "initial-truck-" + i, "NORTH", "TRUCK", 3000);
    let servedAt = null;
    for (let now = 3250; now <= 110000; now += 250) {
      if (j.pending && now >= j.pending.created_at + delay) ack(j, now);
      if (now % 1000 === 0) arrival(j, "continuous-truck-" + now, "NORTH", "TRUCK", now);
      advance(j, now);
      if (j.pending && delay === 0) ack(j, now);
      safe(j);
      if (j.actual_signals.WEST === "GREEN") { servedAt = now; break; }
    }
    assert.notEqual(servedAt, null, "The lower-priority phase must eventually be served");
    assert.ok(servedAt - 3000 <= 90000 + 5000 + 2000 + 3 * delay);
    assert.equal(j.vehicles.some(function(v) { return v.vehicle_id === "employee"; }), true);
  });
}
for (const delta of [-1, 0, 1]) {
  test("emergency overdue boundary 180000 " + delta, function() {
    const j = ready();
    arrival(j, "emergency", "NORTH", "EMERGENCY", 3000);
    advance(j, 183000 + delta);
    assert.equal(j.mode, delta <= 0 ? "EMERGENCY" : "FAILURE");
    assert.equal(j.vehicles.length, 1, "Timeout must not silently clear emergency");
    safe(j);
  });
}
test("first sensor sequence zero is valid and repeated zero is ignored", function() {
  const j = ready();
  const packet = { junction_id: j.id, event_id: "zero", vehicle_id: "zero", direction: "NORTH", vehicle_type: "FORKLIFT", event_type: "VEHICLE_ARRIVED", sequence_no: 0 };
  assert.equal(sensorEvent(j, packet, 3000).status, 201);
  sensorEvent(j, Object.assign({}, packet, { event_id: "second-zero", vehicle_id: "different" }), 3001);
  assert.equal(j.vehicles.length, 1);
});
test("simultaneous emergency ties follow acceptance order rather than vehicle ID", function() {
  const j = ready();
  arrival(j, "ZZ-FIRST", "EAST", "EMERGENCY", 3000);
  arrival(j, "AA-SECOND", "NORTH", "EMERGENCY", 3000);
  ack(j, 3000); advance(j, 8000); ack(j, 8000); advance(j, 10000);
  assert.equal(j.phase, "EAST_WEST"); safe(j);
});
test("latest manual intent changes the target but cannot cancel yellow clearance", function() {
  const j = ready();
  command(j, { command: "MANUAL_GREEN_REQUEST", direction: "WEST" }, 3000);
  command(j, { command: "MANUAL_GREEN_REQUEST", direction: "NORTH" }, 3001);
  assert.equal(j.stage, "YELLOW"); ack(j, 3001);
  advance(j, 8001); ack(j, 8001); advance(j, 10001);
  assert.equal(j.phase, "NORTH_SOUTH"); safe(j);
});
