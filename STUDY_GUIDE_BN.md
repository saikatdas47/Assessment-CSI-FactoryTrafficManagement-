# প্রজেক্ট বোঝার সহজ গাইড

## ১. কী বানানো হয়েছে?

কারখানার একটি রাস্তার মোড়ে কোন দিকের গাড়ি কখন যাবে, backend সেটা ঠিক করে। Frontend backend-এর সিদ্ধান্ত দেখায়। গাড়ি আসা, গাড়ি চলে যাওয়া, signal confirmation, emergency ও failure—এগুলো event। তাই এটি শুধু CRUD নয়।

NORTH মানে উত্তর দিক থেকে মোড়ে আসা গাড়ি; সাধারণ straight movement-এ সেটা দক্ষিণের দিকে যাবে। SOUTH-এর গাড়ি উত্তরে যাবে। দুই দিকে আলাদা lane ধরা হয়েছে। তাই NORTH/SOUTH একসঙ্গে GREEN হতে পারে। EAST/WEST-ও একইভাবে। বাঁক নেওয়া বা pedestrian movement এই ছোট model-এ নেই।

## ২. চালিয়ে দেখবে কীভাবে?

Backend-এ `npm run dev`, frontend-এ `npm run dev`। http://localhost:5173 খুলবে। Normal traffic, Truck priority বা Emergency card একবার চাপো। গাড়ি queue-তে আসবে, backend signal ঠিক করবে, GREEN পাওয়া গাড়ি নিজে থেকে queue ছাড়বে। নিজে গাড়ি যোগ করার form-ও আছে।

Demo-তে **সব waiting গাড়ির নিয়ম একই**: পুরোনো, নতুন, preset, manual form বা API—যেখান থেকেই আসুক। প্রতি GREEN direction-এ তিন সেকেন্ডে একটি গাড়ি ছাড়ে। Simulator `VEHICLE_CLEARED` event পাঠায়; engine matching গাড়ি সরায়। Frontend নিজে queue কমায় না। RED/YELLOW, pending ACK, failure/recovery বা sensor OFFLINE হলে departure বন্ধ।

Admin-এ Automatic vehicle departures বন্ধ করলে automatic departure বন্ধ। `TRAFFIC_SIMULATION` শুধু প্রথমবারের default দেয়; পরে MongoDB-এর saved মান ব্যবহৃত হয়। তখন আসল sensor বা Clear vehicle দিয়ে গাড়ি চলে যাওয়ার খবর দিতে হবে। `simulated` field পুরোনো event contract-এর metadata; এখন ওই flag দিয়ে গাড়ি ছাড়া/আটকানো হয় না।

## ৩. কোন file আগে পড়বে?

| File | কী করে |
| --- | --- |
| backend/index.js | App চালু, database connection, startup recovery, background tick |
| backend/app.js | Express app, middleware, routes, errors, built frontend |
| backend/routes/junctionRoutes.js | কোন URL-এ কোন controller চলবে |
| backend/controllers/junctionController.js | Input check করে service-কে কাজ দেয় |
| backend/services/junctionService.js | একই junction-এর কাজ একে একে চালায় ও save করে |
| backend/services/trafficEngine.js | আসল traffic নিয়ম |
| backend/services/trafficSimulator.js | Preset arrivals ও সবার departure sensor simulation |
| backend/services/controllerSimulator.js | Physical controller-এর বদলে ACK পাঠায় |
| backend/services/storageService.js | MongoDB/local file থেকে load ও save |
| backend/models/Junction.js | Database document-এর schema |
| backend/config/trafficConfig.js | Direction, phase, weight ও সময় |
| backend/utils/validation.js | Event-এর fields ঠিক আছে কি না |

## ৪. একটি request-এর যাত্রা

Vehicle arrives চাপলে frontend POST `/api/sensor-events` করে। Route controller-এ পাঠায়। Controller fields যাচাই করে। Service ওই junction-এর আগের কাজ শেষ হওয়ার জন্য অপেক্ষা করে। Saved state-এর copy বানায়। Engine event গ্রহণ করে, queue ও history বদলায়, প্রয়োজন হলে signal command তৈরি করে। Service database save করে। Save সফল হলে memory update করে। Dashboard পরের poll-এ সেই state দেখায়।

এভাবে database save fail করলে copy-র পরিবর্তন live state হয় না। Queue, processed event ID ও history একসঙ্গে save হয়।

## ৫. Traffic engine-এর functions

