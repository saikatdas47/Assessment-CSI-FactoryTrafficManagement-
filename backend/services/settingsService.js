import { getSettings, applySettings } from "../config/trafficConfig.js";
import { loadSettings, saveSettings, isStorageConnected } from "./storageService.js";
import { check } from "../utils/validation.js";
let revision = 0;
let updatedAt = null;
let previousTask = Promise.resolve();
const ranges = {
  timing: { green: [1000, 300000], yellow: [5000, 30000], clearance: [2000, 30000],
    ack: [1000, 60000], manual: [1000, 600000], starvation: [1000, 600000], emergency: [1000, 600000] },
  weights: { EMPLOYEE_VEHICLE: [1, 100], FORKLIFT: [1, 100], MATERIAL_VEHICLE: [1, 100], TRUCK: [1, 100] },
  scheduling: { weight_scale: [1, 100000], waiting_multiplier: [1, 100] },
  demo: { automatic_ack: null, automatic_departures: null, departure_interval: [1000, 60000] }
};
export function validateSettings(values) {
  check(values && typeof values === "object" && !Array.isArray(values), "Settings object required");
  check(Object.keys(values).length === Object.keys(ranges).length, "Supply exactly the four settings groups");
  for (const group of Object.keys(ranges)) {
    const fields = values[group];
    check(fields && typeof fields === "object" && !Array.isArray(fields), "Missing settings group: " + group);
    check(Object.keys(fields).length === Object.keys(ranges[group]).length, "Invalid fields in " + group);
    for (const name of Object.keys(ranges[group])) {
      const range = ranges[group][name];
      const value = fields[name];
      if (!range) {
        check(typeof value === "boolean", name + " must be boolean");
      } else {
        check(Number.isSafeInteger(value) && value >= range[0] && value <= range[1],
          name + " must be an integer between " + range[0] + " and " + range[1]);
      }
    }
  }
  check(values.weights.TRUCK >= values.weights.FORKLIFT &&
    values.weights.TRUCK >= values.weights.MATERIAL_VEHICLE &&
    values.weights.FORKLIFT >= values.weights.EMPLOYEE_VEHICLE &&
    values.weights.MATERIAL_VEHICLE >= values.weights.EMPLOYEE_VEHICLE,
    "Keep truck >= forklift/material >= employee priority");
  return values;
}
export function readSettings() {
  return { values: getSettings(), revision: revision, updated_at: updatedAt };
}
export async function initializeSettings() {
  let document = await loadSettings();
  if (!document) {
    document = { _id: "traffic", values: getSettings(), revision: 1, updated_at: new Date().toISOString() };
    validateSettings(document.values);
    await saveSettings(document);
  }
  validateSettings(document.values);
  check(Number.isSafeInteger(document.revision) && document.revision >= 1, "Invalid saved settings revision");
  applySettings(document.values);
  revision = document.revision;
  updatedAt = document.updated_at;
}
export function updateSettings(values, expectedRevision) {
  validateSettings(values);
  check(Number.isSafeInteger(expectedRevision) && expectedRevision >= 1, "Valid settings revision required");
  const copy = JSON.parse(JSON.stringify(values));
  const task = saveAfterPrevious(previousTask, copy, expectedRevision);
  previousTask = task.catch(function () {});
  return task;
}
async function saveAfterPrevious(previous, values, expectedRevision) {
  await previous;
  if (!isStorageConnected()) {
    const error = new Error("Storage unavailable");
    error.status = 503;
    throw error;
  }
  if (expectedRevision !== revision) {
    const error = new Error("Settings changed. Reload saved settings before saving again.");
    error.status = 409;
    throw error;
  }
  validateSettings(values);
  const document = { _id: "traffic", values: values, revision: revision + 1, updated_at: new Date().toISOString() };
  await saveSettings(document);
  applySettings(values);
  revision = document.revision;
  updatedAt = document.updated_at;
  return readSettings();
}
