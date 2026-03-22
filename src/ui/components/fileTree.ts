export interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
  changeStatus?: "added" | "modified" | "deleted";
}

export function buildTree(paths: string[], changeMap: Map<string, "added" | "modified" | "deleted">): TreeNode[] {
  const root: TreeNode = { name: "", path: "", isDir: true, children: [] };

  for (const filePath of paths) {
    const parts = filePath.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const isLast = i === parts.length - 1;
      const partPath = parts.slice(0, i + 1).join("/");

      if (isLast) {
        // Don't add duplicates
        if (!current.children.some((c) => c.path === partPath)) {
          current.children.push({
            name: part,
            path: partPath,
            isDir: false,
            children: [],
            changeStatus: changeMap.get(filePath),
          });
        }
      } else {
        let dir = current.children.find((c) => c.isDir && c.name === part);
        if (!dir) {
          dir = { name: part, path: partPath, isDir: true, children: [] };
          current.children.push(dir);
        }
        current = dir;
      }
    }
  }

  // Sort: dirs first, then alphabetical
  sortTree(root);
  return root.children;
}

function sortTree(node: TreeNode) {
  node.children.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const child of node.children) {
    if (child.isDir) sortTree(child);
  }
}

export function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  const result: TreeNode[] = [];
  for (const node of nodes) {
    if (node.isDir) {
      const filteredChildren = filterTree(node.children, query);
      if (filteredChildren.length > 0) {
        result.push({ ...node, children: filteredChildren });
      }
    } else if (node.path.toLowerCase().includes(query)) {
      result.push(node);
    }
  }
  return result;
}
