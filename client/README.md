# Usage metering demo clients

These command-line clients act as a business service on behalf of its users. Console output varies by scenario: some commands print HTTP statuses and JSON responses, while others print formatted summaries and verification messages.

## Run the demo scenarios

Start PostgreSQL and the API:

```sh
docker compose up --build -d db api
```

Run any scenario from the project root:

```sh
docker compose run --build --rm client npm run demo:success
docker compose run --build --rm client npm run demo:rejection
docker compose run --build --rm client npm run demo:shared-account
docker compose run --build --rm client npm run demo:history
docker compose run --build --rm client npm run demo:plan-changes
docker compose run --build --rm client npm run demo:idempotency
docker compose run --build --rm client npm run demo:concurrency
docker compose run --build --rm client npm run demo:isolation
docker compose run --build --rm client npm run demo:validation
```

The cases demonstrate:

- `demo:success`: one user consumes 25 units successfully.
- `demo:rejection`: a user exceeds a 2-unit monthly allowance; the output includes the rejection reason and scope.
- `demo:shared-account`: two users concurrently request 7 units each from an account with a 10-unit allowance. One request should be accepted and the other rejected for the account limit.
- `demo:history`: displays the user's usage summaries for the previous three months and up to the latest 100 account request outcomes. Without `USAGE_API_KEY`, it creates an account, user, plans, and current-month sample requests. Because those plans are assigned starting now, prior-month lookups report that no usage summary is available for the month (there was no plan assignment then). With `USAGE_API_KEY`, pass an existing user's external ID; the scenario only reads that user's summaries and account history.
- `demo:plan-changes`: demonstrates the four plan update/switch cases, including checks that earlier request records remain in usage history.
- `demo:idempotency`: retries the same request ID and verifies usage is counted once; changed data with that ID returns a conflict.
- `demo:concurrency`: sends eight simultaneous requests and verifies all units are counted once.
- `demo:isolation`: verifies an account cannot read or consume for another account's user.
- `demo:validation`: prints errors for zero units and missing request fields.

The plan-change scenario demonstrates that a successful plan update affects the next request, account-plan changes affect all users on that account, switching plans keeps the current month's consumed units, and reducing allowance below usage shows zero remaining and rejects more usage. It then raises the allowance enough to accept only the newly available units. It verifies that all scenario requests remain in history.

## Existing-account effects and persistent demo data

Without `USAGE_API_KEY`, each scenario creates a demo account and uses its returned API key. With an existing key, use a dedicated test account for scenarios that write data: demo-created users, plans, plan-assignment rows, and usage request history are not deleted after a run.

Account-plan assignment behavior differs by scenario:

- `demo:success` and `demo:rejection` assign the existing account to the predefined Starter plan and do not restore its previous account plan.
- `demo:shared-account` assigns a newly created account plan with a 10-unit monthly allowance and does not restore the previous account plan. A fresh account gives the expected one-accepted, one-rejected result because pre-existing monthly account usage counts against that allowance.
- `demo:plan-changes` saves the previous effective account plan and reassigns it at the end only if one existed. If no account plan existed before the scenario, its high-allowance guard plan remains assigned.
- `demo:idempotency`, `demo:concurrency`, `demo:isolation`, and `demo:validation` use the shared helper. It reassigns the previous effective account plan at the end if one existed; otherwise, its guard plan remains assigned.
- `demo:history` with an existing API key and external ID is read-only. Without a key, it creates sample account data and usage requests, which remain in the database.

Reassigning a previous plan creates another assignment row; it does not remove the temporary assignment or other demo records. The plan-change and helper-based scenarios also leave their created plans, users, and other applicable history in the database.

You can also run the clients directly after starting the API with `npm run dev`:

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

With an existing account key, pass the external user ID to view that user's monthly summaries and the account's recent request outcomes:

```sh
npm run demo:history -- customer-123
```

For the Docker Compose client, include the external ID after `--` when `USAGE_API_KEY` is set:

```sh
docker compose run --build --rm client npm run demo:history -- customer-123
```

Keep the account key in this trusted command-line client or server environment; do not put it in browser code.

