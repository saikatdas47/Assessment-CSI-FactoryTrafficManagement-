# কোড বুঝে বলার ছোট গাইড

## Request কীভাবে চলে?

Browser -> routes -> controller -> junctionService -> trafficEngine -> storageService -> response.

`index.js` প্রথমে .env পড়ে, storage connect করে, পুরোনো junction load করে এবং recovery শুরু করে। তারপর server চালায়। `app.js` Express app বানায়। Route শুধু ঠিক করে কোন function চলবে। Controller input যাচাই করে।

## গাড়ি এলে

`sensorEvent()` প্রথমে event ID দেখে। একই event আবার এলে queue বাড়ায় না। একই ID কিন্তু তথ্য ভিন্ন হলে conflict হয়। তারপর direction-এর sequence দেখে; পুরোনো sequence বাদ দেয়। গাড়ি নতুন হলে vehicles array-তে রাখে। Clearance এলে নির্দিষ্ট গাড়িটি সরায়। Queue count এই array থেকে হিসাব হয়।

## Traffic engine

`choose()` ঠিক করে কোন phase আগে যাবে। Emergency আগে; তারপর valid manual request; তারপর priority weight ও অপেক্ষার সময়। `advance()` সিদ্ধান্ত অনুযায়ী signal transition এগিয়ে নেয়। `request()` physical controller-এর জন্য unique command তৈরি করে। `acknowledge()` শুধু বর্তমান command-এর সঠিক confirmation গ্রহণ করে।

GREEN থেকে conflicting GREEN হয় না। আগে YELLOW confirm, পাঁচ সেকেন্ড অপেক্ষা, ALL_RED confirm, দুই সেকেন্ড clearance, তারপর পরের GREEN। `deadline` হচ্ছে কখন পরের ধাপে যাওয়া যাবে। Background tick সময় পরীক্ষা করে; request handler-এ sleep করে না।

## Desired বনাম actual

Desired হলো backend যা চায়। Actual হলো controller শেষ যা নিশ্চিত করেছে। পাঠানো command মানেই কাজ হয়ে গেছে নয়। Timeout হলে actual UNKNOWN, mode FAILURE। ALL_RED command পাঠানো হয়; controller না শুনলে সত্যি RED হয়েছে দাবি করি না।

## একসঙ্গে দুটি request

`junctionService.run()` একই junction-এর কাজ একটি Promise chain-এ রাখে। একটি শেষ হলে পরেরটি চলে। Saved state-এর copy বদলায়, save সফল হলে memory update করে। তাই queue এবং processed event record একই snapshot-এ থাকে। MongoDB-তে একটি document replacement atomic; এখানে বহু collection-এর transaction লাগে না। একাধিক backend instance চালানো এই design-এ অনুমোদিত নয়।

## Restart

গাড়ি, history, event IDs ও mode persist হয়। Restart-এর পরে পুরোনো physical signal সত্য ধরে নেওয়া হয় না। Actual UNKNOWN করে fresh ALL_RED confirmation নেয়। পুরোনো ACK-এর command ID আর মেলে না।

## কেন plain JavaScript frontend?

Vite development server ও build দেয়। HTML/CSS/JavaScript dashboard-এর জন্য যথেষ্ট। Frontend শুধু API call ও render করে; traffic সিদ্ধান্ত নেয় না। Text rendering-এ textContent ব্যবহার করা হয় যাতে vehicle ID-তে HTML দিলে সেটা execute না হয়।

## Review-তে সৎভাবে বলবে

এটি REST simulator, real hardware controller নয়। Database configuration না দিলে local persistent demo চলে। MongoDB Atlas authentication, live write, restart-এর পর persisted state ও duplicate handling যাচাই করা হয়েছে। Submission ZIP-এ নিজের private URI দিতে হবে। Normal starvation protection emergency/manual/failure-এর সময়ে guarantee নয়। History ও processed IDs বড় হলে আলাদা durable log দরকার। nodemon development dependency-এর transitive advisory README-তে লেখা আছে।


## কোন phase আগে পাবে—সহজ উদাহরণ

