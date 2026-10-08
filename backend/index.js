import "dotenv/config";
import app from "./app.js";
import { connectStorage } from "./services/storageService.js";
import { initialize, tick } from "./services/junctionService.js";

async function start() {
  await connectStorage();
  await initialize();
  const port = Number(process.env.PORT) || 4000;
  const server = app.listen(port, function (error) {
    if (error) {
      console.error("Server could not start:", error.message);
      process.exit(1);
      return;
    }
    console.log("Factory traffic API: http://localhost:" + port);
    startControlLoop(server);
  });
}

function startControlLoop(server) {
  let busy = false;
  const timer = setInterval(async function () {
    if (busy) {
      return;
    }
    busy = true;
    try {
      await tick();
    } catch (error) {
      console.error("Persistence/control loop failed; stopping server:", error.message);
      clearInterval(timer);
      server.close(function () {
        process.exit(1);
      });
    }
    busy = false;
  }, 250);

  function stop() {
    clearInterval(timer);
    server.close(function () {
      process.exit(0);
    });
  }
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

start().catch(function (error) {
  console.error(error.message);
  process.exit(1);
});
