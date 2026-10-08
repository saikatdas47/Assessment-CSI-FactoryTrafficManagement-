import mongoose from "mongoose";
import { createJunction } from "./trafficEngine.js";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import Junction from "../models/Junction.js";
let available = false;
let directory = new URL("../data/", import.meta.url);
if (process.env.DATA_DIRECTORY) directory = pathToFileURL(resolve(process.env.DATA_DIRECTORY) + "/");
export function isStorageConnected() {
  if (!available) return false;
  if (process.env.STORAGE === "mongodb") return mongoose.connection.readyState === 1;
  return true;
}
function hydrate(state) {
  return Object.assign(createJunction(state.id, Date.now()), state);
}
export async function connectStorage() {
  if (process.env.STORAGE && !["local", "mongodb"].includes(process.env.STORAGE)) throw new Error("STORAGE must be local or mongodb");
  if (process.env.STORAGE === "mongodb") {
    if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required for MongoDB storage");
    await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB_NAME || "factory_traffic", serverSelectionTimeoutMS: 10000 });
    await Junction.init();
  } else {
    await mkdir(directory, { recursive: true });
  }
  available = true;
}
export async function loadJunctions() {
  if (process.env.STORAGE === "mongodb") {
    const docs = await Junction.find().lean();
    return docs.map(function(doc) { return hydrate(doc.state); });
  }
  const states = [];
  const { readdir } = await import("node:fs/promises");
  for (const name of await readdir(directory)) {
    if (name.endsWith(".json")) states.push(hydrate(JSON.parse(await readFile(new URL(name, directory), "utf8"))));
  }
  return states;
}
export async function saveJunction(j) {
  try {
  if (process.env.STORAGE === "mongodb") {
    await Junction.replaceOne({ _id: j.id }, { _id: j.id, state: j }, { upsert: true });
    return;
  }
  const temporary = new URL(j.id + ".tmp", directory);
  await writeFile(temporary, JSON.stringify(j, null, 2));
  await rename(temporary, new URL(j.id + ".json", directory));
  } catch (error) {
    available = false;
    throw error;
  }
}
