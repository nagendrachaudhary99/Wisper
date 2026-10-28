import { chromium } from "playwright-core";
const shot = (page, name) => page.screenshot({ path: `/tmp/ui-${name}.png`, fullPage: false });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const log = (...a) => console.log("[drive]", ...a);

await page.goto("http://[::1]:5173/?token=wsp_tok_1c5f4639505f4c4f8272bb8e5df2d4db", { waitUntil: "networkidle" });
await page.waitForSelector("text=Local control plane", { timeout: 15000 });
await shot(page, "01-dashboard");
log("dashboard loaded");

// --- Flow 1: terminal command via real companion ---
await page.fill("section.command input", "list the files");
await page.click("section.command button");
log("sent: list the files");
await page.waitForSelector("text=Run this command in Wisper", { timeout: 30000 });
await shot(page, "02-terminal-approval");
log("terminal approval card visible");
await page.click("button:text('Approve exact action')");
await page.waitForSelector("text=demo-file.txt", { timeout: 30000 });
await shot(page, "03-terminal-result");
log("terminal result visible: demo-file.txt listed");

// --- Flow 2: browser.navigate via real Chromium through the stack ---
await page.fill("section.command input", "open http://127.0.0.1:8090/");
await page.click("section.command button");
log("sent: open page");
await page.waitForSelector("text=Open this page in Wisper", { timeout: 30000 });
await shot(page, "04-browser-approval");
await page.click("button:text('Approve exact action')");
await page.waitForSelector("text=Wisper Live UI Test", { timeout: 30000 });
await shot(page, "05-browser-result");
log("browser result visible: real page title + text");

// --- Flow 3: redirect-to-private block surfaces in the UI ---
// (approved host 127.0.0.1:8092 redirects to 'localhost' - different private host => blocked)
await page.fill("section.command input", "open http://127.0.0.1:8092/");
await page.click("section.command button");
await page.waitForSelector("text=Open this page in Wisper", { timeout: 30000 });
await page.click("button:text('Approve exact action')");
await page.waitForSelector("text=private or local network", { timeout: 30000 });
await shot(page, "06-redirect-blocked");
log("redirect-to-private blocked, error shown in UI");

// audit timeline visible?
await shot(page, "07-final");
await browser.close();
log("DONE");
