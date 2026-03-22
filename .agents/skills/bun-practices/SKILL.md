---
name: bun-practices
description: >
  Bun runtime best practices, testing patterns, and APIs for this project.
  Use this skill whenever working with bun commands, bun test, bun build,
  package.json scripts, bunfig.toml, or any TypeScript file that uses bun
  APIs (Bun.serve, Bun.spawn, Bun.file, bun:test, bun:sqlite). Also trigger
  when writing or modifying test files (*.test.ts, *.spec.ts), debugging test
  failures, or optimizing build/runtime performance. If in doubt whether
  something is a bun API or Node API, check this skill.
---

# Bun Practices

This project uses **Bun** as the JavaScript runtime, package manager, test runner, and task runner.

## Reference

For detailed API docs, fetch the latest Bun documentation:

1. Start with `https://bun.sh/llms.txt` to get the documentation index
2. Find the relevant section URL for your topic
3. Fetch that specific page for detailed API docs

If the URL is unavailable, fall back to your training knowledge or web search.

## Testing

We use `bun test` (Jest-compatible). Tests import from `bun:test`:

```ts
import { expect, test, describe, beforeEach, afterEach, mock } from "bun:test";
```

### Key patterns

- **File naming**: `*.test.ts` or `*.spec.ts` -- bun discovers these automatically
- **Run a single file**: `bun test ./path/to/file.test.ts` (prefix with `./` or `/`)
- **Filter by name**: `bun test --test-name-pattern "pattern"`
- **Timeout**: default is 5000ms, override with `--timeout <ms>`
- **Watch mode**: `bun test --watch`

### Mocking

```ts
import { mock, spyOn } from "bun:test";

// Mock a function
const fn = mock(() => 42);
fn(); // 42
fn.mock.calls.length; // 1

// Spy on a method
const spy = spyOn(object, "method");

// Mock a module
mock.module("./path", () => ({ default: mockValue }));
```

### Lifecycle hooks

```ts
beforeAll(() => { /* once before all tests in file */ });
afterAll(() => { /* once after all tests */ });
beforeEach(() => { /* before each test */ });
afterEach(() => { /* after each test */ });
```

### Snapshot testing

```ts
expect(value).toMatchSnapshot();      // file-based
expect(value).toMatchInlineSnapshot(); // inline
```

Update snapshots: `bun test --update-snapshots`

## Bun APIs commonly used in this project

### Process spawning (used in worker/)

```ts
const proc = Bun.spawn(["command", "arg1"], {
  cwd: "/path",
  env: { ...process.env, EXTRA: "val" },
  stdout: "pipe",
  stderr: "pipe",
  onExit(proc, exitCode, signalCode, error) { },
});

const text = await new Response(proc.stdout).text();
await proc.exited; // wait for completion
```

### File I/O

```ts
const file = Bun.file("path/to/file");
const text = await file.text();
const exists = await file.exists();
await Bun.write("output.txt", "content");
```

### Shell ($ template tag)

```ts
import { $ } from "bun";
const result = await $`git status`.text();
await $`ls -la`.quiet(); // suppress output
```

## Build & bundling

```ts
const result = await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  target: "bun",       // or "browser", "node"
  minify: true,
  sourcemap: "external",
});
```

## Configuration (bunfig.toml)

This project's `bunfig.toml` configures the test runner. Check it for coverage settings and test-specific options.
