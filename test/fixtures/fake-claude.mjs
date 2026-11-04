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
out({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: JSON.stringify({ args, cwd: process.cwd() }) }] } });
process.stderr.write("some stderr line\n");
if (prompt.includes("EDIT")) {
  const fs = await import("node:fs");
  fs.appendFileSync("tracked.txt", "line added by claude\n");
  fs.writeFileSync("created-by-claude.txt", "hello from claude\n");
  if (fs.existsSync("old-name.txt")) fs.renameSync("old-name.txt", "new-name.txt");
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
  out({ type: "result", subtype: "success", is_error: false, result: "done: " + prompt, total_cost_usd: 0.0123, duration_ms: 42, num_turns: 1, session_id: sid });
}
