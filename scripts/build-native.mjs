import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const output = join(root, "www");
const iosOutput = join(root, "ios", "App", "App", "public");

const files = [
  "index.html",
  "styles.css",
  "config.js",
  "app.js",
  "manifest.json",
  "sw.js",
];

const directories = [
  "components",
  "constants",
  "hooks",
  "services",
  "types",
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const file of files) {
  await cp(join(root, file), join(output, file));
}

for (const directory of directories) {
  await cp(join(root, directory), join(output, directory), { recursive: true });
}

await cp(join(root, "assets"), join(output, "assets"), { recursive: true });
await cp(join(root, "public"), join(output, "public"), { recursive: true });

await rm(iosOutput, { recursive: true, force: true });
await cp(output, iosOutput, { recursive: true });
await cp(
  join(root, "capacitor.config.json"),
  join(root, "ios", "App", "App", "capacitor.config.json"),
);

console.log("Native web assets and Capacitor config synchronized with iOS.");
