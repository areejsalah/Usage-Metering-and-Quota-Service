# Usage Metering Service

A PostgreSQL-backed HTTP service that tracks monthly unit consumption for accounts and their users. Client businesses authenticate with an account API key, identify their own users with external IDs, and submit usage requests. The service applies account and user plan limits, records accepted and rejected requests, and exposes usage summaries and request history.

The repository also includes command-line demo clients that simulate a business application calling the API on behalf of its users. Their business action is illustrative; the metering request is the service operation.

## Features

- Account creation with a generated API key. The service stores a SHA-256 hash of the key and requires the raw key for authenticated routes.
- Account-scoped users identified by an external ID supplied by the integrating business.
- Predefined and account-owned custom plans, separately for accounts and individual users.
- Effective-dated account and user plan assignments.
- Monthly usage limits and per-request unit limits enforced at both account and user levels.
- Transactional usage handling that serializes consumption for an account and records rejected requests without increasing usage.
- Request ID idempotency within an account. Repeating an ID with matching user and units returns the stored outcome; reusing it with different request data returns a conflict.
- Monthly account and user summaries, plus paginated account request history containing accepted and rejected outcomes.
- Custom plan updates and plan switches take effect for later requests while the current month's already-consumed usage and prior request history remain recorded.
- Demo clients for successful and rejected consumption, concurrent account usage, history, plan changes, idempotency, validation, and account isolation.

## Account and user data model

An account represents the integrating business and owns the API key hash. Its users are records for that business's end users; each user is identified by an `externalId` that the integrating business supplies. A user is unique within its account, but another account can use the same external ID. The external ID is not a separate authentication credential.

The PostgreSQL schema represents the model with these tables:

| Table | Stored data and relationships |
| --- | --- |
| `accounts` | Account name and unique API-key hash. |
| `users` | User external ID and owning account; unique on `(account_id, external_id)`. Deleting an account cascades to its users. |
| `plans` | Plan type, name, allowance and per-request limit. Predefined plans have no owning account; custom plans reference the account that created them. |
| `account_plan_assignments`, `user_plan_assignments` | Append-only plan assignment rows with an `effective_from` timestamp and foreign keys to the account or user and plan. The assignment endpoints set this timestamp to the current time. |
| `account_monthly_usage`, `user_monthly_usage` | Aggregated consumed units keyed by account or user and `billing_month`. Each aggregate table has a composite primary key on its owner and month. |
| `usage_requests` | Per-request history, including account, user, request ID, units, accepted/rejected status, rejection reason/scope, and creation time. The database enforces uniqueness of `(account_id, request_id)`. |

Consumption runs in a database transaction. The handler locks the account row with `SELECT ... FOR UPDATE` before checking the user, request ID, plan limits, and current usage. This serializes consumption requests for the same account, including requests from different users on that account. Accepted requests update both monthly aggregates using atomic insert-or-increment operations and add an accepted history row. Allowance rejections add a rejected history row but do not change either aggregate. This favors consistent account-wide quota enforcement; requests sharing one account wait on that account lock.

## Technology

- Node.js (the container image uses Node.js 22) and TypeScript
- Express 5
- PostgreSQL 17
- Drizzle ORM and Drizzle Kit for schema access and migrations
- Docker Compose for the API and database
- Node's built-in test runner for API tests

## Prerequisites

For the containerized setup, install Docker Engine or Docker Desktop with the Docker Compose plugin. For running the API, tests, or demo scripts directly on the host, install Node.js and npm. The project Dockerfile uses Node.js 22.

## Configuration

Create a root `.env` file for values that Docker Compose or the local application needs. Do not commit it or expose API keys in browser code.

```dotenv
DB_PASSWORD=replace-with-a-local-database-password

# Optional settings for the demo client
USAGE_API_KEY=
USAGE_API_URL=http://localhost:3000
DEMO_ACCOUNT_NAME=Usage demo account
DEMO_EXTERNAL_USER_ID=customer-123
DEMO_DOCUMENT_TEXT=Sample document for the demo

# For running the API on the host against the Compose database:
DB_HOST=localhost
DB_PORT=5433
DB_NAME=usage_metering
DB_USER=postgres
```

Configuration verified in the code and Compose file:

