
const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
const apiKey = process.env.API_KEY;
const externalId = process.env.EXTERNAL_ID;
const units = Number(process.env.UNITS ?? "1");
const requestId =
  process.env.REQUEST_ID ?? `cli-${Date.now()}`;

if (!apiKey) {
  console.error("Missing required environment variable: API_KEY");
  process.exit(1);
}

if (!externalId || externalId.trim().length === 0) {
  console.error("Missing required environment variable: EXTERNAL_ID");
  process.exit(1);
}

if (!Number.isSafeInteger(units) || units <= 0) {
  console.error("UNITS must be a positive safe integer");
  process.exit(1);
}

try {
  const response = await fetch(`${baseUrl}/usage/consume`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      externalId,
      units,
      requestId,
    }),
  });

  const result = await response.json();

  console.log(`HTTP Status: ${response.status}`);
  console.log(JSON.stringify(result, null, 2));

  if (!response.ok) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error("Failed to contact Usage Metering Service.");

  if (error instanceof Error) {
    console.error(error.message);
  }

  process.exitCode = 1;
}
