import { directions, phases, weights, timing, phaseFor, signalsFor } from "../config/trafficConfig.js";
import { randomUUID } from "node:crypto";

export function record(junction, type, details, now) {
  junction.history.push({ event_type: type, details: details, timestamp: new Date(now).toISOString() });
}
export function createJunction(id, now) {
  return { id: id, mode: "RECOVERY", stage: "ALL_RED", phase: null,
    desired_signals: signalsFor(null, "RED"), actual_signals: signalsFor(null, "UNKNOWN"),
    controller_status: "UNKNOWN", sensor_status: {}, signal_status: {}, vehicles: [], processed: {}, sequences: {},
    pending: null, deadline: null, manual: null, alerts: [], history: [],
    last_green_phase: null, last_served_at: {}, device_events: {} };
}
function request(j, stage, phase, now) {
  let color = "RED";
  if (stage === "GREEN") color = "GREEN";
  if (stage === "YELLOW") color = "YELLOW";
  j.stage = stage;
  j.phase = phase;
  j.desired_signals = signalsFor(phase, color);
  j.pending = { command_id: randomUUID(), junction_id: j.id, signals: j.desired_signals,
    created_at: now, expires_at: now + timing.ack };
  j.deadline = null;
  j.green_confirmation = null;
  j.simulation_green_since = {};
  record(j, "SIGNAL_STATE_REQUESTED", j.pending, now);
}
export function fail(j, reason, now) {
  const previousMode = j.mode;
  j.mode = "FAILURE";
  if (previousMode !== j.mode) record(j, "MODE_CHANGED", j.mode, now);
  if (!j.alerts.includes(reason)) j.alerts.push(reason);
  j.actual_signals = signalsFor(null, "UNKNOWN");
  j.green_confirmation = null;
  j.simulation_green_since = {};
  if (!j.pending || Object.values(j.pending.signals).some(function(color) { return color !== "RED"; })) {
    request(j, "ALL_RED", null, now);
  }
  record(j, "DEVICE_FAILURE", reason, now);
}
// Startup must invalidate old commands even when a saved device is offline.
export function recover(j, now, startup = false) {
  if (startup) {
    j.actual_signals = signalsFor(null, "UNKNOWN");
    if (j.controller_status !== "OFFLINE") j.controller_status = "UNKNOWN";
    j.pending = null;
    j.deadline = null;
    j.green_confirmation = null;
    j.simulation_green_since = {};
    if (j.manual && j.manual.expires_at <= now) {
      j.manual = null;
      record(j, "MANUAL_EXPIRED", "Manual hold ended on startup", now);
    }
    request(j, "ALL_RED", null, now);
    record(j, "STARTUP_RECOVERY", "Previous physical confirmation invalidated", now);
  }
  if (j.controller_status === "OFFLINE") {
    fail(j, "Controller remains offline", now);
    return { status: 409, message: "Report controller ONLINE before recovery" };
  }
  for (const state of Object.values(j.sensor_status)) {
    if (state === "OFFLINE") { fail(j, "Sensor remains offline", now); return { status: 409, message: "Report failed sensors ONLINE before recovery" }; }
  }
  for (const state of Object.values(j.signal_status)) {
    if (state === "OFFLINE") { fail(j, "Signal remains offline", now); return { status: 409, message: "Report failed signals ONLINE before recovery" }; }
  }
  if (j.mode !== "RECOVERY") record(j, "MODE_CHANGED", "RECOVERY", now);
  j.mode = "RECOVERY";
  j.actual_signals = signalsFor(null, "UNKNOWN");
  j.alerts = [];
  if (!startup) request(j, "ALL_RED", null, now);
  record(j, "RECOVERY_STARTED", "Fresh all-red confirmation required", now);
}

