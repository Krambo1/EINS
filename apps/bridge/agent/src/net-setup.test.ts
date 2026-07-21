import { afterEach, describe, expect, it, vi } from "vitest";
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from "undici";
import {
  _resetAgentFetchForTests,
  agentFetch,
  configureGlobalDispatcher,
  tlsHint,
} from "./net-setup.js";

describe("agentFetch proxy wiring (H12)", () => {
  const PROXY_VARS = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"];
  const savedEnv = new Map(PROXY_VARS.map((v) => [v, process.env[v]]));
  const savedDispatcher = getGlobalDispatcher();

  afterEach(() => {
    for (const [name, value] of savedEnv) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    setGlobalDispatcher(savedDispatcher);
    _resetAgentFetchForTests();
    vi.restoreAllMocks();
  });

  it("delegates to globalThis.fetch when no proxy is configured", async () => {
    for (const v of PROXY_VARS) delete process.env[v];
    expect(configureGlobalDispatcher(() => {})).toBe(false);
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("direct"));
    const res = await agentFetch("http://portal.test/ping");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await res.text()).toBe("direct");
  });

  it("routes through the npm-undici dispatcher registry when a proxy is set", async () => {
    // The core H12 regression: Node's BUILT-IN fetch reads a different
    // global-dispatcher slot than the npm undici package that ships
    // EnvHttpProxyAgent, so proxy support silently no-ops unless agentFetch
    // switches to undici's own fetch. Prove the switch by installing a
    // MockAgent in the npm registry: if agentFetch still used the built-in
    // fetch, the mock could never intercept and the globalThis spy would fire.
    for (const v of PROXY_VARS) delete process.env[v];
    process.env.HTTPS_PROXY = "http://127.0.0.1:9";
    expect(configureGlobalDispatcher(() => {})).toBe(true);

    const mock = new MockAgent();
    mock.disableNetConnect();
    mock
      .get("http://portal.test")
      .intercept({ path: "/ping", method: "GET" })
      .reply(200, "via-npm-undici-dispatcher");
    setGlobalDispatcher(mock);
    const globalSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("built-in fetch must not be used"));

    const res = await agentFetch("http://portal.test/ping");
    expect(await res.text()).toBe("via-npm-undici-dispatcher");
    expect(globalSpy).not.toHaveBeenCalled();
    await mock.close();
  });
});

describe("tlsHint", () => {
  it("returns null for a non-TLS error", () => {
    expect(tlsHint(new Error("ECONNREFUSED"))).toBeNull();
    expect(tlsHint({ code: "ENOTFOUND" })).toBeNull();
    expect(tlsHint(undefined)).toBeNull();
  });

  it("recognises a top-level cert-verification code", () => {
    const err = Object.assign(new Error("boom"), {
      code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    });
    const hint = tlsHint(err);
    expect(hint).toMatch(/NODE_EXTRA_CA_CERTS/);
    expect(hint).toMatch(/UNABLE_TO_VERIFY_LEAF_SIGNATURE/);
  });

  it("walks the cause chain (undici wraps the TLS error as cause)", () => {
    // Mirrors real undici: fetch throws "fetch failed" whose .cause is the
    // TLS error carrying the code.
    const outer = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("self signed certificate in chain"), {
        code: "SELF_SIGNED_CERT_IN_CHAIN",
      }),
    });
    const hint = tlsHint(outer);
    expect(hint).toMatch(/TLS-inspecting/);
    expect(hint).toMatch(/SELF_SIGNED_CERT_IN_CHAIN/);
  });

  it("does not infinite-loop on a cyclic cause chain", () => {
    const a: { code?: string; cause?: unknown } = { code: "SOMETHING_ELSE" };
    const b: { code?: string; cause?: unknown } = { code: "OTHER", cause: a };
    a.cause = b; // cycle
    expect(tlsHint(a)).toBeNull();
  });
});
