import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const publicDir = resolve(root, "public");
await rm(dist, { recursive: true, force: true });
await rm(publicDir, { recursive: true, force: true });
await mkdir(resolve(dist, "server"), { recursive: true });
await mkdir(resolve(dist, "lib"), { recursive: true });
await mkdir(resolve(dist, ".openai"), { recursive: true });
await cp(resolve(root, "worker/index.js"), resolve(dist, "server/index.js"));
await cp(resolve(root, "lib/order-number.js"), resolve(dist, "lib/order-number.js"));
await cp(resolve(root, ".openai/hosting.json"), resolve(dist, ".openai/hosting.json"));

// Vercel serves static files from public/. Keep this generated copy in sync with
// the Worker page so both deployments show the same interface.
const workerSource = await readFile(resolve(root, "worker/index.js"), "utf8");
const page = workerSource.match(/const page\s*=\s*`([\s\S]*?)`;\r?\n(?:const|export)/);
if (!page) throw new Error("Could not extract the HTML page from worker/index.js");
// The Vercel target serves host-specific static documents, while the Cloudflare target
// renders the Worker response. Keep customer-facing enhancements identical
// in both targets by extracting the same HTML fragments at build time.
const fragments = ["settingsUi"]
  .map((name) => {
    const match = workerSource.match(new RegExp("const " + name + "=`([\\s\\S]*?)`;"));
    if (!match) throw new Error(`Could not extract ${name} from worker/index.js`);
    // Keep the public maintenance banner, but do not let the legacy fragment
    // mount a second interface on the administration route.
    return name === "settingsUi"
      ? match[1].replace("if(!location.pathname.startsWith('/admin'))return;", "if(location.pathname.startsWith('/admin'))return;")
      : match[1];
  })
  .join("");
const singleOrderHome = await readFile(resolve(root, "ui/single-order-home.html"), "utf8");
const singleOrderHomeShell = await readFile(resolve(root, "ui/single-order-home-shell.html"), "utf8");
const orderTrack = await readFile(resolve(root, "ui/order-track.html"), "utf8");
const orderTrackShell = await readFile(resolve(root, "ui/order-track-shell.html"), "utf8");
const orderProgress = await readFile(resolve(root, "ui/order-progress.html"), "utf8");
const orderProgressStyle = `<style>${await readFile(resolve(root, "ui/order-progress.css"), "utf8")}</style>`;
const crunchyrollPortal = await readFile(resolve(root, "ui/crunchyroll-portal.html"), "utf8");
const chatgptPortal = await readFile(resolve(root, "ui/chatgpt-portal.html"), "utf8");
const compensatePortal = await readFile(resolve(root, "ui/compensate-portal.html"), "utf8");
const adminDashboard = await readFile(resolve(root, "ui/admin-dashboard.html"), "utf8");
const maintenanceMode = await readFile(resolve(root, "ui/maintenance-mode.html"), "utf8");
const palette = "<style>:root{--bg:#071A35!important;--panel:#0A1428!important;--line:#1B3158!important;--blue:#C2410C!important;--cyan:#9A3412!important;--accent:#C2410C!important}body{background:radial-gradient(circle at 85% 0,#9A341233,transparent 32rem),#071A35!important}.top .logo{display:flex!important;align-items:center!important;gap:11px!important;min-width:0}.top .logo>span{display:block;min-width:0;line-height:1.2}.top .logo strong{display:inline-block;color:#F8FAFC}.top .logo b{color:#FB923C}.top .logo .logo-art{width:42px!important;height:42px!important;aspect-ratio:1/1!important;object-fit:cover!important;object-position:50% 37%!important;flex:0 0 42px!important;border-radius:11px!important;display:block!important}.tag.gpt,.status{color:#FDBA74!important;background:#9A341233!important;border-color:#C2410C66!important}.chip{color:#FDBA74!important;background:#9A34121f!important;border-color:#C2410C55!important}.bar i{background:#C2410C!important}</style>";
const currentHomeBoot = "<script>if(location.pathname==='/')document.documentElement.classList.add('current-home')</script>";
const currentTrackBoot = "<script>if(location.pathname.startsWith('/track/')||location.pathname.startsWith('/compensate/'))document.documentElement.classList.add('current-track')</script>";
const progressBoot = "document.documentElement.dataset.orderProgress=location.hash.startsWith('#open=')?'details':'search'";
const trackSearchBoot = `<script>if(/^\\/(track|compensate)\\/[^/]+/.test(location.pathname))${progressBoot}</script>`;
const withOrderProgress = (html, boot = "") => html
  .replace("</head>", () => orderProgressStyle + boot + "</head>")
  .replace("<!--order-progress-->", () => orderProgress);
