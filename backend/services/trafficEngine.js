import {
  directions,
  phases,
  weights,
  timing,
  phaseFor,
  signalsFor
} from "../config/trafficConfig.js";
import { randomUUID } from "node:crypto";

export function record(junction, type, details, now) {
  junction.history.push({
    event_type: type,
    details: details,
    timestamp: new Date(now).toISOString()
  });
}
export function createJunction(id, now) {
  return {
    id: id,
    mode: "RECOVERY",
    stage: "ALL_RED",
    phase: null,
    desired_signals: signalsFor(null, "RED"),
    actual_signals: signalsFor(null, "UNKNOWN"),
    controller_status: "UNKNOWN",
    sensor_status: {},
    signal_status: {},
    vehicles: [],
    processed: {},
    sequences: {},
    pending: null,
    deadline: null,
    manual: null,
    alerts: [],
    history: [],
    last_green_phase: null,
    last_served_at: {},
    device_events: {}
  };
}
function request(junction, stage, phase, now) {
  let color = "RED";
  if (stage === "GREEN") {
    color = "GREEN";
  }
  if (stage === "YELLOW") {
    color = "YELLOW";
  }
  junction.stage = stage;
  junction.phase = phase;
  junction.desired_signals = signalsFor(phase, color);
  junction.pending = {
    command_id: randomUUID(),
    junction_id: junction.id,
    signals: junction.desired_signals,
    created_at: now,
    expires_at: now + timing.ack
  };
  junction.deadline = null;
  junction.green_confirmation = null;
  junction.simulation_green_since = {};
  record(junction, "SIGNAL_STATE_REQUESTED", junction.pending, now);
}
export function fail(junction, reason, now) {
  const previousMode = junction.mode;
  junction.mode = "FAILURE";
  if (previousMode !== junction.mode) {
    record(junction, "MODE_CHANGED", junction.mode, now);
  }
  if (!junction.alerts.includes(reason)) {
    junction.alerts.push(reason);
  }
  junction.actual_signals = signalsFor(null, "UNKNOWN");
  junction.green_confirmation = null;
  junction.simulation_green_since = {};
  if (
    !junction.pending ||
    Object.values(junction.pending.signals).some(function (color) {
      return color !== "RED";
    })
  ) {
    request(junction, "ALL_RED", null, now);
  }
  record(junction, "DEVICE_FAILURE", reason, now);
}
// Startup must invalidate old commands even when a saved device is offline.
export function recover(junction, now, startup) {
  if (startup) {
    junction.actual_signals = signalsFor(null, "UNKNOWN");
    if (junction.controller_status !== "OFFLINE") {
      junction.controller_status = "UNKNOWN";
    }
    junction.pending = null;
    junction.deadline = null;
    junction.green_confirmation = null;
    junction.simulation_green_since = {};
    if (junction.manual && junction.manual.expires_at <= now) {
      junction.manual = null;
      record(junction, "MANUAL_EXPIRED", "Manual hold ended on startup", now);
    }
    request(junction, "ALL_RED", null, now);
    record(junction, "STARTUP_RECOVERY", "Previous physical confirmation invalidated", now);
  }
  if (junction.controller_status === "OFFLINE") {
    fail(junction, "Controller remains offline", now);
    return { status: 409, message: "Report controller ONLINE before recovery" };
  }
  for (const state of Object.values(junction.sensor_status)) {
    if (state === "OFFLINE") {
      fail(junction, "Sensor remains offline", now);
      return { status: 409, message: "Report failed sensors ONLINE before recovery" };
    }
  }
  for (const state of Object.values(junction.signal_status)) {
    if (state === "OFFLINE") {
      fail(junction, "Signal remains offline", now);
      return { status: 409, message: "Report failed signals ONLINE before recovery" };
    }
  }
  if (junction.mode !== "RECOVERY") {
    record(junction, "MODE_CHANGED", "RECOVERY", now);
  }
  junction.mode = "RECOVERY";
  junction.actual_signals = signalsFor(null, "UNKNOWN");
  junction.alerts = [];
  if (!startup) {
    request(junction, "ALL_RED", null, now);
  }
  record(junction, "RECOVERY_STARTED", "Fresh all-red confirmation required", now);
}

