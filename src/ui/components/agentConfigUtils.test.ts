import { describe, it, expect } from "bun:test";
import {
  parseEnvString,
  envToString,
  parseArgs,
  argsToString,
  parseOptionalStringArray,
  validateAgentAdvanced,
  type AgentAdvancedForm,
} from "./agentConfigUtils";

describe("parseEnvString", () => {
  it("returns undefined for empty string", () => {
    expect(parseEnvString("")).toBeUndefined();
    expect(parseEnvString("   ")).toBeUndefined();
  });

  it("parses single KEY=VALUE", () => {
    expect(parseEnvString("API_KEY=abc123")).toEqual({ API_KEY: "abc123" });
  });

  it("parses multiple lines", () => {
    expect(parseEnvString("A=1\nB=2\nC=3")).toEqual({ A: "1", B: "2", C: "3" });
  });

  it("handles values containing =", () => {
    expect(parseEnvString("URL=http://x?a=1")).toEqual({ URL: "http://x?a=1" });
  });

  it("trims whitespace from keys and values", () => {
    expect(parseEnvString("  KEY  =  val  ")).toEqual({ KEY: "val" });
  });

  it("skips lines without =", () => {
    expect(parseEnvString("GOOD=yes\nBADLINE\nALSO_GOOD=ok")).toEqual({
      GOOD: "yes",
      ALSO_GOOD: "ok",
    });
  });

  it("returns undefined when all lines are invalid", () => {
    expect(parseEnvString("no-equals\nanother")).toBeUndefined();
  });
});

describe("envToString", () => {
  it("returns empty string for undefined", () => {
    expect(envToString(undefined)).toBe("");
  });

  it("converts record to KEY=VALUE lines", () => {
    expect(envToString({ A: "1", B: "2" })).toBe("A=1\nB=2");
  });
});

describe("parseOptionalStringArray", () => {
  it("returns undefined for empty string", () => {
    expect(parseOptionalStringArray("")).toBeUndefined();
    expect(parseOptionalStringArray("   ")).toBeUndefined();
  });

  it("parses comma-separated values", () => {
    expect(parseOptionalStringArray("a, b, c")).toEqual(["a", "b", "c"]);
  });

  it("filters empty segments", () => {
    expect(parseOptionalStringArray("a,,b,")).toEqual(["a", "b"]);
  });

  it("trims whitespace", () => {
    expect(parseOptionalStringArray("  foo ,  bar  ")).toEqual(["foo", "bar"]);
  });
});

describe("parseArgs", () => {
  it("returns undefined for empty string", () => {
    expect(parseArgs("")).toBeUndefined();
    expect(parseArgs("   ")).toBeUndefined();
  });

  it("parses newline-separated values", () => {
    expect(parseArgs("--flag\nvalue")).toEqual(["--flag", "value"]);
  });

  it("handles values containing commas", () => {
    expect(parseArgs("--config=a,b\n--verbose")).toEqual(["--config=a,b", "--verbose"]);
  });

  it("filters empty lines and trims whitespace", () => {
    expect(parseArgs("  --flag  \n\n  value  \n")).toEqual(["--flag", "value"]);
  });
});

describe("argsToString", () => {
  it("returns empty string for undefined", () => {
    expect(argsToString(undefined)).toBe("");
  });

  it("returns empty string for empty array", () => {
    expect(argsToString([])).toBe("");
  });

  it("joins args with newlines", () => {
    expect(argsToString(["--flag", "value"])).toBe("--flag\nvalue");
  });
});

describe("validateAgentAdvanced", () => {
  const validForm: AgentAdvancedForm = {
    args: "",
    timeoutMs: "60",
    maxRetries: "3",
    retryBackoffMs: "10",
    maxRetryBackoffMs: "300",
    env: "",
    mcpEnabled: true,
    mcpTools: "",
  };

  it("returns null for valid form", () => {
    expect(validateAgentAdvanced(validForm)).toBeNull();
  });

  it("rejects empty timeout", () => {
    expect(validateAgentAdvanced({ ...validForm, timeoutMs: "" })).toContain("Timeout");
  });

  it("rejects timeout < 1", () => {
    expect(validateAgentAdvanced({ ...validForm, timeoutMs: "0" })).toContain("Timeout");
  });

  it("rejects non-numeric timeout", () => {
    expect(validateAgentAdvanced({ ...validForm, timeoutMs: "abc" })).toContain("Timeout");
  });

  it("rejects negative maxRetries", () => {
    expect(validateAgentAdvanced({ ...validForm, maxRetries: "-1" })).toContain("Max retries");
  });

  it("allows zero maxRetries", () => {
    expect(validateAgentAdvanced({ ...validForm, maxRetries: "0" })).toBeNull();
  });

  it("rejects empty retryBackoffMs", () => {
    expect(validateAgentAdvanced({ ...validForm, retryBackoffMs: "" })).toContain("Retry backoff");
  });

  it("rejects maxRetryBackoff < retryBackoff", () => {
    expect(
      validateAgentAdvanced({ ...validForm, retryBackoffMs: "100", maxRetryBackoffMs: "50" })
    ).toContain("Max retry backoff must be >=");
  });

  it("accepts maxRetryBackoff equal to retryBackoff", () => {
    expect(
      validateAgentAdvanced({ ...validForm, retryBackoffMs: "10", maxRetryBackoffMs: "10" })
    ).toBeNull();
  });
});
