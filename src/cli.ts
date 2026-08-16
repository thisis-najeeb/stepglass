#!/usr/bin/env node
import { startServer } from "./server.js";

const [, , command, ...rest] = process.argv;

function getFlag(name: string, fallback: string): string {
  const idx = rest.indexOf(`--${name}`);
  if (idx !== -1 && rest[idx + 1]) return rest[idx + 1];
  return fallback;
}

async function main() {
  if (command === "dashboard" || command === undefined) {
    const dir = getFlag("dir", ".stepglass");
    const port = Number(getFlag("port", "4550"));
    const { url } = startServer({ dir, port });
    console.log(`\n  stepglass dashboard running at ${url}\n  watching: ${dir}\n  (open the URL above in your browser)\n`);
    return;
  }

  console.log(`Unknown command: ${command}\n\nUsage:\n  stepglass dashboard [--dir .stepglass] [--port 4550]`);
  process.exit(1);
}

main();
