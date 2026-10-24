import { test } from "node:test";
import assert from "node:assert/strict";
import { isPostCode, POST_CODE_PATTERN_SOURCE } from "./post-code";

test("pattern source is pinned (same string as apps/portal/src/lib/post-code.ts)", () => {
  assert.equal(
    POST_CODE_PATTERN_SOURCE,
    "^(?=[bcdfghjkmnpqrstvwxz2-9]*[2-9])(?=[bcdfghjkmnpqrstvwxz2-9]*[bcdfghjkmnpqrstvwxz])[bcdfghjkmnpqrstvwxz2-9]{5}$",
  );
});

test("valid post codes", () => {
  for (const v of ["b7k2x", "2222b", "z9999"]) assert.equal(isPostCode(v), true, v);
});

test("everything else is not a post code", () => {
  for (const v of [
    "botox", // word, no digit
    "B7K2X", // upper case
    "b7k2", // too short
    "b7k2xx", // too long
    "a7k2x", // vowel
    "bcdfg", // no digit
    "23456", // no letter
    "b7k1x", // digit 1 not in alphabet
    "b7l2x", // "l" not in alphabet
    " b7k2x",
    "",
    null,
    undefined,
    12345,
  ]) {
    assert.equal(isPostCode(v), false, String(v));
  }
});