function choose(junction, now) {
  let firstEmergency = null;
  for (const vehicle of junction.vehicles) {
    if (vehicle.vehicle_type !== "EMERGENCY") {
      continue;
    }
    if (!firstEmergency || vehicle.received_at < firstEmergency.received_at) {
      firstEmergency = vehicle;
    }
  }
  if (firstEmergency) {
    junction.mode = "EMERGENCY";
    return phaseFor(firstEmergency.direction);
  }
  if (junction.manual && junction.manual.expires_at > now) {
    junction.mode = "MANUAL";
    return junction.manual.phase;
  }
  junction.manual = null;
  junction.mode = "AUTOMATIC";
  const currentPhase = junction.phase || junction.last_green_phase;
  let winner = currentPhase;
  let best = -1;
  let oldestPhase = null;
  let oldestWait = 0;
  for (const phase of Object.keys(phases)) {
    let score = 0;
    for (const vehicle of junction.vehicles) {
      if (phaseFor(vehicle.direction) !== phase) {
        continue;
      }
      let servedAt = 0;
      if (junction.last_served_at) {
        servedAt = junction.last_served_at[phase] || 0;
      }
      const waiting = Math.max(0, now - Math.max(vehicle.received_at, servedAt));
      // Scale the same score by 10000 so equal scores stay exactly equal.
      score += weights[vehicle.vehicle_type] * 10000 + waiting;
      if (waiting > oldestWait && phase !== currentPhase) {
        oldestWait = waiting;
        oldestPhase = phase;
      }
    }
    if (score > best) {
      best = score;
      winner = phase;
    }
    if (score === best && phase === currentPhase) {
      winner = phase;
    }
  }
  if (oldestWait >= timing.starvation) {
    return oldestPhase;
  }
  return winner;
}
export function advance(junction, now) {
  if (junction.manual && junction.manual.expires_at <= now) {
    junction.manual = null;
    record(junction, "MANUAL_EXPIRED", "Manual hold ended", now);
  }
  if (junction.pending && now >= junction.pending.expires_at) {
    record(junction, "CONTROLLER_TIMEOUT", junction.pending.command_id, now);
    if (junction.mode === "FAILURE") {
      junction.pending = null;
      if (!junction.alerts.includes("All-red unconfirmed; physical state unknown")) {
        junction.alerts.push("All-red unconfirmed; physical state unknown");
      }
      return;
    }
    fail(junction, "Controller acknowledgement timeout", now);
    return;
  }
  if (junction.mode === "FAILURE" || junction.mode === "RECOVERY") {
    return;
  }
  for (const vehicle of junction.vehicles) {
    if (vehicle.vehicle_type === "EMERGENCY" && now - vehicle.received_at > timing.emergency) {
      fail(junction, "Emergency clearance overdue; operator intervention required", now);
      return;
    }
  }
  const previousMode = junction.mode;
  const next = choose(junction, now);
  if (previousMode !== junction.mode) {
    record(junction, "MODE_CHANGED", junction.mode, now);
  }
  if (junction.pending) {
    return;
  }
  if (junction.stage === "YELLOW") {
    if (now >= junction.deadline) {
      request(junction, "ALL_RED", null, now);
    }
    return;
  }
  if (junction.stage === "ALL_RED") {
    if (now >= junction.deadline) {
      request(junction, "GREEN", next, now);
    }
    return;
  }
  if (next !== junction.phase && (junction.mode !== "AUTOMATIC" || now >= junction.deadline)) {
    record(junction, "SIGNAL_TRANSITION_STARTED", { from: junction.phase, to: next }, now);
    request(junction, "YELLOW", junction.phase, now);
  }
}
export function acknowledge(junction, event, now) {
  record(junction, "CONTROLLER_ACKNOWLEDGEMENT", event, now);
  if (!junction.pending || event.command_id !== junction.pending.command_id) {
    record(junction, "ACK_IGNORED", "Duplicate or obsolete command", now);
    return { status: 200, message: "Duplicate or obsolete acknowledgement ignored" };
  }
  if (junction.controller_status === "OFFLINE") {
    record(
      junction,
      "ACK_REJECTED",
      "Controller offline; physical confirmation unavailable",
      now
    );
    return { status: 409, message: "Controller offline; report ONLINE before confirmation" };
  }
  if (now >= junction.pending.expires_at) {
    advance(junction, now);
    record(junction, "ACK_IGNORED", "Expired command", now);
    return { status: 200, message: "Expired acknowledgement ignored" };
  }
  if (
    event.status !== "ACK" ||
    !signalsMatch(event.actual_signals, junction.desired_signals)
  ) {
    fail(junction, "Controller rejected command or confirmed mismatched signals", now);
    return {
      status: 409,
      message: "Controller rejection or mismatched state; junction entered FAILURE"
    };
  }
  if (Object.values(junction.signal_status).includes("OFFLINE")) {
    record(
      junction,
      "ACK_IGNORED",
      "A failed signal cannot provide whole-junction confirmation",
      now
    );
    return { status: 409, message: "Signal offline; whole-junction confirmation unavailable" };
  }
  const previousSignals = junction.actual_signals;
  junction.actual_signals = {};
  for (const direction of directions) {
    junction.actual_signals[direction] = event.actual_signals[direction];
  }
  junction.controller_status = "ONLINE";
  for (const direction of directions) {
    junction.signal_status[direction] = "ONLINE";
  }
  junction.pending = null;
  if (junction.stage === "GREEN") {
    junction.green_confirmation = { command_id: event.command_id, confirmed_at: now };
    junction.simulation_green_since = {};
    for (const direction of phases[junction.phase]) {
      junction.simulation_green_since[direction] = {
        command_id: event.command_id,
        since: now
      };
    }
    junction.deadline = now + timing.green;
    junction.last_green_phase = junction.phase;
    if (!junction.last_served_at) {
      junction.last_served_at = {};
    }
    junction.last_served_at[junction.phase] = now;
  }
  if (junction.stage === "YELLOW") {
    junction.deadline = now + timing.yellow;
  }
  if (junction.stage === "ALL_RED") {
    junction.deadline = now + timing.clearance;
  }
  record(
    junction,
    "SIGNAL_STATE_CONFIRMED",
    {
      command_id: event.command_id,
      previous_signals: previousSignals,
      signals: junction.actual_signals
    },
    now
  );
  if (junction.mode === "RECOVERY") {
    junction.mode = "AUTOMATIC";
    record(junction, "MODE_CHANGED", junction.mode, now);
  }
  return { status: 200, message: "Controller state confirmed", command_id: event.command_id };
}
export function signalsMatch(actual, expected) {
  if (!actual || typeof actual !== "object") {
    return false;
  }
  for (const direction of directions) {
    if (actual[direction] !== expected[direction]) {
      return false;
    }
  }
  return true;
}
export function sensorEvent(junction, event, now) {
  if (event.simulated !== undefined && typeof event.simulated !== "boolean") {
    const error = new Error("simulated must be boolean");
    error.status = 400;
    throw error;
  }
  const payload = [
    event.direction,
    event.event_type,
    event.vehicle_id,
    event.vehicle_type,
    event.sequence_no,
    event.timestamp
  ];
  const legacyFingerprint = JSON.stringify(payload);
  payload.push(event.simulated === true);
  const fingerprint = JSON.stringify(payload);
  if (Object.hasOwn(junction.processed, event.event_id)) {
    const savedFingerprint = junction.processed[event.event_id];
    // Legacy records did not store simulated. Never replay or promote those IDs.
    const legacyDuplicate = savedFingerprint === legacyFingerprint && event.simulated !== true;
    if (savedFingerprint !== fingerprint && !legacyDuplicate) {
      record(junction, "SENSOR_REJECTED", "Event ID reused with different payload", now);
      return { status: 409, message: "Event ID already has a different payload" };
    }
    record(junction, "DUPLICATE_SENSOR_EVENT", event.event_id, now);
    return { status: 200, message: "Duplicate ignored" };
  }
  if (junction.sensor_status[event.direction] === "OFFLINE") {
    record(junction, "SENSOR_REJECTED", "Sensor is offline: " + event.direction, now);
    return {
      status: 409,
      message: "Sensor is offline; report ONLINE before new vehicle events"
    };
  }
  // Safely store even an event ID named __proto__; normal assignment would be unsafe.
  Object.defineProperty(junction.processed, event.event_id, {
    value: fingerprint,
    enumerable: true,
    writable: true,
    configurable: true
  });
  const last = junction.sequences[event.direction];
  if (last !== undefined && event.sequence_no <= last) {
    record(junction, "SENSOR_REJECTED", "Out-of-order sequence: " + event.event_id, now);
    return { status: 200, message: "Old sequence ignored" };
  }
  junction.sequences[event.direction] = event.sequence_no;
  junction.sensor_status[event.direction] = "ONLINE";
  const index = junction.vehicles.findIndex(function (vehicle) {
    return vehicle.vehicle_id === event.vehicle_id;
  });
  if (event.event_type === "VEHICLE_ARRIVED") {
    if (index >= 0) {
      record(junction, "SENSOR_REJECTED", "Vehicle already waiting", now);
      return { status: 409, message: "Vehicle already waiting" };
    }
    junction.vehicles.push({
      vehicle_id: event.vehicle_id,
      direction: event.direction,
      vehicle_type: event.vehicle_type,
      received_at: now,
      sensor_timestamp: event.timestamp
    });
    record(junction, "VEHICLE_DETECTED", event, now);
    if (event.vehicle_type === "EMERGENCY") {
      record(junction, "EMERGENCY_DETECTED", event.vehicle_id, now);
    }
  } else {
    if (index < 0 || junction.vehicles[index].direction !== event.direction) {
      record(junction, "SENSOR_REJECTED", "No matching waiting vehicle", now);
      return { status: 200, message: "No matching vehicle; queue unchanged" };
    }
    const vehicle = junction.vehicles[index];
    junction.vehicles.splice(index, 1);
    record(junction, "VEHICLE_CLEARED", event, now);
    if (vehicle.vehicle_type === "EMERGENCY") {
      record(junction, "EMERGENCY_CLEARED", event.vehicle_id, now);
    }
  }
  advance(junction, now);
  return { status: 201, message: "Event processed" };
}
export function command(junction, body, now) {
  if (
    !["MANUAL_GREEN_REQUEST", "RETURN_TO_AUTOMATIC", "RECOVER_CONTROLLER"].includes(
      body.command
    )
  ) {
    const error = new Error("Invalid command");
    error.status = 400;
    throw error;
  }
  if (body.command === "MANUAL_GREEN_REQUEST") {
    if (!directions.includes(body.direction)) {
      const error = new Error("Invalid direction");
      error.status = 400;
      throw error;
    }
    if (junction.mode === "FAILURE" || junction.mode === "RECOVERY") {
      const error = new Error(
        "Recover and confirm the controller before requesting manual green"
      );
      error.status = 409;
      throw error;
    }
  }
  if (body.command === "RECOVER_CONTROLLER") {
    return recover(junction, now);
  }
  if (body.command === "RETURN_TO_AUTOMATIC") {
    junction.manual = null;
    record(junction, "RETURN_TO_AUTOMATIC", body, now);
  } else {
    junction.manual = { phase: phaseFor(body.direction), expires_at: now + timing.manual };
    record(junction, "MANUAL_OVERRIDE", junction.manual, now);
  }
  advance(junction, now);
}
export function status(junction) {
  const alerts = [];
  for (const alert of junction.alerts) {
    if (!alerts.includes(alert)) {
      alerts.push(alert);
    }
  }
  const queues = {};
  for (const d of directions) {
    queues[d] = 0;
  }
  for (const vehicle of junction.vehicles) {
    queues[vehicle.direction] += 1;
  }
  return {
    junction_id: junction.id,
    mode: junction.mode,
    phase: junction.phase,
    stage: junction.stage,
    controller_status: junction.controller_status,
    desired_signals: junction.desired_signals,
    actual_signals: junction.actual_signals,
    queues: queues,
    vehicles: junction.vehicles,
    pending: junction.pending,
    alerts: alerts,
    manual: junction.manual,
    sensor_status: junction.sensor_status,
    signal_status: junction.signal_status,
    deadline: junction.deadline,
    sensor_sequences: junction.sequences
  };
}

