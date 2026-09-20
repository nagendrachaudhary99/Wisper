-- Google Docs/Drive are deliberately outside this local beta. Reject any
-- accidentally over-broad Google connection at the persistence boundary.
ALTER TABLE oauth_connections
  ADD CONSTRAINT oauth_google_no_docs_drive
  CHECK (
    provider <> 'google' OR NOT (
      scopes && ARRAY[
        'https://www.googleapis.com/auth/documents',
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/drive.file'
      ]::text[]
    )
  ) NOT VALID;
ALTER TABLE oauth_connections VALIDATE CONSTRAINT oauth_google_no_docs_drive;