| Variable | Used by | Behavior |
| --- | --- | --- |
| `DB_PASSWORD` | Docker Compose and PostgreSQL connection | Compose passes it to PostgreSQL and the API. Set it in `.env` for the Compose setup. |
| `DB_HOST` | Local API / database connection | Defaults to `localhost` in the database module; Compose sets it to `db` for the API container. |
| `DB_PORT` | Local API / database connection | Defaults to `8080` in the database module; Compose sets the API's container-side port to `5432`. The database is published on host port `5433`. For a host-run API using the Compose database, set `DB_PORT=5433`. |
| `DB_NAME` | Local API / database connection | Defaults to `usage_metering`; Compose uses the same database name. |
| `DB_USER` | Local API / database connection | Defaults to `postgres`; Compose uses `postgres`. |
| `USAGE_API_URL` | Demo clients | Defaults to `http://localhost:3000`; the Compose client sets it to `http://api:3000`. |
| `USAGE_API_KEY` | Demo clients | Optional. If unset, a demo creates an account and uses the API key returned by account creation. If set, the demo uses that account. |
| `DEMO_ACCOUNT_NAME` | Main demo client / Compose | Optional account name for the demo client. |
| `DEMO_EXTERNAL_USER_ID` | Main demo client / Compose | Optional external ID; Compose defaults it to `customer-123`. |
| `DEMO_DOCUMENT_TEXT` | Main demo client / Compose | Optional simulated business input used by the main demo client. |
| `BASE_URL` | Test scripts | Overrides the target service URL. The API test defaults to `http://localhost:3000`; the Node load test defaults to `http://localhost:3001`. The API server itself does not read this variable. |

The API listens on port `3000` in `src/index.ts`; the `PORT` value in Compose is not used to configure that listener. The application and Drizzle configuration do not read `DATABASE_URL`; they use the separate `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` variables. The host connection values in the sample are overridden by Compose's explicit `DB_HOST=db` and `DB_PORT=5432` settings inside the API container.

## Run with Docker Compose

Set `DB_PASSWORD` in `.env`, then build and start PostgreSQL and the API:

```sh
docker compose up --build 
```

The API is available at `http://localhost:3000`; PostgreSQL is published at `localhost:5433`. The API container waits until the database health check succeeds. Check API readiness with:

```sh
curl http://localhost:3000/health
```

The Compose `client` service runs the main demo client. For example:

```sh
docker compose run --build --rm client npm run demo:success
```

To stop the services without deleting the database volume:

```sh
docker compose down
```

The Compose file defines a persistent named PostgreSQL volume, so stopping containers does not clear stored accounts, users, plans, or usage records.

## Run locally

Install dependencies:

```sh
npm ci
```

Start the database with Compose and configure the host-run API to connect to the published database port (`DB_HOST=localhost`, `DB_PORT=5433`, plus the database name, user, and password). Then start the API:

```sh
npm run dev
```

The API starts on port `3000`. Its startup process runs database migrations and processes predefined plans before listening for requests.

## Database migrations and predefined plans

SQL migrations are stored in `src/db/migrations`. On startup, the API runs the migrations in that folder through Drizzle's migrator, then calls the predefined-plan initializer. There is no separate migration script in `package.json`.

Predefined plans are inserted when missing and are available across accounts:

| Plan | Applies to | Monthly allowance | Maximum units per request |
| --- | --- | ---: | ---: |
| Starter | Account | 100,000 | 10,000 |
| Pro | Account | 1,000,000 | 100,000 |
| Basic | User | 10,000 | 1,000 |
| Premium | User | 100,000 | 10,000 |

Custom plans belong to the account that created them. Account and user plans are assigned separately. Usage is measured by UTC calendar month. Changing plans does not reset the usage already accumulated in that month.

## API

The route handlers use JSON request and response bodies. `GET` routes do not require a request body. Authenticated endpoints require the account API key in the `x-api-key` header. `POST /accounts` creates an account and key without authentication; `/health` is also unauthenticated. A missing or invalid key returns HTTP `401`. Explicit validation errors are JSON; unhandled errors and unmatched paths use Express's default handling.

### Create an account

`POST /accounts`

Request:

```json
{"name":"Example business"}
```

Returns HTTP `201` with an account object and the generated raw API key:

```json
{
  "account": {
    "id":"<account-uuid>",
    "name":"Example business",
    "createdAt":"<timestamp>"
  },
  "apiKey":"<generated-api-key>"
}
```

The raw key is returned in this creation response; subsequent authentication checks use its SHA-256 hash. The account object includes `id`, `name`, and `createdAt` (it does not include `apiKeyHash`). Save the returned key securely for later requests.

### Health

`GET /health` — no authentication required. Returns HTTP `200`, for example:

```json
{"status":"ok","message":"Usage Metering Service is running"}
```

