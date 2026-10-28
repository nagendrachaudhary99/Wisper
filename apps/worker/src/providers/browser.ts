import dns from "node:dns/promises";
import { chromium, type Browser, type Route } from "playwright-core";
import { isPrivateHost, type BrowserNavigateInput, type BrowserPageResult, type BrowserProvider } from "@wisper/contracts";

const MAX_TEXT = 20_000;
const NAV_TIMEOUT_MS = 15_000;
const DNS_TIMEOUT_MS = 3_000;
const MAX_REDIRECTS = 10;

/** DNS lookup with a timeout; resolution failure means the navigation will
 *  fail on its own, so it is not treated as private here. */
async function resolvesPrivate(hostname: string, cache: Map<string, boolean>): Promise<boolean> {
  const cached = cache.get(hostname);
  if (cached !== undefined) return cached;
  if (isPrivateHost(`http://${hostname}`)) { cache.set(hostname, true); return true; }
  let priv = false;
  if (hostname.includes(".") && !/^\d+\.\d+\.\d+\.\d+$/.test(hostname) && !hostname.includes(":")) {
    try {
      const addrs = (await Promise.race([
        dns.lookup(hostname, { all: true }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("dns timeout")), DNS_TIMEOUT_MS)),
      ])) as Array<{ address: string }>;
      priv = addrs.some((a) => isPrivateHost(`http://${a.address}`));
    } catch {
      priv = false;
    }
  }
  cache.set(hostname, priv);
  return priv;
}

/**
 * Navigation in an isolated headless Chromium. Every call uses a fresh
 * browser context - no cookies, storage or login state carry over. Page
 * scripts DO run (they can load resources); nothing is clicked, typed or
 * submitted. Network policy is enforced at request resolution time on every
 * request the page makes - document, each redirect hop and every
 * subresource: non-http(s) is aborted, and private/local targets are aborted
 * unless the approved URL itself was that same private host. Main-frame
 * redirects are followed manually hop by hop because route.continue() would
 * follow them inside the network stack without re-interception. A public
 * name that DNS-resolves to a private address is refused outright, since
 * the approval warning keys off the URL the user saw. Residual gap: DNS can
 * change between this check and connect (TOCTOU) - documented, not hidden.
 */
export class PlaywrightBrowserProvider implements BrowserProvider {
  private browserPromise: Promise<Browser> | null = null;
  constructor(private readonly options: { headless?: boolean } = {}) {}

  private browser(): Promise<Browser> {
    this.browserPromise ??= chromium.launch({ headless: this.options.headless ?? true, args: ["--no-sandbox"] });
    return this.browserPromise;
  }

  async navigate(input: BrowserNavigateInput): Promise<BrowserPageResult> {
    if (!/^https?:\/\//i.test(input.url)) throw new Error("only http and https URLs can be opened");
    const dnsCache = new Map<string, boolean>();
    const approvedHost = new URL(input.url).hostname.toLowerCase();
    const literalPrivate = isPrivateHost(input.url);
    if (!literalPrivate && (await resolvesPrivate(approvedHost, dnsCache))) {
      throw new Error("refused: this address's name resolves to a private or local network location");
    }
    const allowed = async (u: string): Promise<boolean> => {
      if (!/^https?:\/\//i.test(u)) return false;
      const host = new URL(u).hostname.toLowerCase();
      const priv = await resolvesPrivate(host, dnsCache);
      return !priv || (literalPrivate && host === approvedHost);
    };
    const browser = await this.browser();
    const context = await browser.newContext();
    try {
      await context.route("**/*", async (route: Route) => {
        const req = route.request();
        const isMainNav = req.isNavigationRequest() && req.frame() === page.mainFrame();
        if (!isMainNav) {
          return (await allowed(req.url())) ? route.continue() : route.abort();
        }
        // Main-frame navigation: follow redirects manually so every hop is
        // policy-checked; fulfill with the final response.
        let current = req.url();
        for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
          if (!(await allowed(current))) return route.abort();
          const resp = await route.fetch({ url: current, maxRedirects: 0 });
          const status = resp.status();
          const location = resp.headers()["location"];
          if (status >= 300 && status < 400 && location) {
            current = new URL(location, current).toString();
            continue;
          }
          return route.fulfill({ response: resp });
        }
        return route.abort();
      });
      const page = await context.newPage();
      let response;
      try {
        response = await page.goto(input.url, { timeout: NAV_TIMEOUT_MS, waitUntil: "domcontentloaded" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/ERR_ABORTED|ERR_FAILED/i.test(msg)) throw new Error("blocked: the page tried to reach a private or local network address");
        throw err;
      }
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