- `createJunction()` একটি মোড়ের শুরুর state তৈরি করে।
- `sensorEvent()` arrival, clearance, duplicate ও sequence সামলায়।
- `choose()` emergency, manual বা normal score থেকে পরের phase বেছে নেয়।
- `advance()` সময় ও সিদ্ধান্ত দেখে transition এগিয়ে নেয়।
- `request()` unique physical command তৈরি করে।
- `acknowledge()` current command-এর matching confirmation নেয়।
- `fail()` traffic থামিয়ে physical state UNKNOWN করে।
- `recover()` fresh safe confirmation দিয়ে ফেরার প্রস্তুতি নেয়।
- `deviceEvent()` sensor/signal/controller ONLINE বা OFFLINE খবর নেয়।
- `status()` vehicle array গুনে প্রতিটি direction-এর queue জানায়।
- `record()` গুরুত্বপূর্ণ ঘটনার history রাখে।

সময় ও weight-এর নিচের সংখ্যাগুলো default। Admin-এর saved মান পাল্টালে নতুন সিদ্ধান্তে সেই মান ব্যবহার হবে।

## ৬. Priority হিসাব

Truck weight ৩, forklift/material ২, employee ১। প্রতিটি গাড়ির score:

```text
weight × saved weight_scale + scheduling waiting milliseconds × saved waiting_multiplier
```

এক phase-এর গাড়িগুলোর score যোগ হয়। বেশি score আগে সুযোগ পায়। সমান হলে বর্তমান phase থাকে। Integer হিসাব ব্যবহার করি যাতে দশমিক rounding-এর কারণে অপ্রয়োজনীয় switch না হয়।

গাড়ির scheduling wait হলো server-এ আসার সময় এবং ওই phase-এর শেষ confirmed GREEN—এই দুই সময়ের পরেরটি থেকে অপেক্ষা। Dashboard-এ original arrival age দেখায়। অন্য phase অন্তত ৯০ সেকেন্ড সুযোগ না পেলে পরের normal সুযোগে আগে যায়। তবে YELLOW/ALL_RED সময় বাদ যাবে না।

Priority phase বেছে দেয়। একই lane-এর গাড়ি FIFO-তে যায়—আগে আসা গাড়ি আগে। Truck পিছনে থাকলে শুধু weight-এর কারণে সামনে থাকা গাড়ির ওপর দিয়ে যাবে না।

## ৭. GREEN কেন সরাসরি বদলায় না?

NORTH/SOUTH GREEN থাকলে EAST/WEST সঙ্গে সঙ্গে GREEN করা বিপজ্জনক। নিয়ম:

```text
GREEN → YELLOW confirmation → ৫ সেকেন্ড
→ ALL_RED confirmation → ২ সেকেন্ড
→ পরের GREEN confirmation
```

Normal GREEN minimum ৩০ সেকেন্ড। Emergency/manual আগে transition চাইতে পারে, কিন্তু clearance বাদ দিতে পারে না। `deadline` বলে কখন পরের ধাপ সম্ভব। ২৫০ ms background tick সময় পরীক্ষা করে; HTTP handler ঘুমিয়ে থাকে না।

## ৮. Desired, actual ও ACK

Desired মানে backend যা চায়। Actual মানে controller যা নিশ্চিত করেছে। `command_id` দিয়ে কোন request-এর উত্তর সেটা মিলাই। চার direction-এর পুরো map মেলাতে হয়। Wrong map/NACK/timeout হলে FAILURE। Actual UNKNOWN মানে আমরা physical light নিশ্চিত নই।

Known controller OFFLINE থাকলে recovery বা ACK দিয়ে status মুছে চলতে পারবে না। আগে ONLINE report, তারপর recovery, fresh ALL_RED ACK, দুই সেকেন্ড clearance। ONLINE report নিজে traffic resume করে না। Startup-এর UNKNOWN controller fresh confirmation দিয়ে ONLINE হতে পারে।

## ৯. Emergency ও manual

Emergency সব normal/manual traffic-এর আগে। Oldest server-accepted emergency আগে; একই সময়ে এলে যে event আগে গ্রহণ হয়েছে সেটা আগে। Emergency চলে গেলে valid manual intent ফিরে আসে; না থাকলে automatic। Emergency ১৮০ সেকেন্ডের বেশি থাকলে failure হয়, গাড়ি silently delete হয় না।

Manual request ৬০ সেকেন্ড থাকে। শেষ accepted request আগেরটি বদলায়। Return to automatic manual intent সরায়, emergency বা fault সরায় না।

## ১০. Duplicate ও পুরোনো event

`event_id` একবার process হলে exact duplicate queue বদলায় না। একই ID-তে payload বদলালে 409। প্রতিটি direction-এর `sequence_no` বাড়তে হবে; পুরোনো/equal sequence ignore ও audit হয়। Unknown clearance queue negative করে না।

Sensor timestamp সংরক্ষণ হয়, কিন্তু waiting-এর জন্য server time লাগে। Sensor clock ভুল হলেও scheduling পুরোনো sensor time দিয়ে priority পায় না। Legacy processed IDs retain হয়; সেগুলো replay করে গাড়ি ফিরিয়ে আনা হয় না।

## ১১. একসঙ্গে request ও restart

