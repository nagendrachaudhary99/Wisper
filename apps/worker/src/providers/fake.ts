import type {
  BrowserNavigateInput,
  BrowserPageResult,
  BrowserProvider,
  CalendarCreateEventInput,
  CalendarEventResult,
  CalendarProvider,
  CompanionCommandResult,
  CompanionProvider,
  GmailMessageSummary,
  GmailProvider,
  GmailReadInput,
  LocalRunCommandInput,
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
  async deleteEvent(input:{eventId:string}){this.calls+=1;return {eventId:input.eventId,deleted:true as const};}
  async createEvent(input: CalendarCreateEventInput): Promise<CalendarEventResult> {
    this.calls += 1;
    this.created.push(input);
    const eventId = `fake_evt_${this.created.length}`;
    return { eventId, htmlLink: `https://calendar.local/fake/${eventId}` };
  }
}

export class FakeCompanionProvider implements CompanionProvider {
  calls = 0;
  ran: LocalRunCommandInput[] = [];
  async runCommand(input: LocalRunCommandInput): Promise<CompanionCommandResult> {
    this.calls += 1;
    this.ran.push(input);
    return {
      status: "completed",
      preview: [input.executable, ...input.args].join(" "),
      approvalClass: "explicit",
      stdout: `fake output for ${input.executable}`,
      stderr: "",
      exitCode: 0,
    };
  }
}

export class FakeBrowserProvider implements BrowserProvider {
  calls = 0;
  async navigate(input: BrowserNavigateInput): Promise<BrowserPageResult> {
    this.calls += 1;
    return { url: input.url, title: "Fake page", text: `Fake text for ${input.url}` };
  }
}

/**
 * Truthful stand-in when the companion is configured but untrusted: every
 * command fails with the reason and the fix, so a run can never present
 * fake output as a real execution.
 */
export class UnavailableCompanionProvider implements CompanionProvider {
  constructor(private readonly reason: string) {}
  async runCommand(): Promise<CompanionCommandResult> {
    throw new Error(this.reason);
  }
}
