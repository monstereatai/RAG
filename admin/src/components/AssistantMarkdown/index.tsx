import { XMarkdown } from "@ant-design/x-markdown";
import "@ant-design/x-markdown/es/XMarkdown/index.css";
import React from "react";

export type AssistantMarkdownStatus = "streaming" | "done";

export const normalizeAssistantMarkdown = (
  content: string,
  status?: AssistantMarkdownStatus,
) => {
  const normalized = content
    .replace(/\r\n/g, "\n")
    .replace(/```([A-Za-z0-9_-]+)\s+(?=\S)/g, "```$1\n");
  const fenceCount = normalized.match(/```/g)?.length ?? 0;
  if (status === "done" && fenceCount % 2 === 1) {
    return `${normalized}\n\`\`\``;
  }
  return normalized;
};

export interface AssistantMarkdownProps {
  content: string;
  status?: AssistantMarkdownStatus;
  className?: string;
}

/** 问答、运行中心统一使用的 Markdown 结果预览。 */
export function AssistantMarkdown({ content, status, className }: AssistantMarkdownProps) {
  return (
    <XMarkdown
      className={className ?? "answer-markdown"}
      content={normalizeAssistantMarkdown(content, status)}
      escapeRawHtml
      openLinksInNewTab
      paragraphTag="div"
    />
  );
}