function choose(j, now) {
  const emergencies = [];
  for (const vehicle of j.vehicles) {
    if (vehicle.vehicle_type === "EMERGENCY") emergencies.push(vehicle);
  }
  if (emergencies.length > 0) {
    emergencies.sort(function(a, b) { return a.received_at - b.received_at; });
    j.mode = "EMERGENCY";
    return phaseFor(emergencies[0].direction);
  }
  if (j.manual && j.manual.expires_at > now) {
    j.mode = "MANUAL";
    return j.manual.phase;
  }
  j.manual = null;
  j.mode = "AUTOMATIC";
  const currentPhase = j.phase || j.last_green_phase;
  let winner = currentPhase;
  let best = -1;
  let oldestPhase = null;
  let oldestWait = 0;
  for (const phase of Object.keys(phases)) {
    let score = 0;
    for (const vehicle of j.vehicles) {
      if (phaseFor(vehicle.direction) !== phase) continue;
      let servedAt = 0;
      if (j.last_served_at) servedAt = j.last_served_at[phase] || 0;
      const waiting = Math.max(0, now - Math.max(vehicle.received_at, servedAt));
      // Scale the same score by 10000 so equal scores stay exactly equal.
      score += weights[vehicle.vehicle_type] * 10000 + waiting;
      if (waiting > oldestWait && phase !== currentPhase) {
        oldestWait = waiting;
        oldestPhase = phase;
      }
    }
    if (score > best) { best = score; winner = phase; }
    if (score === best && phase === currentPhase) winner = phase;
  }
  if (oldestWait >= timing.starvation) return oldestPhase;
  return winner;
}
export function advance(j, now) {
  if (j.manual && j.manual.expires_at <= now) {
    j.manual = null;
    record(j, "MANUAL_EXPIRED", "Manual hold ended", now);
  }
  if (j.pending && now >= j.pending.expires_at) {
    record(j, "CONTROLLER_TIMEOUT", j.pending.command_id, now);
    if (j.mode === "FAILURE") {
      j.pending = null;
      if (!j.alerts.includes("All-red unconfirmed; physical state unknown")) j.alerts.push("All-red unconfirmed; physical state unknown");
      return;
    }
    fail(j, "Controller acknowledgement timeout", now);
    return;
  }
  if (j.mode === "FAILURE" || j.mode === "RECOVERY") return;
  for (const v of j.vehicles) {
    if (v.vehicle_type === "EMERGENCY" && now - v.received_at > timing.emergency) {
      fail(j, "Emergency clearance overdue; operator intervention required", now);
      return;
    }
  }
  const previousMode = j.mode;
  const next = choose(j, now);
  if (previousMode !== j.mode) record(j, "MODE_CHANGED", j.mode, now);
  if (j.pending) return;
  if (j.stage === "YELLOW") {
    if (now >= j.deadline) request(j, "ALL_RED", null, now);
    return;
  }
  if (j.stage === "ALL_RED") {
    if (now >= j.deadline) request(j, "GREEN", next, now);
    return;
  }
  if (next !== j.phase && (j.mode !== "AUTOMATIC" || now >= j.deadline)) {
    record(j, "SIGNAL_TRANSITION_STARTED", { from: j.phase, to: next }, now);
    request(j, "YELLOW", j.phase, now);
  }
}
export function acknowledge(j, event, now) {
  record(j, "CONTROLLER_ACKNOWLEDGEMENT", event, now);
  if (!j.pending || event.command_id !== j.pending.command_id) {
    record(j, "ACK_IGNORED", "Duplicate or obsolete command", now);
    return { status: 200, message: "Duplicate or obsolete acknowledgement ignored" };
  }
  if (j.controller_status === "OFFLINE") {
    record(j, "ACK_REJECTED", "Controller offline; physical confirmation unavailable", now);
    return { status: 409, message: "Controller offline; report ONLINE before confirmation" };
  }
  if (now >= j.pending.expires_at) {
    advance(j, now);
    record(j, "ACK_IGNORED", "Expired command", now);
    return { status: 200, message: "Expired acknowledgement ignored" };
  }
  if (event.status !== "ACK" || !signalsMatch(event.actual_signals, j.desired_signals)) {
    fail(j, "Controller rejected command or confirmed mismatched signals", now);
    return { status: 409, message: "Controller rejection or mismatched state; junction entered FAILURE" };
  }
  if (Object.values(j.signal_status).includes("OFFLINE")) {
    record(j, "ACK_IGNORED", "A failed signal cannot provide whole-junction confirmation", now);
    return { status: 409, message: "Signal offline; whole-junction confirmation unavailable" };
  }
  const previousSignals = j.actual_signals;
  j.actual_signals = {};
  for (const direction of directions) j.actual_signals[direction] = event.actual_signals[direction];
  j.controller_status = "ONLINE";
  for (const direction of directions) j.signal_status[direction] = "ONLINE";
  j.pending = null;
  if (j.stage === "GREEN") {
    j.green_confirmation = { command_id: event.command_id, confirmed_at: now };
    j.simulation_green_since = {};
    for (const direction of phases[j.phase]) {
      j.simulation_green_since[direction] = { command_id: event.command_id, since: now };
    }
    j.deadline = now + timing.green;
    j.last_green_phase = j.phase;
    if (!j.last_served_at) j.last_served_at = {};
    j.last_served_at[j.phase] = now;
  }
  if (j.stage === "YELLOW") j.deadline = now + timing.yellow;
  if (j.stage === "ALL_RED") j.deadline = now + timing.clearance;
  record(j, "SIGNAL_STATE_CONFIRMED", { command_id: event.command_id, previous_signals: previousSignals, signals: j.actual_signals }, now);
  if (j.mode === "RECOVERY") {
    j.mode = "AUTOMATIC";
    record(j, "MODE_CHANGED", j.mode, now);
  }
  return { status: 200, message: "Controller state confirmed", command_id: event.command_id };
}
export function signalsMatch(actual, expected) {
  if (!actual || typeof actual !== "object") return false;
  for (const direction of directions) {
    if (actual[direction] !== expected[direction]) return false;
  }
  return true;
}
export function sensorEvent(j, e, now) {
  if (e.simulated !== undefined && typeof e.simulated !== "boolean") {
    const error = new Error("simulated must be boolean"); error.status = 400; throw error;
  }
  const payload = [e.direction, e.event_type, e.vehicle_id, e.vehicle_type, e.sequence_no, e.timestamp];
  const legacyFingerprint = JSON.stringify(payload);
  payload.push(e.simulated === true);
  const fingerprint = JSON.stringify(payload);
  if (Object.hasOwn(j.processed, e.event_id)) {
    const savedFingerprint = j.processed[e.event_id];
    // Legacy records did not store simulated. Never replay or promote those IDs.
    const legacyDuplicate = savedFingerprint === legacyFingerprint && e.simulated !== true;
    if (savedFingerprint !== fingerprint && !legacyDuplicate) {
      record(j, "SENSOR_REJECTED", "Event ID reused with different payload", now);
      return { status: 409, message: "Event ID already has a different payload" };
    }
    record(j, "DUPLICATE_SENSOR_EVENT", e.event_id, now);
    return { status: 200, message: "Duplicate ignored" };
  }
  if (j.sensor_status[e.direction] === "OFFLINE") {
    record(j, "SENSOR_REJECTED", "Sensor is offline: " + e.direction, now);
    return { status: 409, message: "Sensor is offline; report ONLINE before new vehicle events" };
  }
  Object.defineProperty(j.processed, e.event_id, { value: fingerprint, enumerable: true, writable: true, configurable: true });
  const last = j.sequences[e.direction];
  if (last !== undefined && e.sequence_no <= last) {
    record(j, "SENSOR_REJECTED", "Out-of-order sequence: " + e.event_id, now);
    return { status: 200, message: "Old sequence ignored" };
  }
  j.sequences[e.direction] = e.sequence_no;
  j.sensor_status[e.direction] = "ONLINE";
  const index = j.vehicles.findIndex(function(v) { return v.vehicle_id === e.vehicle_id; });
  if (e.event_type === "VEHICLE_ARRIVED") {
    if (index >= 0) {
      record(j, "SENSOR_REJECTED", "Vehicle already waiting", now);
      return { status: 409, message: "Vehicle already waiting" };
    }
    j.vehicles.push({ vehicle_id: e.vehicle_id, direction: e.direction, vehicle_type: e.vehicle_type,
      received_at: now, sensor_timestamp: e.timestamp });
    record(j, "VEHICLE_DETECTED", e, now);
    if (e.vehicle_type === "EMERGENCY") record(j, "EMERGENCY_DETECTED", e.vehicle_id, now);
  } else {
    if (index < 0 || j.vehicles[index].direction !== e.direction) {
      record(j, "SENSOR_REJECTED", "No matching waiting vehicle", now);
      return { status: 200, message: "No matching vehicle; queue unchanged" };
    }
    const vehicle = j.vehicles.splice(index, 1)[0];
    record(j, "VEHICLE_CLEARED", e, now);
    if (vehicle.vehicle_type === "EMERGENCY") record(j, "EMERGENCY_CLEARED", e.vehicle_id, now);
  }
  advance(j, now);
  return { status: 201, message: "Event processed" };
}
export function command(j, body, now) {
  if (!["MANUAL_GREEN_REQUEST", "RETURN_TO_AUTOMATIC", "RECOVER_CONTROLLER"].includes(body.command)) {
    const error = new Error("Invalid command"); error.status = 400; throw error;
  }
  if (body.command === "MANUAL_GREEN_REQUEST") {
    if (!directions.includes(body.direction)) { const error = new Error("Invalid direction"); error.status = 400; throw error; }
    if (j.mode === "FAILURE" || j.mode === "RECOVERY") {
      const error = new Error("Recover and confirm the controller before requesting manual green"); error.status = 409; throw error;
    }
  }
  if (body.command === "RECOVER_CONTROLLER") return recover(j, now);
  if (body.command === "RETURN_TO_AUTOMATIC") {
    j.manual = null;
    record(j, "RETURN_TO_AUTOMATIC", body, now);
  } else {
    j.manual = { phase: phaseFor(body.direction), expires_at: now + timing.manual };
    record(j, "MANUAL_OVERRIDE", j.manual, now);
  }
  advance(j, now);
}
export function status(j) {
  const alerts = [];
  for (const alert of j.alerts) if (!alerts.includes(alert)) alerts.push(alert);
  const queues = {};
  for (const d of directions) queues[d] = 0;
  for (const v of j.vehicles) queues[v.direction] += 1;
  return { junction_id: j.id, mode: j.mode, phase: j.phase, stage: j.stage,
    controller_status: j.controller_status, desired_signals: j.desired_signals, actual_signals: j.actual_signals,
    queues: queues, vehicles: j.vehicles, pending: j.pending, alerts: alerts,
    manual: j.manual, sensor_status: j.sensor_status, signal_status: j.signal_status, deadline: j.deadline,
    sensor_sequences: j.sequences };
}

