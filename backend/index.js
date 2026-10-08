import "dotenv/config";
import app from "./app.js";
import { connectStorage } from "./services/storageService.js";
import { initialize, tick } from "./services/junctionService.js";
async function start() {
  await connectStorage();
  await initialize();
  const server = app.listen(Number(process.env.PORT) || 4000, function() { console.log("Factory traffic API: http://localhost:" + (process.env.PORT || 4000)); });
  let busy = false;
  const timer = setInterval(async function() {
    if (busy) return;
    busy = true;
    try { await tick(); } catch (error) {
      console.error("Persistence/control loop failed; stopping server:", error.message);
      clearInterval(timer);
      server.close(function() { process.exit(1); });
    }
    busy = false;
  }, 250);
  process.on("SIGINT", function() { clearInterval(timer); server.close(function() { process.exit(0); }); });
}
start().catch(function(error) { console.error(error.message); process.exit(1); });
