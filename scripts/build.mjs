import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const publicDir = resolve(root, "public");
await rm(dist, { recursive: true, force: true });
await rm(publicDir, { recursive: true, force: true });
await mkdir(resolve(dist, "server"), { recursive: true });
await mkdir(resolve(dist, ".openai"), { recursive: true });
await cp(resolve(root, "worker/index.js"), resolve(dist, "server/index.js"));
await cp(resolve(root, ".openai/hosting.json"), resolve(dist, ".openai/hosting.json"));

// Vercel serves static files from public/. Keep this generated copy in sync with
// the Worker page so both deployments show the same interface.
const workerSource = await readFile(resolve(root, "worker/index.js"), "utf8");
const page = workerSource.match(/const page\s*=\s*`([\s\S]*?)`;\r?\nexport default/);
if (!page) throw new Error("Could not extract the HTML page from worker/index.js");
await mkdir(publicDir, { recursive: true });
await writeFile(resolve(publicDir, "index.html"), page[1], "utf8");
console.log(`Built ${dist} and ${publicDir}`);