export function deviceEvent(junction, event, now) {
  if (!junction.device_events) {
    junction.device_events = {};
  }
  const fingerprint = JSON.stringify([
    event.device_type,
    event.direction,
    event.status,
    event.timestamp
  ]);
  if (event.event_id && Object.hasOwn(junction.device_events, event.event_id)) {
    if (junction.device_events[event.event_id] !== fingerprint) {
      record(
        junction,
        "DEVICE_STATUS_REJECTED",
        "Device event ID reused with different payload",
        now
      );
      return { status: 409, message: "Device event ID has a different payload" };
    }
    record(junction, "DEVICE_STATUS_IGNORED", "Duplicate device event", now);
    return { status: 200, message: "Duplicate device report ignored" };
  }
  if (event.event_id) {
    Object.defineProperty(junction.device_events, event.event_id, {
      value: fingerprint,
      enumerable: true,
      writable: true,
      configurable: true
    });
  }
  let previous;
  if (event.device_type === "SIGNAL_CONTROLLER") {
    previous = junction.controller_status;
  }
  if (event.device_type === "SENSOR") {
    previous = junction.sensor_status[event.direction];
  }
  if (event.device_type === "SIGNAL") {
    previous = junction.signal_status[event.direction];
  }
  if (previous === event.status) {
    record(junction, "DEVICE_STATUS_IGNORED", "Device status already " + event.status, now);
    return { status: 200, message: "Unchanged device status ignored" };
  }
  if (event.device_type === "SIGNAL_CONTROLLER") {
    junction.controller_status = event.status;
  }
  if (event.device_type === "SENSOR") {
    junction.sensor_status[event.direction] = event.status;
  }
  if (event.device_type === "SIGNAL") {
    junction.signal_status[event.direction] = event.status;
  }
  record(junction, "DEVICE_STATUS", event, now);
  if (event.status === "OFFLINE") {
    fail(junction, event.device_type + " offline " + (event.direction || ""), now);
  }
  return { status: 200, message: "Device status recorded; recovery is explicit" };
}
