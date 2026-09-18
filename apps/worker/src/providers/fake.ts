import type {
  CalendarCreateEventInput,
  CalendarEventResult,
  CalendarProvider,
  GmailMessageSummary,
  GmailProvider,
  GmailReadInput,
} from "@wisper/contracts";

/**
 * Dev fakes: deterministic, side-effect-free, and instrumented with call
 * counters so tests can prove a provider was not called twice.
 * The real Google adapters implement the same interfaces (follow-on milestone).
 */
export class FakeGmailProvider implements GmailProvider {
  calls = 0;
  async listUnread(input: GmailReadInput): Promise<GmailMessageSummary[]> {
    this.calls += 1;
    return Array.from({ length: Math.min(3, input.maxResults) }, (_, i) => ({
      messageId: `fake_msg_${i}`,
      threadId: `fake_thread_${i}`,
      from: `sender${i}@example.com`,
      subject: `Fake unread message ${i}`,
      snippet: "This is a local development placeholder.",
      receivedAt: new Date(0).toISOString(),
    }));
  }
}

export class FakeCalendarProvider implements CalendarProvider {
  calls = 0;
  created: CalendarCreateEventInput[] = [];
  async createEvent(input: CalendarCreateEventInput): Promise<CalendarEventResult> {
    this.calls += 1;
    this.created.push(input);
    const eventId = `fake_evt_${this.created.length}`;
    return { eventId, htmlLink: `https://calendar.local/fake/${eventId}` };
  }
}
