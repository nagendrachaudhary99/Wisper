# Live local beta setup

This milestone keeps all Wisper services on the Mac. It connects only OpenAI-compatible planning, Gmail read-only, and Calendar event creation. Calendar writes remain blocked until the exact event is approved in the dashboard. Google Docs and Drive scopes are not requested and are rejected at the database boundary.

## 1. Configure non-secret fields

```bash
cp -n .env.example .env.local
chmod 600 .env.local
```

Edit `.env.local` and set:

```dotenv
PROVIDER_MODE=google
WISPER_TENANT_ID=<tenant_id printed by your existing local setup>
MODEL_ENDPOINT=https://api.openai.com/v1
MODEL_NAME=gpt-4o-mini
GOOGLE_CLIENT_ID=<OAuth desktop client id>
PUBLIC_BASE_URL=http://localhost:3001
```

In Google Cloud Console, enable **Gmail API** and **Google Calendar API** only. Create an OAuth 2.0 client and register this exact redirect URI:

```text
http://localhost:3001/oauth/google/callback
```

Do not enable or consent to Google Docs or Drive access.

## 2. Install secrets without printing them

Each command prompts in Terminal with echo disabled, stores the value in macOS Keychain, and writes the ignored `.env.local` with mode 600. Do not paste any secret into chat.

```bash
./wisper local install-model-key
./wisper local install-google-secret
./wisper local install-oauth-key
```

For the OAuth encryption key, generate a value locally, copy it, run the install command, paste at its hidden prompt, then clear the clipboard:

```bash
openssl rand -base64 32 | pbcopy
./wisper local install-oauth-key
pbcopy < /dev/null
```

## 3. Start and connect

```bash
./wisper local up
./wisper local status
```

Open http://localhost:5173. In Connectors, select **Connect Google locally**, choose `nagendrachaudhary0308@gmail.com`, and approve only Gmail read-only and Calendar event scopes.

## 4. Three end-to-end checks

Run these separately from the dashboard:

1. `Show my 5 latest unread Gmail messages.` This is a real read-only Gmail task and should complete without approval.
2. `Create a calendar event called Wisper live check tomorrow from 3:00 PM to 3:15 PM Pacific.` The run must stop at `waiting approval`; inspect the exact title and times. Reject it for a no-side-effect verification, or approve it only if you want that real event created.
3. `Show unread Gmail messages about security alerts, maximum 3.` This checks real model planning with a query filter and shows the provider result in Latest results.

The Work queue, Latest results, approval card, and audit timeline all come from Postgres. No demo rows are inserted on restart.
