const intervalMs = 60_000;

function startWorkerLoop(): void {
  console.log("Worker bootstrap started");

  setInterval(() => {
    console.log("Worker heartbeat");
  }, intervalMs);
}

startWorkerLoop();
