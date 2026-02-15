const NEWLINE = /\r\n?/g;

const splitLines = (text: string): string[] => text.replace(NEWLINE, "\n").split("\n");

const trimEmptyEdges = (lines: string[]): string[] => {
  const result = [...lines];
  while (result.length && result[0].trim() === "") {
    result.shift();
  }
  while (result.length && result[result.length - 1].trim() === "") {
    result.pop();
  }
  return result;
};

const getMinimumIndent = (lines: string[]): number => {
  const indents = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => (line.match(/^[ \t]*/) ?? [""])[0].length);
  return indents.length ? Math.min(...indents) : 0;
};

const removeIndent = (lines: string[], indent: number): string[] => {
  if (!indent) {
    return lines;
  }
  return lines.map((line) => {
    if (line.trim() === "") {
      return "";
    }
    const match = line.match(/^[ \t]*/);
    const currentIndent = match ? match[0].length : 0;
    const sliceAmount = Math.min(indent, currentIndent);
    return line.slice(sliceAmount);
  });
};

export const normalizeCodeWhitespace = (textContent = ""): string => {
  if (!textContent) {
    return "";
  }
  const lines = splitLines(textContent);
  const trimmed = trimEmptyEdges(lines);
  if (!trimmed.length) {
    return "";
  }
  const minIndent = getMinimumIndent(trimmed);
  const dedented = removeIndent(trimmed, minIndent);
  return dedented.join("\n");
};

export const normalizeCodeNode = (node: Element | null | undefined): void => {
  if (!node) {
    return;
  }
  const current = node.textContent ?? "";
  const normalized = normalizeCodeWhitespace(current);
  if (normalized !== current) {
    node.textContent = normalized;
  }
};

export default normalizeCodeNode;
