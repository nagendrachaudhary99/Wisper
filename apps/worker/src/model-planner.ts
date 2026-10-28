import { parsePlan, type ModelPlanner } from "@wisper/contracts";
import { gmailSearchQuery } from "./gmail-query.js";

export interface ModelPlannerAdapterOptions { endpoint: string; apiKey: string; model: string; fetch?: typeof globalThis.fetch; /** Abort the model call after this many ms so a hung endpoint fails the run instead of leaving it in planning forever. Default 30s. */ timeoutMs?: number; }

function systemPrompt(today: string): string {
  return [
    "Return only JSON matching {summary,steps:[{ordinal,intent:{kind,input},rationale}]}.",
    "Allowed kinds: gmail.read, calendar.create_event, and calendar.delete_event.",
    "Input schemas:",
    "- gmail.read: {maxResults?: integer 1-50 (default 10), query?: string}. Default is the latest 10 unread messages when there is no query. When the user asks to find/search mail about a topic (for example, find any interview update in my email), supply a query containing the topic (e.g. interview), not an empty input. query is Gmail search syntax: use terms or quoted phrases, and operators such as from: and newer_than: when requested. A query replaces the unread default, so include is:unread only when the user asks for unread. A gmail read needs no other facts: never decline a gmail read for missing facts, never emit zero steps when the user asks to read, show, find, search, or list email, and input may be omitted entirely when there is nothing to filter by.",
    "- calendar.delete_event: {eventId: string}. Use only when the user supplies the exact event id and asks to delete/cancel it.",
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
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error(`Planner returned non-JSON content: ${content.slice(0, 200)}`);
    }
    const plan = parsePlan(parsed);
    // A model can still omit the filter for a clear search request. Preserve
    // richer model queries, but prevent the empty-input all-unread fallback.
    const fallbackQuery = gmailSearchQuery(text);
    if (fallbackQuery) for (const step of plan.steps) {
      if (step.intent.kind === "gmail.read" && !step.intent.input.query?.trim()) step.intent.input.query = fallbackQuery;
    }
    return plan;
  }
}
function optionsUrl(endpoint: string): string { return endpoint.replace(/\/$/, "") + "/chat/completions"; }
