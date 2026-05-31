# Channel Load-Test Baseline (S25 #27)

The custom WebSocket load-test rig (ADR-0012) validates that one channel process
sustains the ADR-0011 **50-player cap at 20Hz**. It spins up N headless clients,
drives a representative input mix (move / attack / dodge over the binary +
delta-encoded protocol), and reports connection outcomes, inbound bandwidth, and
the channel's own tick-loop timing.

## Running it

**Automated validation** (CI / `pnpm test`): `apps/server-channel/src/loadtest/load-rig.test.ts`
spins up an in-process channel (cap 50), connects 51 clients, and asserts 50 join,
1 is refused, and the 20Hz budget holds.

**Ad-hoc against a running channel** (clean per-process memory/CPU):

```bash
# terminal 1 — a real channel process
ZONE_ID=ashen-plains CHANNEL_ID=ashen-ch0 CHANNEL_PORT=8081 \
  CHANNEL_WS_URL=ws://localhost:8081 pnpm --filter @mmo/server-channel dev

# terminal 2 — drive load
WS_URL=ws://localhost:8081 CLIENTS=50 DURATION_MS=15000 \
  pnpm --filter @mmo/server-channel loadtest
```

## Rig configuration (baseline run)

| Parameter            | Value                                  |
|----------------------|----------------------------------------|
| Clients              | 51 (vs cap 50 → 1 refused)             |
| Duration             | 1.5 s                                  |
| Tick rate            | 20 Hz (50 ms budget)                   |
| Input cadence        | 5 inputs/s per client                  |
| Input mix            | 75% move, ~12.5% attack, ~12.5% dodge  |
| Zone                 | 30×30, 1 mob                           |
| Wire format          | binary + delta snapshots (S23/S24)     |

## Observed metrics (in-process reference run)

> In-process numbers fold the 51 simulated clients **and** the channel into one
> Node process, so RSS/CPU are an upper bound — the CLI against a standalone
> channel reports the true per-process figures. Tick timing is the channel's own.

| Metric                       | Observed            | Budget / Notes               |
|------------------------------|---------------------|------------------------------|
| Clients welcomed             | 50 / 51             | cap enforced (1 channel-full)|
| Connection errors            | 0                   | —                            |
| **Tick avg**                 | **~1.7 ms**         | ≪ 50 ms budget               |
| **Tick max**                 | **~11 ms**          | < 50 ms (no missed ticks)    |
| Missed ticks                 | 0                   | 20Hz held under full load    |
| Inbound bandwidth / client   | ~15 KB/s            | with delta encoding (S24)    |
| Process RSS (in-process)     | ~125 MB             | clients + server combined    |

**Conclusion:** tick work at 50 players uses ~3% of the 20Hz budget — the
50-player cap (ADR-0011) is comfortably real, with substantial headroom. The rig
is reusable for post-alpha regression checks (bump `CLIENTS` to probe the ceiling).
