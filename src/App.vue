<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import ChatMessage from "./components/ChatMessage.vue";
import SettingsPanel from "./components/SettingsPanel.vue";
import { createId } from "./lib/chatRepository";
import { loadSettings, saveSettings } from "./lib/settingsStorage";
import { useChatSessions } from "./composables/useChatSessions";
import { useStreamChat } from "./composables/useStreamChat";
import type { AgentSettings, ChatMessage as Message, ChatStreamRequest } from "./types";

// 配置保持响应式，Command+K 面板修改后可以直接保存。
const settings = ref<AgentSettings>(loadSettings());

// 会话与消息状态由独立 composable 管理。
const {
  sessions,
  activeSessionId,
  messages,
  initSessions,
  openSession,
  startNewChat,
  ensureActiveSession,
  persistMessages,
  removeSession,
} = useChatSessions();

// 流式聊天控制由单独 composable 管理。
const stream = useStreamChat();

// 当前输入框内容。
const prompt = ref("");

// 配置面板是否打开。
const settingsOpen = ref(false);

// 控制侧边栏展开和收起状态。
const sidebarCollapsed = ref(false);

// 聊天滚动容器引用，用于自动滚到底部。
const messageList = ref<HTMLElement | null>(null);

// 是否保持贴底滚动；用户向上滚动查看历史时会临时关闭。
const shouldStickToBottom = ref(true);

// 只有用户在输出阶段点击暂停后，才显示“继续生成”。
const continueFromPaused = ref(false);

// 保存一个最近的 UI 提示，用于非流式状态显示。
const uiNotice = ref("准备就绪");

// 用于减少流式输出期间的 IndexedDB 频繁写入。
let persistTimer: number | null = null;

// 当前历史阈值，避免输入非法值。
const historyLimits = computed(() => ({
  maxSessions: Math.max(1, settings.value.historySessionLimit || 20),
  maxMessages: Math.max(10, settings.value.historyMessageLimit || 80),
}));

// 当前主按钮是否应该显示暂停图标。
const isOutputting = computed(
  () => stream.status.value === "thinking" || stream.status.value === "streaming" || stream.status.value === "reconnecting",
);

// 是否允许从上一次 eventId 断点继续生成。
const canContinueGeneration = computed(() => continueFromPaused.value && Boolean(stream.currentRunId.value) && stream.status.value === "paused");

// 当前是否正在等待模型响应。
const sending = computed(
  () => stream.status.value === "thinking" || stream.status.value === "streaming" || stream.status.value === "paused" || stream.status.value === "reconnecting",
);

// 发送按钮是否可点击：输出中用于暂停/断开，非输出中需要有输入内容。
const primaryActionDisabled = computed(() => !isOutputting.value && (sending.value || !prompt.value.trim()));

// 流式内容追加时，如果用户没有主动离开底部，就自动保持最新内容可见。
watch(
  messages,
  async () => {
    if (shouldStickToBottom.value) {
      await scrollToBottom();
    }
  },
  { deep: true, flush: "post" },
);

// 配置变化后自动保存。
watch(
  settings,
  (value) => {
    saveSettings(value);
  },
  { deep: true },
);

// 正常输出完成或进入错误态时，清理“继续生成”入口，避免按钮残留。
watch(
  () => stream.status.value,
  (status) => {
    if (status === "done" || status === "error" || status === "idle") {
      continueFromPaused.value = false;
    }
  },
);

// 消息变化后延迟持久化，避免流式阶段每个字符都写一次 IndexedDB。
watch(
  messages,
  async () => {
    if (!activeSessionId.value) {
      return;
    }

    if (persistTimer) {
      window.clearTimeout(persistTimer);
    }

    persistTimer = window.setTimeout(async () => {
      await persistMessages(historyLimits.value);
    }, 220);
  },
  { deep: true },
);

// 首次进入页面时加载 IndexedDB 会话。
onMounted(async () => {
  await initSessions();
  await scrollToBottom();
  window.addEventListener("keydown", handleShortcut);
});

// 组件卸载时移除全局快捷键和定时器。
onUnmounted(() => {
  window.removeEventListener("keydown", handleShortcut);
  if (persistTimer) {
    window.clearTimeout(persistTimer);
  }
});

// Command+K / Ctrl+K 打开配置面板，Esc 关闭面板。
function handleShortcut(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    settingsOpen.value = true;
  }

  if (event.key === "Escape") {
    settingsOpen.value = false;
  }
}

// 切换侧边栏展开与收起。
function toggleSidebar(): void {
  sidebarCollapsed.value = !sidebarCollapsed.value;
}

