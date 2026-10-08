# Factory Traffic Management System

Node.js / Express / MongoDB (Mongoose) / Vite with plain JavaScript.
A small single-process control system with REST controller simulation. No real hardware integration.

## Setup and run

Requires Node.js 20.19+ or 22.12+.

Terminal 1:
```sh
cd backend
cp .env.example .env
npm install
npm run dev
```
Terminal 2:
```sh
cd frontend
npm install
npm run dev
```
Open http://localhost:5173. API: http://localhost:4000. Run `npm test` in backend; run `npm run build` in frontend.

The supplied `.env.example` enables **local persistent storage and automatic simulated ACK** for an immediately runnable demonstration. No credentials are committed. Local files live in `backend/data/` and survive restart. To use MongoDB Atlas, configure:
```dotenv
PORT=4000
STORAGE=mongodb
MONGODB_URI=mongodb+srv://USERNAME:PASSWORD@YOUR_CLUSTER_HOST/
MONGODB_DB_NAME=factory_traffic
AUTO_ACK=true
```
Use your actual URI privately in `backend/.env`. A cluster hostname is required. The current correctness run used the private connection configuration only with a temporary `factory_traffic_audit_*` database. MongoDB writes, restart invalidation with offline controller/sensor/signal, retained event IDs and explicit recovery passed there. Working Junction A was not used. Earlier working-database and source-ZIP verification notes are historical, not evidence from this run. Database credentials are not a database name.

## Architecture

`index.js`: configuration, storage initialization, recovery, background tick, server startup.
`app.js`: Express middleware, routing, errors.
`routes/`: URL-to-controller mapping.
`controllers/`: validation and application calls.
`services/junctionService.js`: serialized per-junction processing and persistence boundary.
`services/trafficEngine.js`: traffic decisions; no HTTP, Mongoose or frontend dependency.
`services/storageService.js`: MongoDB adapter and local atomic-file adapter.
`models/Junction.js`: persistence schema.
`config/trafficConfig.js`: movements, priorities and timing.
`frontend/src/`: API consumer, rendering and simulation only.

Each junction snapshot contains queues, processed IDs, stream sequences, mode, desired/actual state, pending command, manual state and audit history. MongoDB replaces one document atomically, so an accepted event and its queue/history changes cannot be partially committed across documents. This deliberately avoids multi-document transactions and works without a replica set. Every mutation operates on a copy; memory is replaced only after storage succeeds. Local storage uses temporary-file rename. One backend instance only; multi-instance locking is not implemented. A storage failure in the scheduler stops the process rather than continuing control with uncommitted state. Physical hardware still requires its own watchdog.

## Traffic-control algorithm

NORTH/SOUTH and EAST/WEST are the only two configured phases. Normal phase score sums TRUCK=3, FORKLIFT=2, MATERIAL_VEHICLE=2, EMPLOYEE_VEHICLE=1 plus scheduling waiting milliseconds / 10000 per vehicle. Internally the equivalent integer score (weight * 10000 + waiting milliseconds) prevents floating-point ties from causing unnecessary switching. Scheduling wait starts at the later of server acceptance and that phase's latest confirmed GREEN. Already-served vehicles cannot repeatedly defeat another phase merely because clearance has not arrived. Sensor time never controls scheduling. Dashboard arrival age remains the original server acceptance age. A conflicting phase containing a vehicle waiting at least 90 seconds takes the next normal opportunity. Normal green has a 30-second minimum; no empty-phase switching is needed when the current phase remains preferred. Queues require explicit clearance events: GREEN does not invent vehicle departures.

Emergency uses a separate priority policy: oldest server-accepted emergency first; equal acceptance timestamps retain serialized acceptance/insertion order (not vehicle ID order); same-phase vehicles can move together. Emergency overrides manual intent. A valid manual intent resumes afterward; otherwise automatic mode resumes. Emergency waiting beyond 180 seconds enters FAILURE; it is never silently deleted. Manual intent lasts 60 seconds from acceptance, including time spent in failure or recovery; latest serialized accepted manual request replaces the previous one. Return-to-automatic clears manual intent but does not cancel emergency.

## Traffic-state transitions

