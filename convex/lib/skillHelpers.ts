export const MAX_SKILL_SIZE = 100_000; // 100KB limit for fetched skill content
export const FETCH_TIMEOUT_MS = 15_000; // 15s timeout for fetching remote skills

// Blocked hosts for SSRF mitigation (cloud metadata endpoints)
const BLOCKED_HOSTNAMES = new Set([
  "169.254.169.254", // AWS/GCP metadata
  "metadata.google.internal",
  "metadata.google",
]);

/** Check if an IPv4 address string falls in a private/reserved range. */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map(Number);
  if (octets.some((o) => isNaN(o) || o < 0 || o > 255)) return false;

  const a = octets[0];
  const b = octets[1];
  // 127.0.0.0/8 loopback
  if (a === 127) return true;
  // 10.0.0.0/8
  if (a === 10) return true;
  // 172.16.0.0/12
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  // 0.0.0.0
  if (a === 0) return true;
  // 169.254.0.0/16 link-local
  if (a === 169 && b === 254) return true;

  return false;
}

/**
 * Returns true if the hostname should be blocked for SSRF protection.
 *
 * NOTE: DNS rebinding (hostname resolving to a private IP) cannot be mitigated
 * here because the Convex runtime does not expose DNS resolution APIs. This
 * function blocks all dangerous IP-literal hostnames.
 */
export function isBlockedHost(hostname: string): boolean {
  if (BLOCKED_HOSTNAMES.has(hostname)) return true;
  if (hostname === "localhost") return true;

  // Plain IPv4 literal
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    return isPrivateIPv4(hostname);
  }

  // IPv6 in URL form is bracketed: [::1] — but URL.hostname strips brackets
  const v6 = hostname.toLowerCase();
  // Loopback
  if (v6 === "::1" || v6 === "0:0:0:0:0:0:0:1") return true;
  // Unspecified
  if (v6 === "::" || v6 === "0:0:0:0:0:0:0:0") return true;
  // Link-local
  if (v6.startsWith("fe80:") || v6.startsWith("fe80%")) return true;
  // IPv6-mapped IPv4 (::ffff:x.x.x.x)
  const mappedMatch = v6.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mappedMatch) {
    const mapped = mappedMatch[1];
    if (mapped) return isPrivateIPv4(mapped);
  }

  return false;
}

export async function fetchAndParseSkill(url: string): Promise<{ name: string; description: string; content: string }> {
  const parsed = new URL(url);
  if (isBlockedHost(parsed.hostname)) {
    throw new Error(`Blocked request to internal or private address: ${parsed.hostname}`);
  }

  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`Failed to fetch skill: HTTP ${res.status} from ${url}`);
  }
  const raw = await res.text();
  if (!raw.trim()) {
    throw new Error("Fetched content is empty");
  }
  if (raw.length > MAX_SKILL_SIZE) {
    throw new Error(`Skill content too large (${raw.length} bytes, max ${MAX_SKILL_SIZE})`);
  }
  return parseSkillMd(raw);
}

export function parseSkillMd(raw: string): { name: string; description: string; content: string } {
  const trimmed = raw.trim();
  if (trimmed.startsWith("---")) {
    const endIdx = trimmed.indexOf("\n---", 3);
    if (endIdx !== -1) {
      const frontmatter = trimmed.slice(3, endIdx).trim();
      const content = trimmed.slice(endIdx + 4).trim();
      const meta: Record<string, string> = {};
      for (const line of frontmatter.split("\n")) {
        const kvMatch = line.match(/^([\w-]+):\s*(.+)$/);
        if (!kvMatch?.[1]) continue;
        let val = kvMatch[2]?.trim() ?? "";
        // Strip matching surrounding quotes
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        meta[kvMatch[1]] = val;
      }
      return {
        name: meta["name"] ?? "unnamed-skill",
        description: meta["description"] ?? "",
        content,
      };
    }
  }
  return { name: "unnamed-skill", description: "", content: trimmed };
}

export function resolveSourceUrl(sourceRef: string): { url: string; source: string } {
  // Raw URL – only allow HTTPS for safety
  if (sourceRef.startsWith("https://")) {
    return { url: sourceRef, source: "url" };
  }
  if (sourceRef.startsWith("http://")) {
    throw new Error("Only HTTPS URLs are supported for security reasons");
  }
  // npm: prefix → unpkg
  if (sourceRef.startsWith("npm:")) {
    const pkg = sourceRef.slice(4);
    return { url: `https://unpkg.com/${pkg}@latest/SKILL.md`, source: "npm" };
  }
  // GitHub shorthand: owner/repo[@branch][/path]
  // GitHub shorthand must start with an alphanumeric char (reject ".." etc.)
  const ghMatch = sourceRef.match(/^([a-zA-Z\d][\w.-]*)\/([\w][\w.-]*)(?:@([\w.\-]+))?(?:\/(.+))?$/);  // eslint-disable-line no-useless-escape
  if (ghMatch) {
    const [, owner, repo, branch, path] = ghMatch;
    const ref = branch ?? "main";
    const filePath = path ?? "SKILL.md";
    return {
      url: `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${filePath}`,
      source: "github",
    };
  }
  throw new Error(
    `Invalid source: "${sourceRef}". Use a URL, npm:package-name, or owner/repo`
  );
}
