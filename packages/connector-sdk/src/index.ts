import { z } from "zod";

export const ConnectorCapability = z.enum(["read", "draft", "send", "webhook", "media"]);
export type ConnectorCapability = z.infer<typeof ConnectorCapability>;
export const ConnectorManifest = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  mode: z.enum(["mock", "local", "live"]),
  capabilities: z.array(ConnectorCapability),
  credentialFields: z.array(z.object({ key: z.string(), secret: z.boolean(), source: z.string() })),
});
export type ConnectorManifest = z.infer<typeof ConnectorManifest>;
export interface ConnectorEvent { id: string; connectorId: string; type: string; occurredAt: string; payload: unknown; }
export interface ConnectorAdapter {
  manifest: ConnectorManifest;
  health(): Promise<{ ok: boolean; detail: string }>;
  receive(): Promise<ConnectorEvent[]>;
  perform(action: { kind: string; input: unknown; idempotencyKey: string }): Promise<unknown>;
}
export class MockConnector implements ConnectorAdapter {
  readonly events: ConnectorEvent[] = [];
  readonly calls: Array<{ kind: string; input: unknown; idempotencyKey: string }> = [];
  constructor(public readonly manifest: ConnectorManifest) {}
  async health() { return { ok: true, detail: "Mock adapter ready; no external credentials used." }; }
  async receive() { return [...this.events]; }
  async perform(action: { kind: string; input: unknown; idempotencyKey: string }) {
    if (this.calls.some((call) => call.idempotencyKey === action.idempotencyKey)) return { duplicate: true };
    this.calls.push(action);
    return { accepted: true, simulated: true };
  }
}
const fields = {
  twilio: [
    { key: "TWILIO_ACCOUNT_SID", secret: false, source: "Twilio Console > Account Info" },
    { key: "TWILIO_AUTH_TOKEN", secret: true, source: "Twilio Console > Account Info" },
    { key: "TWILIO_PHONE_NUMBER", secret: false, source: "Twilio Console > Phone Numbers" },
  ],
  meta: [
    { key: "META_APP_ID", secret: false, source: "Meta for Developers > App settings" },
    { key: "META_APP_SECRET", secret: true, source: "Meta for Developers > App settings" },
    { key: "WHATSAPP_PHONE_NUMBER_ID", secret: false, source: "WhatsApp Manager > API setup" },
    { key: "WHATSAPP_ACCESS_TOKEN", secret: true, source: "Meta Business settings > System users" },
    { key: "WHATSAPP_VERIFY_TOKEN", secret: true, source: "Generate locally for webhook verification" },
  ],
  oauth: [
    { key: "CLIENT_ID", secret: false, source: "Platform developer console" },
    { key: "CLIENT_SECRET", secret: true, source: "Platform developer console" },
    { key: "REDIRECT_URI", secret: false, source: "Wisper connector callback URL" },
  ],
};
export const builtinConnectorManifests: ConnectorManifest[] = [
  { id: "twilio-sms", name: "Twilio SMS", mode: "mock", capabilities: ["read", "send", "webhook"], credentialFields: fields.twilio },
  { id: "whatsapp-cloud", name: "WhatsApp Cloud API", mode: "mock", capabilities: ["read", "send", "media", "webhook"], credentialFields: fields.meta },
  ...["instagram", "facebook", "linkedin", "x", "slack", "discord"].map((id) => ({ id, name: id[0]!.toUpperCase() + id.slice(1), mode: "mock" as const, capabilities: ["read", "draft", "send"] as ConnectorCapability[], credentialFields: fields.oauth })),
];
