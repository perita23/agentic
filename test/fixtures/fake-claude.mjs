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
out({ type: "assistant", message: { id: "msg_fake1", role: "assistant", usage: { input_tokens: 100, cache_read_input_tokens: 400, output_tokens: 42 }, content: [{ type: "text", text: JSON.stringify({ args, cwd: process.cwd(), compact: process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE ?? null }) }] } });
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
if ((prompt.includes("closures") || prompt.includes("modo voz")) && process.env.CLAUDE_HOME) {
  // A chat answer with markup, to be read aloud (headings, emphasis, a link, code). A chat is read back from the transcript.
  const fs = await import("node:fs");
  const path = await import("node:path");
  const dir = path.join(process.env.CLAUDE_HOME, "projects", "-chat");
  fs.mkdirSync(dir, { recursive: true });
  const now = Date.now();
  const text = "## Closures\n\nUna **closure** recuerda las variables de donde nació. Mira [la guía](https://example.com/guia).\n\n```js\nconst a = 1;\n```\n\n- primero\n- segundo";
  fs.appendFileSync(
    path.join(dir, `${sid}.jsonl`),
    [
      { type: "user", cwd: process.cwd(), timestamp: new Date(now).toISOString(), message: { role: "user", content: prompt } },
      { type: "assistant", timestamp: new Date(now + 1).toISOString(), message: { role: "assistant", model: "claude", content: [{ type: "text", text }] } },
    ]
      .map((l) => JSON.stringify(l))
      .join("\n") + "\n",
  );
}
if (prompt.includes("SUBAGENTES")) {
  // Claude launches two subagents together; their own steps arrive tagged with the call that launched them.
  out({ type: "assistant", message: { id: "sa1", role: "assistant", content: [{ type: "text", text: "Reparto el trabajo." }, { type: "tool_use", id: "ag1", name: "Agent", input: { description: "Localizar el login", prompt: "Busca dónde se valida el login.", subagent_type: "lector" } }, { type: "tool_use", id: "ag2", name: "Agent", input: { description: "Escribir el arreglo", prompt: "Arregla la validación.", subagent_type: "escritor", model: "haiku" } }] } });
  out({ type: "assistant", parent_tool_use_id: "ag1", message: { role: "assistant", content: [{ type: "tool_use", id: "c1", name: "Grep", input: { pattern: "login" } }] } });
  out({ type: "user", parent_tool_use_id: "ag1", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: "src/auth.ts:12" }] } });
  out({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "ag1", content: "El login se valida en `src/auth.ts`, línea 12." }] } });
  out({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "ag2", content: "Hecho: validación arreglada." }] } });
}
if (prompt.includes("CREAFICHERO") && process.env.CLAUDE_HOME) {
  // Claude writes a file (its Write tool) and says so: the chat offers it for download.
  const fs = await import("node:fs");
  const path = await import("node:path");
  const file = path.join(process.cwd(), "informe-morphy.md");
  fs.writeFileSync(file, "# Informe de prueba\n\nEscrito por Morphy.\n");
  const dir = path.join(process.env.CLAUDE_HOME, "projects", "-chat");
  fs.mkdirSync(dir, { recursive: true });
  const now = Date.now();
  fs.appendFileSync(
    path.join(dir, `${sid}.jsonl`),
    [
      { type: "user", cwd: process.cwd(), timestamp: new Date(now).toISOString(), message: { role: "user", content: prompt } },
      { type: "assistant", timestamp: new Date(now + 1).toISOString(), message: { role: "assistant", model: "claude", content: [{ type: "text", text: "He creado el informe." }, { type: "tool_use", id: "w1", name: "Write", input: { file_path: file, content: "# Informe de prueba" } }] } },
    ]
      .map((l) => JSON.stringify(l))
      .join("\n") + "\n",
  );
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
if (prompt.includes("OBSIDIAN")) {
  // Writes a note in the folder it was handed with --add-dir (the vault's Agentic folder).
  const fs = await import("node:fs");
  const i = args.indexOf("--add-dir");
  const dir = i >= 0 ? args[i + 1] : null;
  if (dir) {
    const proj = process.cwd().split("/").pop();
    const file = `${dir}/${proj}/Decisiones.md`;
    fs.mkdirSync(`${dir}/${proj}`, { recursive: true });
    fs.writeFileSync(file, "---\ntitle: Decisiones\n---\n\nUsar PolyForm.\n");
    out({ type: "assistant", message: { id: "ob1", role: "assistant", content: [{ type: "tool_use", id: "obw1", name: "Write", input: { file_path: file, content: "…" } }] } });
    out({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "obw1", content: "ok" }] } });
    out({ type: "assistant", message: { id: "ob2", role: "assistant", content: [{ type: "text", text: "Nota guardada." }] } });
  }
}
if (prompt.includes("SLOW")) await new Promise((r) => setTimeout(r, 900)); // a turn that takes a moment
if (prompt.includes("BASHCHANGE")) {
  // A change made through the terminal (not an Edit/Write tool call): the file changes, then the tool result arrives.
  const fs = await import("node:fs");
  // A real Claude takes seconds to start: the watcher's first look at the tree must happen before it acts (a slow CI
  // runner made the fake race ahead of it, and the change then looked like it had always been there).
  await new Promise((r) => setTimeout(r, 2500));
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
