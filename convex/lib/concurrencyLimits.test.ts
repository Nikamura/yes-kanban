import { describe, test, expect } from "bun:test";
import { assertAtLeastOneWhenNumber, assertProjectConcurrencyPatch } from "./concurrencyLimits";

describe("assertAtLeastOneWhenNumber", () => {
  test("allows non-numbers", () => {
    expect(() => assertAtLeastOneWhenNumber("x", null)).not.toThrow();
    expect(() => assertAtLeastOneWhenNumber("x", undefined)).not.toThrow();
  });

  test("rejects numbers below 1", () => {
    expect(() => assertAtLeastOneWhenNumber("maxConcurrentPlanning", 0)).toThrow(
      /maxConcurrentPlanning must be >= 1/,
    );
  });

  test("allows 1 and above", () => {
    expect(() => assertAtLeastOneWhenNumber("maxConcurrent", 1)).not.toThrow();
    expect(() => assertAtLeastOneWhenNumber("maxConcurrent", 99)).not.toThrow();
  });
});

describe("assertProjectConcurrencyPatch", () => {
  test("allows empty patch", () => {
    expect(() => assertProjectConcurrencyPatch({})).not.toThrow();
  });

  test("rejects zero for any concurrency field", () => {
    expect(() => assertProjectConcurrencyPatch({ maxConcurrent: 0 })).toThrow();
    expect(() => assertProjectConcurrencyPatch({ maxConcurrentPlanning: 0 })).toThrow();
    expect(() => assertProjectConcurrencyPatch({ maxConcurrentCoding: 0 })).toThrow();
  });
});