`Map` হলো ID দিয়ে value রাখার JavaScript collection। Service-এ junction-এর state এবং শেষ pending task রাখি। `Set` দিয়ে কোন junction ID create হচ্ছে সেটা মনে রাখি। `async/await` দিয়ে আগের কাজ ও database save শেষ হওয়া পর্যন্ত অপেক্ষা করি। নতুন framework নয়।

Restart-এর পরে saved GREEN সত্য ধরে নেওয়া হয় না। পুরোনো command ও simulator timer বাতিল, actual UNKNOWN, নতুন ALL_RED command লাগে। Queue/history/event ID থাকে। Offline fault থাকলে FAILURE থাকে। নতুন confirmed GREEN ছাড়া গাড়ি ছাড়ে না।

## ১২. Code পড়ার নিয়ম

Functions, সাধারণ if/else, braces, for loop ও সাধারণ callback ব্যবহার করা হয়েছে। এক লাইনে অনেক কাজ রাখা হয়নি। `Object.hasOwn()` নিজের event ID আছে কি না দেখে। `Object.defineProperty()` special ID যেমন `__proto__` নিরাপদে সংরক্ষণ করে—এই safeguard বাদ দিলে object-এর prototype বদলে যেতে পারে। Regex UTC timestamp-এর format দেখে, পরে Date round-trip দিয়ে impossible date আটকায়। এগুলো validation-এর প্রয়োজনীয় JavaScript methods।

## ১৩. Documentation ও পরীক্ষার কাজ

README: setup, architecture, algorithm, assumptions, deployment ও AI usage। API.md: request JSON ও status codes। TEST_REPORT.md: সর্বশেষ test results ও coverage। এই গাইড: বোঝার জন্য। Tests source-এর অংশ; পুরোনো before-* backup প্রয়োজন নেই।

Root-এ `npm test` backend ও frontend পরীক্ষা করে। Backend-এ `npm run test:atlas` আলাদা temporary database-এ persistence পরীক্ষা করে। Tests queue, duplicate, timing, emergency, manual, failure, restart ও concurrent requests যাচাই করে। বর্তমান সংখ্যা TEST_REPORT.md-এ দেখবে।

## ১৪. সীমাবদ্ধতা ও review-তে কী বলবে?

এটি AI-assisted assessment demo, real physical hardware নয়। একটি backend process state-এর owner। Mongoose Mixed পুরো nested schema validate করে না; controller/domain checks করে। History ও processed IDs বড় হলে আলাদা storage দরকার। বাস্তব controller watchdog, heartbeat, authentication, MQTT ও distributed locking এখানে নেই। এগুলো বোঝা এবং নিজের ভাষায় explain করা প্রয়োজন।

Render-এ frontend build `frontend/dist` হয়; Express একই URL থেকে dashboard/API serve করে। MongoDB URI private environment-এ দিতে হবে, ZIP বা GitHub-এ নয়।


## Admin settings কীভাবে কাজ করে?

উপরের ছোট Admin button খুললে তিনটি বিষয় পাওয়া যায়: junction যোগ/নির্বাচন, traffic settings, controller/failure recovery। Login নেই। নতুন junction-এর queue ও light আলাদা; traffic policy সবার জন্য একই। Main dashboard প্রথমে A দেখায়। Admin-এ B বেছে Back to dashboard দিলে B দেখাবে।

`Settings.js` MongoDB-এর settings document রাখে। `settingsService.js` startup-এ document পড়ে। না থাকলে একবার defaults save করে। Admin GET `/api/settings` থেকে বর্তমানে saved মান দেখায়। Save করলে POST `/api/settings` হয়; validation ও database save সফল হওয়ার পরে backend-এর active values বদলায়।

`revision` হলো saved settings-এর version number। একই revision নিয়ে দুজন save করলে প্রথমটি সফল হবে; অন্যজনকে reload করতে বলবে। এতে পুরোনো form দিয়ে নতুন settings মুছে দেওয়া যায় না।

Time form-এ seconds, database-এ milliseconds। Yellow ৫ সেকেন্ডের নিচে এবং all-red ২ সেকেন্ডের নিচে save করা যায় না। Emergency সবার আগে, conflicting phase একসঙ্গে GREEN নয়—এই safety rules admin বদলাতে পারে না।

Transition শুরু হলে তার timing copy রাখা হয়। Settings বদলালে চলমান yellow/all-red/green deadline বা pending ACK timeout বদলায় না। Accepted manual ও emergency expiry-ও একই থাকে। পরের নতুন transition/request নতুন settings ব্যবহার করে। Demo-তে ইতিমধ্যে scheduled departure পুরোনো interval রাখে; পরেরটি নতুন interval নেয়।

MongoDB-এর `settings` collection-এর `_id: traffic` document-এ `values`, `revision`, `updated_at` থাকবে। Backend restart-এ সেটাই load হয়। Environment-এর AUTO_ACK ও TRAFFIC_SIMULATION saved value overwrite করে না।
