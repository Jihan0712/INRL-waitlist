// Copies the self-hosted WOFF2 files (Latin subset) from @fontsource into public/assets/fonts.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "assets", "fonts");
mkdirSync(out, { recursive: true });

const files = [
  ["oxanium", "oxanium-latin-500-normal.woff2"],
  ["oxanium", "oxanium-latin-600-normal.woff2"],
  ["roboto", "roboto-latin-400-normal.woff2"],
  ["roboto", "roboto-latin-500-normal.woff2"],
];

for (const [pkg, file] of files) {
  copyFileSync(join(root, "node_modules", "@fontsource", pkg, "files", file), join(out, file));
  console.log(`copied ${file}`);
}
