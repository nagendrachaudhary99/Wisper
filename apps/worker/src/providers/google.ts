import type { CalendarCreateEventInput, CalendarEventResult, GmailMessageSummary, GmailProvider, CalendarProvider } from "@wisper/contracts";

export interface GoogleTokenSource { accessToken(): Promise<string>; }
export interface GoogleProviderOptions { tokenSource: GoogleTokenSource; fetch?: typeof globalThis.fetch; }

async function googleJson<T>(fetcher: typeof globalThis.fetch, token: string, url: string, init?: RequestInit): Promise<T> {
  const res = await fetcher(url, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init?.headers ?? {}) } });
  if (!res.ok) throw new Error(`Google API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return await res.json() as T;
}

export class GoogleGmailProvider implements GmailProvider {
  private readonly fetcher: typeof globalThis.fetch;
  constructor(private readonly options: GoogleProviderOptions) { this.fetcher = options.fetch ?? globalThis.fetch; }
  async listUnread(input: { maxResults: number; query?: string }): Promise<GmailMessageSummary[]> {
    const token = await this.options.tokenSource.accessToken();
    const q = ["is:unread", input.query].filter(Boolean).join(" ");
    const params = new URLSearchParams({ maxResults: String(input.maxResults), q });
    const list = await googleJson<{ messages?: Array<{ id: string; threadId: string }> }>(this.fetcher, token, `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`);
    return Promise.all((list.messages ?? []).map(async ({ id, threadId }) => {
      const msg = await googleJson<{ id: string; threadId: string; snippet?: string; internalDate?: string; payload?: { headers?: Array<{ name: string; value: string }> } }>(this.fetcher, token, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`);
      const headers = new Map((msg.payload?.headers ?? []).map((h) => [h.name.toLowerCase(), h.value]));
      return { messageId: msg.id, threadId: msg.threadId || threadId, from: headers.get("from") ?? "", subject: headers.get("subject") ?? "", snippet: msg.snippet ?? "", receivedAt: new Date(Number(msg.internalDate ?? 0)).toISOString() };
    }));
  }
}

export class GoogleCalendarProvider implements CalendarProvider {
  private readonly fetcher: typeof globalThis.fetch;
  constructor(private readonly options: GoogleProviderOptions) { this.fetcher = options.fetch ?? globalThis.fetch; }
  async createEvent(input: CalendarCreateEventInput): Promise<CalendarEventResult> {
    const token = await this.options.tokenSource.accessToken();
    const body = { summary: input.summary, start: { dateTime: input.start }, end: { dateTime: input.end }, location: input.location, description: input.description, attendees: input.attendees?.map((email) => ({ email })) };
    const event = await googleJson<{ id: string; htmlLink: string }>(this.fetcher, token, "https://www.googleapis.com/calendar/v3/calendars/primary/events", { method: "POST", body: JSON.stringify(body) });
    return { eventId: event.id, htmlLink: event.htmlLink };
  }
}
