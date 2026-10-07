import test from "node:test";
import assert from "node:assert/strict";
import { normalizeWhatsAppNumber, whatsAppCardMessage, whatsAppCardUrl } from "./whatsapp.js";

test("WhatsApp numbers normalize Indian mobile and explicit international formats", () => {
  assert.equal(normalizeWhatsAppNumber("98765 43210"), "+919876543210");
  assert.equal(normalizeWhatsAppNumber("+91 (98765) 43210"), "+919876543210");
  assert.equal(normalizeWhatsAppNumber("919876543210"), "+919876543210");
  assert.equal(normalizeWhatsAppNumber("+1 (202) 555-0123"), "+12025550123");
  assert.equal(normalizeWhatsAppNumber("+44 7700 900123"), "+447700900123");
  assert.equal(normalizeWhatsAppNumber("+1234567890"), "+1234567890");
});

test("WhatsApp numbers must be present and contain a valid international or Indian format", () => {
  for (const value of [undefined, null, "", "  "]) assert.throws(() => normalizeWhatsAppNumber(value), /Enter the customer's WhatsApp number/);
  for (const value of [1234567890, {}, "+01234567890", "1234567890", "++919876543210", "abc", "9876543210 ext 1", "1234567890123456"])
    assert.throws(() => normalizeWhatsAppNumber(value), /Enter a valid WhatsApp number/);
});

test("WhatsApp links target the entered customer with an encoded card message", () => {
  const cardUrl = "https://example.test/card/abc123";
  const url = new URL(whatsAppCardUrl("9876543210", cardUrl));
  assert.equal(url.origin, "https://web.whatsapp.com");
  assert.equal(url.pathname, "/send");
  assert.equal(url.searchParams.get("phone"), "919876543210");
  assert.equal(url.searchParams.get("text"), whatsAppCardMessage(cardUrl));
  assert.equal(whatsAppCardMessage(cardUrl), `A surprise is waiting for you! Scratch your card here: ${cardUrl}`);
});