// 每次新消息出现后，把滚动条移动到底部。
async function scrollToBottom(): Promise<void> {
  await nextTick();
  if (messageList.value) {
    messageList.value.scrollTop = messageList.value.scrollHeight;
  }
}

// 用户手动滚动聊天区时，只有接近底部才继续自动贴底。
function handleMessageScroll(): void {
  const element = messageList.value;
  if (!element) {
    return;
  }
  const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
  shouldStickToBottom.value = distanceToBottom < 80;
}

// 保存配置并关闭 Command 面板。
function handleSaveSettings(): void {
  saveSettings(settings.value);
  settingsOpen.value = false;
  uiNotice.value = "配置已保存";
}

// 打开已有会话。
async function handleOpenSession(sessionId: string): Promise<void> {
  if (sending.value) {
    return;
  }
  continueFromPaused.value = false;
  await openSession(sessionId);
  uiNotice.value = "已切换到历史会话";
  await scrollToBottom();
}

// 删除一条历史会话，并阻止触发父级的“打开会话”动作。
async function handleDeleteSession(event: Event, sessionId: string): Promise<void> {
  event.stopPropagation();
  if (sending.value) {
    return;
  }
  continueFromPaused.value = false;
  await removeSession(sessionId);
  uiNotice.value = "历史会话已删除";
  await scrollToBottom();
}

// 新建一条空会话。
async function handleStartNewChat(): Promise<void> {
  if (sending.value) {
    return;
  }
  continueFromPaused.value = false;
  await startNewChat();
  uiNotice.value = "已开启新对话";
}

// 只把真实 user/assistant 消息发给模型，本地提示不会进入上下文。
function buildRequestMessages(): Message[] {
  return messages.value.filter((message) => !message.localOnly && message.content.trim());
}

// 根据密钥模式组装请求，平台模式不会把 API Key 或服务地址发给后端。
function buildStreamRequest(requestMessages: Message[]): ChatStreamRequest {
  const baseRequest: ChatStreamRequest = {
    credentialMode: settings.value.credentialMode,
    model: settings.value.model,
    temperature: settings.value.temperature,
    messages: requestMessages,
  };

  if (settings.value.credentialMode === "user") {
    return {
      ...baseRequest,
      apiUrl: settings.value.apiUrl,
      apiKey: settings.value.apiKey,
    };
  }

  return baseRequest;
}

// 自定义 Key 模式需要用户先补齐必要配置。
function ensureCredentialReady(): boolean {
  if (settings.value.credentialMode === "server") {
    return true;
  }

  if (settings.value.apiUrl.trim() && settings.value.apiKey.trim()) {
    return true;
  }

  uiNotice.value = "请先填写自定义 API URL 和 API Key";
  settingsOpen.value = true;
  return false;
}

