import type { ChatMessage, ChatSession } from "../types";

// IndexedDB 数据库名称和版本号。
const DB_NAME = "code-agent-db";
const DB_VERSION = 1;

// 统一生成稳定主键。
export function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// 把 IndexedDB 细节封装成一个小仓储类，页面只关心增删查改。
export class ChatRepository {
  // 打开数据库，并在首次升级时创建对象仓库。
  private openDb(): Promise<IDBDatabase> {
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

  // 把 IDBRequest 包装成 Promise，便于 async/await 使用。
  private requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // 新建会话摘要。
  async createSession(title = "新的对话"): Promise<ChatSession> {
    const db = await this.openDb();
    const now = Date.now();
    const session = { id: createId("session"), title, createdAt: now, updatedAt: now };
    const store = db.transaction("sessions", "readwrite").objectStore("sessions");
    store.put(session);
    await this.requestToPromise(store.get(session.id));
    db.close();
    return session;
  }

  // 读取全部会话，并按更新时间倒序返回。
  async listSessions(): Promise<ChatSession[]> {
    const db = await this.openDb();
    const store = db.transaction("sessions").objectStore("sessions");
    const sessions = (await this.requestToPromise(store.getAll())) as ChatSession[];
    db.close();
    return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  // 读取单个会话下的全部消息。
  async loadSessionMessages(sessionId: string): Promise<ChatMessage[]> {
    const db = await this.openDb();
    const index = db.transaction("messages").objectStore("messages").index("sessionCreatedAt");
    const range = IDBKeyRange.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER]);
    const messages = (await this.requestToPromise(index.getAll(range))) as ChatMessage[];
    db.close();
    return messages;
  }

  // 保存消息并更新会话摘要，同时执行阈值清理。
  async saveSessionMessages(
    sessionId: string,
    messages: ChatMessage[],
    limits: { maxSessions: number; maxMessages: number },
  ): Promise<void> {
    const db = await this.openDb();
    const tx = db.transaction(["sessions", "messages"], "readwrite");
    const sessionStore = tx.objectStore("sessions");
    const messageStore = tx.objectStore("messages");
    const now = Date.now();
    const session = ((await this.requestToPromise(sessionStore.get(sessionId))) as ChatSession | undefined) ?? {
      id: sessionId,
      title: "新的对话",
      createdAt: now,
      updatedAt: now,
    };

    session.title = this.createTitle(messages) || session.title;
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

    await this.requestToPromise(sessionStore.get(sessionId));
    db.close();
    await this.cleanupOldMessages(sessionId, limits.maxMessages);
    await this.cleanupOldSessions(limits.maxSessions);
  }

  // 删除会话和它下面的全部消息。
  async deleteSession(sessionId: string): Promise<void> {
    const db = await this.openDb();
    const tx = db.transaction(["sessions", "messages"], "readwrite");
    tx.objectStore("sessions").delete(sessionId);

    const messageStore = tx.objectStore("messages");
    const index = messageStore.index("sessionCreatedAt");
    const range = IDBKeyRange.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER]);
    const messages = (await this.requestToPromise(index.getAll(range))) as ChatMessage[];
    messages.forEach((message) => message.id && messageStore.delete(message.id));

    await this.requestToPromise(messageStore.count());
    db.close();
  }

  // 根据第一条用户消息生成会话标题。
  private createTitle(messages: ChatMessage[]): string {
    const firstUserMessage = messages.find((message) => message.role === "user" && message.content.trim());
    const title = firstUserMessage?.content.trim() ?? "新的对话";
    return title.length > 24 ? `${title.slice(0, 24)}...` : title;
  }

  // 单会话消息过多时，删除最旧几条。
  private async cleanupOldMessages(sessionId: string, maxMessages: number): Promise<void> {
    const db = await this.openDb();
    const store = db.transaction("messages", "readwrite").objectStore("messages");
    const index = store.index("sessionCreatedAt");
    const range = IDBKeyRange.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER]);
    const messages = (await this.requestToPromise(index.getAll(range))) as ChatMessage[];
    const extraCount = messages.length - maxMessages;

    if (extraCount > 0) {
      messages.slice(0, extraCount).forEach((message) => message.id && store.delete(message.id));
    }

    await this.requestToPromise(store.count());
    db.close();
  }

  // 会话数量过多时，删除最旧会话。
  private async cleanupOldSessions(maxSessions: number): Promise<void> {
    const sessions = await this.listSessions();
    const extraSessions = sessions.slice(maxSessions);
    await Promise.all(extraSessions.map((session) => this.deleteSession(session.id)));
  }
}
