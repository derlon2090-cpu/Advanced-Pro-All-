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
const page = workerSource.match(/const page\s*=\s*`([\s\S]*?)`;\r?\n(?:const|export)/);
if (!page) throw new Error("Could not extract the HTML page from worker/index.js");
const palette = "<style>:root{--bg:#050A18!important;--panel:#0A1428!important;--line:#1B3158!important;--blue:#C2410C!important;--cyan:#9A3412!important;--accent:#C2410C!important}body{background:radial-gradient(circle at 85% 0,#9A341233,transparent 32rem),#050A18!important}.tag.gpt,.status{color:#FDBA74!important;background:#9A341233!important;border-color:#C2410C66!important}.chip{color:#FDBA74!important;background:#9A34121f!important;border-color:#C2410C55!important}.bar i{background:#C2410C!important}</style>";
await mkdir(publicDir, { recursive: true });
await writeFile(resolve(publicDir, "index.html"), page[1].replace("</head>", palette + "</head>"), "utf8");
console.log(`Built ${dist} and ${publicDir}`);
