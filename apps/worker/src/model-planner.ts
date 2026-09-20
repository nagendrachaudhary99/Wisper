import { Plan, type ModelPlanner } from "@wisper/contracts";

export interface ModelPlannerAdapterOptions { endpoint: string; apiKey: string; model: string; fetch?: typeof globalThis.fetch; /** Abort the model call after this many ms so a hung endpoint fails the run instead of leaving it in planning forever. Default 30s. */ timeoutMs?: number; }

function systemPrompt(today: string): string {
  return [
    "Return only JSON matching {summary,steps:[{ordinal,intent:{kind,input},rationale}]}.",
    "Allowed kinds: gmail.read and calendar.create_event.",
    "Input schemas:",
    "- gmail.read: {maxResults?: integer 1-50 (default 10), query?: string}. A gmail read needs no other facts: never decline a gmail read for missing facts, and never emit zero steps when the user asks to read, show, or list email.",
    "- calendar.create_event: {summary: string, start: ISO 8601 datetime with offset, end: ISO 8601 datetime with offset, location?: string, attendees?: string[], description?: string}.",
    `Today's date is ${today}; resolve relative dates (today, tomorrow, next Friday) against it.`,
    "Never invent missing dates or recipients; emit zero steps only when a calendar.create_event is requested and required facts (summary, start, end) cannot be determined.",
  ].join(" ");
}

export class HttpModelPlanner implements ModelPlanner {
  private readonly fetcher: typeof globalThis.fetch;
  constructor(private readonly options: ModelPlannerAdapterOptions) { this.fetcher = options.fetch ?? globalThis.fetch; }
  async plan(text: string) {
    const timeoutMs = this.options.timeoutMs ?? 30_000;
    let res: Response;
    try {
      res = await this.fetcher(optionsUrl(this.options.endpoint), { method: "POST", headers: { authorization: `Bearer ${this.options.apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ model: this.options.model, response_format: { type: "json_object" }, messages: [{ role: "system", content: systemPrompt(new Date().toISOString().slice(0, 10)) }, { role: "user", content: text }] }), signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) throw new Error(`Planner timed out after ${timeoutMs}ms`);
      throw err;
    }
    if (!res.ok) throw new Error(`Planner endpoint ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("Planner returned no structured content");
    console.log(`Planner raw response: ${content.slice(0, 1000)}`);
    return Plan.parse(JSON.parse(content));
  }
}
function optionsUrl(endpoint: string): string { return endpoint.replace(/\/$/, "") + "/chat/completions"; }
