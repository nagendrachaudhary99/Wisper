import { chromium, type Browser } from "playwright-core";
import type { BrowserNavigateInput, BrowserPageResult, BrowserProvider } from "@wisper/contracts";

const MAX_TEXT = 20_000;
const NAV_TIMEOUT_MS = 15_000;

/**
 * Read-only navigation in an isolated headless Chromium. Every call uses a
 * fresh browser context - no cookies, storage or login state carry over, and
 * the user's own browser profile is never touched. javascript-enabled page
 * rendering, but no clicks, typing or submissions.
 */
export class PlaywrightBrowserProvider implements BrowserProvider {
  private browserPromise: Promise<Browser> | null = null;
  constructor(private readonly options: { headless?: boolean } = {}) {}

  private browser(): Promise<Browser> {
    this.browserPromise ??= chromium.launch({ headless: this.options.headless ?? true, args: ["--no-sandbox"] });
    return this.browserPromise;
  }

  async navigate(input: BrowserNavigateInput): Promise<BrowserPageResult> {
    const browser = await this.browser();
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const response = await page.goto(input.url, { timeout: NAV_TIMEOUT_MS, waitUntil: "domcontentloaded" });
      if (!response) throw new Error("no response from page");
      if (response.status() >= 400) throw new Error(`page returned HTTP ${response.status()}`);
      const title = await page.title();
      const text = (await page.innerText("body")).slice(0, MAX_TEXT);
      return { url: page.url(), title, text };
    } finally {
      await context.close();
    }
  }

  async close(): Promise<void> {
    if (this.browserPromise) {
      const browser = await this.browserPromise;
      await browser.close();
      this.browserPromise = null;
    }
  }
}
