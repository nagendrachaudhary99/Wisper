-- Tenant-scoped encrypted OAuth credentials and one-time PKCE state.
CREATE TABLE IF NOT EXISTS oauth_connections (
  tenant_id              text NOT NULL REFERENCES tenants(id),
  provider               text NOT NULL,
  encrypted_refresh_token text NOT NULL,
  encrypted_access_token  text,
  access_token_expires_at timestamptz,
  scopes                  text[] NOT NULL DEFAULT '{}',
  provider_account_id     text,
  provider_account_email  text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, provider)
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash    text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenants(id),
  provider      text NOT NULL,
  code_verifier text NOT NULL,
  redirect_uri  text NOT NULL,
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz
);
CREATE INDEX IF NOT EXISTS oauth_states_expiry ON oauth_states (expires_at);
