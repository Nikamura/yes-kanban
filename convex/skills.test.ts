import { describe, test, expect } from "bun:test";
import { parseSkillMd, resolveSourceUrl, fetchAndParseSkill, isBlockedHost } from "./lib/skillHelpers";

describe("parseSkillMd", () => {
  test("parses valid frontmatter with name and description", () => {
    const raw = `---
name: my-skill
description: A useful skill
---

Do the thing.`;
    const result = parseSkillMd(raw);
    expect(result.name).toBe("my-skill");
    expect(result.description).toBe("A useful skill");
    expect(result.content).toBe("Do the thing.");
  });

  test("handles quoted values containing colons", () => {
    const raw = `---
name: "fix-skill"
description: "Fix: something broken"
---

Content here.`;
    const result = parseSkillMd(raw);
    expect(result.name).toBe("fix-skill");
    expect(result.description).toBe("Fix: something broken");
  });

  test("handles single-quoted values", () => {
    const raw = `---
name: 'my-skill'
description: 'A simple skill'
---

Body.`;
    const result = parseSkillMd(raw);
    expect(result.name).toBe("my-skill");
    expect(result.description).toBe("A simple skill");
  });

  test("returns defaults when no frontmatter present", () => {
    const raw = "Just some content without frontmatter.";
    const result = parseSkillMd(raw);
    expect(result.name).toBe("unnamed-skill");
    expect(result.description).toBe("");
    expect(result.content).toBe("Just some content without frontmatter.");
  });

  test("returns defaults when frontmatter is incomplete", () => {
    const raw = `---
foo: bar
---

Content.`;
    const result = parseSkillMd(raw);
    expect(result.name).toBe("unnamed-skill");
    expect(result.description).toBe("");
    expect(result.content).toBe("Content.");
  });

  test("handles empty content after frontmatter", () => {
    const raw = `---
name: empty-body
description: No body
---
`;
    const result = parseSkillMd(raw);
    expect(result.name).toBe("empty-body");
    expect(result.content).toBe("");
  });

  test("handles unquoted values with colons", () => {
    const raw = `---
name: my-skill
description: Fix: handle edge cases
---

Body.`;
    const result = parseSkillMd(raw);
    expect(result.description).toBe("Fix: handle edge cases");
  });
});

describe("resolveSourceUrl", () => {
  test("returns raw HTTPS URL as-is", () => {
    const result = resolveSourceUrl("https://example.com/skill.md");
    expect(result.url).toBe("https://example.com/skill.md");
    expect(result.source).toBe("url");
  });

  test("rejects HTTP URLs", () => {
    expect(() => resolveSourceUrl("http://example.com/skill.md")).toThrow("Only HTTPS");
  });

  test("resolves npm: prefix to unpkg URL", () => {
    const result = resolveSourceUrl("npm:my-package");
    expect(result.url).toBe("https://unpkg.com/my-package@latest/SKILL.md");
    expect(result.source).toBe("npm");
  });

  test("resolves GitHub shorthand owner/repo", () => {
    const result = resolveSourceUrl("acme/cool-skill");
    expect(result.url).toBe("https://raw.githubusercontent.com/acme/cool-skill/main/SKILL.md");
    expect(result.source).toBe("github");
  });

  test("resolves GitHub shorthand owner/repo/path", () => {
    const result = resolveSourceUrl("acme/cool-skill/skills/deploy.md");
    expect(result.url).toBe(
      "https://raw.githubusercontent.com/acme/cool-skill/main/skills/deploy.md"
    );
    expect(result.source).toBe("github");
  });

  test("throws on invalid source ref", () => {
    expect(() => resolveSourceUrl("just-a-word")).toThrow("Invalid source");
  });

  test("rejects path traversal in GitHub shorthand", () => {
    expect(() => resolveSourceUrl("../..")).toThrow("Invalid source");
  });

  test("resolves GitHub shorthand with branch specifier", () => {
    const result = resolveSourceUrl("acme/cool-skill@master");
    expect(result.url).toBe("https://raw.githubusercontent.com/acme/cool-skill/master/SKILL.md");
    expect(result.source).toBe("github");
  });

  test("resolves GitHub shorthand with branch and path", () => {
    const result = resolveSourceUrl("acme/cool-skill@develop/skills/deploy.md");
    expect(result.url).toBe(
      "https://raw.githubusercontent.com/acme/cool-skill/develop/skills/deploy.md"
    );
  });
});

