/** Narrow, literal search-target extraction for prompts that explicitly name email.
 * More complex Gmail operators (from:, newer_than:, etc.) are left to the model.
 */
export function gmailSearchQuery(text: string): string | undefined {
  const prompt = text.trim();
  if (!/\b(?:email|emails|gmail|inbox|mail)\b/i.test(prompt)) return undefined;
  const patterns = [
    /\b(?:emails?|messages?|mail)\s+about\s+(.+?)(?:[?.!]|$)/i,
    /\b(?:find|search(?: for)?|look for)\s+(?:any\s+)?(.+?)\s+(?:in|from|through)\s+(?:my\s+)?(?:email|emails|gmail|inbox|mail)\b/i,
    /\b(?:email|gmail|inbox|mail)\s+(?:about|for|on)\s+(.+?)(?:[?.!]|$)/i,
  ];
  const match = patterns.map((p) => prompt.match(p)?.[1]?.trim()).find(Boolean);
  if (!match) return undefined;
  const target = match.replace(/^(?:the|an?|any)\s+/i, "")
    .replace(/\b(?:updates?|messages?|emails?|mail)\s*$/i, "")
    .replace(/\s+/g, " ").trim();
  // Do not invent a query for a generic read, or interpret Gmail operators from
  // arbitrary user prose. The model can still construct a richer query itself.
  if (!target || /^(?:latest|recent|unread|all|new|last|my|the|any|\d+)$/i.test(target)) return undefined;
  const words = target.match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu);
  if (!words?.length) return undefined;
  const terms = words.join(" ").slice(0, 200);
  return words.length > 1 ? `"${terms}"` : terms;
}
