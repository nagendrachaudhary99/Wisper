import { Plan, type ModelPlanner } from "@wisper/contracts";

export interface ModelPlannerAdapterOptions { endpoint: string; apiKey: string; model: string; fetch?: typeof globalThis.fetch; }
export class HttpModelPlanner implements ModelPlanner {
  private readonly fetcher: typeof globalThis.fetch;
  constructor(private readonly options: ModelPlannerAdapterOptions) { this.fetcher = options.fetch ?? globalThis.fetch; }
  async plan(text: string) {
    const res = await this.fetcher(optionsUrl(this.options.endpoint), { method: "POST", headers: { authorization: `Bearer ${this.options.apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ model: this.options.model, response_format: { type: "json_object" }, messages: [{ role: "system", content: "Return only JSON matching {summary,steps:[{ordinal,intent:{kind,input},rationale}]}. Allowed kinds: gmail.read and calendar.create_event. Never invent missing dates or recipients; emit zero steps when required facts are missing." }, { role: "user", content: text }] }) });
    if (!res.ok) throw new Error(`Planner endpoint ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("Planner returned no structured content");
    return Plan.parse(JSON.parse(content));
  }
}
function optionsUrl(endpoint: string): string { return endpoint.replace(/\/$/, "") + "/chat/completions"; }
