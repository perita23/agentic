import { describe, expect, it } from "vitest";
import { JsonStore } from "@/lib/server/store";
import { TaskService } from "@/lib/server/tasks";
import { tmpDir } from "./helpers";

const svc = () => new TaskService(new JsonStore(tmpDir()));

describe("TaskService", () => {
  it("creates tasks with defaults and validates input", () => {
    const s = svc();
    const t = s.create({ title: "  Hola  ", checklist: [{ text: "a" }] });
    expect(t).toMatchObject({ title: "Hola", status: "todo", priority: "medium", labels: [], runIds: [] });
    expect(t.checklist[0].id).toMatch(/^[0-9a-f]{12}$/);
    expect(() => s.create({})).toThrow();
    expect(() => s.create({ title: "x", status: "nope" })).toThrow();
    expect(() => s.create({ title: "x".repeat(201) })).toThrow();
    expect(() => s.create({ title: "x", projectPath: "relative/path" })).toThrow(/absolute/);
    expect(() => s.create({ title: "a\0b" })).toThrow();
  });

  it("orders tasks within a column and moves to the end on status change", () => {
    const s = svc();
    const a = s.create({ title: "a" });
    const b = s.create({ title: "b" });
    expect(b.order).toBe(a.order + 1);
    const d = s.create({ title: "d", status: "done" });
    const moved = s.update(a.id, { status: "done" });
    expect(moved.order).toBe(d.order + 1);
  });

  it("PATCH only changes the given fields (regression: zod defaults in partial)", () => {
    const s = svc();
    const a = s.create({ title: "a", description: "desc", labels: ["x"], prompt: "p", status: "review", priority: "urgent", checklist: [{ text: "c" }] });
    const moved = s.update(a.id, { status: "done", order: 3 });
    expect(moved).toMatchObject({ title: "a", description: "desc", labels: ["x"], prompt: "p", status: "done", priority: "urgent", order: 3 });
    expect(moved.checklist).toHaveLength(1);
    const p = s.update(a.id, { priority: "low" });
    expect(p).toMatchObject({ status: "done", description: "desc", priority: "low" });
    expect(() => s.update(a.id, { runIds: [] })).toThrow();
  });

  it("rejects unknown fields on update (no mass-assignment of id/createdAt)", () => {
    const s = svc();
    const a = s.create({ title: "a" });
    expect(() => s.update(a.id, { id: "hijack" })).toThrow();
    expect(() => s.update(a.id, { createdAt: "x" })).toThrow();
    expect(() => s.update("missing", { title: "x" })).toThrow(/not found/);
  });

  it("links runs and moves tasks through the workflow", () => {
    const s = svc();
    const a = s.create({ title: "a" });
    s.attachRun(a.id, "11111111-1111-4111-8111-111111111111");
    expect(s.get(a.id).status).toBe("in_progress");
    s.onRunFinished(a.id, true);
    expect(s.get(a.id).status).toBe("review");
  });

  it("seeds default templates and instantiates them with variables", () => {
    const s = svc();
    const tpls = s.templates();
    expect(tpls.length).toBeGreaterThanOrEqual(5);
    const t = s.instantiate("tpl-bugfix", { values: { bug: "login roto", area: "auth" }, projectPath: "/tmp" });
    expect(t.title).toBe("Bug: login roto");
    expect(t.prompt).toContain("login roto");
    expect(t.prompt).toContain("auth");
    expect(t.labels).toEqual(["bug"]);
    expect(t.checklist).toHaveLength(4);
    expect(t.templateId).toBe("tpl-bugfix");
    // Template syntax in values is not re-evaluated.
    const t2 = s.instantiate("tpl-tests", { values: { module: "{{module}}" } });
    expect(t2.title).toBe("Tests para {{module}}");
  });

  it("supports custom template CRUD", () => {
    const s = svc();
    const tpl = s.createTemplate({ name: "Docs", title: "Docs {{x}}", variables: [{ name: "x", default: "README" }] });
    expect(s.instantiate(tpl.id, {}).title).toBe("Docs README");
    s.updateTemplate(tpl.id, { name: "Docs2", title: "D" });
    expect(s.template(tpl.id).name).toBe("Docs2");
    s.removeTemplate(tpl.id);
    expect(() => s.template(tpl.id)).toThrow();
    expect(() => s.createTemplate({ name: "x", title: "y", variables: [{ name: "bad-name" }] })).toThrow();
  });
});
