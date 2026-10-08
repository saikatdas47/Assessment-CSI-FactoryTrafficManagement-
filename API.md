# API documentation

Development base URL: http://localhost:4000. Render uses the same deployment URL for dashboard and API. POST requests use Content-Type: application/json.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | /health | Storage health, auto_ack and auto_departures |
| GET | /api/junctions | Junction list |
| POST | /api/junctions | Create junction, body `{ "id": "B" }` |
| GET | /api/junctions/A | Junction status |
| GET | /api/junctions/A/status | Same status, queues and sensor_sequences |
| GET | /api/junctions/A/history?limit=50 | Recent events; max 200 |
| POST | /api/sensor-events | Arrival or clearance |
| POST | /api/junctions/A/commands | Operator intent |
| POST | /api/controller-events | ACK/NACK or device report |
| POST | /api/junctions/A/scenarios | One-click preset |
| GET/POST | /api/settings | Read/save complete persisted traffic policy with revision |
| GET/POST | /api/simulator | Automatic controller confirmation setting |

## Vehicle arrival

```json
{
  "event_id": "evt-1",
  "junction_id": "A",
  "direction": "EAST",
  "event_type": "VEHICLE_ARRIVED",
  "vehicle_id": "VH-1",
  "vehicle_type": "TRUCK",
  "sequence_no": 1,
  "timestamp": "2026-10-08T10:00:00Z"
}
```

Use a fresh event ID and the latest `sensor_sequences.EAST + 1` from status. Replace the illustrative timestamp with current UTC time. Timestamp must be valid UTC ISO and at most 60 seconds into the future. Sequence is monotonic per junction/direction across arrivals and exits.

| vehicle_type | Category | Normal weight |
| --- | --- | --- |
| FORKLIFT | Forklift | 2 |
| TRUCK | Delivery truck | 3 |
| MATERIAL_VEHICLE | Material-carrying vehicle | 2 |
| EMPLOYEE_VEHICLE | Employee transport | 1 |
| EMERGENCY | Emergency vehicle | Separate highest-priority policy |

Optional `simulated` must be boolean. Omitted equals false in the fingerprint. Changed false-to-true reuse of an event ID is 409. The field is metadata; **demo departures apply to every queued vehicle**, regardless of this value. Old six-field fingerprints remain retained conservatively: matching omitted/false duplicates are ignored; uncertain true/changed reuse is rejected.

## Clearance

```json
{
  "event_id": "evt-2",
  "junction_id": "A",
  "direction": "EAST",
  "event_type": "VEHICLE_CLEARED",
  "vehicle_id": "VH-1",
  "sequence_no": 2,
  "timestamp": "2026-10-08T10:00:05Z"
}
```

Direction and vehicle must match a waiting entry. Unknown clearance leaves the queue unchanged but advances the accepted stream sequence. Duplicate exits cannot create negative counts.

With saved `demo.automatic_departures=true` (default), the backend generates these exits for all queued vehicles: one per confirmed GREEN direction per configured interval (default three seconds). With `false`, only external/manual exits remove vehicles.

## Operator command

```json
{ "command": "MANUAL_GREEN_REQUEST", "direction": "WEST" }
```

Other commands: `{ "command": "RETURN_TO_AUTOMATIC" }` and `{ "command": "RECOVER_CONTROLLER" }`. Manual request does not force GREEN; the engine completes safe switching. Failure/recovery blocks manual GREEN. Restore every known offline controller/signal/sensor before recovery.

## Device report

```json
{
  "event_id": "device-1",
  "junction_id": "A",
  "device_type": "SIGNAL_CONTROLLER",
  "status": "OFFLINE"
}
```

Supported device types: SIGNAL_CONTROLLER, SIGNAL, SENSOR. SIGNAL/SENSOR require NORTH/SOUTH/EAST/WEST direction. Status: ONLINE or OFFLINE. Optional event_id makes reports idempotent; changed payload reuse is 409. Optional timestamp must be valid UTC ISO. Repeated unchanged reports do not extend pending-command timeout. ONLINE reporting alone does not recover traffic.

