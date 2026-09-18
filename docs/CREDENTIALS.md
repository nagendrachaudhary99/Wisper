# Later integration and credential checklist

Local fake mode needs none of these. Add credentials only when its adapter is ready, store secrets in macOS Keychain or the approved secret vault, and never paste them into chat or commit `.env`.

| Integration | Fields | Where to get them |
| --- | --- | --- |
| Model planner | `MODEL_API_KEY` (secret), `MODEL_ENDPOINT`, `MODEL_NAME` | API provider account; Wisper already has a securely stored model key available for later local injection |
| Google Gmail/Calendar | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (secret), `OAUTH_ENCRYPTION_KEY` (secret), `PUBLIC_BASE_URL` | Google Cloud Console > APIs & Services > Credentials; generate encryption key locally with `openssl rand -base64 32` |
| Twilio SMS | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` (secret), `TWILIO_PHONE_NUMBER`, optional Messaging Service SID | Twilio Console > Account Info and Phone Numbers/Messaging Services |
| WhatsApp Cloud API | `META_APP_ID`, `META_APP_SECRET` (secret), `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, long-lived `WHATSAPP_ACCESS_TOKEN` (secret), self-generated `WHATSAPP_VERIFY_TOKEN` (secret) | Meta for Developers app settings, WhatsApp > API Setup, Business Settings > System Users |
| Instagram/Facebook | Meta app ID/secret, page ID, Instagram business account ID, long-lived page/system-user token | Meta for Developers and Business Settings |
| LinkedIn | client ID/secret, redirect URI, organization/person permissions | LinkedIn Developer Portal product settings |
| X | client ID/secret, redirect URI; access token/secret only if OAuth 1.0a is required | X Developer Portal project/app |
| Slack | client ID/secret, signing secret, bot token after install | Slack API > Your Apps > Basic Information/OAuth |
| Discord | application ID, public key, bot token | Discord Developer Portal |
| Local companion | workspace root, command allowlist, OS automation permissions | Wisper local config; macOS System Settings > Privacy & Security for per-app Files/Automation/Accessibility permissions |

Do not collect a personal phone number merely to build the adapters. A Twilio-owned sender or WhatsApp Business number is chosen when live messaging is tested. Before any live connector sends, show recipient, channel, exact content and effect for approval.
