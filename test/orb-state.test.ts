import { describe, expect, it } from "vitest";
import { stateFromEvents, toolState } from "@/lib/orb-state";

const assistant = (...content: object[]) => ({ type: "assistant", message: { content } });

describe("orb state from stream-json events", () => {
  it("maps tools to what Claude is doing", () => {
    expect(toolState("Read")).toBe("reading");
    expect(toolState("Edit")).toBe("editing");
    expect(toolState("Bash")).toBe("running");
    expect(toolState("mcp__github__list_prs")).toBe("running");
    expect(toolState("WebSearch")).toBe("searching");
    expect(toolState("AskUserQuestion")).toBe("waiting");
    expect(toolState("Algo")).toBe("thinking");
  });

  it("follows the conversation to its last meaningful event", () => {
    expect(stateFromEvents([]).state).toBe("thinking");
    expect(stateFromEvents([{ type: "system", subtype: "init" }]).state).toBe("thinking");
    expect(stateFromEvents([assistant({ type: "thinking", thinking: "…" })]).state).toBe("thinking");
    expect(stateFromEvents([assistant({ type: "text", text: "Hola" }), assistant({ type: "tool_use", name: "Edit" })]).state).toBe("editing");
    expect(stateFromEvents([assistant({ type: "tool_use", name: "Bash" }), { type: "user", message: { content: [{ type: "tool_result" }] } }]).state).toBe("thinking");
    expect(stateFromEvents([assistant({ type: "text", text: "Respuesta" })]).state).toBe("writing");
    expect(stateFromEvents([assistant({ type: "text", text: "x" }), { type: "stderr", text: "ruido" }]).state).toBe("writing");
  });

  it("waits for the user when Claude asked a question or a tool was denied", () => {
    expect(stateFromEvents([{ type: "result", is_error: false, result: "¿Quieres que lo haga con TypeScript?" }]).state).toBe("waiting");
    expect(stateFromEvents([{ type: "result", is_error: false, result: "Hecho.", permission_denials: [{ tool_name: "Bash" }] }]).state).toBe("waiting");
    expect(stateFromEvents([{ type: "result", is_error: false, result: "Hecho." }]).state).toBe("done");
  });

  it("ends in done or error", () => {
    expect(stateFromEvents([assistant({ type: "tool_use", name: "Bash" }), { type: "result", is_error: false }]).state).toBe("done");
    expect(stateFromEvents([{ type: "result", is_error: true }]).state).toBe("error");
    expect(stateFromEvents([{ type: "agentic", subtype: "exit", code: 1 }]).state).toBe("error");
    expect(stateFromEvents([{ type: "agentic", subtype: "exit", code: 0 }]).label).toBe("Terminado");
  });
});
