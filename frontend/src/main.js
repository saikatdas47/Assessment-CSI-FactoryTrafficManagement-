import "./styles.css";
import { api } from "./api.js";
import { settingFields, fieldValue, storedValue } from "./adminData.js";
import { validateStatus, validateHistory, nextSequence } from "./dashboardData.js";
import { vehicleName, roadName, phaseName, modeName, transitionText, activityTitle, activityText, signalSummary, actionMessage } from "./displayText.js";
const $ = function(id) { return document.getElementById(id); };
const directions = ["NORTH", "SOUTH", "EAST", "WEST"];
const actionIds = ["scenario-normal", "scenario-priority", "scenario-emergency", "manual", "automatic", "recover", "arrive", "clear", "duplicate", "ack", "nack", "offline", "device-offline", "device-online", "toggle-ack"];
let current = null;
let lastEvent = null;
let refreshTask = null;
let automaticAck = true;
let automaticDepartures = true;
let loadError = false;
let savedSettings = null;
let displaySettings = null;
const busy = {};
function element(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}
function showMessage(type, message) {
  $("error").textContent = "";
  $("feedback").textContent = "";
  $(type).textContent = message;
  $("notifications").hidden = !message;
}
function updateButtons() {
  const ready = current && current.junction_id === $("junction").value;
  for (const id of actionIds) {
    let enabled = Boolean(ready) && !busy[id];
    if (id === "ack" || id === "nack") enabled = enabled && Boolean(current.pending);
    if (id === "duplicate") enabled = enabled && lastEvent && lastEvent.junction_id === $("junction").value;
    if (id.startsWith("scenario-") || id === "manual") enabled = enabled && current.mode !== "FAILURE" && current.mode !== "RECOVERY";
    $(id).disabled = !enabled;
  }
  for (const button of $("vehicles").querySelectorAll("button")) button.disabled = !ready || Boolean(busy.clear);
}
async function loadSnapshot() {
  try {
    const health = await api("/health");
    const id = $("junction").value;
    const snapshot = validateStatus(await api("/api/junctions/" + id + "/status"));
    const history = validateHistory(await api("/api/junctions/" + id + "/history?limit=10"));
    const settingsResponse = await api("/api/settings");
    // A response for the old selection must never replace the new junction view.
    if ($("junction").value !== id) return;
    if (snapshot.junction_id !== id) throw new Error("Backend returned a different junction");
    current = snapshot;
    document.querySelector("main").classList.remove("stale");
    $("connection").textContent = "Backend connected · updated " + new Date().toLocaleTimeString();
    $("live-state").textContent = "LIVE";
    $("live-state").className = "live-badge online";
    displaySettings = settingsResponse.values;
    automaticAck = health.auto_ack;
    automaticDepartures = health.auto_departures !== false;
    $("departure-help").textContent = automaticDepartures ? "All waiting vehicles leave every " + displaySettings.demo.departure_interval / 1000 + " seconds on confirmed green. Old and new vehicles follow the same rule." : "Automatic departure simulation is off. Use Clear vehicle or send an exit-sensor event.";
    $("simulator").textContent = automaticAck ? "Automatic confirmation is on." : "Manual confirmation is on. Confirm pending commands within " + displaySettings.timing.ack / 1000 + " seconds.";
    $("device-help").textContent = "For a device fault: report that device online, then recover. Manual ACK timeout for new commands is " + displaySettings.timing.ack / 1000 + " seconds; use the pending command deadline.";
    $("toggle-ack").textContent = automaticAck ? "Use manual confirmation" : "Use automatic confirmation";
    if (loadError) showMessage("error", "");
    loadError = false;
    render(history);
  } catch (error) {
    current = null;
    document.querySelector("main").classList.add("stale");
    $("connection").textContent = "Backend unavailable · signals may be stale · controls paused";
    $("live-state").textContent = "OFFLINE";
    $("live-state").className = "live-badge offline";
    showMessage("error", "Backend unavailable. Start the backend to reconnect. " + error.message);
    loadError = true;
  }
  updateButtons();
}
function refresh() {
  if (refreshTask) return refreshTask;
  refreshTask = loadSnapshot().finally(function() { refreshTask = null; });
  return refreshTask;
}
function render(history) {
  $("junction-title").textContent = "Junction " + current.junction_id;
  $("yellow-time").textContent = "Yellow · " + displaySettings.timing.yellow / 1000 + "s";
  $("clearance-time").textContent = "All red · " + displaySettings.timing.clearance / 1000 + "s";
  $("mode").textContent = modeName(current.mode);
  $("mode-help").textContent = current.mode === "AUTOMATIC" ? "Backend chooses from queues, priority and waiting time" : current.mode === "EMERGENCY" ? "Emergency overrides normal and manual traffic" : current.mode === "MANUAL" ? "A time-limited operator request is active" : "Fresh safe confirmation is required";
  $("phase-help").textContent = current.mode === "FAILURE" ? "Physical signal state is unconfirmed" : current.pending ? "Requested change · not yet confirmed" : current.stage === "YELLOW" ? "Confirmed yellow clearance" : current.stage === "ALL_RED" ? "Confirmed red clearance" : "Confirmed green movement";
  $("transition-help").textContent = transitionText(current, displaySettings.timing);
  $("state-notice").hidden = current.mode !== "FAILURE" && current.mode !== "RECOVERY";
  $("state-notice").replaceChildren();
  if (current.mode === "FAILURE") {
    const failedDevices = [];
    for (const direction of directions) {
      if (current.signal_status[direction] === "OFFLINE") failedDevices.push(roadName(direction) + " traffic signal");
      if (current.sensor_status[direction] === "OFFLINE") failedDevices.push(roadName(direction) + " vehicle sensor");
    }
    if (current.controller_status === "OFFLINE") failedDevices.push("physical controller");
    const problem = failedDevices.length ? "Offline: " + failedDevices.join(", ") + "." : "Signal confirmation failed or timed out.";
    $("state-notice").append(element("strong", "Traffic is paused at Junction " + current.junction_id), element("p", problem + " Restore the failed device online, then request safe recovery. Waiting vehicles are kept."));
    const link = element("button", "Open Admin for recovery", "secondary"); link.addEventListener("click", openAdmin); $("state-notice").append(link);
  } else if (current.mode === "RECOVERY") $("state-notice").append(element("p", "Safe recovery in progress. Traffic resumes only after fresh all-red confirmation and clearance."));
  const emergencies = current.vehicles.filter(function(vehicle) { return vehicle.vehicle_type === "EMERGENCY"; });
  $("emergency-banner").classList.toggle("active", emergencies.length > 0);
  if (emergencies.length) {
    const emergencyNames = emergencies.map(function(vehicle) { return vehicle.vehicle_id + " from " + roadName(vehicle.direction); });
    $("emergency-banner").textContent = "Emergency at Junction " + current.junction_id + ": " + emergencyNames.join(", ") + ". " + transitionText(current, displaySettings.timing);
  } else $("emergency-banner").textContent = "";
  $("manual-help").textContent = current.manual ? "Manual request: " + phaseName(current.manual.phase) + ". Expires at " + new Date(current.manual.expires_at).toLocaleTimeString() + (current.mode === "EMERGENCY" ? ". Emergency currently takes priority." : ".") : "Manual control lasts " + displaySettings.timing.manual / 1000 + " seconds. Emergency vehicles take priority.";
  $("phase").textContent = current.mode === "FAILURE" ? "Signals unconfirmed" : phaseName(current.phase);
  $("controller").textContent = current.controller_status;
  let total = 0;
  $("intersection").replaceChildren(element("div", "JUNCTION " + current.junction_id, "road-center"));
  for (const direction of directions) {
    total += current.queues[direction];
    const card = element("div", "", "signal " + direction.toLowerCase());
    card.append(element("strong", roadName(direction)));
    const lights = element("div", "", "traffic-lights");
    lights.setAttribute("aria-hidden", "true");
    for (const color of ["RED", "YELLOW", "GREEN"]) {
      let bulbClass = "bulb";
      if (current.actual_signals[direction] === color) bulbClass += " lit " + color.toLowerCase();
      lights.append(element("span", "", bulbClass));
    }
    card.append(lights);
    card.append(element("div", current.actual_signals[direction], "lamp " + current.actual_signals[direction].toLowerCase()));
    card.append(element("small", "Requested: " + current.desired_signals[direction]));
    card.append(element("span", current.queues[direction] + " waiting"));
    card.append(element("small", "Sensor: " + (current.sensor_status[direction] || "UNKNOWN")));
    card.append(element("small", "Signal: " + (current.signal_status[direction] || "UNKNOWN")));
    $("intersection").append(card);
  }
  $("total").textContent = total;
  $("alerts").replaceChildren();
  let mismatch = false;
  for (const d of directions) if (current.desired_signals[d] !== current.actual_signals[d]) mismatch = true;
  if (current.mode === "FAILURE") $("alerts").append(element("p", "Traffic paused. Restore failed devices, then request recovery.", "alert"));
  if (mismatch) $("alerts").append(element("p", "Requested and confirmed signals differ. Check the pending command or device alerts.", "alert"));
  if (current.controller_status === "OFFLINE" || current.controller_status === "UNKNOWN") $("alerts").append(element("p", "Controller " + current.controller_status + ". Physical state requires confirmation.", "alert"));
  for (const direction of directions) {
    if (current.signal_status[direction] === "OFFLINE") $("alerts").append(element("p", roadName(direction) + " traffic signal is offline. In Device health, choose Traffic signal and " + roadName(direction) + ", report online, then request recovery.", "alert"));
    if (current.sensor_status[direction] === "OFFLINE") $("alerts").append(element("p", roadName(direction) + " vehicle sensor is offline. Restore that sensor before sending new events.", "alert"));
  }
  for (const alert of current.alerts) {
    if (alert.startsWith("SIGNAL offline") || alert.startsWith("SENSOR offline") || alert === "Signal remains offline" || alert === "Sensor remains offline") continue;
    $("alerts").append(element("p", alert, "alert"));
  }
  if (current.pending) {
    $("pending").replaceChildren(element("p", signalSummary(current.pending.signals)), element("p", "Confirm by " + new Date(current.pending.expires_at).toLocaleTimeString()), element("small", "Command ID: " + current.pending.command_id));
  } else $("pending").textContent = "None";
  $("vehicles").replaceChildren();
  for (const v of current.vehicles) {
    const row = document.createElement("tr");
    const waiting = Math.max(0, Math.floor((Date.now() - v.received_at) / 1000));
    for (const text of [v.vehicle_id, roadName(v.direction), vehicleName(v.vehicle_type), waiting + " seconds"]) row.append(element("td", text));
    const action = document.createElement("td");
    const clearButton = element("button", "Clear vehicle", "secondary");
    clearButton.disabled = Boolean(busy.clear);
    clearButton.addEventListener("click", function() {
      $("vehicle").value = v.vehicle_id;
      $("direction").value = v.direction;
      document.querySelector('input[name="vehicle-type"][value="' + v.vehicle_type + '"]').checked = true;
      $("clear").click();
    });
    action.append(clearButton); row.append(action);
    $("vehicles").append(row);
  }
  if (!current.vehicles.length) {
    const row = document.createElement("tr"); const cell = element("td", "No waiting vehicles"); cell.colSpan = 5; row.append(cell); $("vehicles").append(row);
  }
  $("history").replaceChildren();
  for (const event of history) {
    const item = element("div", "", "activity");
    const heading = document.createElement("div");
    heading.append(element("time", new Date(event.timestamp).toLocaleTimeString()), element("strong", activityTitle(event.event_type)));
    item.append(heading, element("p", activityText(event, displaySettings.timing)));
    $("history").append(item);
  }
}
function requireCurrent() {
  if (!current || current.junction_id !== $("junction").value) throw new Error("Wait for fresh junction data before sending a command");
  return current;
}
function bind(id, action) {
  $(id).addEventListener("click", async function() {
    const junction = $("junction").value;
    showMessage("feedback", "");
    const buttonText = $(id).textContent;
    busy[id] = true; updateButtons(); $(id).disabled = true;
    if (!id.startsWith("scenario-")) $(id).textContent = "Sending…";
    try {
      const result = await action();
      if (result) {
        let message = actionMessage(id, result);
        message = "Junction " + junction + ": " + message;
        showMessage("feedback", message);
        if (!$("admin-view").hidden) $("admin-message").textContent = message;
      }
      // A poll started before this command may still contain the old state.
      const previousPoll = refreshTask;
      await refresh();
      if (previousPoll) await refresh();
    } catch (error) { showMessage("error", error.message); if (!$("admin-view").hidden) $("admin-message").textContent = error.message; await refresh(); }
    busy[id] = false;
    if (id !== "toggle-ack" && !id.startsWith("scenario-")) $(id).textContent = buttonText;
    updateButtons();
  });
}
function control(command) {
  const snapshot = requireCurrent();
  return api("/api/junctions/" + snapshot.junction_id + "/commands", { command: command, direction: $("manual-direction").value });
}
async function vehicleEvent(type) {
  const snapshot = requireCurrent();
  const direction = $("direction").value;
  const vehicleId = $("vehicle").value.trim();
  if (!vehicleId) throw new Error("Enter a vehicle ID");
  const key = "sequence-" + snapshot.junction_id + "-" + direction;
  let saved = 0;
  try { saved = localStorage.getItem(key); } catch { /* Server sequence still makes the simulator usable. */ }
  const sequence = nextSequence(snapshot.sensor_sequences[direction], saved);
  try { localStorage.setItem(key, sequence); } catch { /* Storage may be unavailable in private browsing. */ }
  const event = { event_id: crypto.randomUUID(), junction_id: snapshot.junction_id, direction: direction,
    event_type: type, vehicle_id: vehicleId, vehicle_type: document.querySelector('input[name="vehicle-type"]:checked').value,
    simulated: true, sequence_no: sequence, timestamp: new Date().toISOString() };
  const result = await api("/api/sensor-events", event);
  lastEvent = event;
  return result;
}
bind("toggle-ack", async function() {
  requireCurrent();
  const result = await api("/api/simulator", { automatic_ack: !automaticAck });
  automaticAck = result.automatic_ack;
  await loadAdminSettings();
  return result;
});
bind("manual", function() { return control("MANUAL_GREEN_REQUEST"); });
bind("automatic", function() { return control("RETURN_TO_AUTOMATIC"); });
bind("recover", function() { return control("RECOVER_CONTROLLER"); });
bind("arrive", function() { return vehicleEvent("VEHICLE_ARRIVED"); });
bind("clear", function() { return vehicleEvent("VEHICLE_CLEARED"); });
bind("duplicate", function() {
  const snapshot = requireCurrent();
  if (!lastEvent || lastEvent.junction_id !== snapshot.junction_id) throw new Error("Submit a vehicle event for this junction first");
  return api("/api/sensor-events", lastEvent);
});
for (const id of ["ack", "nack"]) bind(id, function() {
  const snapshot = requireCurrent();
  if (!snapshot.pending) throw new Error("No pending command");
  return api("/api/controller-events", { junction_id: snapshot.junction_id, command_id: snapshot.pending.command_id,
    status: id === "ack" ? "ACK" : "NACK", actual_signals: snapshot.pending.signals });
});
bind("offline", function() { return api("/api/controller-events", { junction_id: requireCurrent().junction_id, device_type: "SIGNAL_CONTROLLER", status: "OFFLINE" }); });
for (const id of ["device-offline", "device-online"]) bind(id, function() {
  return api("/api/controller-events", { junction_id: requireCurrent().junction_id, direction: $("device-direction").value,
    device_type: $("device").value, status: id === "device-offline" ? "OFFLINE" : "ONLINE" });
});
$("junction").addEventListener("change", async function() {
  current = null; updateButtons(); document.querySelector("main").classList.add("stale");
  $("connection").textContent = "Loading selected junction…";
  await refresh(); await refresh();
});
for (const name of ["normal", "priority", "emergency"]) {
  bind("scenario-" + name, function() {
    return api("/api/junctions/" + requireCurrent().junction_id + "/scenarios", { scenario: name.toUpperCase() });
  });
}
updateButtons(); refresh(); setInterval(refresh, 1000);

