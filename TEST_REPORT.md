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
| Frontend | Missing/malformed data, all vehicle categories, signal descriptions, sequencing, errors and request timeout |

Domain tests call the engine without HTTP/database/browser. GREEN by itself does not mutate queues there. The separate demo adapter generates actual clearance events when enabled; integration tests verify it also clears old snapshots through the running API.

## Latest results

- Backend: **1,377 passed, 0 failed**, 1 opt-in Atlas test skipped in the default run (1,378 total).
- Separate Atlas integration: **1 passed, 0 failed** in a disposable database.
- Frontend: **14 passed, 0 failed**; production build passed.
- Working local Junction A: all pre-existing vehicles departed automatically and its waiting count reached zero; no manual queue reset was used.
- The occupied-port regression verifies failed startup exits instead of running a duplicate control loop.
- Backend files use ordinary functions and explicit conditionals/loops; syntax checks found no arrow functions, spread syntax, optional chaining or nullish coalescing.

Current logs are docs/latest-backend-tests.txt and docs/latest-atlas-tests.txt. This run verified local source/build/runtime, not the deployed Render service.

## Limits

These tests validate software with a REST controller simulator, not physical hardware. One backend instance owns state. Physical signal maps must apply atomically and confirmations must be honest. Starvation protection applies to healthy automatic mode. Mongoose Mixed does not enforce the whole state schema. Delayed-event reconciliation, bounded audit storage, authenticated operators, heartbeat/watchdog and distributed ownership remain outside the assessment scope.