### Users and plans

Successful user creation returns `{"user":{"id":"<uuid>","accountId":"<uuid>","externalId":"<external-id>","createdAt":"<timestamp>"}}`.

Plan create, update, and list responses return plan objects with `id`, `name`, `type`, `monthlyAllowance`, `maxUnitsPerRequest`, `isPredefined`, `accountId`, `createdAt`, and `updatedAt`. An account-plan assignment object has `id`, `accountId`, `planId`, `effectiveFrom`, and `createdAt`; a user-plan assignment uses `userId` in place of `accountId`. `GET` plan-assignment responses wrap the selected assignment and plan as `{"assignment":{...},"plan":{...}}`.

| Method and path | Authentication | Request body / query | Successful response |
| --- | --- | --- | --- |
| `POST /users` | API key | `{"externalId":"customer-123"}` | `201`, `{"user":{...}}` |
| `POST /plans` | API key | `{"name":"Team","type":"account","monthlyAllowance":50000,"maxUnitsPerRequest":5000}`. `type` is `account` or `user`. | `201`, `{"plan":{...}}` |
| `GET /plans` | API key | None | `200`, `{"plans":[...]}` containing predefined plans and custom plans visible to the account. |
| `PATCH /plans/:planId` | API key | One or more of `name`, `monthlyAllowance`, `maxUnitsPerRequest` | `200`, `{"plan":{...}}`. Only the owning account's custom plans can be updated; predefined plans cannot. |
| `POST /account/plan` | API key | `{"planId":"<plan-uuid>"}` for an account plan | `201`, `{"assignment":{...},"plan":{...}}` |
| `GET /account/plan` | API key | None | `200`, `{"assignment":{...},"plan":{...}}` |
| `POST /users/:externalId/plan` | API key | `{"planId":"<plan-uuid>"}` for a user plan | `201`, `{"assignment":{...},"plan":{...}}` |
| `GET /users/:externalId/plan` | API key | None | `200`, `{"assignment":{...},"plan":{...}}` |

Plan creation requires a non-empty string `name`, a `type` of `account` or `user`, and positive safe integers for both `monthlyAllowance` and `maxUnitsPerRequest`. Plan updates require at least one of `name`, `monthlyAllowance`, or `maxUnitsPerRequest`; supplied names must be non-empty strings and supplied numeric values must be positive safe integers. Predefined plans cannot be updated. Users must be created before assignment or usage; a usage request requires both a current account-plan assignment and a current user-plan assignment.

For these routes, invalid request fields return HTTP `400`; creating an external ID already present in the same account returns `409`; assigning a plan to a missing user returns `404`; and reading a current plan or monthly summary without a matching assignment returns `404`. A cross-account or otherwise inaccessible custom plan is rejected. Explicit JSON errors use the shape `{"error":"<reason>"}`.

### End-to-end request example

The following POSIX shell example creates an account, saves the returned API key, finds the predefined plan IDs, creates a user, assigns an account plan and a user plan, then consumes usage. Substitute the API key and plan IDs returned by your service:

```sh
# Create an account. Copy .apiKey from the JSON response below.
curl -sS -X POST http://localhost:3000/accounts \
  -H 'Content-Type: application/json' \
  -d '{"name":"Example business"}'

export API_KEY='<apiKey returned when the account was created>'

# Find available predefined IDs: Starter is an account plan; Basic is a user plan.
curl -sS http://localhost:3000/plans \
  -H "x-api-key: $API_KEY"

export ACCOUNT_PLAN_ID='<Starter account plan id>'
export USER_PLAN_ID='<Basic user plan id>'

# Create the account's user.
curl -sS -X POST http://localhost:3000/users \
  -H "x-api-key: $API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"externalId":"customer-123"}'

# Assign both required plans.
curl -sS -X POST http://localhost:3000/account/plan \
  -H "x-api-key: $API_KEY" \
  -H 'Content-Type: application/json' \
  -d "{\"planId\":\"$ACCOUNT_PLAN_ID\"}"

curl -sS -X POST http://localhost:3000/users/customer-123/plan \
  -H "x-api-key: $API_KEY" \
  -H 'Content-Type: application/json' \
  -d "{\"planId\":\"$USER_PLAN_ID\"}"

# Consume 25 units for that user. Keep requestId stable when retrying this operation.
curl -sS -X POST http://localhost:3000/usage/consume \
  -H "x-api-key: $API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"externalId":"customer-123","units":25,"requestId":"invoice-2026-0001"}'
```