async function loadAdminSettings() {
  const result = await api("/api/settings");
  savedSettings = result;
  $("settings-saved").textContent = "Saved revision " + result.revision + " · " + new Date(result.updated_at).toLocaleString();
  $("settings-fields").replaceChildren();
  const groupNames = { timing: "Signal & control timing", weights: "Vehicle priority", scheduling: "Scheduling", demo: "Simulation" };
  const groups = {};
  for (const name of Object.keys(groupNames)) {
    const section = element("section", "", "settings-group");
    section.append(element("h4", groupNames[name]));
    groups[name] = section;
    $("settings-fields").append(section);
  }
  for (const field of settingFields) {
    const label = element("label", "", "setting-row");
    const title = element("span", field[2]);
    label.append(title);
    const input = document.createElement("input");
    input.id = "setting-" + field[1];
    if (field[3] === "boolean") {
      input.type = "checkbox";
      input.checked = result.values[field[0]][field[1]];
    } else {
      input.type = "number";
      input.min = field[4]; input.max = field[5];
      input.step = field[3] === "seconds" ? "0.001" : "1";
      input.required = true;
      input.value = fieldValue(field, result.values[field[0]][field[1]]);
      if (field[3] === "seconds") title.append(element("small", " · sec"));
    }
    label.append(input);
    groups[field[0]].append(label);
  }
}
async function loadAdminJunctions() {
  const junctions = await api("/api/junctions");
  $("admin-junction").replaceChildren();
  $("junction").replaceChildren();
  for (const junction of junctions) {
    for (const name of ["admin-junction", "junction"]) {
      const option = element("option", "Junction " + junction.junction_id);
      option.value = junction.junction_id;
      $(name).append(option);
    }
  }
  const selected = current ? current.junction_id : "A";
  $("admin-junction").value = selected;
  $("junction").value = selected;
}
function showDashboard() {
  $("admin-view").hidden = true;
  $("dashboard-view").hidden = false;
  $("open-admin").textContent = "Admin";
  $("page-title").textContent = "Factory traffic dashboard";
  $("page-description").textContent = "Choose a scenario → watch the signals → vehicles leave on green.";
  window.scrollTo(0, 0);
  refresh();
}
async function openAdmin() {
  $("open-admin").textContent = "← Dashboard";
  $("page-title").textContent = "Factory traffic admin";
  $("page-description").textContent = "Manage saved settings and junctions.";
  window.scrollTo(0, 0);
  $("dashboard-view").hidden = true;
  $("admin-view").hidden = false;
  $("admin-message").textContent = "Loading saved settings…";
  try {
    await loadAdminJunctions();
    await loadAdminSettings();
    $("admin-message").textContent = "";
  } catch (error) { $("admin-message").textContent = error.message; }
}
$("open-admin").addEventListener("click", function() {
  if ($("admin-view").hidden) openAdmin();
  else showDashboard();
});
$("close-admin").addEventListener("click", showDashboard);
$("admin-junction").addEventListener("change", function() {
  $("junction").value = $("admin-junction").value;
  $("junction").dispatchEvent(new Event("change"));
});
$("reload-settings").addEventListener("click", async function() {
  try { await loadAdminSettings(); $("admin-message").textContent = "Saved settings loaded."; }
  catch (error) { $("admin-message").textContent = error.message; }
});
$("add-junction").addEventListener("click", async function() {
  $("add-junction").disabled = true;
  try {
    const id = $("new-junction").value.trim().toUpperCase();
    await api("/api/junctions", { id: id });
    await loadAdminJunctions();
    $("new-junction").value = "";
    $("admin-message").textContent = "Junction " + id + " added. Select it to view its traffic and device controls.";
  } catch (error) { $("admin-message").textContent = error.message; }
  $("add-junction").disabled = false;
});
$("settings-form").addEventListener("submit", async function(event) {
  event.preventDefault();
  $("save-settings").disabled = true;
  try {
    if (!savedSettings) throw new Error("Load saved settings first");
    const values = { timing: {}, weights: {}, scheduling: {}, demo: {} };
    for (const field of settingFields) {
      const input = $("setting-" + field[1]);
      let value = input.value;
      if (field[3] === "boolean") value = input.checked;
      values[field[0]][field[1]] = storedValue(field, value);
    }
    await api("/api/settings", { values: values, revision: savedSettings.revision });
    await loadAdminSettings();
    $("admin-message").textContent = "Settings saved. Running timers keep their original durations.";
    await refresh();
  } catch (error) { $("admin-message").textContent = error.message; }
  $("save-settings").disabled = false;
});
