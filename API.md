# API examples

Base URL: http://localhost:4000. Content-Type: application/json.

## Vehicle arrival
POST /api/sensor-events
```json
{"event_id":"evt-1","junction_id":"A","direction":"EAST","event_type":"VEHICLE_ARRIVED","vehicle_id":"VH-1","vehicle_type":"EMERGENCY","sequence_no":1,"timestamp":"2026-10-05T10:15:20Z"}
```
Optional `simulated` must be boolean; omission equals false for idempotency. False-to-true reuse of an event ID returns 409 without marking or replaying the vehicle. Legacy six-field fingerprints remain retained: matching omitted/false requests return 200 ignored; true or changed core payload returns 409 conservatively.

These illustrative IDs/sequences assume an empty direction. For an existing junction use a new event ID and the latest sensor_sequences.EAST + 1 from status. Supply a valid UTC ISO timestamp no more than 60 seconds ahead of server time. Repeat the identical payload to demonstrate idempotency. Each direction has its own monotonic sequence.

## Clearance
POST /api/sensor-events
```json
{"event_id":"evt-2","junction_id":"A","direction":"EAST","event_type":"VEHICLE_CLEARED","vehicle_id":"VH-1","sequence_no":2,"timestamp":"2026-10-05T10:16:20Z"}
```

## Operator intent
POST /api/junctions/A/commands
```json
{"command":"MANUAL_GREEN_REQUEST","direction":"WEST"}
```
Other commands: `RETURN_TO_AUTOMATIC`, `RECOVER_CONTROLLER`.

## Device report
POST /api/controller-events
```json
{"junction_id":"A","device_type":"SIGNAL_CONTROLLER","status":"OFFLINE"}
```
Use device_type SENSOR or SIGNAL with direction NORTH/SOUTH/EAST/WEST. ONLINE does not itself recover traffic. Optional event_id makes device reports idempotent; changed payload with the same ID returns 409. Repeating unchanged status leaves the pending command deadline intact. Failed SENSOR rejects new events; failed SIGNAL blocks whole-junction ACK. Report the failed controller/sensor/signal ONLINE before RECOVER_CONTROLLER; otherwise recovery returns 409 and preserves OFFLINE. For a fresh startup, UNKNOWN controller may establish ONLINE through a matching fresh ALL_RED ACK; known OFFLINE cannot. Restart unconditionally supersedes all previous command IDs, even with offline devices. Remaining faults keep FAILURE and block GREEN.

## Controller ACK
Get pending command from GET /api/junctions/A/status. Copy its command_id and entire signals map. POST /api/controller-events:
```json
{"junction_id":"A","command_id":"COPY_CURRENT_ID","status":"ACK","actual_signals":{"NORTH":"RED","SOUTH":"RED","EAST":"RED","WEST":"RED"}}
```
Map must match the current requested map. status NACK enters failure. A stale command ID is ignored. Set AUTO_ACK=false to manually exercise this flow.

## Status and history
GET /api/junctions/A/status
GET /api/junctions/A/history?limit=50
GET /api/junctions
POST /api/junctions with `{ "id": "B" }`.

## Simulator mode
GET /api/simulator
POST /api/simulator with `{ "automatic_ack": false }` disables automatic simulated confirmation globally; true enables it. This affects simulation only and does not bypass the engine.


## Response semantics

Applied arrival and matching clearance: 201. Scenario and junction creation: 201. Duplicate/old-sequence/unknown-clearance/obsolete events: 200 with an ignored message. Changed event payload, duplicate waiting vehicle or junction, rejected physical confirmation, and blocked recovery: 409. Invalid input: 400. Unknown junction: 404. Conflicting IDs, invalid state confirmations or unavailable recovery: 409. Storage unavailable: 503; an unexpected write failure initially returns 500. A successful ACK says Controller state confirmed; rejected ACKs never report success. Delayed/duplicate/expired ACKs return 200 with an explicit ignored message.

The single-direction actual_state example from the assessment is intentionally replaced by the entire actual_signals map. One command describes one atomic four-signal operation; partial acknowledgement cannot establish junction safety.


## Vehicle category names

| API vehicle_type | Dashboard label | Normal weight |
| --- | --- | --- |
| FORKLIFT | Forklift | 2 |
| TRUCK | Delivery truck | 3 |
| MATERIAL_VEHICLE | Material-carrying vehicle | 2 |
| EMPLOYEE_VEHICLE | Employee transport | 1 |
| EMERGENCY | Emergency vehicle | Separate highest-priority policy |

MATERIAL_VEHICLE extends the four-item API example to include the scenario's fifth category. Existing API names remain unchanged.

## Demo scenarios
POST `/api/junctions/A/scenarios` with `{ "scenario": "NORMAL" }`, `PRIORITY` or `EMERGENCY`. Returns 201 on success, 400 for an unknown preset, 409 for unhealthy state. Adds to queues without resetting them. Dashboard sensor events include `simulated: true`; only marked vehicles receive automatic simulator-generated clearance on confirmed green.
