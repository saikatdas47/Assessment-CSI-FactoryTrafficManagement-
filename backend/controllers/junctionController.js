import { startScenario, markSimulated } from "../services/trafficSimulator.js";
import * as service from "../services/junctionService.js";
import { status, sensorEvent, command, acknowledge, deviceEvent, record } from "../services/trafficEngine.js";
import { check, validateSensor, text, validTimestamp } from "../utils/validation.js";
import { directions } from "../config/trafficConfig.js";
export function list(req, res) { res.json(service.ids().map(function(id) { return status(service.get(id)); })); }
export function detail(req, res) {
  const j = service.get(req.params.id);
  if (!j) return res.status(404).json({ message: "Junction not found" });
  res.json(status(j));
}
export async function create(req, res) {
  check(typeof req.body.id === "string" && /^[A-Z0-9_-]{1,20}$/.test(req.body.id), "id must contain 1-20 uppercase letters, digits, underscore or hyphen");
  res.status(201).json(status(await service.add(req.body.id)));
}
export async function sensor(req, res) {
  try { validateSensor(req.body); } catch (error) {
    if (service.get(req.body.junction_id)) {
      await service.run(req.body.junction_id, function(j) { record(j, "SENSOR_REJECTED", error.message, Date.now()); });
    }
    throw error;
  }
  const result = await service.run(req.body.junction_id, function(j) { const result = sensorEvent(j, req.body, Date.now());
    if (req.body.simulated === true && req.body.event_type === "VEHICLE_ARRIVED" && result.status === 201) markSimulated(j, req.body.vehicle_id);
    return result; });
  res.status(result.status).json(result);
}
export async function control(req, res) {
  const body = req.body;
  check(["MANUAL_GREEN_REQUEST", "RETURN_TO_AUTOMATIC", "RECOVER_CONTROLLER"].includes(body.command), "Invalid command");
  if (body.command === "MANUAL_GREEN_REQUEST") check(directions.includes(body.direction), "Invalid direction");
  const result = await service.run(req.params.id, function(j) { return command(j, body, Date.now()); });
  if (result) return res.status(result.status).json(result);
  detail(req, res);
}
export async function controller(req, res) {
  const e = req.body;
  check(typeof e.junction_id === "string", "junction_id required");
  if (e.command_id) {
    check(typeof e.command_id === "string" && ["ACK", "NACK"].includes(e.status), "Invalid acknowledgement");
    if (e.status === "ACK") {
      check(e.actual_signals && typeof e.actual_signals === "object", "actual_signals map required");
      const normalized = {};
      for (const d of directions) {
        check(["RED", "YELLOW", "GREEN"].includes(e.actual_signals[d]), "All four actual signals required");
        normalized[d] = e.actual_signals[d];
      }
      e.actual_signals = normalized;
    }
  } else {
    if (e.event_id !== undefined) check(text(e.event_id), "Invalid device event_id");
    if (e.timestamp !== undefined) check(validTimestamp(e.timestamp), "Invalid device timestamp");
    check(["SIGNAL_CONTROLLER", "SENSOR", "SIGNAL"].includes(e.device_type), "Invalid device_type");
    check(["ONLINE", "OFFLINE"].includes(e.status), "Invalid device status");
    if (e.device_type !== "SIGNAL_CONTROLLER") check(directions.includes(e.direction), "Direction required");
  }
  const result = await service.run(e.junction_id, function(j) {
    const now = Date.now();
    if (e.command_id) return acknowledge(j, e, now);
    return deviceEvent(j, e, now);
  });
  if (result) return res.status(result.status).json(result);
  res.json({ message: "Controller acknowledgement processed; see status/history" });
}
export function history(req, res) {
  const j = service.get(req.params.id);
  if (!j) return res.status(404).json({ message: "Junction not found" });
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  res.json(j.history.slice(-limit).reverse());
}

export async function scenario(req, res) {
  const result = await service.run(req.params.id, function(j) { return startScenario(j, req.body.scenario, Date.now()); });
  res.status(result.status).json(result);
}
