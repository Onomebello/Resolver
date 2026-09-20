import { test } from "node:test";
import assert from "node:assert/strict";
import { capitalizeWords } from "../src/examples/string-utils.js";

test("capitalizes only the first letter of each word", () => {
  assert.equal(capitalizeWords("hello world"), "Hello World");
});

test("leaves already-capitalized words unchanged", () => {
  assert.equal(capitalizeWords("Hello World"), "Hello World");
});
