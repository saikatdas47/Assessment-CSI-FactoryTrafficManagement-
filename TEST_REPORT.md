# Test report

## Run

```sh
# Project root: backend and frontend
npm test

# Backend only
cd backend
npm test
npm run test:atlas

# Frontend tests and build
cd frontend
npm test
npm run build
```

Atlas verification requires the private URI; it overrides the database name with a temporary factory_traffic_audit_* database and removes only that database afterward. API tests use temporary local directories and separate server ports. They do not reset working Junction A.

## Coverage

| Area | Checks |
| --- | --- |
| Queues | Arrival, matching/unknown/wrong-direction exit, no negative counts, duplicate and changed IDs, stream sequence ordering |
| Scheduling | 1,152 independent queue/weight combinations, exact-score ties, server waiting age, minimum GREEN and starvation |
| Transitions | Confirmed YELLOW 5s, confirmed ALL_RED 2s, ACK delays and deadline boundaries, no conflicting GREEN |
| Emergency/manual | Accepted-order emergencies, safe preemption, competing requests, completion, overdue failure, manual replacement/expiry |
| Failure/restart | Offline controller/sensor/signal, NACK/mismatch/timeout, explicit ONLINE and recovery, startup command invalidation |
| Concurrency/storage | Serialized requests, concurrent duplicates, actual process restart, failed save prevents memory/queued commits |
| Demo departures | Old persisted/unmarked and new vehicles follow the same rule; exit events, FIFO, three-second boundaries, empty-road timing, no instant catch-up, simulator-off behavior |
| Simulator recovery | New GREEN identity requires a full interval even without unhealthy simulator ticks; pending/failure/recovery/offline sensor pause exits |
| Stress | 100,000 deterministic mixed-operation steps with independent queue and physical-transition observers |
| Admin settings | Every editable field validation, minimum clearances, priority order, frozen transition/ACK/manual/emergency/departure timers, concurrent revision conflict, local restart and MongoDB persistence |
| Frontend | Missing/malformed data, all vehicle categories, signal descriptions, sequencing, errors and request timeout |

Domain tests call the engine without HTTP/database/browser. GREEN by itself does not mutate queues there. The separate demo adapter generates actual clearance events when enabled; integration tests verify it also clears old snapshots through the running API.

## Latest results

- Backend: **1,383 passed, 0 failed**, 1 opt-in Atlas test skipped in the default run (1,384 total).
- Separate Atlas integration: **1 passed, 0 failed** in a disposable database.
- Frontend: **16 passed, 0 failed**; production build passed.
- Working local Junction A: all pre-existing vehicles departed automatically and its waiting count reached zero; no manual queue reset was used.
- The occupied-port regression verifies failed startup exits instead of running a duplicate control loop.
- Browser: Compact Admin rows and both Dashboard exit buttons verified; sticky exit remained visible after scrolling; 390px layout had no horizontal overflow. Admin displayed MongoDB defaults; save, invalid priority rejection, junction creation/selection and return to dashboard checked.
- Backend files use ordinary functions and explicit conditionals/loops; syntax checks found no arrow functions, spread syntax, optional chaining or nullish coalescing.

Current logs are docs/latest-backend-tests.txt and docs/latest-atlas-tests.txt. This run verified local source/build/runtime, not the deployed Render service.

## Limits

These tests validate software with a REST controller simulator, not physical hardware. One backend instance owns state. Physical signal maps must apply atomically and confirmations must be honest. Starvation protection applies to healthy automatic mode. Mongoose Mixed does not enforce the whole state schema. Delayed-event reconciliation, bounded audit storage, authenticated operators, heartbeat/watchdog and distributed ownership remain outside the assessment scope.


## Current Atlas data verification

Working database `factory_traffic` was read directly through the MongoDB driver and compared with the running API. The complete saved settings values/revision matched. Junction A and B status projections, queues, desired/actual maps, devices, manual/pending state, vehicles and the latest 200 history entries matched their MongoDB snapshots. A had 190 processed event IDs and 2,464 history entries; B had 20 processed IDs and 59 history entries at the check. Both queues were empty.

The opt-in Atlas integration additionally verified complete edited settings, persisted demo mode after restart, junction creation, all five vehicle types, queue updates, sequence/event IDs, emergency expiry, manual intent/clearance, history fetch, device failures and fresh restart confirmation. It uses a disposable database and does not reset the working database. Latest result: 1 passed, 0 failed. API status reads current in-memory state loaded from MongoDB; state is committed to MongoDB before memory is published.

Obsolete local A snapshot, empty runtime log, outdated dashboard screenshot and unused root cache were removed. Required source, tests, docs, private local environment and backend/frontend dependencies were retained. Submission ZIP includes the built frontend; it excludes credentials, dependencies, Git and local runtime data.