## Controller acknowledgement

Read `pending` from status. Copy current command ID and full requested signals map:

```json
{
  "junction_id": "A",
  "command_id": "COPY_CURRENT_ID",
  "status": "ACK",
  "actual_signals": { "NORTH": "RED", "SOUTH": "RED", "EAST": "RED", "WEST": "RED" }
}
```

The map must match the pending request. NACK/mismatch enters failure. Current ACK from a known OFFLINE controller is rejected. Duplicate/obsolete/expired ACKs are ignored and audited. Old pre-restart command IDs cannot change recovered physical state. A fresh UNKNOWN startup controller can establish ONLINE through matching safe confirmation.

The assignment's partial actual_state example is replaced with a full map: one command represents one atomic four-signal operation.

## Presets and simulator settings

POST /api/junctions/A/scenarios:

```json
{ "scenario": "NORMAL" }
```

NORMAL: N3/S2/E3/W2. PRIORITY: N4 employees/E3 trucks/W2 forklifts. EMERGENCY: one emergency opposite the current phase. Presets add to current queues; they do not reset devices or manual intent.

POST /api/simulator with `{ "automatic_ack": false }` disables automatic simulated controller ACK globally; true enables it. This compatibility endpoint persists the automatic_ack flag in the same settings document. AUTO_ACK seeds only the first setup.

GET /health includes `auto_departures` reflecting the saved active demo setting. Change it through Admin or /api/settings; restart is not required.

## HTTP response codes

| Code | Meaning |
| --- | --- |
| 201 | Applied arrival/matching clearance; scenario/junction creation |
| 200 | Successful status/ACK/device report; duplicate/old-sequence/unknown-clearance/obsolete event with explicit ignored message |
| 400 | Invalid command, payload, category, simulated value or timestamp |
| 404 | Unknown junction or route |
| 409 | Changed ID payload, duplicate waiting vehicle/junction, rejected confirmation or blocked recovery |
| 413 | JSON request exceeds 32kb |
| 500 | Unexpected persistence write failure; state not committed |
| 503 | Storage unavailable; queued operation stopped |

ACK responses distinguish accepted, ignored and rejected physical confirmation. They never claim GREEN execution merely because a command was requested.


## Admin settings

GET `/api/settings` returns `{ "values": {...}, "revision": 1, "updated_at": "..." }`.
POST `/api/settings` replaces the complete validated policy using the currently saved revision. All stored times are milliseconds; the Admin form displays seconds.

```json
{
  "revision": 1,
  "values": {
    "timing": { "green": 30000, "yellow": 5000, "clearance": 2000, "ack": 5000, "manual": 60000, "starvation": 90000, "emergency": 180000 },
    "weights": { "EMPLOYEE_VEHICLE": 1, "FORKLIFT": 2, "MATERIAL_VEHICLE": 2, "TRUCK": 3 },
    "scheduling": { "weight_scale": 10000, "waiting_multiplier": 1 },
    "demo": { "automatic_ack": true, "automatic_departures": true, "departure_interval": 3000 }
  }
}
```

Returns saved values with a new revision. Invalid/missing/unknown fields return 400. Stale revision returns 409; reload before saving again. Integer limits in milliseconds: green 1000–300000, yellow 5000–30000, clearance 2000–30000, ACK 1000–60000; manual/starvation/emergency 1000–600000; departure interval 1000–60000. Weights 1–100 with truck >= forklift/material >= employee. Scale 1–100000 and wait multiplier 1–100. Demo toggles must be booleans. Emergency precedence and arbitrary signal maps cannot be changed.

Policy is shared across junctions. Existing transition timers and accepted manual/emergency expiries do not change. Controller controls target the Admin-selected junction. POST `/api/junctions` with `{ "id": "B" }` creates an independent junction using the same engine. Duplicate ID returns 409. No junction delete or authentication is supplied for this assessment.