Use a URL-encoded external ID in the user path when it contains characters that need URL encoding.

### Consume usage

`POST /usage/consume` — API key required.

Request:

```json
{"externalId":"customer-123","units":25,"requestId":"invoice-2026-0001"}
```

`externalId` and `requestId` must be non-empty strings; `requestId` may be at most 255 characters. `units` must be a positive safe integer.

An accepted request returns HTTP `200`:

```json
{
  "requestId":"invoice-2026-0001",
  "status":"ACCEPTED",
  "units":25,
  "billingMonth":"<YYYY-MM>",
  "accountConsumed":25,
  "userConsumed":25,
  "accountRemaining":99975,
  "userRemaining":9975,
  "idempotent":false
}
```

This example assumes no previous usage in the month and the Starter account plan (100,000 units) plus Basic user plan (10,000 units). Actual consumed and remaining values include earlier requests in the same UTC month.

Checks are applied in this order: account per-request maximum, user per-request maximum, account monthly allowance, then user monthly allowance. The first failing check determines the rejection reason and scope. A quota or per-request maximum rejection returns HTTP `429`, records the rejected request, and does not change usage aggregates. Its response includes `requestId`, `status`, `units`, `rejectionReason`, `rejectionScope`, `billingMonth`, `accountConsumed`, and `userConsumed`.

For example, a rejection by the user monthly limit returns HTTP `429` with:

```json
{"requestId":"invoice-2026-0002","status":"REJECTED","units":1,"rejectionReason":"User monthly allowance exceeded","rejectionScope":"user","billingMonth":"<YYYY-MM>","accountConsumed":25,"userConsumed":10000}
```

#### Retry and idempotency behavior

The request ID is trimmed and unique within the authenticated account. The database also has a unique `(account_id, request_id)` index. If a request with the same ID, user, and unit count has already been processed, the service does not consume or record it again:

- An originally accepted request is replayed with HTTP `200` and `status: "ACCEPTED"`.
- An originally quota-rejected request is replayed with HTTP `429` and `status: "REJECTED"`.
- Both replay bodies contain `requestId`, `status`, `units`, `rejectionReason`, `rejectionScope`, and `idempotent: true`. They do not include the original response's usage totals or remaining allowance.
- Reusing the ID for another user or a different unit count returns HTTP `409` with `{"error":"requestId was already used with different request data"}`.

Accepted retry response (HTTP `200`):

```json
{"requestId":"invoice-2026-0001","status":"ACCEPTED","units":25,"rejectionReason":null,"rejectionScope":null,"idempotent":true}
```

Rejected retry response (HTTP `429`):

```json
{"requestId":"invoice-2026-0002","status":"REJECTED","units":1,"rejectionReason":"User monthly allowance exceeded","rejectionScope":"user","idempotent":true}
```

Requests rejected before an outcome is recorded, such as a request for an unknown user or missing plan assignment, do not create a usage-history row and therefore do not establish an idempotent result.

### Usage summaries and history

| Method and path | Authentication | Query parameters | Successful response |
| --- | --- | --- | --- |
| `GET /account/usage` | API key | Optional `month=YYYY-MM`; defaults to the current UTC month. | `200`, `{"billingMonth":"<YYYY-MM>","consumedUnits":0,"monthlyAllowance":100000,"remainingUnits":100000}` (example assumes Starter plan and no recorded usage) |
| `GET /users/:externalId/usage` | API key | Optional `month=YYYY-MM`; defaults to the current UTC month. | `200`, `{"externalId":"customer-123","billingMonth":"<YYYY-MM>","consumedUnits":0,"monthlyAllowance":10000,"remainingUnits":10000}` (example assumes Basic plan and no recorded usage) |
| `GET /usage/history` | API key | Optional `limit` (default `20`, range 1–100) and `offset` (default `0`, non-negative integer). | `200`, `{"limit":20,"offset":0,"requests":[{"id":"<uuid>","accountId":"<uuid>","userId":"<uuid>","requestId":"<request-id>","units":1,"status":"ACCEPTED","rejectionReason":null,"rejectionScope":null,"createdAt":"<timestamp>"}]}` |

Monthly aggregates use a UTC `YYYY-MM` billing month. For a requested month, the summary selects the latest plan assignment effective at or before the end of that month, then reads that plan row's current allowance. If assignments changed mid-month, the summary reports the month-end assignment rather than an allowance snapshot for each request. Updating a custom plan edits the existing plan row; it can therefore change the allowance later displayed for historical months assigned to that plan. Request-history rows preserve accepted/rejected outcomes, but do not snapshot the plan or allowance used at request time. Remaining allowance is clamped to zero if usage exceeds the selected plan's allowance.

