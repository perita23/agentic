#!/usr/bin/env node
// CI: sign latest-mac.yml with AGENTIC_UPDATE_PRIVATE_KEY → latest-mac.yml.sig
// and check it against AGENTIC_UPDATE_PUBLIC_KEY. Usage: node sign-update.mjs <dir>
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2] ?? ".";
const priv = (process.env.AGENTIC_UPDATE_PRIVATE_KEY || "").trim();
const pub = (process.env.AGENTIC_UPDATE_PUBLIC_KEY || "").trim();
if (!priv && !pub) {
  console.log("Firma de actualizaciones no configurada; se omite.");
  process.exit(0);
}
if (!priv || !pub) {
  console.error("Hay que configurar a la vez AGENTIC_UPDATE_PRIVATE_KEY (secret) y AGENTIC_UPDATE_PUBLIC_KEY (variable).");
  process.exit(1);
}
const manifest = fs.readFileSync(path.join(dir, "latest-mac.yml"));
const sig = crypto.sign(null, manifest, priv).toString("base64");
if (!crypto.verify(null, manifest, pub, Buffer.from(sig, "base64"))) {
  console.error("La clave privada no corresponde a la pública.");
  process.exit(1);
}
fs.writeFileSync(path.join(dir, "latest-mac.yml.sig"), sig + "\n");
console.log("latest-mac.yml firmado.");
