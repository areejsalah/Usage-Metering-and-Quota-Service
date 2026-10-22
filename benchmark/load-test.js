import http from "k6/http";
import { Counter } from "k6/metrics";
import { check } from "k6";
import exec from "k6/execution";

const target = JSON.parse(open("./benchmark-target.json"));

const iterations = new Counter("benchmark_iterations");
const accepted = new Counter("benchmark_accepted");
const rejected = new Counter("benchmark_rejected");
const errors = new Counter("benchmark_errors");

export const options = {
  scenarios: {
    stage_25_rps: {
      executor: "constant-arrival-rate",
      startTime: "0s",
      rate: 25,
      timeUnit: "1s",
      duration: "30s",
      preAllocatedVUs: 50,
      maxVUs: 100,
      gracefulStop: "60s",
    },
    stage_100_rps: {
      executor: "constant-arrival-rate",
      startTime: "30s",
      rate: 100,
      timeUnit: "1s",
      duration: "30s",
      preAllocatedVUs: 150,
      maxVUs: 500,
      gracefulStop: "60s",
    },
    stage_500_rps: {
      executor: "constant-arrival-rate",
      startTime: "60s",
      rate: 500,
      timeUnit: "1s",
      duration: "30s",
      preAllocatedVUs: 600,
      maxVUs: 2_000,
      gracefulStop: "60s",
    },
  },
};

export default function () {
  const scenario = exec.scenario.name;
  iterations.add(1, { scenario });
  const requestId = `k6-${target.runId}-${scenario}-${__VU}-${__ITER}`;

  let response;
  try {
    response = http.post(
      `${target.baseUrl}/usage/consume`,
      JSON.stringify({ externalId: target.externalId, units: 1, requestId }),
      {
        headers: {
          "content-type": "application/json",
          "x-api-key": target.apiKey,
        },
        tags: { scenario },
        timeout: "30s",
      },
    );
  } catch {
    errors.add(1, { scenario });
    return;
  }

  let payload;
  try {
    payload = response.json();
  } catch {
    payload = null;
  }

  if (response.status === 200 && payload?.status === "ACCEPTED") {
    accepted.add(1, { scenario });
    check(response, { "usage request accepted": (res) => res.status === 200 });
  } else if (response.status === 429 && payload?.status === "REJECTED") {
    rejected.add(1, { scenario });
  } else {
    errors.add(1, { scenario });
  }
}
