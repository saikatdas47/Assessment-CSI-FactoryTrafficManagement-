import { startScenario } from "../services/trafficSimulator.js";
import * as service from "../services/junctionService.js";
import {
  status,
  sensorEvent,
  command,
  acknowledge,
  deviceEvent,
  record
} from "../services/trafficEngine.js";
import { check, validateSensor, text, validTimestamp } from "../utils/validation.js";
import { directions } from "../config/trafficConfig.js";
export function list(req, res) {
  const junctions = [];
  for (const id of service.ids()) {
    junctions.push(status(service.get(id)));
  }
  res.json(junctions);
}
export function detail(req, res) {
  const junction = service.get(req.params.id);
  if (!junction) {
    return res.status(404).json({ message: "Junction not found" });
  }
  res.json(status(junction));
}
export async function create(req, res) {
  check(
    typeof req.body.id === "string" && /^[A-Z0-9_-]{1,20}$/.test(req.body.id),
    "id must contain 1-20 uppercase letters, digits, underscore or hyphen"
  );
  const junction = await service.add(req.body.id);
  res.status(201).json(status(junction));
}
export async function sensor(req, res) {
  try {
    validateSensor(req.body);
  } catch (error) {
    if (service.get(req.body.junction_id)) {
      await service.run(req.body.junction_id, function (junction) {
        record(junction, "SENSOR_REJECTED", error.message, Date.now());
      });
    }
    throw error;
  }
  const result = await service.run(req.body.junction_id, function (junction) {
    return sensorEvent(junction, req.body, Date.now());
  });
  res.status(result.status).json(result);
}
export async function control(req, res) {
  const body = req.body;
  check(
    ["MANUAL_GREEN_REQUEST", "RETURN_TO_AUTOMATIC", "RECOVER_CONTROLLER"].includes(
      body.command
    ),
    "Invalid command"
  );
  if (body.command === "MANUAL_GREEN_REQUEST") {
    check(directions.includes(body.direction), "Invalid direction");
  }
  const result = await service.run(req.params.id, function (junction) {
    return command(junction, body, Date.now());
  });
  if (result) {
    return res.status(result.status).json(result);
  }
  detail(req, res);
}
export async function controller(req, res) {
  const event = req.body;
  check(typeof event.junction_id === "string", "junction_id required");
  if (event.command_id) {
    check(
      typeof event.command_id === "string" && ["ACK", "NACK"].includes(event.status),
      "Invalid acknowledgement"
    );
    if (event.status === "ACK") {
      check(
        event.actual_signals && typeof event.actual_signals === "object",
        "actual_signals map required"
      );
      const normalized = {};
      for (const direction of directions) {
        check(
          ["RED", "YELLOW", "GREEN"].includes(event.actual_signals[direction]),
          "All four actual signals required"
        );
        normalized[direction] = event.actual_signals[direction];
      }
      event.actual_signals = normalized;
    }
  } else {
    if (event.event_id !== undefined) {
      check(text(event.event_id), "Invalid device event_id");
    }
    if (event.timestamp !== undefined) {
      check(validTimestamp(event.timestamp), "Invalid device timestamp");
    }
    check(
      ["SIGNAL_CONTROLLER", "SENSOR", "SIGNAL"].includes(event.device_type),
      "Invalid device_type"
    );
    check(["ONLINE", "OFFLINE"].includes(event.status), "Invalid device status");
    if (event.device_type !== "SIGNAL_CONTROLLER") {
      check(directions.includes(event.direction), "Direction required");
    }
  }
  const result = await service.run(event.junction_id, function (junction) {
    const now = Date.now();
    if (event.command_id) {
      return acknowledge(junction, event, now);
    }
    return deviceEvent(junction, event, now);
  });
  if (result) {
    return res.status(result.status).json(result);
  }
  res.json({ message: "Controller acknowledgement processed; see status/history" });
}
export function history(req, res) {
  const junction = service.get(req.params.id);
  if (!junction) {
    return res.status(404).json({ message: "Junction not found" });
  }
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  res.json(junction.history.slice(-limit).reverse());
}

export async function scenario(req, res) {
  const result = await service.run(req.params.id, function (junction) {
    return startScenario(junction, req.body.scenario, Date.now());
  });
  res.status(result.status).json(result);
}
