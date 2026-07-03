// 聊天时间线里展示的一条消息。
export interface ChatMessage {
  id?: string;
  role: "user" | "assistant";
  content: string;
  localOnly?: boolean;
  createdAt?: number;
}

// IndexedDB 里保存的一条会话摘要。
export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

// 保存在浏览器本地的模型服务配置。
export interface AgentSettings {
  credentialMode: "server" | "user";
  apiUrl: string;
  apiKey: string;
  rememberApiKey: boolean;
  model: string;
  temperature: number;
  historySessionLimit: number;
  historyMessageLimit: number;
}

// 消息渲染器解析出来的文本块或代码块。
export interface RenderBlock {
  kind: "text" | "code";
  value: string;
  language?: string;
}

// 发送给后端流式接口的请求体。
export interface ChatStreamRequest {
  credentialMode: "server" | "user";
  apiUrl?: string;
  apiKey?: string;
  model: string;
  temperature: number;
  messages: ChatMessage[];
}

// 流式阶段状态，用于按钮和提示文案。
export type StreamStatus =
  | "idle"
  | "thinking"
  | "streaming"
  | "paused"
  | "disconnected"
  | "reconnecting"
  | "done"
  | "error";

// 后端 SSE 流里的事件类型。
export type StreamEvent =
  | { type: "start"; model: string; runId?: string; eventId?: number }
  | { type: "delta"; content: string; runId?: string; eventId?: number }
  | { type: "usage"; model: string; usage?: { total_tokens?: number }; runId?: string; eventId?: number }
  | { type: "done"; model: string; usage?: { total_tokens?: number }; runId?: string; eventId?: number }
  | { type: "error"; detail: unknown; runId?: string; eventId?: number };
