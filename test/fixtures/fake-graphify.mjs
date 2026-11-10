#!/usr/bin/env node
import fs from "node:fs";
const a = process.argv.slice(2);
if (a[0] === "--version") { console.log("graphify 0.9.1"); process.exit(0); }
if (a[0] === "update") {
  fs.mkdirSync("graphify-out", { recursive: true });
  fs.writeFileSync("graphify-out/graph.json", JSON.stringify({ nodes: [{ id: "a" }, { id: "b" }, { id: "c" }], links: [{ source: "a", target: "b", confidence: "EXTRACTED" }, { source: "b", target: "c", confidence: "INFERRED" }], graph: { graphify_version: "0.9.1" } }));
  fs.writeFileSync("graphify-out/GRAPH_REPORT.md", "# Informe\n\nGod nodes: a");
  console.log("grafo construido");
  process.exit(0);
}
if (a[0] === "query") { console.log("ARGS:" + JSON.stringify(a)); process.exit(0); }
console.log("ARGS:" + JSON.stringify(a));
