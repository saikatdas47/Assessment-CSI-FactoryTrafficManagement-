import mongoose from "mongoose";
import { createJunction } from "./trafficEngine.js";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { mkdir, readFile, writeFile, rename, readdir } from "node:fs/promises";
import Junction from "../models/Junction.js";
import Settings from "../models/Settings.js";
let available = false;
let directory = new URL("../data/", import.meta.url);
if (process.env.DATA_DIRECTORY) {
  directory = pathToFileURL(resolve(process.env.DATA_DIRECTORY) + "/");
}
export function isStorageConnected() {
  if (!available) {
    return false;
  }
  if (process.env.STORAGE === "mongodb") {
    return mongoose.connection.readyState === 1;
  }
  return true;
}
function hydrate(state) {
  return Object.assign(createJunction(state.id, Date.now()), state);
}
export async function connectStorage() {
  if (
    process.env.TRAFFIC_SIMULATION !== undefined &&
    !["true", "false"].includes(process.env.TRAFFIC_SIMULATION)
  ) {
    throw new Error("TRAFFIC_SIMULATION must be true or false");
  }

  if (process.env.STORAGE && !["local", "mongodb"].includes(process.env.STORAGE)) {
    throw new Error("STORAGE must be local or mongodb");
  }
  if (process.env.STORAGE === "mongodb") {
    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI is required for MongoDB storage");
    }
    await mongoose.connect(process.env.MONGODB_URI, {
      dbName: process.env.MONGODB_DB_NAME || "factory_traffic",
      serverSelectionTimeoutMS: 10000
    });
    await Junction.init();
    await Settings.init();
  } else {
    await mkdir(directory, { recursive: true });
  }
  available = true;
}
export async function loadJunctions() {
  if (process.env.STORAGE === "mongodb") {
    const docs = await Junction.find().lean();
    const states = [];
    for (const doc of docs) {
      states.push(hydrate(doc.state));
    }
    return states;
  }
  const states = [];
  for (const name of await readdir(directory)) {
    if (name.endsWith(".json") && name !== ".traffic-settings.json") {
      states.push(hydrate(JSON.parse(await readFile(new URL(name, directory), "utf8"))));
    }
  }
  return states;
}
export async function saveJunction(junction) {
  try {
    if (process.env.STORAGE === "mongodb") {
      await Junction.replaceOne(
        { _id: junction.id },
        { _id: junction.id, state: junction },
        { upsert: true }
      );
      return;
    }
    const temporary = new URL(junction.id + ".tmp", directory);
    await writeFile(temporary, JSON.stringify(junction, null, 2));
    await rename(temporary, new URL(junction.id + ".json", directory));
  } catch (error) {
    available = false;
    throw error;
  }
}

export async function loadSettings() {
  if (process.env.STORAGE === "mongodb") {
    return Settings.findById("traffic").lean();
  }
  try {
    return JSON.parse(await readFile(new URL(".traffic-settings.json", directory), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}
export async function saveSettings(document) {
  try {
    if (process.env.STORAGE === "mongodb") {
      await Settings.replaceOne({ _id: "traffic" }, document, { upsert: true });
      return;
    }
    const temporary = new URL(".traffic-settings.tmp", directory);
    await writeFile(temporary, JSON.stringify(document, null, 2));
    await rename(temporary, new URL(".traffic-settings.json", directory));
  } catch (error) {
    available = false;
    throw error;
  }
}
