# k6 Performance Benchmark Results

Run ID: `ffd5bdc4-47db-425e-a875-8baa539e4021`

Target: `http://localhost:3100` (isolated benchmark Compose stack)
Scenario: fresh account and user, one unit per request; no historical usage was seeded.

| Stage | Target rate | Iterations started | HTTP samples | Accepted in history | Rejected in history | k6 errors | Dropped iterations | Accepted throughput | k6 error rate | Avg latency | p50 | p95 | p99 | Result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 25 RPS | 25/s | 751 | 751 | 751 | 0 | 0 | 0 | 25.03 req/s | 0.00% | 22.45 ms | 19.74 ms | 37.16 ms | 82.88 ms | Passed |
| 100 RPS | 100/s | 2177 | 2177 | 2177 | 0 | 218 | 824 | 72.57 req/s | 10.01% | 9484.35 ms | 6741.82 ms | 30006.46 ms | 30119.46 ms | Failed / limited |
| 500 RPS | 500/s | 12026 | 12026 | 1926 | 0 | 12026 | 2974 | 64.20 req/s | 100.00% | 5008.38 ms | 218.66 ms | 29999.89 ms | 30001.03 ms | Failed / limited |

## Usage and quota verification

- Persisted accepted benchmark requests: 4854; expected consumed units from accepted history rows: 4854.
- Actual account consumed units: 4854; actual user consumed units: 4854.
- Usage total matches expected accepted usage: **yes**.
- Over-limit probe (100,001 units; limit 100,000): HTTP 429, REJECTED; it did not increment usage: **yes**.

Accepted throughput is persisted accepted requests from each 30-second stage divided by its arrival window. Accepted/rejected counts come from paginated usage history, so requests processed by the API after a client timeout are still reconciled. k6 errors and error rate describe load-generator-observed unexpected responses and transport errors, including timeouts; a timed-out request can still appear as accepted in server history if the API finished it. Quota rejections are reported separately. Latency percentiles use the raw `http_req_duration` samples (nearest-rank percentile). Dropped iterations are arrivals k6 could not start.

Raw k6 JSON output: [benchmark-results.json](benchmark-results.json). It contains per-sample metric points.

This report describes one benchmark run on the recorded environment. Results depend on machine, database, and workload conditions.
