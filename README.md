# Factory Traffic Management System

CSI Smart Tech Backend Developer Intern assessment. Node.js, Express, MongoDB/Mongoose, nodemon, Vite and plain JavaScript. The dashboard focuses on Junction A; the backend engine supports additional junctions.

## Setup and run

Use Node.js 22.12 or newer in the Node 22 series.

Backend:

```sh
cd backend
cp .env.example .env
npm install
npm run dev
```

Frontend, in another terminal:

```sh
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The API runs on http://localhost:4000. Preserve an existing private `.env` instead of replacing it. The example configuration uses local persistent storage so a reviewer can run the project without database credentials.

For MongoDB, set these privately in `backend/.env`:

```dotenv
PORT=4000
STORAGE=mongodb
MONGODB_URI=mongodb+srv://USERNAME:PASSWORD@YOUR_CLUSTER_HOST/
MONGODB_DB_NAME=factory_traffic
AUTO_ACK=true
TRAFFIC_SIMULATION=true
```

`.env`, local runtime data, node_modules, generated frontend build and source ZIP are excluded from Git. Credentials belong in private environment settings.

## Dashboard and vehicle flow

NORTH means vehicles approaching the junction from the north; SOUTH approaches from the south. This simplified model assumes separate opposing lanes and straight movements: north to south, south to north, east to west and west to east. It does not model turns or pedestrians.

Use a scenario card to add vehicles, or submit an individual arrival. The intersection displays controller-confirmed lights and requested states separately. In demo mode, **every queued vehicle** follows the same departure rule, including old persisted vehicles and arrivals without a simulated flag.

The traffic simulator reports one departure per GREEN direction every three seconds. Each departure is a normal VEHICLE_CLEARED event. The domain engine removes the matching vehicle; it never decrements a frontend-supplied count. Vehicles on RED/YELLOW, pending commands, failed/recovering junctions and offline sensors do not depart.

Departures follow arrival order within each direction. New vehicles do not use time accumulated while the road was empty. A delayed scheduler tick clears at most one vehicle per eligible direction, rather than instantly draining a queue. A new GREEN confirmation starts a fresh interval.

`TRAFFIC_SIMULATION=true` is the default demonstration mode. Set it to `false` when testing real exit-sensor events: then every vehicle requires explicit clearance. The optional boolean `simulated` remains accepted as event metadata for compatibility/idempotency; it no longer selects which vehicles can depart.

Manual controls request a direction safely; Return to automatic removes manual intent. Optional controller/failure tools are collapsed. Recent activity is a small scrollable list. The frontend polls every second, uses an eight-second request timeout and disables actions when state is unavailable.

## Architecture

| File or folder | Responsibility |
| --- | --- |
| backend/index.js | Read environment, connect storage, recover saved state, start HTTP and 250ms scheduler |
| backend/app.js | Express middleware, API mounting, errors and built frontend serving |
| backend/routes/ | Map URLs to controller functions |
| backend/controllers/ | Validate inputs and call application service |
| backend/services/junctionService.js | Serialize operations for each junction; save before memory commit |
| backend/services/trafficEngine.js | Queues, scheduling, transitions, events, failure and recovery |
| backend/services/trafficSimulator.js | Scenario arrivals and exit-sensor simulation for all queued vehicles |
| backend/services/controllerSimulator.js | Simulated controller ACKs through the normal domain function |
| backend/services/storageService.js | MongoDB and local-file persistence |
| backend/models/Junction.js | Mongoose snapshot schema |
| backend/config/trafficConfig.js | Directions, phase geometry, weights and timings |
| backend/utils/validation.js | Required fields, IDs, sequence and timestamp validation |
| frontend/src/ | API requests, readable labels and backend-driven rendering |

The engine does not import Express, Mongoose, browser or MQTT code. Small functions, ordinary function callbacks, explicit if/else blocks and loops keep the code explainable. Async/await is needed for requests and persistence; Map/Set track junction tasks and creation reservations. No custom class framework or distributed infrastructure is introduced.

## Traffic-control algorithm

Two phases: NORTH_SOUTH and EAST_WEST. Emergency first, then an unexpired manual intent, then normal scoring.

Normal weight: TRUCK=3, FORKLIFT=2, MATERIAL_VEHICLE=2, EMPLOYEE_VEHICLE=1. Each vehicle contributes `weight * 10000 + scheduling_wait_ms`. Sum contributions for each phase. Equal scores retain the current phase. This integer formula avoids decimal-rounding switches.

Scheduling wait starts at the later of server acceptance and that phase's latest confirmed GREEN. Arrival age displayed in the dashboard remains the original server acceptance age. A conflicting phase waiting at least 90 seconds receives the next healthy automatic scheduling opportunity. This threshold still includes subsequent safe signal switching time; emergency/manual/failure may delay normal service.

Emergency order uses oldest server acceptance; equal-time ties retain insertion/serialized acceptance order. Emergency overrides manual intent. After emergency clearance, valid manual intent resumes, otherwise automatic scheduling resumes. An emergency older than 180 seconds enters FAILURE without silently deleting its vehicle.

Manual intent lasts 60 seconds from acceptance, including failure/recovery time. Latest serialized accepted manual intent wins. Returning to automatic does not cancel an emergency or bypass clearance.

## Safe transitions and controller confirmation

```text
confirmed GREEN
→ requested YELLOW → matching ACK → 5 seconds
→ requested ALL_RED → matching ACK → 2 seconds
→ requested next GREEN → matching ACK
```

Normal GREEN has a 30-second minimum; emergency/manual can initiate earlier safe preemption. Every command has a unique ID and a full four-signal map. Sending a request does not prove physical execution. Timers start at accepted matching ACKs. Clients cannot force arbitrary signal maps.

ACK timeout is five seconds. NACK, mismatched confirmation, timeout or device outage enters FAILURE and marks actual state UNKNOWN. The system requests ALL_RED but cannot claim physical RED without confirmation. No automatic non-red retries are performed. Duplicate/obsolete/expired ACKs are audited and ignored.

Known OFFLINE controller/signal blocks confirmation. ONLINE reporting alone does not resume traffic. Restore each failed device ONLINE, then request recovery; fresh ALL_RED ACK and clearance are required. Fresh startup UNKNOWN may receive matching safe confirmation; known OFFLINE must not be erased by recovery.

## Persistence, concurrency and restart

One MongoDB `junctions` document per junction: `_id` is the ID; `state` stores queues/vehicles, processed IDs, direction sequences, mode, desired/actual signals, pending command, deadlines, manual intent, device status, simulator timing and audit history. The model uses Mongoose Mixed; validation is in the application/domain rather than a complete database state schema.

`junctionService.run()` waits for the previous task for that junction. It changes a JSON copy, atomically replaces the stored snapshot, then updates memory. A failed write does not commit memory or allow queued mutations to continue with unavailable storage. The scheduler stops the server on persistence failure. This is a single-backend-process consistency strategy.

Local storage uses temporary-file rename. It is a development fallback, not a power-loss durability guarantee. MongoDB is required for Render persistence.

Restart unconditionally invalidates old physical confirmation, pending command IDs, deadlines and simulator intervals. It creates a fresh ALL_RED command even with persisted offline devices. Queues, event IDs, history and valid manual intent survive; expired manual intent is removed. Unresolved devices retain FAILURE; old ACKs cannot resume traffic.

## Demonstration scenarios

1. Normal traffic: click Normal traffic (N3/S2/E3/W2). Watch safe scheduling and queues drain on GREEN.
2. Priority: click Truck priority (N4 employees/E3 trucks/W2 forklifts). Compare weighted scheduling and waiting.
3. Emergency: click Emergency. It adds one emergency opposite the current phase; observe YELLOW, ALL_RED, emergency GREEN and clearance.
4. Manual: request a direction, then return to automatic. Emergency remains higher priority.
5. Duplicate: submit an arrival and repeat its event; queue is unchanged by the duplicate.
6. Clearance: in demo mode watch exit events automatically reduce every queue; manual Clear vehicle remains available. With simulation off, send explicit exits.
7. Failure: report a controller/sensor/signal OFFLINE, restore ONLINE, then recover. Manual ACK mode can demonstrate a missing ACK timeout.
8. Restart: add vehicles and restart backend; queues/history survive, lights need fresh confirmation.
9. Concurrent events: automated API tests interleave truck/emergency/manual/duplicate/ACK and verify serialized safety.

## API and database documentation

See [API.md](API.md) for JSON examples, endpoints and response codes. See `backend/models/Junction.js` for the snapshot schema. MongoDB `_id` is unique; no separate SQL migration is needed.

## Assumptions / Questions / Requirement Issues

- Geometry is two opposing-lane straight phases. Single-lane alternating traffic, turns and pedestrians need different conflict configuration.
- The scenario lists five vehicle categories while the sample event contract lists four. MATERIAL_VEHICLE adds the missing material category at forklift weight.
- One monotonic sensor stream per direction. Multiple independent sensors need sensor IDs and separate stream sequencing.
- event_id is authoritative for idempotency. Changed payload reuse returns 409. Optional simulated normalizes omitted/false identically. Old six-field fingerprints are retained conservatively, without replay.
- Older/equal sequence events are ignored and audited; legitimate delayed events are not reconciled automatically. Unknown clearance advances the sequence without creating negative queues.
- UTC sensor time is validated and stored; server acceptance controls waiting. Sensor time over 60 seconds into the future is rejected.
- All queued vehicles depart in demo mode, regardless of arrival source/age. Three seconds per direction is a demonstration throughput assumption, not evidence from physical sensors. Disable the simulator for actual exit-sensor integration.
- Vehicle priority selects a phase. Vehicles within the same lane depart FIFO; they cannot overtake merely because of type.
- ACK describes an atomic complete signal map; partial acknowledgements cannot establish junction safety. Simulator ACKs are assumed honest.
- No physical controller heartbeat/watchdog, production authentication, MQTT, distributed locking or custom per-junction geometry editor. REST adapters and polling satisfy the assessment demo.
- Processed IDs and history are unbounded within a snapshot. Larger systems need partitioned audit/event storage and durable command delivery.

## Tests

Run `npm test` at the project root for backend and frontend tests. Run `npm run build` at the root for dependencies plus the combined deploy build. Run `npm run test:atlas` in backend for an opt-in temporary MongoDB database test. See [TEST_REPORT.md](TEST_REPORT.md) for latest results and limits. Tests do not certify physical hardware.

## Render deployment

Push this project to GitHub. Create one Node Web Service: Root Directory empty, Build Command `npm run build`, Start Command `npm start`, Health Check `/health`. Express serves `frontend/dist` and API under one URL. `render.yaml` also supports Blueprint setup.

Set STORAGE=mongodb, MONGODB_DB_NAME=factory_traffic, AUTO_ACK=true, TRAFFIC_SIMULATION=true and private MONGODB_URI in Render. Allow the service outbound addresses in Atlas Network Access. Use one instance. Sleeping/restarting services pause traffic and require recovery; MongoDB retains saved data. Manual/simulation endpoints are unauthenticated assessment controls.

## AI / Tool Usage

OpenAI Codex assisted with implementation, tests, documentation and local verification. Prettier and ESLint were used as temporary development tools to format code and add explicit braces; they are not application dependencies. The candidate remains responsible for explaining and modifying the submitted implementation.

## Further work

Physical watchdog/heartbeat, exit-sensor integration, bounded history, delayed-event reconciliation, durable dispatch, authenticated operations and multi-instance ownership would be the next steps.