History is scoped to the authenticated account and ordered newest first. Common explicit statuses include `400` for validation errors, `401` for a missing or invalid API key, `404` for missing users and for reads with no matching assignment, `409` for conflicting request IDs, and `429` for quota rejection. For `POST /usage/consume`, a missing or invalid account/user plan assignment returns `409`; the usage summary and current-plan read routes return `404` when no assignment exists for the requested/current time. The JSON `error` message identifies the reason. Unexpected database/application errors are passed to Express's default error handler.

### Validation and PostgreSQL storage bounds

Handler-level validation is distinct from column limits enforced by PostgreSQL:

| Field | Handler validation | Database column |
| --- | --- | --- |
| Account `name` | Must be a non-empty string after trimming. | `varchar(100)`; the handler does not check this maximum before insert. |
| User `externalId` | Must be a non-empty string after trimming; duplicates within the same account return `409`. | `varchar(255)`; the handler does not check this maximum. |
| Plan `name` | Must be a non-empty string after trimming. | `varchar(100)`; the handler does not check this maximum. |
| Plan `type` | Must be exactly `account` or `user`. | `varchar(20)`. |
| `monthlyAllowance`, `maxUnitsPerRequest` | Positive JavaScript safe integers. | PostgreSQL `integer`, whose maximum is 2,147,483,647. The handler does not enforce this smaller maximum, so a larger value can pass validation but fail at database insertion/update. |
| Usage `units` | Positive JavaScript safe integer. | PostgreSQL `bigint`; the handler's safe-integer bound is below the column's signed 64-bit maximum. |
| Usage `requestId` | Non-empty string, at most 255 characters before trimming. | `varchar(255)` and unique per account. |

An overlong varchar value is not converted by these handlers to a documented validation `400`; it can fail at the database layer and reach Express's default error handling.

## Demo clients

The project includes command-line demo clients that simulate a business service consuming usage on behalf of its users. The scenarios demonstrate successful usage consumption, quota rejection, shared account limits, usage history, plan changes, idempotency, concurrent requests, account isolation, and request validation.

Start the API and database, then run a scenario from the project root:

```sh
docker compose up --build -d db api
docker compose run --build --rm client npm run demo:success
```

You can also run a scenario directly from the project root after starting the API:

```sh
npm run demo:success
npm run demo:rejection
npm run demo:shared-account
npm run demo:history
npm run demo:plan-changes
npm run demo:idempotency
npm run demo:concurrency
npm run demo:isolation
npm run demo:validation
```

See [`client/README.md`](client/README.md) for all available scenarios, commands, and their expected behavior. Some scenarios create users, plans, assignments, and usage records that remain in the database after execution. Use a dedicated test account when running mutating scenarios against an existing account.

## Tests and load testing

### API tests against an isolated database

`npm test` runs `tests/api.test.mjs` with Node's built-in test runner. It sends HTTP requests to the service at `BASE_URL` (default `http://localhost:3000`), creates test accounts, users, and plans, and does not clean those records up. It does not create or reset a database itself.

Run the automated API tests with:

```sh
npm test
```

The latest recorded run completed with these results:

```yaml
Tests: 19
Passed: 19
Failed: 0
Duration: 1768.5409 ms
```

The suite covers these behaviors, grouped by area:

- **API key authentication and access:** requests without a key or with an invalid key are rejected; a valid key can access plans.
- **Account isolation:** an account cannot see or update another account's custom plan, and usage history does not expose another account's requests.
- **Usage validation and quotas:** zero and negative units are rejected; user and account monthly allowances and per-request limits reject over-limit usage without increasing consumption.
- **Idempotency:** retrying the same request does not count usage twice; reusing a request ID with different units or a different user returns a conflict without changing usage.
- **Usage history pagination:** limit and offset return separate pages, results are ordered newest first, and history remains account-scoped.
- **Plan updates:** subsequent usage requests use updated custom user plan settings.
- **Concurrent requests:** concurrent usage respects a user's monthly allowance and accepted concurrent requests are counted once without lost or double-counted usage.

To isolate test data in a separate Compose project, first ensure no other project is using host ports `3000` and `5433`. From the repository root, start a uniquely named test stack:

```sh
docker compose -p usage-metering-test up --build -d db api
```

Compose project names give this stack its own named PostgreSQL volume. Run the API tests against that stack:

