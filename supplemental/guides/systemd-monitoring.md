# Systemd service monitoring

Beszel collects systemd service status and resource usage from Linux agents. The global **Services** page combines the latest service snapshot from every system the signed-in user can access.

The feature is read-only. It does not start, stop, restart, enable, or disable services.

## Agent requirements

An agent running directly on a system normally connects to the system D-Bus without additional configuration. Set `SKIP_SYSTEMD=true` to disable collection or use `SERVICE_PATTERNS` to limit the collected services.

When the agent runs in Docker, mount the system D-Bus socket as read-only:

```yaml
services:
  beszel-agent:
    volumes:
      - /var/run/dbus/system_bus_socket:/var/run/dbus/system_bus_socket:ro
```

Some Linux hosts use an AppArmor profile that blocks access to the mounted socket. If the agent log reports an AppArmor D-Bus denial, add the narrower exception below to the agent service:

```yaml
services:
  beszel-agent:
    security_opt:
      - apparmor:unconfined
```

Do not add privileged mode for systemd monitoring.

## Optional service filtering

By default, the agent collects loaded `*.service` units that have been active at least once. `SERVICE_PATTERNS` accepts a comma-separated list of systemd patterns:

```yaml
environment:
  SERVICE_PATTERNS: "nginx,postgresql@*,cloudflared"
```

Patterns without a `.service` or `timer` suffix automatically receive `.service`.
