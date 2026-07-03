import type { AgentSettings, ChatMessage, ChatSession } from "../types";

// 配置仍然用 localStorage，读写简单，也不会产生大量数据。
const SETTINGS_KEY = "code-agent-settings";

// IndexedDB 数据库名称和版本号。
const DB_NAME = "code-agent-db";
const DB_VERSION = 1;

// 默认会话数量阈值，超过后自动删除最旧会话。
const DEFAULT_SESSION_LIMIT = 20;

// 默认单会话消息阈值，超过后删除最旧消息。
const DEFAULT_MESSAGE_LIMIT = 80;

// 默认配置与 Python 后端保持一致。
export function defaultSettings(): AgentSettings {
  return {
    credentialMode: "server",
    apiUrl: "https://ws-jnefwues8byo66qg.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
    apiKey: "",
    rememberApiKey: false,
    model: "qwen-plus",
    temperature: 0.2,
    historySessionLimit: DEFAULT_SESSION_LIMIT,
    historyMessageLimit: DEFAULT_MESSAGE_LIMIT,
  };
}

// 从 localStorage 读取配置，没有保存过就使用默认值。
export function loadSettings(): AgentSettings {
  const saved = localStorage.getItem(SETTINGS_KEY);
  if (!saved) {
    return defaultSettings();
  }
  const settings = { ...defaultSettings(), ...JSON.parse(saved) } as AgentSettings;

  // 默认不从 localStorage 恢复用户密钥，除非用户明确选择“本机记住密钥”。
  if (!settings.rememberApiKey) {
    settings.apiKey = "";
  }

  return settings;
}

// 保存配置，刷新页面后仍然可用。
export function saveSettings(settings: AgentSettings): void {
  const safeSettings = {
    ...settings,
    // 平台 Key 模式永远不保存用户密钥；自定义模式也需要用户主动勾选才保存。
    apiKey: settings.credentialMode === "user" && settings.rememberApiKey ? settings.apiKey : "",
  };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(safeSettings));
}

// 打开 IndexedDB，并在首次使用时创建对象仓库。
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains("sessions")) {
        const sessions = db.createObjectStore("sessions", { keyPath: "id" });
        sessions.createIndex("updatedAt", "updatedAt");
      }

      if (!db.objectStoreNames.contains("messages")) {
        const messages = db.createObjectStore("messages", { keyPath: "id" });
        messages.createIndex("sessionId", "sessionId");
        messages.createIndex("sessionCreatedAt", ["sessionId", "createdAt"]);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// 把 IDBRequest 包装成 Promise，调用方可以用 async/await。
function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// 生成简单稳定的主键。
export function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// 新建一条会话摘要。
export async function createSession(title = "新的对话"): Promise<ChatSession> {
  const db = await openDb();
  const now = Date.now();
  const session = { id: createId("session"), title, createdAt: now, updatedAt: now };
  const tx = db.transaction("sessions", "readwrite");
  tx.objectStore("sessions").put(session);
  await requestToPromise(tx.objectStore("sessions").get(session.id));
  db.close();
  return session;
}

// 读取全部会话摘要，并按更新时间倒序排列。
export async function listSessions(): Promise<ChatSession[]> {
  const db = await openDb();
  const sessions = await requestToPromise(db.transaction("sessions").objectStore("sessions").getAll());
  db.close();
  return (sessions as ChatSession[]).sort((a, b) => b.updatedAt - a.updatedAt);
}

// 读取某个会话里的全部消息。
export async function loadSessionMessages(sessionId: string): Promise<ChatMessage[]> {
  const db = await openDb();
  const index = db.transaction("messages").objectStore("messages").index("sessionCreatedAt");
  const range = IDBKeyRange.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER]);
  const messages = await requestToPromise(index.getAll(range));
  db.close();
  return messages as ChatMessage[];
}

// 保存某个会话里的消息，并刷新会话标题和更新时间。
export async function saveSessionMessages(
  sessionId: string,
  messages: ChatMessage[],
  limits?: { maxSessions?: number; maxMessages?: number },
): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(["sessions", "messages"], "readwrite");
  const sessionStore = tx.objectStore("sessions");
  const messageStore = tx.objectStore("messages");
  const savedSession = (await requestToPromise(sessionStore.get(sessionId))) as ChatSession | undefined;
  const now = Date.now();
  const title = createTitle(messages);
  const session = savedSession ?? { id: sessionId, title, createdAt: now, updatedAt: now };

  session.title = title || session.title;
  session.updatedAt = now;
  sessionStore.put(session);

  for (const message of messages) {
    if (message.localOnly) {
      continue;
    }
    messageStore.put({
      ...message,
      id: message.id ?? createId("message"),
      sessionId,
      createdAt: message.createdAt ?? now,
    });
  }

  await requestToPromise(sessionStore.get(sessionId));
  db.close();
  await cleanupOldMessages(sessionId, limits?.maxMessages ?? DEFAULT_MESSAGE_LIMIT);
  await cleanupOldSessions(limits?.maxSessions ?? DEFAULT_SESSION_LIMIT);
}

// 删除指定会话及其消息。
export async function deleteSession(sessionId: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(["sessions", "messages"], "readwrite");
  tx.objectStore("sessions").delete(sessionId);

  const messageStore = tx.objectStore("messages");
  const index = messageStore.index("sessionCreatedAt");
  const range = IDBKeyRange.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER]);
  const messages = (await requestToPromise(index.getAll(range))) as ChatMessage[];
  messages.forEach((message) => message.id && messageStore.delete(message.id));

  await requestToPromise(tx.objectStore("sessions").get(sessionId));
  db.close();
}

// 根据第一条用户消息生成侧边栏标题。
function createTitle(messages: ChatMessage[]): string {
  const firstUserMessage = messages.find((message) => message.role === "user" && message.content.trim());
  const title = firstUserMessage?.content.trim() ?? "新的对话";
  return title.length > 24 ? `${title.slice(0, 24)}...` : title;
}

// 单会话消息超过阈值时，删除最旧的几条记录。
async function cleanupOldMessages(sessionId: string, maxMessages: number): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("messages", "readwrite");
  const store = tx.objectStore("messages");
  const index = store.index("sessionCreatedAt");
  const range = IDBKeyRange.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER]);
  const messages = (await requestToPromise(index.getAll(range))) as ChatMessage[];
  const extraCount = messages.length - maxMessages;

  if (extraCount > 0) {
    messages.slice(0, extraCount).forEach((message) => message.id && store.delete(message.id));
  }

  await requestToPromise(store.count());
  db.close();
}

// 会话数量超过阈值时，删除最旧会话和它的消息。
async function cleanupOldSessions(maxSessions: number): Promise<void> {
  const sessions = await listSessions();
  const extraSessions = sessions.slice(maxSessions);
  await Promise.all(extraSessions.map((session) => deleteSession(session.id)));
}