একটি EAST truck-এর weight ৩; একটি NORTH employee car-এর weight ১। প্রতিটি গাড়ির scheduling অপেক্ষার প্রতি ১০ সেকেন্ডে score ১ বাড়ে। যে phase শেষবার GREEN পেয়েছে, তার scheduling অপেক্ষা সেই সময় থেকে আবার গণনা হয়। গাড়ি কিন্তু queue থেকে সরবে কেবল clearance event এলে। তাই পুরোনো গাড়ি queue-তে পড়ে থাকলেও বারবার নিজের phase-কে জেতাতে পারে না। Conflicting phase ৯০ সেকেন্ড সুযোগ না পেলে পরের স্বাভাবিক সুযোগে আগে যায়। GREEN-এর ৩০ সেকেন্ড minimum এবং safety transition তখনও মানতে হয়। Emergency ও manual control থাকলে এই স্বাভাবিক fairness সাময়িক বন্ধ থাকে।

## Failure থেকে ফেরার নিয়ম

Controller ONLINE হলেও আলাদা SIGNAL OFFLINE হতে পারে। Failed signal থাকলে পুরো junction-এর ACK সত্য ধরে নেওয়া যাবে না। Failed sensor থাকলে তার নতুন vehicle event গ্রহণ করা হবে না। আগে সেই device ONLINE report করবে, তারপর recovery চাইবে। Recovery-তেও fresh ALL_RED ACK ও clearance লাগে। একই OFFLINE report বারবার পাঠালে নতুন command বানিয়ে timeout পিছিয়ে দেওয়া হয় না। Manual request failure-এর মধ্যেও মেয়াদ শেষ হয়।

## Frontend-এর দায়িত্ব

Dashboard প্রতি সেকেন্ডে API থেকে তথ্য আনে। আট সেকেন্ডেও response না এলে error দেখায়। Backend বন্ধ হলে পুরোনো signal-কে stale দেখিয়ে action buttons বন্ধ করে; reconnect হলে আবার চালু করে। Junction বদলালে আগের junction-এর দেরিতে আসা response নতুন junction-এর screen বদলাতে পারে না। নতুন junction API দিয়ে বানানো যায়; dashboard-এ বাড়তি form রাখা হয়নি।

## পরীক্ষায় কী দেখা হয়েছে

আগের run-এর historical verification: ৪৬টি backend test, ১৪টি frontend test এবং আলাদা live Atlas test pass করার নোট ছিল। বর্তমান result নিচে দেওয়া আছে। একটি test-এ ১,০০০ mixed operation-এর পরও safety invariant পরীক্ষা হয়েছে। Browser-এ emergency, manual, duplicate, clearance, failure, recovery এবং server বন্ধ/চালু করা পরীক্ষা হয়েছে। বিস্তারিত TEST_REPORT.md-এ আছে। এগুলো real hardware certification নয়; একটি backend process ও REST simulator-এর যাচাই।


## পাঁচ ধরনের গাড়ি ও সহজ dashboard

Scenario-তে পাঁচটি category, API example-এ চারটি নাম ছিল। এখন Forklift, Delivery truck, Material-carrying vehicle, Employee transport এবং Emergency—পাঁচটিই visible radio choice। Backend-এ material গাড়ির নাম MATERIAL_VEHICLE, weight ২; forklift-এর সমান। Truck ৩, employee ১; emergency আলাদা সর্বোচ্চ priority পায়।

Dashboard-এর ধাপগুলো হলো: junction দেখো → vehicle ID/direction/type দিয়ে arrival দাও → queue row থেকে clearance দাও → দরকার হলে আলাদা direction দিয়ে manual green চাও → device fault হলে সেই device/direction restore করে recovery চাও। Vehicle direction বদলালে manual বা device direction বদলায় না। Controller ACK test দরকার হলেই তার আলাদা section খুলবে। Emergency banner সবসময় ওপরেই থাকে। UNKNOWN signal দেখালে সেটা থেমে আছে দাবি করি না।


## সর্বশেষ UI সরলীকরণ

