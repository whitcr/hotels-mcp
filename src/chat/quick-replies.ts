// The hidden line normally starts a line, but a model may also glue it onto the end of a sentence.
const replyMarker = /QUICK_REPLIES[ \t]*:/i;

export function splitQuickReplies(output: string): { text: string; quickReplies: string[] } {
  const marker = replyMarker.exec(output);
  if (!marker) return { text: output, quickReplies: [] };

  // Keep incomplete or malformed button metadata out of the visible answer.
  const text = output.slice(0, marker.index).trimEnd();
  const encoded = output.slice(marker.index + marker[0].length).trim();
  if (encoded.length > 2_000) return { text, quickReplies: [] };

  let options: unknown;
  try {
    options = JSON.parse(encoded);
  } catch {
    return { text, quickReplies: [] };
  }
  if (!Array.isArray(options)) return { text, quickReplies: [] };

  const replies = new Map<string, string>();
  for (const option of options) {
    if (typeof option !== "string") continue;
    const reply = option.trim();
    if (!reply || reply.length > 120 || /[\p{Cc}\p{Cf}<>]|https?:\/\/|www\./iu.test(reply)) continue;
    replies.set(reply.toLocaleLowerCase(), reply);
    if (replies.size === 4) break;
  }
  return { text, quickReplies: [...replies.values()] };
}