export function deviceEvent(j, event, now) {
  if (!j.device_events) j.device_events = {};
  const fingerprint = JSON.stringify([event.device_type, event.direction, event.status, event.timestamp]);
  if (event.event_id && Object.hasOwn(j.device_events, event.event_id)) {
    if (j.device_events[event.event_id] !== fingerprint) {
      record(j, "DEVICE_STATUS_REJECTED", "Device event ID reused with different payload", now);
      return { status: 409, message: "Device event ID has a different payload" };
    }
    record(j, "DEVICE_STATUS_IGNORED", "Duplicate device event", now);
    return { status: 200, message: "Duplicate device report ignored" };
  }
  if (event.event_id) Object.defineProperty(j.device_events, event.event_id, { value: fingerprint, enumerable: true, writable: true, configurable: true });
  let previous;
  if (event.device_type === "SIGNAL_CONTROLLER") previous = j.controller_status;
  if (event.device_type === "SENSOR") previous = j.sensor_status[event.direction];
  if (event.device_type === "SIGNAL") previous = j.signal_status[event.direction];
  if (previous === event.status) {
    record(j, "DEVICE_STATUS_IGNORED", "Device status already " + event.status, now);
    return { status: 200, message: "Unchanged device status ignored" };
  }
  if (event.device_type === "SIGNAL_CONTROLLER") j.controller_status = event.status;
  if (event.device_type === "SENSOR") j.sensor_status[event.direction] = event.status;
  if (event.device_type === "SIGNAL") j.signal_status[event.direction] = event.status;
  record(j, "DEVICE_STATUS", event, now);
  if (event.status === "OFFLINE") fail(j, event.device_type + " offline " + (event.direction || ""), now);
  return { status: 200, message: "Device status recorded; recovery is explicit" };
}
