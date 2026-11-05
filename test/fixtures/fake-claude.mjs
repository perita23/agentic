#!/usr/bin/env node
// Stand-in for the `claude` CLI used by tests. Emits stream-json like `claude -p`.
const args = process.argv.slice(2);
const sep = args.indexOf("--");
const prompt = sep >= 0 ? args.slice(sep + 1).join(" ") : "";
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
if (args[0] === "--version") {
  console.log("9.9.9 (Fake Claude)");
  process.exit(0);
}
if (args[0] === "mcp") {
  // `claude mcp add/remove`: record the call so tests can check the argv.
  if (process.env.FAKE_CLAUDE_LOG) (await import("node:fs")).appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ args, cwd: process.cwd() }) + "\n");
  if (args.includes("broken")) {
    process.stderr.write("Error: invalid MCP configuration\n");
    process.exit(1);
  }
  process.exit(0);
}
const sid = "11111111-2222-4333-8444-555555555555";
out({ type: "system", subtype: "init", session_id: sid, cwd: process.cwd() });
out({ type: "assistant", message: { id: "msg_fake1", role: "assistant", usage: { input_tokens: 100, cache_read_input_tokens: 400, output_tokens: 42 }, content: [{ type: "text", text: JSON.stringify({ args, cwd: process.cwd() }) }] } });
process.stderr.write("some stderr line\n");
if (prompt.includes("EDIT")) {
  const fs = await import("node:fs");
  const path = await import("node:path");
  fs.appendFileSync("tracked.txt", "line added by claude\n");
  fs.writeFileSync("created-by-claude.txt", "hello from claude\n");
  out({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Write", input: { file_path: path.join(process.cwd(), "created-by-claude.txt"), content: "hello from claude\n" } }] } });
  if (fs.existsSync("old-name.txt")) fs.renameSync("old-name.txt", "new-name.txt");
}
if (prompt.includes("<tarea>describir_pr</tarea>")) {
  // The PR description, written in pieces like the real partial messages.
  for (const piece of ["TITULO: Añade login ", "con Touch ID\n---\n## Resumen\n", "Permite entrar con la huella.\n\n## Cambios\n", "- Nuevo botón de acceso\n"]) {
    out({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: piece } } });
    await new Promise((r) => setTimeout(r, 500));
  }
}
if (prompt.includes("STREAMTEXT")) {
  // Text written token by token (partial messages), then the complete message.
  for (const piece of ["Hola, ", "esto se va ", "escribiendo"]) {
    out({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: piece } } });
    await new Promise((r) => setTimeout(r, 400));
  }
  out({ type: "assistant", message: { id: "m1", role: "assistant", content: [{ type: "text", text: "Hola, esto se va escribiendo" }] } });
}
if (prompt.includes("CURLLONG")) {
  // A long curl (a token with no spaces, a long URL) as a command, its output, and written in the answer.
  const tok = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9".repeat(6);
  const curl = `curl -sS -X POST -H "Authorization: Bearer ${tok}" -H "Content-Type: application/json" https://api.example.com/v1/materials/mcp/.well-known/oauth-authorization-server/${tok}?redirect_uri=https%3A%2F%2Fexample.com%2Fcallback%3Fstate%3D${tok} -d '{"a":1}'`;
  out({ type: "assistant", message: { id: "cl1", role: "assistant", content: [{ type: "tool_use", id: "cu1", name: "Bash", input: { command: curl, description: "Prueba el endpoint" } }] } });
  out({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "cu1", content: `HTTP/2 403 ${tok}${tok}\n{"error":"${tok}${tok}"}` }] } });
  out({ type: "assistant", message: { id: "cl2", role: "assistant", content: [{ type: "text", text: `Lo probé así: \`${curl}\`\n\n\`\`\`bash\n${curl}\n\`\`\`\n\nY ${curl}` }] } });
  await new Promise((r) => setTimeout(r, 6000));
}
if (prompt.includes("SLOW")) await new Promise((r) => setTimeout(r, 900)); // a turn that takes a moment
if (prompt.includes("BASHCHANGE")) {
  // A change made through the terminal (not an Edit/Write tool call): the file changes, then the tool result arrives.
  const fs = await import("node:fs");
  out({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "bc1", name: "Bash", input: { command: "sed -i s/uno/dos/ tracked.txt" } }] } });
  fs.appendFileSync("tracked.txt", "línea nueva por terminal\n");
  fs.writeFileSync("hecho-por-terminal.txt", "contenido nuevo\n");
  out({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "bc1", content: "ok" }] } });
  await new Promise((r) => setTimeout(r, 500)); // a real model takes a moment before its next step
  out({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "ed1", name: "Edit", input: { file_path: process.cwd() + "/tracked.txt", old_string: "x", new_string: "y" } }] } });
  fs.appendFileSync("tracked.txt", "línea por Edit\n");
  out({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "ed1", content: "ok" }] } });
}
if (prompt.includes("BIGIMG")) {
  // A screenshot read by Claude: one huge line of base64 (twice, like the real CLI), then more events.
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(700_000, 7)]).toString("base64");
  out({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "img1", name: "Read", input: { file_path: "/tmp/shot.png" } }] } });
  out({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "img1", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: png } }] }] }, tool_use_result: { type: "image", file: { base64: png } } });
  out({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "he visto la imagen" }] } });
}
if (prompt.includes("PLAN")) {
  out({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "plan1", name: "ExitPlanMode", input: { plan: "## Plan de prueba\n\n1. Paso uno\n2. **Paso dos** con `codigo`\n\n| a | b |\n|---|---|\n| 1 | 2 |" } }] } });
}
if (prompt.includes("TOOLS")) {
  out({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "tb1", name: "Bash", input: { command: "docker logs -f --tail 50 api" } }] } });
  out({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tb1", content: "api listening on :3000\nGET /health 200" }] } });
}
if (prompt.includes("SLEEP")) {
  setTimeout(() => {}, 60_000);
} else if (prompt.includes("FAIL")) {
  out({ type: "result", subtype: "error_during_execution", is_error: true, result: "boom", session_id: sid });
  process.exit(2);
} else if (prompt.includes("NOISE")) {
  for (let i = 0; i < 2000; i++) out({ type: "assistant", message: { content: [{ type: "text", text: "x".repeat(200) }] } });
  out({ type: "result", subtype: "success", is_error: false, result: "ok", total_cost_usd: 0.01, session_id: sid });
} else {
  // Claude Code reports plan usage as it runs.
  out({ type: "rate_limit_event", rate_limit_info: { status: "allowed_warning", resetsAt: Math.floor(Date.now() / 1000) + 2 * 3600 + 14 * 60, rateLimitType: "five_hour", utilization: 0.62 } });
  out({ type: "result", subtype: "success", is_error: false, result: "done: " + prompt, total_cost_usd: 0.0123, duration_ms: 42, num_turns: 1, usage: { input_tokens: 120, output_tokens: 380 }, session_id: sid });
  // A background task keeps the process alive after the answer is complete.
  if (prompt.includes("LINGER")) await new Promise((r) => setTimeout(r, 7000));
}