GREEN -> confirmed YELLOW (5 seconds) -> confirmed ALL_RED (2 seconds) -> next GREEN. Timer starts only after matching fresh controller confirmation. There is no blocking sleep in handlers. A 250ms background scheduler advances persisted deadlines. Every physical command has a unique ID and complete four-signal map. A full-map ACK is an intentional API change that avoids interpreting a partial direction ACK as whole-junction confirmation.

ACK timeout is 5 seconds. Mismatch/NACK/offline/timeout enters FAILURE, marks actual states UNKNOWN and requests ALL_RED. Failed all-red acknowledgement remains unknown and blocks further GREEN. No automatic retries of non-red commands. Recovery requires a new all-red command and fresh confirmation followed by clearance. Known OFFLINE controllers and signals reject current full-map confirmation. Controller OFFLINE is known communication loss; it cannot be changed to UNKNOWN by an operator recovery request. Report the controller ONLINE explicitly first. ONLINE reporting alone leaves traffic in FAILURE; operator recovery, fresh ALL_RED ACK and the two-second clearance are still required. An OFFLINE sensor blocks new vehicle events, but safe RED confirmation remains possible. A fresh accepted sensor event or full-map confirmation records the corresponding devices ONLINE. Repeated unchanged OFFLINE reports do not replace pending commands or extend their timeout. Delayed/duplicate/obsolete ACK is audited and ignored. Online device reporting alone does not clear failure; use recovery after reporting failed sensors/signals ONLINE. Actual physical RED cannot be guaranteed without functioning hardware communication.

Startup recovery is a serialized persisted mutation: actual signals become UNKNOWN, every old pending command/deadline and simulated departure interval is invalidated, and a new unique ALL_RED command is created even when a saved device is OFFLINE. Non-offline controller status becomes UNKNOWN; known OFFLINE statuses remain OFFLINE. Queues, processed IDs, history and valid manual intent survive; expired manual intent is removed. On a fresh startup, UNKNOWN means confirmation has not been established, not known communication loss: a matching fresh full-map ACK may establish ONLINE, and AUTO_ACK may simulate that confirmation. A known OFFLINE controller cannot ACK or auto-confirm until explicitly reported ONLINE. Waiting vehicles/history remain. Persisted offline devices keep the junction in FAILURE. Stored deadlines do not authorize immediate GREEN after restart.

## API documentation

All requests and responses use JSON. See `API.md` for copyable examples.
- GET /health
- GET /api/junctions
- POST /api/junctions: { "id": "B" }
- GET /api/junctions/:id and /status
- POST /api/sensor-events
- POST /api/junctions/:id/commands
- POST /api/controller-events
- GET /api/junctions/:id/history?limit=50 (max 200)

Validation errors: 400; unknown junction: 404; conflicting event ID/duplicate vehicle/junction: 409; successful creation: 201; duplicates/ignored old events: 200; known storage unavailability: 503; initial unexpected persistence failure: 500. Already queued mutations also stop after a failed write. Health returns 503 while storage is unavailable. Rejected ACKs and blocked recovery return 409 with an explanation. API responses distinguish ignored events from applied events.

## Demonstration scenarios

1. Normal: add NORTH and EAST vehicles with distinct IDs. Wait for 30-second scheduling/5-second yellow/2-second clearance.
2. Priority: compare one EAST truck with one NORTH employee car after the minimum green period.
3. Emergency: while NORTH/SOUTH GREEN, submit EAST EMERGENCY. Observe immediate YELLOW request, confirmed yellow, all-red clearance, EAST/WEST GREEN.
4. Manual: request WEST manual green, then return to automatic. Emergency can override it.
5. Duplicate: click Repeat last event; queue count stays unchanged.
6. Clearance: use the same vehicle ID and direction, click Vehicle clears. Repeated clearance cannot create negative counts.
7. Failure: report controller OFFLINE; actual states become UNKNOWN and no new GREEN is permitted. For missing ACK click Use manual confirmation, request a conflicting manual phase, and do not confirm the pending command. AUTO_ACK sets the initial simulator mode on restart. For sensor/signal failure use device controls; report ONLINE before recovery.
8. Restart: add vehicles, restart backend, inspect persisted queue/history and recovery. In manual ACK mode, acknowledge new all-red command before traffic resumes. Old command IDs cannot resume old transitions.
9. Concurrent: send multiple POST requests with Promise.all or separate terminals; junction mutations serialize. Domain tests and API smoke tests cover consistency.
The dashboard displays Junction A; additional junctions remain supported through the backend API.

