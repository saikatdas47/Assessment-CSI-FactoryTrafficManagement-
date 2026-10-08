import { createJunction, recover, advance } from "./trafficEngine.js";
import { loadJunctions, saveJunction, isStorageConnected } from "./storageService.js";
import { simulateController } from "./controllerSimulator.js";
import { simulateDepartures } from "./trafficSimulator.js";
const junctions = new Map();
const tasks = new Map();
const creating = new Set();
export function ids() {
  return Array.from(junctions.keys());
}
export function get(id) {
  return junctions.get(id);
}
export function run(id, operation) {
  const previousTask = tasks.get(id);
  const nextTask = runAfterPrevious(previousTask, id, operation);
  tasks.set(id, nextTask);
  return nextTask;
}

async function runAfterPrevious(previousTask, id, operation) {
  if (previousTask) {
    try {
      await previousTask;
    } catch (error) {
      // A failed request must not permanently block later requests.
      // Storage health is checked again below before doing any work.
    }
  }
  if (!isStorageConnected()) {
    const error = new Error("Storage unavailable; queued operation stopped");
    error.status = 503;
    throw error;
  }
  const saved = junctions.get(id);
  if (!saved) {
    const error = new Error("Junction not found");
    error.status = 404;
    throw error;
  }

  // Change a copy. Only publish it in memory after the database save succeeds.
  const copy = JSON.parse(JSON.stringify(saved));
  const result = await operation(copy);
  if (JSON.stringify(copy) !== JSON.stringify(saved)) {
    await saveJunction(copy);
    junctions.set(id, copy);
  }
  return result;
}
export async function add(id) {
  if (junctions.has(id) || creating.has(id)) {
    const error = new Error("Junction already exists");
    error.status = 409;
    throw error;
  }
  const junction = createJunction(id, Date.now());
  recover(junction, Date.now());
  // Reserve the ID until persistence completes.
  creating.add(id);
  try {
    await saveJunction(junction);
    junctions.set(id, junction);
  } finally {
    creating.delete(id);
  }
  return junction;
}
export async function initialize() {
  for (const junction of await loadJunctions()) {
    junctions.set(junction.id, junction);
  }
  if (junctions.size === 0) {
    await add("A");
  }
  for (const id of ids()) {
    await run(id, function (junction) {
      recover(junction, Date.now(), true);
    });
  }
}
export async function tick() {
  if (!isStorageConnected()) {
    throw new Error("Storage unavailable; traffic processing stopped");
  }
  for (const id of ids()) {
    await run(id, function (junction) {
      const now = Date.now();
      advance(junction, now);
      simulateController(junction, now);
      simulateDepartures(junction, now);
    });
  }
}
