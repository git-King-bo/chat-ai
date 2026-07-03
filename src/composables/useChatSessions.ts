import { computed, ref } from "vue";
import { ChatRepository } from "../lib/chatRepository";
import type { ChatMessage, ChatSession } from "../types";

// 统一管理会话列表、当前会话和消息持久化。
export function useChatSessions() {
  const repository = new ChatRepository();
  const sessions = ref<ChatSession[]>([]);
  const activeSessionId = ref("");
  const messages = ref<ChatMessage[]>([]);

  // 当前是否已经有打开的会话。
  const hasActiveSession = computed(() => Boolean(activeSessionId.value));

  // 初始化会话列表，并默认打开最近的一条。
  async function initSessions(): Promise<void> {
    sessions.value = await repository.listSessions();
    if (sessions.value[0]) {
      await openSession(sessions.value[0].id);
    }
  }

  // 打开某条会话并加载消息。
  async function openSession(sessionId: string): Promise<void> {
    activeSessionId.value = sessionId;
    messages.value = await repository.loadSessionMessages(sessionId);
  }

  // 新建一条会话并切换过去。
  async function startNewChat(): Promise<ChatSession> {
    const session = await repository.createSession();
    sessions.value = await repository.listSessions();
    activeSessionId.value = session.id;
    messages.value = [];
    return session;
  }

  // 确保当前存在会话，没有就自动新建。
  async function ensureActiveSession(): Promise<string> {
    if (activeSessionId.value) {
      return activeSessionId.value;
    }
    const session = await startNewChat();
    return session.id;
  }

  // 把当前消息保存回仓储，并刷新侧边栏摘要。
  async function persistMessages(limits: { maxSessions: number; maxMessages: number }): Promise<void> {
    if (!activeSessionId.value) {
      return;
    }
    await repository.saveSessionMessages(activeSessionId.value, messages.value, limits);
    sessions.value = await repository.listSessions();
  }

  // 删除指定会话；如果删的是当前会话，就尽量切到下一条会话。
  async function removeSession(sessionId: string): Promise<void> {
    const deletingActive = activeSessionId.value === sessionId;
    await repository.deleteSession(sessionId);
    sessions.value = await repository.listSessions();

    if (!deletingActive) {
      return;
    }

    const nextSession = sessions.value[0];
    if (nextSession) {
      await openSession(nextSession.id);
      return;
    }

    activeSessionId.value = "";
    messages.value = [];
  }

  return {
    sessions,
    activeSessionId,
    messages,
    hasActiveSession,
    initSessions,
    openSession,
    startNewChat,
    ensureActiveSession,
    persistMessages,
    removeSession,
  };
}