## Assumptions / Questions / Requirement Issues

- The scenario lists five vehicle categories, but the event contract lists four. All four contract names remain supported. MATERIAL_VEHICLE is added for material-carrying vehicles, with weight 2 like FORKLIFT; delivery trucks use TRUCK and employee transport uses EMPLOYEE_VEHICLE. This resolves the omitted category without renaming existing API values.
- Safe movement geometry is simplified to two non-conflicting phases as specified. Turning movements, pedestrians and real clearance engineering are out of scope.
- One logical sensor stream per junction/direction; sequence numbers are monotonic across arrival and clearance events. Multiple independent sensors require sensor_id and separate sequence tracking.
- event_id is authoritative for idempotency; the stored fingerprint includes normalized `simulated` (omitted equals false) and detects changed logical payloads. Optional `simulated` must be boolean. Existing six-field fingerprints are retained: a matching omitted/false submission is an ignored duplicate, but a true submission or changed core payload returns 409 because legacy simulation intent cannot be established. Legacy IDs are never removed, replayed or newly marked simulated. IDs and history are retained without expiry in this assessment.
- Older/equal sequence is recorded and ignored. This may drop legitimate late events; no automatic reconciliation is claimed. Unknown clearance advances the sequence but leaves the queue unchanged, preventing late old arrivals from resurrecting vehicles.
- Sensor timestamp is validated, stored for evidence, and rejected if over 60 seconds in the future. It never controls waiting or signal timers. Very old emergencies remain high priority when received; sensor-clock uncertainty prevents silently dismissing them.
- Duplicate waiting vehicle arrival is rejected. No inferred clearance from elapsed GREEN time.
- Starvation protection applies only in healthy automatic mode. Continuous emergencies, manual control and failures can suspend normal service.
- Controller commands describe the full map. The simulated controller must apply maps atomically and report honestly; the backend cannot independently verify physical lights.
- All controller events run through the same serialized junction service. Only current matching command ID can change confirmed state. No hardware heartbeat/offline detection beyond commands and explicit device reports is implemented.
- Controller recovery is operator requested. Known OFFLINE controller/sensors/signals must first be marked ONLINE. Emergency remains until cleared or alerts on timeout; no unverified auto-clear.
- Local storage is a demo fallback, MongoDB is supported through Mongoose. Neither adapter claims distributed consistency. Single-process ownership is required.
- Junction configuration uses a shared central phase/timing policy. Per-junction custom geometry/configuration editing is not implemented.
- No production authentication, MQTT, deployment, analytics or WebSocket; these were lower priority than safety. REST simulation and 1-second polling are sufficient for the demonstration.

## Database schema

One `junctions` collection. `_id`: unique junction ID. `state`: complete junction snapshot including `vehicles`, `processed`, `sequences`, `mode`, `stage`, `phase`, `desired_signals`, `actual_signals`, `pending`, `deadline`, `manual`, device statuses, alerts and history. Mongoose schema lives in `backend/models/Junction.js`; initialization creates its index. `state` is Mongoose `Mixed`: it does not enforce the complete domain schema. Application validation and domain rules are responsible for validating mutations; direct database writes bypass those rules. Audit/processed IDs will eventually exceed MongoDB's document limit; a production design needs partitioned event/history collections with transactional writes or an event log. The bounded assessment intentionally uses a straightforward atomic snapshot.

## Tests and limitations

Domain tests exercise safe transitions, duplicate/conflicting events, ordering, clearance, emergency, manual expiry, timeout, mismatched ACK, restart, starvation, offline recovery and interleaved actions without HTTP or a database. Tests use a fake clock; no sleeps. `npm test` runs them. The opt-in Atlas integration test requires private connection configuration and passed against a dedicated temporary database in this run. See TEST_REPORT.md for current verification; older verification claims are not silently reused. Browser polling and process restart are demonstration tools, not real-time industrial guarantees. Local-file writes are atomic rename but do not claim power-loss durability/fsync. No hardware verified.