মূল screen-এ live intersection, vehicle/manual control, queues, controller/recovery এবং ছোট activity list আছে। বাড়তি navigation, নতুন junction বানানোর form ও raw JSON viewer সরানো হয়েছে। Duplicate, missing ACK/NACK এবং device fault পরীক্ষা দরকার হলে একটিমাত্র Test scenarios section খুলবে। Pending command দেখতে Controller & failure tests খুলবে। এই UI সরলীকরণের আগের নোটটি বর্তমান correctness changes-এর বিবরণ নয়।


## মূল calculation-এর সর্বশেষ পরীক্ষা

এক truck-এর score ৩.৩ আর তিন employee গাড়ির score-ও ৩.৩ হতে পারে। আগের দশমিক যোগে সামান্য rounding difference হয়ে অপ্রয়োজনীয় switch হচ্ছিল। এখন একই সূত্রে weight * ১০০০০ + waiting milliseconds হিসাব করি। দুই score সমান হলে বর্তমান phase থাকে।

১,৩৪৯টি domain test pass করেছে, যার মধ্যে ১ লাখ mixed operation আছে। Green হওয়া মানে গাড়ি যেতে পারবে; queue থেকে গাড়ি সরানো হবে matching clearance event এলে। Starvation-এর ৯০ সেকেন্ড threshold পার হলে safe switch শুরু হবে—তারপরও yellow, all-red ও ACK সময় লাগবে। Test চালানোর নিয়ম TEST_REPORT.md-এ আছে।


### এক ক্লিকে simulation
উপরের Normal traffic, Truck priority ও Emergency card চাপলে backend নির্দিষ্ট গাড়িগুলো queue-তে যোগ করে। Dashboard-এর নতুন simulated গাড়ি confirmed GREEN-এ প্রতি direction-এ ৩ সেকেন্ডে একটি করে ছাড়ে। আলাদা simulator VEHICLE_CLEARED event পাঠায়; domain নিজে গাড়ি চলে গেছে ধরে নেয় না। RED/YELLOW, pending ACK, failure বা recovery-তে গাড়ি ছাড়বে না। সাধারণ sensor API event-এ simulated flag না থাকলে আগের মতো explicit clearance লাগবে।


### বর্তমান correctness verification — 2026-10-08
৮টি নতুন regression test পুরোনো code-এ fail করেছে, fixes-এর পরে pass করেছে। বর্তমান isolated backend suite: ১,৩৭০ pass, ০ fail, ১ Atlas test skipped। Atlas আলাদা disposable database-এ ১ pass। Frontend ১৪ pass এবং build সফল। এই run-এ live browser বা working database verification করা হয়নি।

Controller OFFLINE মানে যোগাযোগ বন্ধ জানা আছে। UNKNOWN মানে physical confirmation নেই। Recovery OFFLINE মুছবে না: আগে Physical controller বেছে ONLINE report, তারপর recovery, fresh ALL_RED ACK ও ২ সেকেন্ড clearance। ONLINE report নিজে traffic চালু করে না। Fresh startup-এর UNKNOWN controller matching ALL_RED ACK দিয়ে ONLINE হতে পারে; AUTO_ACK এটি simulate করতে পারে। Known OFFLINE controller-এর জন্য তা নিষিদ্ধ।

Restart-এ offline device থাকলেও নতুন ALL_RED command ID তৈরি হয়; পুরোনো ACK ignored, actual signals UNKNOWN, valid manual intent/queues/IDs/history থাকে। Expired manual intent বাদ যায়। Accepted GREEN command ID-র সঙ্গে departure interval বাঁধা: failure/recovery/restart/transition আগের timer invalidate করে; নতুন confirmation-এর পরে পুরো ৩ সেকেন্ড লাগবে।

Optional simulated boolean; omitted এবং false একই payload। একই ID-তে false থেকে true করলে 409। পুরোনো fingerprint-এর ID replay হয় না: matching omitted/false duplicate ignored, true বা changed core payload conservatively 409। Equal-time emergency-তে serialized acceptance/insertion order আগে। Applied arrival/clearance ও scenario 201; ignored/duplicate 200; conflict 409। Mongoose Mixed নিজে পুরো domain schema enforce করে না।
