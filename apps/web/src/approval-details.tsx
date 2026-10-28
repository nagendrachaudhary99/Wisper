import { isPrivateHost } from "./api.js";

/**
 * Permission-critical copy for approval gates. BOTH approval surfaces - the
 * dashboard Approvals panel and the chat dock - render the same warnings from
 * this one module, so no entry point can offer a quieter approval than another.
 */

export const TERMINAL_PERMISSION_WARNING =
  "This runs inside Wisper's companion Docker container on your Mac. It can read and change files in the Wisper project folder - including any secrets stored in project files like .env.local - and use the network. Your other Mac folders are not mounted into the container. Approve only if this exact command is what you want.";

export const BROWSER_SESSION_NOTE =
  "A fresh headless browser in Wisper's worker container, with no cookies or logins, renders the page and returns its title and visible text. Nothing is clicked, typed or submitted. The page's own scripts do run and can load network resources; private-network targets are blocked unless this URL itself is private.";

export const PRIVATE_URL_WARNING =
  "This URL points at a private or local network address - it can reach services on your Mac or home network. Approve only if you meant Wisper to open it.";

export const UNTRUSTED_CONTENT_NOTE =
  "The page's text comes back as untrusted content - it is shown to you, never executed or turned into actions.";

export interface PermissionNotice {
  sessionNote?: string;
  warnings: string[];
}

/** The permission-critical notices an approver must see for this action. */
export function permissionNoticeFor(kind: string, input: Record<string, unknown>): PermissionNotice {
  if (kind === "local.run_command") return { warnings: [TERMINAL_PERMISSION_WARNING] };
  if (kind === "browser.navigate") {
    const url = typeof input.url === "string" ? input.url : "";
    const warnings: string[] = [];
    if (url && isPrivateHost(url)) warnings.push(PRIVATE_URL_WARNING);
    warnings.push(UNTRUSTED_CONTENT_NOTE);
    return { sessionNote: BROWSER_SESSION_NOTE, warnings };
  }
  return { warnings: [] };
}

export function PermissionNotices({ kind, input }: { kind: string; input: Record<string, unknown> }) {
  const n = permissionNoticeFor(kind, input);
  return <>
    {n.sessionNote && <small>{n.sessionNote}</small>}
    {n.warnings.map((w, i) => <p key={i} className="warnline">{w}</p>)}
  </>;
}
