import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const output = join(root, "www");

const files = [
  "index.html",
  "styles.css",
  "config.js",
  "app.js",
  "manifest.json",
  "sw.js",
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const file of files) {
  await cp(join(root, file), join(output, file));
}

await cp(join(root, "assets"), join(output, "assets"), { recursive: true });
await cp(join(root, "public"), join(output, "public"), { recursive: true });

console.log("Native web assets copied to www/");
