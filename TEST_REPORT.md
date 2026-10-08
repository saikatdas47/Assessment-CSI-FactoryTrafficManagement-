# Test report

## Current correctness verification — 2026-10-08

Eight new domain regression tests failed against the previous source and all passed after the fixes. They reproduce controller-OFFLINE recovery/ACK bypass, old ALL_RED IDs surviving restart with offline controller/sensor/signal, expired startup intent, departure intervals surviving an interruption without simulator ticks, and incomplete simulated-field validation/idempotency (including legacy fingerprints).

The current isolated backend suite: 1,370 passed, 0 failed, 1 opt-in Atlas test skipped (1,371 total). It includes REST validation, concurrency, actual process restart, offline-device restart invalidation, payload normalization, and forced persistence failure preventing queued memory commits. The existing calculation and independent queue/physical safety tests remain included.

The opt-in MongoDB integration test: 1 passed, 0 failed. It used a dedicated factory_traffic_audit_* database, checked atomic snapshots, persisted IDs/queues, restart with offline controller/sensor/signal and fresh recovery, and removed that database afterward. Working Junction A and its database were not modified. Credentials were not included in test output.

Frontend: 14 passed, 0 failed. Vite production build passed. The only UI change adds Physical controller to the existing device report selector so ONLINE can be reported explicitly. No live browser visual QA was performed in this run.

Current logs replace docs/latest-backend-tests.txt and docs/latest-atlas-tests.txt. Earlier browser/working-Atlas/source-ZIP verification statements describe historical runs and are not current evidence.

## Commands

- Backend: cd backend, then npm test.
- Frontend: cd frontend, then npm test and npm run build.
- MongoDB: cd backend, then npm run test:atlas with private connection configuration. The test overrides the database name with a dedicated temporary name.

## Safety and limits

Normal GREEN minimum 30 seconds, confirmed YELLOW 5 seconds and confirmed ALL_RED 2 seconds remain enforced. Manual/emergency switches retain the clearance sequence. A current ACK from a known OFFLINE controller is rejected. ONLINE reporting alone does not resume traffic. Startup discards physical confirmation, command deadlines and departure timing; unresolved faults retain FAILURE even if safe RED is confirmed.

Departures require a new confirmed GREEN identity and a full three-second interval; only marked vehicles are cleared through events. Legacy processed IDs are retained conservatively: matching omitted/false duplicates are ignored; true or changed payload is rejected rather than replayed.

This is a single-process REST simulation, not hardware certification. Physical maps must be applied atomically and ACKs must be honest. Mongoose Mixed does not enforce the whole state schema. Delayed sequence reconciliation, bounded persistent audit storage, distributed ownership and power-loss durability remain outside scope.