```sh
# macOS / Linux
BASE_URL=http://localhost:3000 npm test
```

```powershell
# Windows PowerShell
$env:BASE_URL = "http://localhost:3000"
npm test
```

After testing, remove this test stack and its database volume only when you intend to discard its test data:

```sh
docker compose -p usage-metering-test down -v
```

Do not point the tests at a database containing data you need to preserve: the test suite leaves its generated records behind. The `-v` cleanup command deletes the named volume for this test project.

## Automated API Tests

Run the automated API test suite with:

```bash
npm test
```

The tests verify the API's behavior, validation rules, usage limits, and concurrency handling.

### Test Results

The latest recorded test run produced the following results:

| Metric | Result |
|---|---:|
| Total tests | 19 |
| Passed | 19 |
| Failed | 0 |
| Duration | 1.77 seconds |

### Test Coverage

The automated tests cover the following areas:

- **API Key Authentication:** Rejects requests with missing or invalid API keys and allows authenticated access.
- **Account Isolation:** Prevents accounts from accessing or modifying another account's custom plans and ensures usage history remains account-scoped.
- **Usage Validation and Quotas:** Rejects zero or negative units, usage beyond monthly allowances, and requests exceeding per-request limits.
- **Idempotency:** Prevents duplicate usage from being counted twice and rejects reuse of a request ID with different usage data.
- **Usage History:** Verifies pagination and account isolation.
- **Plan Updates:** Ensures updated custom user plan settings apply to subsequent usage requests.
- **Concurrent Requests:** Verifies monthly quota enforcement and ensures concurrent requests do not cause lost or double-counted usage.

All 19 tests passed, with no failures.

---

## Load Testing

The load test evaluates how the service handles a large number of concurrent usage requests and verifies that recorded consumption matches the expected total.

### Prerequisites

- Docker Desktop is running.
- The project dependencies are installed.
- The PostgreSQL service is available through Docker Compose.

### Running the Load Test

**1. Start the test API** in the first PowerShell terminal, from the project directory:

```powershell
docker compose run --rm -p 3001:3000 -e DB_NAME=usage_metering api
```

Wait until the server displays:

```text
Server is running on port 3000
```

Keep this terminal open.

**2. Run the load test** in a second PowerShell terminal, from the project directory:

```powershell
node tests/load-test.mjs
```

The 10,000-request test may take a few minutes to complete. Wait for the final results to appear.

### Load Test Results

The following results were recorded during a successful run with 10,000 requests and a concurrency level of 25.

| Metric | Result |
|---|---:|
| Total requests | 10,000 |
| Concurrency | 25 |
| Accepted requests | 10,000 |
| Rejected requests | 0 |
| Errors | 0 |
| Duration | 114.10 seconds |
| Throughput | 87.64 requests/second |
| Average latency | 284.95 ms |
| p50 latency | 273.43 ms |
| p95 latency | 332.48 ms |
| p99 latency | 390.61 ms |
| Expected consumed units | 10,000 |
| Actual consumed units | 10,000 |

### Performance Metrics Explained

- **Throughput:** The average number of requests processed per second during the test.
- **Average latency:** The mean response time across requests.
- **p50 latency:** 50% of requests completed within 273.43 ms.
- **p95 latency:** 95% of requests completed within 332.48 ms.
- **p99 latency:** 99% of requests completed within 390.61 ms.

### Outcome

All 10,000 requests were accepted, with zero rejections and zero errors. The actual consumed usage matched the expected total of 10,000 units.

These results represent a single test run and do not guarantee identical performance under every production workload.
## Known limitations

- API keys are created with accounts and stored as hashes, but the API has no key rotation or revocation endpoint.
- There are no account, user, or plan deletion endpoints. Account and user foreign-key cascades exist in the schema, but deletion is not exposed through this API.
- End-user records are identified by the integrating business's `externalId`; authenticated requests are authorized at the account level with the account API key. There is no separate end-user authentication flow.
- No request rate-limiting middleware is configured.
- Assignment rows and usage history are retained, but request history does not capture the plan or allowance used for each request. Plan edits update the plan row in place, which also affects the allowance later read for historical summary queries.
- The API tests and Node load script create records without cleaning them up. Use a disposable database when running them.
- The API has no custom error-response middleware; unexpected errors and unmatched routes are handled by Express defaults rather than the JSON error shapes returned by explicit handler validation.
- The Node load script has a fixed one-account, one-user, 10,000-request workload. k6 scripts and verified performance results are not part of the current repository.