// 发送一轮用户输入，并流式追加模型输出。
async function sendPrompt(): Promise<void> {
  const content = prompt.value.trim();
  if (!content || sending.value) {
    return;
  }

  if (!ensureCredentialReady()) {
    return;
  }

  continueFromPaused.value = false;
  await ensureActiveSession();

  const userMessage: Message = {
    id: createId("message"),
    role: "user",
    content,
    createdAt: Date.now(),
  };

  messages.value.push(userMessage);
  prompt.value = "";
  shouldStickToBottom.value = true;

  const requestMessages = buildRequestMessages();
  const assistant: Message = {
    id: createId("message"),
    role: "assistant",
    content: "",
    createdAt: Date.now(),
  };

  messages.value.push(assistant);
  uiNotice.value = "正在思考...";
  await scrollToBottom();

  try {
    await stream.startStream({
      request: buildStreamRequest(requestMessages),
      assistant,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown request error.";
    assistant.content = `请求失败：${message}`;
    assistant.localOnly = true;
    stream.failStream(error);
  } finally {
    if (!shouldStickToBottom.value) {
      return;
    }
    await scrollToBottom();
  }
}

// 暂停当前 SSE 订阅；如果还在思考阶段，就按用户预期直接断开。
async function handlePauseStream(): Promise<void> {
  if (stream.status.value === "thinking" || stream.status.value === "reconnecting") {
    continueFromPaused.value = false;
    stream.disconnectStream();
    return;
  }

  try {
    continueFromPaused.value = await stream.pauseStream();
  } catch (error) {
    continueFromPaused.value = false;
    stream.failStream(error);
  }
}

// 根据 runId 和 lastEventId 继续订阅后端缓存。
async function handleContinueGeneration(): Promise<void> {
  try {
    continueFromPaused.value = false;
    if (stream.status.value === "paused") {
      await stream.resumeStream();
    } else {
      await stream.reconnectStream();
    }
  } catch (error) {
    continueFromPaused.value = false;
    stream.failStream(error);
  } finally {
    await scrollToBottom();
  }
}

// 主按钮在输出时负责暂停/断开，空闲时负责发送。
function handlePrimaryAction(): void {
  if (isOutputting.value) {
    void handlePauseStream();
    return;
  }
  void sendPrompt();
}

// 按 Enter 直接发送，Shift+Enter 继续换行。
function handleComposerKeydown(event: KeyboardEvent): void {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void sendPrompt();
  }
}
</script>

<template>
  <main class="app-shell" :class="{ collapsed: sidebarCollapsed }">
    <aside class="sidebar" :class="{ collapsed: sidebarCollapsed }">
      <div class="sidebar-topbar">
        <div class="brand">
          <div class="brand-mark">CA</div>
          <span v-if="!sidebarCollapsed">code agent</span>
        </div>
        <div class="sidebar-actions">
          <button type="button" class="top-icon-button" @click="toggleSidebar">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="4" y="5" width="16" height="14" rx="2" />
              <path d="M10 5v14" />
            </svg>
          </button>
          <button type="button" class="top-icon-button" @click="settingsOpen = true">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="6" />
              <path d="m20 20-4.2-4.2" />
            </svg>
          </button>
          <button v-if="sidebarCollapsed" type="button" class="top-icon-button" @click="handleStartNewChat">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="8" />
              <path d="M12 8v8" />
              <path d="M8 12h8" />
            </svg>
          </button>
        </div>
      </div>

      <button v-if="!sidebarCollapsed" type="button" class="new-chat-button" @click="handleStartNewChat">
        + 开启新对话
      </button>

      <nav v-if="!sidebarCollapsed" class="history-list" aria-label="历史对话">
        <p class="history-title">历史对话</p>
        <div v-for="session in sessions" :key="session.id" class="history-item" :class="{ active: session.id === activeSessionId }">
          <button type="button" class="history-open" @click="handleOpenSession(session.id)">
            {{ session.title }}
          </button>
          <button type="button" class="history-delete" aria-label="删除当前历史会话" @click="handleDeleteSession($event, session.id)">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m8.5 8.5 7 7" />
              <path d="m15.5 8.5-7 7" />
            </svg>
          </button>
        </div>
      </nav>
    </aside>

    <section class="chat-stage">
      <section ref="messageList" class="message-list" @scroll="handleMessageScroll">
        <div v-if="messages.length === 0" class="quick-start">
          <div class="quick-logo">CA</div>
          <h1>使用快速模式开始对话</h1>
          <div class="mode-tabs">
            <button type="button" class="active">快速模式</button>
            <button type="button">专家模式</button>
            <button type="button">代码模式</button>
          </div>
        </div>

        <ChatMessage
          v-for="(message, index) in messages"
          :key="message.id"
          :message="message"
          :pending="index === messages.length - 1 && message.role === 'assistant' && sending"
        >
          <template v-if="index === messages.length - 1 && message.role === 'assistant' && canContinueGeneration" #actions>
            <button type="button" class="continue-button" @click="handleContinueGeneration">
              继续生成
            </button>
          </template>
        </ChatMessage>
      </section>

      <form class="composer" @submit.prevent="sendPrompt">
        <textarea
          v-model="prompt"
          class="composer-input"
          rows="4"
          placeholder="给 Code Agent 发送消息"
          @keydown="handleComposerKeydown"
        />
        <div class="composer-footer">
          <span></span>
          <button type="button" class="send-button" :class="{ pausing: isOutputting }" :disabled="primaryActionDisabled" @click="handlePrimaryAction">
            <svg v-if="isOutputting" class="pause-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 7v10" />
              <path d="M15 7v10" />
            </svg>
            <svg v-else class="send-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3.7 11.4 20.2 3.8c.8-.4 1.6.4 1.2 1.2l-7.6 16.5c-.4.8-1.5.7-1.8-.1l-2.2-6.1-6.1-2.2c-.8-.3-.9-1.4 0-1.8Z" />
              <path d="m10 14 5.7-5.7" />
            </svg>
          </button>
        </div>
      </form>
    </section>

    <SettingsPanel
      v-if="settingsOpen"
      :settings="settings"
      :sending="sending"
      @save="handleSaveSettings"
      @close="settingsOpen = false"
    />
  </main>
</template>
