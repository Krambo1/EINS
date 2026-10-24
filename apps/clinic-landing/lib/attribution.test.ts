/**
 * Simulated browser for the inline attribution script: runs the exact
 * ATTRIBUTION_SCRIPT string against a fake `window`, then reads the capture
 * the way the pre-qualifier's extractUtm() does (extractUtmFrom).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ATTRIBUTION_SCRIPT, extractUtmFrom, withAttribution } from "./attribution";
import { POST_CODE_PATTERN_SOURCE } from "./post-code";

interface FakeWindow {
  location: { href: string };
  history: { state: unknown; replaceState: (s: unknown, t: string, url: string) => void };
  __einsAttribution__?: Record<string, string>;
}

/** One page load: the script runs at parse time. Returns the address after it and the capture. */
function load(href: string): { address: string; captured: Record<string, string> | undefined } {
  const win: FakeWindow = {
    location: { href },
    history: {
      state: null,
      replaceState(_s, _t, url) {
        win.location.href = new URL(url, win.location.href).href;
      },
    },
  };
  new Function("window", ATTRIBUTION_SCRIPT)(win);
  return { address: win.location.href, captured: win.__einsAttribution__ };
}

/** What the pre-qualifier puts into the intake payload `utm` on that page. */
function payloadUtm(page: ReturnType<typeof load>) {
  return extractUtmFrom(page.captured, new URL(page.address).search);
}

test("the inline regex literal equals POST_CODE_PATTERN_SOURCE", () => {
  const m = ATTRIBUTION_SCRIPT.match(/c=\/(.+?)\/;/);
  assert.ok(m, "regex literal not found in the script");
  assert.equal(m[1], POST_CODE_PATTERN_SOURCE);
});

test("organic DM link with a post code: the code stays in the address and survives a reload", () => {
  const link = "https://praxis.example/?utm_source=instagram&utm_medium=dm&utm_content=b7k2x";
  const first = load(link);
  assert.equal(first.address, link);
  assert.deepEqual(payloadUtm(first), { utm_source: "instagram", utm_medium: "dm", utm_content: "b7k2x" });

  const reload = load(first.address);
  assert.equal(reload.address, link);
  assert.deepEqual(payloadUtm(reload), { utm_source: "instagram", utm_medium: "dm", utm_content: "b7k2x" });
});

test("ad link: campaign, term and a non-code utm_content are stripped before any pixel, captured in memory", () => {
  const link =
    "https://praxis.example/a1?utm_source=facebook&utm_medium=paid&utm_campaign=botox-herbst&utm_term=falten&utm_content=botox_video_1&fbclid=XYZ#form";
  const first = load(link);
  assert.equal(first.address, "https://praxis.example/a1?utm_source=facebook&utm_medium=paid&fbclid=XYZ#form");
  assert.deepEqual(payloadUtm(first), {
    utm_source: "facebook",
    utm_medium: "paid",
    utm_campaign: "botox-herbst",
    utm_term: "falten",
    utm_content: "botox_video_1",
    fbclid: "XYZ",
  });

  // After a reload only what stayed in the address is left.
  const reload = load(first.address);
  assert.equal(reload.address, first.address);
  assert.deepEqual(payloadUtm(reload), { utm_source: "facebook", utm_medium: "paid", fbclid: "XYZ" });
});

test("utm_content that only looks close to a code is stripped", () => {
  for (const v of ["B7K2X", "botox", "bcdfg", "23456", "a7k2x", "b7k2"]) {
    const page = load(`https://praxis.example/?utm_source=instagram&utm_medium=story&utm_content=${v}`);
    assert.equal(page.address, "https://praxis.example/?utm_source=instagram&utm_medium=story", v);
    assert.equal(page.captured?.utm_content, v);
  }
});

test("profile link without utm_content is left alone", () => {
  const link = "https://praxis.example/?utm_source=instagram&utm_medium=profil_link";
  assert.equal(load(link).address, link);
});

test("start page carries every utm_* and click id to the treatment page", () => {
  const start = load(
    "https://praxis.example/?utm_source=facebook&utm_medium=paid&utm_campaign=c1&utm_term=t&utm_content=b7k2x&gclid=G&wbraid=W&gbraid=GB&ttclid=T&fbclid=F&other=1",
  );
  const href = withAttribution("/praxis/a1", start.captured);
  const target = load(new URL(href, "https://praxis.example").href);
  assert.deepEqual(payloadUtm(target), {
    utm_source: "facebook",
    utm_medium: "paid",
    utm_campaign: "c1",
    utm_term: "t",
    utm_content: "b7k2x",
    gclid: "G",
    wbraid: "W",
    gbraid: "GB",
    ttclid: "T",
    fbclid: "F",
  });
  assert.equal(new URL(href, "https://praxis.example").searchParams.has("other"), false);
  assert.equal(withAttribution("/praxis/a1", undefined), "/praxis/a1");
  assert.equal(withAttribution("/praxis/a1", {}), "/praxis/a1");
});
