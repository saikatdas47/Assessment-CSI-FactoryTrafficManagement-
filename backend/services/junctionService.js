import { createJunction, recover, advance } from "./trafficEngine.js";
import { loadJunctions, saveJunction, isStorageConnected } from "./storageService.js";
import { simulateController } from "./controllerSimulator.js";
import { simulateDepartures } from "./trafficSimulator.js";
const junctions = new Map();
const tasks = new Map();
const creating = new Set();
export function ids() { return Array.from(junctions.keys()); }
export function get(id) { return junctions.get(id); }
export async function run(id, operation) {
  const previous = tasks.get(id) || Promise.resolve();
  const next = previous.catch(function() {}).then(async function() {
    if (!isStorageConnected()) {
      const error = new Error("Storage unavailable; queued operation stopped"); error.status = 503; throw error;
    }
    const saved = junctions.get(id);
    if (!saved) { const error = new Error("Junction not found"); error.status = 404; throw error; }
    const copy = JSON.parse(JSON.stringify(saved));
    const result = await operation(copy);
    if (JSON.stringify(copy) !== JSON.stringify(saved)) {
      await saveJunction(copy);
      junctions.set(id, copy);
    }
    return result;
  });
  tasks.set(id, next);
  return next;
}
export async function add(id) {
  if (junctions.has(id) || creating.has(id)) { const error = new Error("Junction already exists"); error.status = 409; throw error; }
  const j = createJunction(id, Date.now());
  recover(j, Date.now());
  // Reserve the ID until persistence completes.
  creating.add(id);
  try { await saveJunction(j); junctions.set(id, j); } finally { creating.delete(id); }
  return j;
}
export async function initialize() {
  for (const j of await loadJunctions()) junctions.set(j.id, j);
  if (junctions.size === 0) await add("A");
  for (const id of ids()) await run(id, function(j) { recover(j, Date.now(), true); });
}
export async function tick() {
  if (!isStorageConnected()) throw new Error("Storage unavailable; traffic processing stopped");
  for (const id of ids()) {
    await run(id, function(j) {
      const now = Date.now();
      advance(j, now);
      simulateController(j, now);
      simulateDepartures(j, now);
    });
  }
}
