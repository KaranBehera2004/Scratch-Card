import test from "node:test";
import assert from "node:assert/strict";
import { UNAVAILABLE_ERROR_MESSAGE, UNEXPECTED_ERROR_MESSAGE, errorMessage, errorStatus } from "../src/services/http-errors.js";

const withStatus = (message, status) => Object.assign(new Error(message), { status });
const named = (name, message, extra = {}) => Object.assign(new Error(message), { name, ...extra });

test("deliberate API errors keep their status and message", () => {
  for (const [error, status] of [
    [withStatus("Access to another business is denied.", 403), 403],
    [withStatus("Configure AUTH_SECRET before signing in.", 503), 503],
    [Object.assign(new Error("request entity too large"), { statusCode: 413, type: "entity.too.large" }), 413],
  ]) {
    assert.equal(errorStatus(error), status);
    assert.equal(errorMessage(error), error.message);
  }
});

test("input validation from Mongoose is a client error", () => {
  for (const name of ["ValidationError", "CastError"]) {
    const error = named(name, "Card validation failed: branchName is too long");
    assert.equal(errorStatus(error), 400);
    assert.equal(errorMessage(error), error.message);
  }
});

test("database outages are temporary and never expose driver details", () => {
  const transient = new Error("Write conflict during plan execution");
  transient.hasErrorLabel = (label) => label === "TransientTransactionError";
  for (const error of [
    named("MongoServerSelectionError", "Server selection timed out after 15000 ms (cluster0.example.mongodb.net)"),
    named("MongooseServerSelectionError", "Could not connect to any servers in your MongoDB Atlas cluster"),
    named("MongoNetworkTimeoutError", "connection 4 to 10.0.0.7:27017 timed out"),
    named("MongoServerError", "Not primary", { code: 10107 }),
    named("MongooseError", "Operation `cards.findOne()` buffering timed out after 10000ms"),
    transient,
  ]) {
    assert.equal(errorStatus(error), 503, error.message);
    assert.equal(errorMessage(error), UNAVAILABLE_ERROR_MESSAGE);
  }
});

test("unexpected failures are server errors with a generic message", () => {
  for (const error of [new TypeError("Cannot read properties of undefined (reading 'filter')"),
    new SyntaxError("Unexpected token n in JSON at position 1"), withStatus("No status", "error")]) {
    assert.equal(errorStatus(error), 500);
    assert.equal(errorMessage(error), UNEXPECTED_ERROR_MESSAGE);
  }
  assert.equal(errorStatus(undefined), 500);
});
