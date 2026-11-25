const MARKERS = ["QUICK_REPLIES:", "RECOMMENDED:"];
const quickRepliesLine = /^[ \t]*(?:QUICK_REPLIES|RECOMMENDED)/im;
const openLink = /^\[[^\]\n]*(?:\](?:\([^)\s]*)?)?$/;
const completeLink = /\[([^\]\n]+)\]\([^)\s]*\)/g;

/**
 * Turns the model's raw text deltas into text that is safe to show while it streams:
 * the hidden QUICK_REPLIES line is never emitted and Markdown links show only their label.
 * The final, verified answer always replaces whatever was streamed.
 */
export class DeltaFilter {
  private buffer = "";
  private cut = false;

  push(delta: string): string {
    if (this.cut) return "";
    this.buffer += delta;
    return this.drain(false);
  }

  flush(): string {
    return this.cut ? "" : this.drain(true);
  }

  private drain(final: boolean): string {
    let text = this.buffer;
    const marker = quickRepliesLine.exec(text);
    if (marker) {
      this.cut = true;
      this.buffer = "";
      return labels(text.slice(0, marker.index).replace(/\s+$/, ""));
    }
    let hold = text.length;
    if (!final) {
      // Trailing whitespace may belong to the separator before the hidden line.
      const trailing = /\s+$/.exec(text);
      if (trailing) hold = trailing.index;
      const lineStart = text.lastIndexOf("\n") + 1;
      const startOfLine = text.slice(lineStart).trimStart().toUpperCase();
      if (MARKERS.some(marker => marker.startsWith(startOfLine))) {
        let start = lineStart;
        while (start > 0 && /\s/.test(text[start - 1]!)) start -= 1;
        hold = Math.min(hold, start);
      }
      const open = text.lastIndexOf("[");
      if (open >= 0 && open < hold && text.length - open < 400 && openLink.test(text.slice(open))) hold = open;
    }
    this.buffer = text.slice(hold);
    return labels(text.slice(0, hold));
  }
}

function labels(text: string): string {
  return text.replace(completeLink, "$1");
}
