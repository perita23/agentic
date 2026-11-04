import { describe, expect, it } from "vitest";
import { describeBash, describeTool, mainCommand, stripAnsi } from "@/lib/tool-cards";

describe("tool cards", () => {
  it("recognises docker commands and their target", () => {
    expect(describeBash("docker logs -f --tail 100 api")).toMatchObject({ icon: "docker", group: "Docker", title: "Leyendo logs · api" });
    expect(describeBash("cd /app && docker compose up -d")).toMatchObject({ group: "Docker Compose", title: "Levantando servicios" });
    expect(describeBash("docker ps -a").title).toBe("Listando contenedores");
  });
  it("skips cd/env/sudo when finding the main command", () => {
    expect(mainCommand("cd x && FOO=1 sudo git status")).toBe("git status");
    expect(describeBash("git diff --stat").title).toBe("Revisando los cambios");
  });
  it("classifies tests, packages, kubernetes and falls back to terminal", () => {
    expect(describeBash("npx vitest run").icon).toBe("test");
    expect(describeBash("npm run build").title).toBe("npm run build");
    expect(describeBash("kubectl get pods -n prod").icon).toBe("kube");
    expect(describeBash("some-custom-tool --x").icon).toBe("terminal");
  });
  it("describes file and MCP tools", () => {
    expect(describeTool("Edit", { file_path: "/p/src/a.ts" })).toMatchObject({ group: "Editar archivo", title: "a.ts" });
    expect(describeTool("mcp__github__list_issues", {})).toMatchObject({ icon: "mcp", group: "github", title: "list issues" });
    expect(describeTool("Read", null).title).toBe("");
  });
  it("strips ANSI colours", () => {
    expect(stripAnsi("\u001b[32mok\u001b[0m")).toBe("ok");
  });
});
