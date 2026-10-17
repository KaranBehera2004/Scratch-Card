// Route handlers raise deliberate API errors with an HTTP status. Anything else
// is an unexpected server or database failure: report it as one instead of
// blaming the client, and never send internal error text to the browser.
const CLIENT_ERRORS = new Set(["ValidationError", "CastError", "StrictModeError"]);
const DATABASE_ERRORS = new Set([
  "MongoServerSelectionError", "MongooseServerSelectionError", "MongoNetworkError",
  "MongoNetworkTimeoutError", "MongoNotConnectedError", "MongoTopologyClosedError",
  "MongoPoolClearedError", "MongoWaitQueueTimeoutError",
]);
// Replica-set elections, shutdowns, time limits and Atlas quota/proxy errors.
const DATABASE_CODES = new Set([6, 7, 50, 89, 91, 189, 262, 8000, 9001, 10107, 11600, 11602, 13435, 13436]);

export const UNEXPECTED_ERROR_MESSAGE = "Something went wrong on our side. Please try again.";
export const UNAVAILABLE_ERROR_MESSAGE = "The service is temporarily unavailable. Please try again shortly.";

function explicitStatus(error) {
  const status = Number(error?.status ?? error?.statusCode);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 0;
}

export function isDatabaseUnavailable(error) {
  return DATABASE_ERRORS.has(error?.name) || DATABASE_CODES.has(error?.code)
    || Boolean(error?.hasErrorLabel?.("TransientTransactionError"))
    || Boolean(error?.hasErrorLabel?.("RetryableWriteError"))
    || /buffering timed out/i.test(String(error?.message || ""));
}

export function errorStatus(error) {
  const status = explicitStatus(error);
  if (status) return status;
  if (CLIENT_ERRORS.has(error?.name)) return 400;
  return isDatabaseUnavailable(error) ? 503 : 500;
}

// Deliberate errors and input validation explain what to fix. Unexpected
// failures can contain hostnames, stack details or query text.
export function errorMessage(error, status = errorStatus(error)) {
  if (explicitStatus(error) || status < 500) return error?.message || "Something went wrong.";
  return status === 503 ? UNAVAILABLE_ERROR_MESSAGE : UNEXPECTED_ERROR_MESSAGE;
}
