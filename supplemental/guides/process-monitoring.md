# Process monitoring

The global **Processes** page provides a read-only snapshot of processes running on connected systems.

Process snapshots are requested only while the page is open and are refreshed every 10 seconds. Beszel does not store per-process history and does not provide actions to start, stop, restart, or signal processes.

Each row includes:

- process name and PID;
- system and operating-system user;
- current state;
- CPU usage calculated between snapshots;
- resident memory usage;
- process start time, when supported by the operating system.

Command-line arguments and environment variables are not collected. To keep payloads and rendering bounded, each agent returns at most 500 processes, prioritized by CPU usage and then memory usage. The page shows the full detected count when a snapshot is limited.

## Docker agent

An agent running in Docker needs read-only access to the host process filesystem. Mount `/proc` and point gopsutil to the mounted path:

```yaml
services:
  beszel-agent:
    volumes:
      - /proc:/host/proc:ro
    environment:
      HOST_PROC: /host/proc
```

Host PID mode and privileged mode are not required.