describe("isBlockedHost", () => {
  // Cloud metadata endpoints
  test("blocks AWS/GCP metadata IP", () => {
    expect(isBlockedHost("169.254.169.254")).toBe(true);
  });

  test("blocks GCP metadata hostname", () => {
    expect(isBlockedHost("metadata.google.internal")).toBe(true);
  });

  // Loopback
  test("blocks localhost", () => {
    expect(isBlockedHost("localhost")).toBe(true);
  });

  test("blocks 127.0.0.1", () => {
    expect(isBlockedHost("127.0.0.1")).toBe(true);
  });

  test("blocks 127.x.x.x range", () => {
    expect(isBlockedHost("127.255.0.1")).toBe(true);
  });

  // 0.0.0.0
  test("blocks 0.0.0.0", () => {
    expect(isBlockedHost("0.0.0.0")).toBe(true);
  });

  // Private IPv4 ranges
  test("blocks 10.0.0.0/8", () => {
    expect(isBlockedHost("10.0.0.1")).toBe(true);
    expect(isBlockedHost("10.255.255.255")).toBe(true);
  });

  test("blocks 172.16.0.0/12", () => {
    expect(isBlockedHost("172.16.0.1")).toBe(true);
    expect(isBlockedHost("172.31.255.255")).toBe(true);
  });

  test("does not block 172.15.x.x or 172.32.x.x", () => {
    expect(isBlockedHost("172.15.0.1")).toBe(false);
    expect(isBlockedHost("172.32.0.1")).toBe(false);
  });

  test("blocks 192.168.0.0/16", () => {
    expect(isBlockedHost("192.168.1.1")).toBe(true);
    expect(isBlockedHost("192.168.0.1")).toBe(true);
  });

  // Link-local
  test("blocks 169.254.x.x link-local", () => {
    expect(isBlockedHost("169.254.1.1")).toBe(true);
  });

  // IPv6 loopback and unspecified
  test("blocks IPv6 loopback ::1", () => {
    expect(isBlockedHost("::1")).toBe(true);
  });

  test("blocks IPv6 unspecified ::", () => {
    expect(isBlockedHost("::")).toBe(true);
  });

  test("blocks expanded IPv6 loopback", () => {
    expect(isBlockedHost("0:0:0:0:0:0:0:1")).toBe(true);
  });

  test("blocks expanded IPv6 unspecified", () => {
    expect(isBlockedHost("0:0:0:0:0:0:0:0")).toBe(true);
  });

  // IPv6 link-local
  test("blocks IPv6 link-local fe80::", () => {
    expect(isBlockedHost("fe80::1")).toBe(true);
    expect(isBlockedHost("FE80::1")).toBe(true);
  });

  // IPv6-mapped IPv4
  test("blocks IPv6-mapped private IPv4", () => {
    expect(isBlockedHost("::ffff:10.0.0.1")).toBe(true);
    expect(isBlockedHost("::ffff:192.168.1.1")).toBe(true);
    expect(isBlockedHost("::ffff:127.0.0.1")).toBe(true);
  });

  test("allows IPv6-mapped public IPv4", () => {
    expect(isBlockedHost("::ffff:8.8.8.8")).toBe(false);
  });

  // Public IPs should be allowed
  test("allows public IPv4", () => {
    expect(isBlockedHost("8.8.8.8")).toBe(false);
    expect(isBlockedHost("1.1.1.1")).toBe(false);
  });

  test("allows regular hostnames", () => {
    expect(isBlockedHost("example.com")).toBe(false);
    expect(isBlockedHost("github.com")).toBe(false);
  });
});

describe("fetchAndParseSkill", () => {
  test("blocks requests to AWS metadata endpoint", async () => {
    await expect(fetchAndParseSkill("https://169.254.169.254/latest/meta-data/")).rejects.toThrow("Blocked request to internal or private address");
  });

  test("blocks requests to GCP metadata endpoint", async () => {
    await expect(fetchAndParseSkill("https://metadata.google.internal/computeMetadata/")).rejects.toThrow("Blocked request to internal or private address");
  });

  test("blocks requests to localhost", async () => {
    await expect(fetchAndParseSkill("https://localhost/secret")).rejects.toThrow("Blocked request to internal or private address");
  });

  test("blocks requests to 127.0.0.1", async () => {
    await expect(fetchAndParseSkill("https://127.0.0.1/secret")).rejects.toThrow("Blocked request to internal or private address");
  });

  test("blocks requests to private IP ranges", async () => {
    await expect(fetchAndParseSkill("https://10.0.0.1/secret")).rejects.toThrow("Blocked request to internal or private address");
    await expect(fetchAndParseSkill("https://192.168.1.1/secret")).rejects.toThrow("Blocked request to internal or private address");
  });
});