With more time: controller heartbeat/watchdog protocol, durable outbox dispatch, multi-instance ownership, timestamp/sequence reconciliation, bounded audit storage and configurable junction geometry.

## AI / Tool Usage

OpenAI Codex was used for implementation, documentation, tests and local verification. Candidate should study the traffic engine, ordering assumptions, acknowledgement flow and persistence strategy and be able to explain/modify each. No external task submission performed.

## Dependency audit

Earlier verification reported a clean production dependency audit; dependency audit was not repeated in the current correctness run. nodemon development dependency has a transitive braces/chokidar advisory; the suggested npm automatic fix would downgrade nodemon significantly and was not applied blindly. Use `npm start` for evaluation without the file watcher.

The controller adapter is `backend/services/controllerSimulator.js`. POST `/api/simulator` with `{ "automatic_ack": false }` switches all demo junctions to manual ACK; GET returns its setting. Dashboard offers this switch. This simulator-only setting resets to AUTO_ACK on restart. No physical-controller delivery is claimed. Idempotency is scoped to junction plus event_id.

## Verification

Run `npm test` in backend and frontend. Run `npm run build` in frontend. Run `npm run test:atlas` in backend for the opt-in MongoDB test, which creates and removes an isolated test database. TEST_REPORT.md describes current coverage.

## Dashboard workflow

The dashboard displays Junction A. Enter a unique vehicle ID, direction and type, then click Vehicle arrives. Watch the confirmed signals in the live intersection. Dashboard simulations report departures automatically on confirmed green; Clear vehicle also permits manual clearance. Ordinary sensor events still require explicit clearance.

Manual control requests a direction safely; Return to automatic restores normal scheduling. Controller and failure-test tools are collapsed. Restore failed devices online before requesting recovery. The dashboard polls every second and pauses controls when backend data is unavailable. STUDY_GUIDE_BN.md explains the logic in Bengali.

## One-click traffic simulation

Three presets add vehicles to Junction A: NORMAL (N3/S2/E3/W2), PRIORITY (N4 employees/E3 trucks/W2 forklifts), and EMERGENCY (one emergency opposite the current phase). Presets add to existing queues and do not reset devices or manual control.

Dashboard arrivals and presets are explicitly marked simulated. Each accepted GREEN confirmation stores its unique command ID and server confirmation time. The separate backend traffic simulator binds per-direction departure timers to that identity and generates VEHICLE_CLEARED events for marked vehicles only, at one per direction after every three seconds of uninterrupted confirmed GREEN. Failure, recovery, restart and new signal requests invalidate the previous interval immediately; correctness does not depend on an unhealthy simulator tick. Duplicate/obsolete ACKs cannot reset the interval. Pending commands, failure, recovery and non-green signals pause departures. Ordinary sensor API events without `simulated: true` still need external clearance. Simulator markers persist across restart; fresh physical confirmation remains mandatory. This is a demonstration throughput assumption, not vehicle detection from real hardware.

## Current correctness verification (2026-10-08)

Eight regression tests failed against the previous implementation and passed after the fixes. The isolated full backend suite passed 1,370 tests (zero failures; one opt-in Atlas test skipped). The Atlas test passed separately against a disposable database, including offline-device restart cases. Frontend: 14 passed; production build passed. Existing working data and running Junction A were not changed. No live browser or physical hardware verification was performed in this run.

## Render deployment

Deploy the repository as one Node Web Service. Leave Root Directory empty, use `npm run build` as Build Command and `npm start` as Start Command. Express serves the built Vite frontend and the API from the same URL. Set STORAGE=mongodb, MONGODB_DB_NAME=factory_traffic, AUTO_ACK=true and the private MONGODB_URI in Render environment settings. Do not paste credentials into GitHub files. Use `/health` for the health check. `render.yaml` includes these settings for a Blueprint deployment.

Authorize the Render service to reach MongoDB Atlas using the service outbound addresses in Atlas Network Access. Keep one service instance because state serialization is in-process. A continuously running service is necessary for meaningful real-time demonstrations; service sleep/restart pauses traffic processing and triggers fresh recovery. This assessment service has unauthenticated simulation/manual endpoints; use it as a demonstration only.
