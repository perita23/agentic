// Entry of the local server's utility process. The main process sends the
// data key (from the macOS Keychain) and the server path over the private
// parent port, so the key never appears in argv, the environment or on disk.
"use strict";

process.parentPort.once("message", ({ data }) => {
  if (data && typeof data.key === "string" && /^[0-9a-f]{64}$/.test(data.key)) globalThis.__agenticDataKey = data.key;
  require(data.entry);
});