const serviceSearchBoot = (host, prefix) => `<script>if(new RegExp('^'+(location.hostname==='${host}'?'':'/${prefix}')+'/[a-zA-Z0-9_-]{16,128}/?$').test(location.pathname))${progressBoot}</script>`;
const browserIcon = '<link rel="icon" type="image/png" sizes="any" href="/assets/bawaba-favicon.png"><link rel="apple-touch-icon" href="/assets/bawaba-favicon.png">';
await mkdir(publicDir, { recursive: true });
await cp(resolve(root, "assets"), resolve(publicDir, "assets"), { recursive: true });
await cp(resolve(root, "lib"), resolve(publicDir, "lib"), { recursive: true });
const currentPage = page[1].replace(/<main id="portal">[\s\S]*?<\/main>/, singleOrderHomeShell);
const trackPage = page[1].replace(/<main id="portal">[\s\S]*?<\/main>/, orderTrackShell);
const adminPage = page[1]
  .replace("path=location.pathname", "path='/admin'")
  .replaceAll("location.href='/admin'", "location.href='/'");
const additions = fragments + maintenanceMode + singleOrderHome + orderTrack + adminDashboard;
const adminAdditions = adminDashboard
  .replaceAll("location.pathname.startsWith('/admin')", "true")
  .replaceAll("location.pathname==='/admin'", "true")
  .replaceAll("location.href='/admin'", "location.href='/'");
const finishPage = (source, boot, injected = additions) => source
  .replace("</head>", browserIcon + boot + palette + "</head>")
  .replace("</body>", injected + "</body>")
  .replace(/__STORE_URL__/g, process.env.PUBLIC_STORE_URL || "https://salla.sa");
await writeFile(resolve(publicDir, "home.html"), withOrderProgress(finishPage(currentPage, currentHomeBoot)), "utf8");
await writeFile(resolve(publicDir, "admin.html"), finishPage(adminPage, "", adminAdditions), "utf8");
await writeFile(resolve(publicDir, "track.html"), withOrderProgress(finishPage(trackPage, currentTrackBoot), trackSearchBoot), "utf8");
await writeFile(resolve(publicDir, "crunchyroll.html"), withOrderProgress(crunchyrollPortal, serviceSearchBoot('anime.advpro.app', 'crunchyroll')), "utf8");
await writeFile(resolve(publicDir, "chatgpt.html"), withOrderProgress(chatgptPortal, serviceSearchBoot('gpt.advpro.app', 'chatgpt')), "utf8");
await writeFile(resolve(publicDir, "compensate.html"), withOrderProgress(compensatePortal, serviceSearchBoot('warranty.advpro.app', 'compensate')), "utf8");
await writeFile(resolve(publicDir, "404.html"), '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>404 | أدفانسد برو</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#071a35;color:#f8fafc;font-family:Tahoma,Arial,sans-serif;text-align:center}h1{font-size:4rem;margin:0;color:#ea580c}p{color:#cbd5e1}</style><main><h1>404</h1><p>الصفحة غير موجودة.</p></main></html>', "utf8");
console.log(`Built ${dist} and ${publicDir}`);
