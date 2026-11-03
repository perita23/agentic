#!/usr/bin/env node
// Generates the Ed25519 key pair that signs Agentic's update manifests.
// Run it ONCE on your own computer and store the two values in GitHub:
//   - Secret   AGENTIC_UPDATE_PRIVATE_KEY  (never commit it, never share it)
//   - Variable AGENTIC_UPDATE_PUBLIC_KEY   (goes inside every app build)
import crypto from "node:crypto";

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const pub = publicKey.export({ type: "spki", format: "pem" }).trim();
const priv = privateKey.export({ type: "pkcs8", format: "pem" }).trim();
console.log(`
1) GitHub → perita23/agentic → Settings → Secrets and variables → Actions

2) Pestaña "Secrets" → New repository secret
   Name:  AGENTIC_UPDATE_PRIVATE_KEY
   Value: (todo el bloque siguiente)

${priv}

3) Pestaña "Variables" → New repository variable
   Name:  AGENTIC_UPDATE_PUBLIC_KEY
   Value: (todo el bloque siguiente)

${pub}

Desde la siguiente versión, la app sólo instalará actualizaciones firmadas con esta clave.
No guardes la clave privada en ningún otro sitio.
`);
