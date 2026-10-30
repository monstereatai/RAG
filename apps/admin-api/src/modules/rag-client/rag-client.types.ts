export interface RagAguiStreamQuery {
  query: string;
  mode?: "simple" | "agentic" | "auto";
  model?: "qwen" | "deepseek" | "zhipu";
  userId?: string;
  threadId?: string;
  rolePresetId?: string;
  pluginKeys?: string[];
  attachmentIds?: string[];
}

export interface RagArtifactCreateInput {
  ownerUserId: string;
  threadId?: string;
  title: string;
  kind: "markdown" | "word" | "excel" | "architecture" | "image";
  sourceText: string;
  prompt?: string;
}
