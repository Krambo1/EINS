import { describe, expect, it } from "vitest";
import {
  BRIDGE_SOURCES,
  CURRENCIES,
  EVENT_KINDS,
} from "../../../bridge/src/canonical/schema-source";
import { PvsEventSchema } from "./pvs-events";

/**
 * Conformance gate for the portal Zod schema against the single source of truth
 * (apps/bridge/src/canonical/schema-source.ts). The portal Zod is a
 * hand-maintained copy; editing it (adding/removing a bridge source, event
 * kind, or currency) without updating the source fails this test.
 *
 * zod's runtime introspection (.options on a ZodEnum, .value on a ZodLiteral,
 * .removeDefault() on a ZodDefault) is untyped on a discriminated-union
 * member's shape, so this reads it through a thin `any` view. The assertions
 * are the real contract.
 */
type AnyMember = { shape: Record<string, any> };
const members = PvsEventSchema.options as unknown as AnyMember[];

// bridgeSource is shared across every union member via baseFields, so the first
// member's enum is representative.
const bridgeSourceOptions: string[] = members[0].shape.bridgeSource.options;
const kindLiterals: string[] = members.map((m) => m.shape.kind.value);
const invoicePaid = members.find((m) => m.shape.kind.value === "InvoicePaid");
const currencyOptions: string[] =
  invoicePaid!.shape.currency.removeDefault().options;

const sorted = (xs: readonly string[]) => [...xs].sort();

describe("portal PvsEventSchema conforms to canonical schema-source", () => {
  it("BridgeSource enum equals BRIDGE_SOURCES exactly", () => {
    expect(sorted(bridgeSourceOptions)).toEqual(sorted(BRIDGE_SOURCES));
  });

  it("discriminated-union kinds equal EVENT_KINDS exactly", () => {
    expect(sorted(kindLiterals)).toEqual(sorted(EVENT_KINDS));
  });

  it("InvoicePaid currency enum equals CURRENCIES exactly", () => {
    expect(sorted(currencyOptions)).toEqual(sorted(CURRENCIES));
  });
});
