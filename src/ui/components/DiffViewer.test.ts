import { describe, test, expect } from "bun:test";
import { buildTree, filterTree } from "./fileTree";

describe("buildTree", () => {
  test("builds nested tree from flat paths", () => {
    const paths = ["src/index.ts", "src/utils/helpers.ts", "README.md"];
    const tree = buildTree(paths, new Map());

    expect(tree.length).toBe(2); // README.md and src/
    // Dirs first, then files alphabetically
    expect(tree[0]!.name).toBe("src");
    expect(tree[0]!.isDir).toBe(true);
    expect(tree[1]!.name).toBe("README.md");
    expect(tree[1]!.isDir).toBe(false);
  });

  test("returns empty array for empty paths", () => {
    expect(buildTree([], new Map())).toEqual([]);
  });

  test("handles single-segment paths (root-level files)", () => {
    const tree = buildTree(["file.txt"], new Map());
    expect(tree.length).toBe(1);
    expect(tree[0]!.name).toBe("file.txt");
    expect(tree[0]!.isDir).toBe(false);
    expect(tree[0]!.path).toBe("file.txt");
  });

  test("handles deeply nested paths", () => {
    const tree = buildTree(["a/b/c/d/file.txt"], new Map());
    expect(tree.length).toBe(1);
    expect(tree[0]!.name).toBe("a");
    expect(tree[0]!.isDir).toBe(true);
    const b = tree[0]!.children[0]!;
    expect(b.name).toBe("b");
    const c = b.children[0]!;
    expect(c.name).toBe("c");
    const d = c.children[0]!;
    expect(d.name).toBe("d");
    const file = d.children[0]!;
    expect(file.name).toBe("file.txt");
    expect(file.path).toBe("a/b/c/d/file.txt");
  });

  test("attaches changeStatus from changeMap", () => {
    const changeMap = new Map<string, "added" | "modified" | "deleted">([
      ["src/new.ts", "added"],
      ["src/old.ts", "deleted"],
    ]);
    const tree = buildTree(["src/new.ts", "src/old.ts", "src/unchanged.ts"], changeMap);
    const src = tree[0]!;
    const files = src.children;
    expect(files.find((f) => f.name === "new.ts")!.changeStatus).toBe("added");
    expect(files.find((f) => f.name === "old.ts")!.changeStatus).toBe("deleted");
    expect(files.find((f) => f.name === "unchanged.ts")!.changeStatus).toBeUndefined();
  });

  test("deduplicates identical paths", () => {
    const tree = buildTree(["a/b.ts", "a/b.ts"], new Map());
    const dir = tree[0]!;
    expect(dir.children.length).toBe(1);
  });

  test("sorts directories before files, then alphabetically", () => {
    const paths = ["z.txt", "a/file.ts", "b.txt", "a/nested/deep.ts"];
    const tree = buildTree(paths, new Map());
    expect(tree[0]!.name).toBe("a");
    expect(tree[0]!.isDir).toBe(true);
    expect(tree[1]!.name).toBe("b.txt");
    expect(tree[2]!.name).toBe("z.txt");
  });
});

describe("filterTree", () => {
  const tree = buildTree(
    ["src/index.ts", "src/utils/helpers.ts", "README.md", "package.json"],
    new Map(),
  );

  test("returns all nodes when query is empty-like match", () => {
    // filterTree is called with lowercased query; passing a broad match
    const result = filterTree(tree, "");
    // Empty query matches everything
    expect(result.length).toBe(tree.length);
  });

  test("filters by filename", () => {
    const result = filterTree(tree, "readme");
    expect(result.length).toBe(1);
    expect(result[0]!.name).toBe("README.md");
  });

  test("filters by path segment", () => {
    const result = filterTree(tree, "utils");
    expect(result.length).toBe(1);
    expect(result[0]!.name).toBe("src");
    expect(result[0]!.isDir).toBe(true);
    expect(result[0]!.children.length).toBe(1);
    expect(result[0]!.children[0]!.name).toBe("utils");
  });

  test("returns empty for no match", () => {
    const result = filterTree(tree, "zzzznotfound");
    expect(result.length).toBe(0);
  });

  test("preserves dir structure for matched files", () => {
    const result = filterTree(tree, "helpers");
    expect(result.length).toBe(1);
    const src = result[0]!;
    expect(src.name).toBe("src");
    const utils = src.children[0]!;
    expect(utils.name).toBe("utils");
    expect(utils.children[0]!.name).toBe("helpers.ts");
  });
});
