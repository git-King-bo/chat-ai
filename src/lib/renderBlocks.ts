import type { RenderBlock } from "../types";

// 解析 Markdown 风格代码块；即使代码块没有闭合，也尽量稳定展示。
export function renderBlocks(content: string): RenderBlock[] {
  const blocks: RenderBlock[] = [];
  const fencePattern = /```([^\n`]*)\n?/g;
  let cursor = 0;
  let opening = fencePattern.exec(content);

  while (opening) {
    if (opening.index > cursor) {
      blocks.push({ kind: "text", value: content.slice(cursor, opening.index) });
    }

    const language = opening[1]?.trim() || "text";
    const codeStart = fencePattern.lastIndex;
    const closingIndex = content.indexOf("```", codeStart);

    if (closingIndex === -1) {
      blocks.push({ kind: "code", value: content.slice(codeStart).trimEnd(), language });
      cursor = content.length;
      break;
    }

    blocks.push({ kind: "code", value: content.slice(codeStart, closingIndex).trimEnd(), language });
    cursor = closingIndex + 3;
    fencePattern.lastIndex = cursor;
    opening = fencePattern.exec(content);
  }

  if (cursor < content.length) {
    blocks.push({ kind: "text", value: content.slice(cursor) });
  }

  return blocks.length > 0 ? blocks : [{ kind: "text", value: content }];
}
