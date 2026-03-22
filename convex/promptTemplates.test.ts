import { describe, test, expect } from "bun:test";
import { resolveTemplate } from "./promptTemplates";

// Helper to create a minimal template doc for testing
function tpl(overrides: Partial<{ projectId: string; isDefault: boolean; name: string }> = {}) {
  return {
    _id: `tpl_${Math.random().toString(36).slice(2)}` as any,
    _creationTime: Date.now(),
    projectId: overrides.projectId as any,
    name: overrides.name ?? "template",
    type: "workflow" as const,
    content: "content",
    isDefault: overrides.isDefault ?? false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe("resolveTemplate priority", () => {
  test("returns null when no templates exist", () => {
    expect(resolveTemplate([], [])).toBeNull();
  });

  test("returns null when no templates are marked as default", () => {
    const project = [tpl({ projectId: "p1", isDefault: false })];
    const global = [tpl({ isDefault: false })];
    expect(resolveTemplate(project, global)).toBeNull();
  });

  test("returns global default when no project templates exist", () => {
    const globalDefault = tpl({ isDefault: true, name: "Global WF" });
    expect(resolveTemplate([], [globalDefault])).toBe(globalDefault);
  });

  test("returns project default over global default", () => {
    const projectDefault = tpl({ projectId: "p1", isDefault: true, name: "Project WF" });
    const globalDefault = tpl({ isDefault: true, name: "Global WF" });
    const result = resolveTemplate([projectDefault], [globalDefault]);
    expect(result).toBe(projectDefault);
    expect(result!.name).toBe("Project WF");
  });

  test("returns global default when project has templates but none are default", () => {
    const projectNonDefault = tpl({ projectId: "p1", isDefault: false });
    const globalDefault = tpl({ isDefault: true, name: "Global WF" });
    const result = resolveTemplate([projectNonDefault], [globalDefault]);
    expect(result).toBe(globalDefault);
  });

  test("picks first default when multiple project defaults exist", () => {
    const first = tpl({ projectId: "p1", isDefault: true, name: "First" });
    const second = tpl({ projectId: "p1", isDefault: true, name: "Second" });
    const result = resolveTemplate([first, second], []);
    expect(result).toBe(first);
  });
});
