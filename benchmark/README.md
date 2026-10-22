# k6 Performance Benchmark

This benchmark runs three consecutive 30-second constant-arrival-rate stages against a fresh account on a dedicated Compose stack: 25, 100, and 500 requests per second. Each successful request consumes one unit and uses a unique request ID. The harness verifies accepted usage against both account and user aggregates, then sends a separate over-limit request to verify that quota rejection does not change usage.

No historical usage is seeded. The benchmark uses a fresh database volume and fresh account/user so prior counters cannot affect quota results. The plans allow 1,000,000 monthly units and at most 100,000 units per request, sufficient for the planned 18,750 requests. The final 100,001-unit quota probe exceeds the per-request limit and must be rejected without changing usage.

## Dependencies

- Docker Engine or Docker Desktop with Docker Compose v2.
- Node.js 22 or later and npm (for the preparation and report scripts).
- k6 installed and available as `k6` on `PATH`.
- A root `.env` file containing `DB_PASSWORD`.

The benchmark Compose file publishes its API on port `3100` and PostgreSQL on port `5543`, and creates its own named database volume. It does not use the default Compose ports or volume. Make sure ports 3100 and 5543 are available.

## Run on Windows PowerShell

From the repository root:

```powershell
docker compose --env-file .env --project-directory . -p usage-metering-benchmark -f benchmark/compose.yaml up --build -d
```

Wait until the API is healthy, then prepare a fresh account, user, and plans. The confirmation variable is required, and preparation refuses any API URL other than the isolated `http://localhost:3100` endpoint.

```powershell
$env:BASE_URL = "http://localhost:3100"
$env:BENCHMARK_CONFIRM_DISPOSABLE = "true"
node benchmark/prepare.mjs
```

Run k6 and export its raw per-sample JSON output, then generate the concise report with usage and quota verification:

```powershell
k6 run --out json=benchmark-results.json benchmark/load-test.js
node benchmark/report.mjs
```

The private target file `benchmark/benchmark-target.json` contains the benchmark API key and is git-ignored. Keep it private. Review `benchmark-results.md` and `benchmark-results.json`; the reporter exits with a nonzero status if a stage is incomplete, requests are dropped/rejected/errors occur, usage does not match accepted requests, or the quota probe fails.

After saving the results, remove only the dedicated benchmark stack and its database volume:

```powershell
docker compose --env-file .env --project-directory . -p usage-metering-benchmark -f benchmark/compose.yaml down -v
```

This deletes the disposable benchmark database. It does not remove the exported result files.

## Run on macOS or Linux

From the repository root, use the same Compose and k6 commands. Set the preparation variables in the shell before running the preparation script:

```sh
docker compose --env-file .env --project-directory . -p usage-metering-benchmark -f benchmark/compose.yaml up --build -d
BASE_URL=http://localhost:3100 BENCHMARK_CONFIRM_DISPOSABLE=true node benchmark/prepare.mjs
k6 run --out json=benchmark-results.json benchmark/load-test.js
node benchmark/report.mjs
docker compose --env-file .env --project-directory . -p usage-metering-benchmark -f benchmark/compose.yaml down -v
```

The raw JSON output is line-delimited k6 metric data. The report derives per-stage throughput, average latency and p50/p95/p99, unexpected error rate, accepted/rejected/error counts, dropped iterations, aggregate usage correctness, and over-limit quota correctness from that run. Each stage allows up to 60 seconds for already-started requests to finish after its 30-second arrival window; the next stage still begins at the scheduled 30-second boundary.
