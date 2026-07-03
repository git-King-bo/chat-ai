import { computed, ref } from "vue";
import { apiUrl } from "../lib/apiBase";
import type { ChatMessage, ChatStreamRequest, StreamEvent, StreamStatus } from "../types";

interface StartStreamOptions {
  request: ChatStreamRequest;
  assistant: ChatMessage;
}

interface ParsedFrame {
  id: number;
  event: StreamEvent;
}

// 独立封装流式读取、暂停、继续、断开和重连控制。
export function useStreamChat() {
  const status = ref<StreamStatus>("idle");
  const model = ref("");
  const usage = ref<{ total_tokens?: number } | null>(null);
  const controller = ref<AbortController | null>(null);
  const currentReader = ref<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const currentAssistant = ref<ChatMessage | null>(null);
  const lastRequest = ref<ChatStreamRequest | null>(null);
  const lastError = ref("");
  const currentRunId = ref("");
  const lastEventId = ref(0);
  const intentionalAbortStatus = new WeakMap<AbortController, "paused" | "disconnected">();

  // 用更可读的中文文案描述当前流状态。
  const notice = computed(() => {
    if (status.value === "thinking") {
      return model.value ? `正在连接模型：${model.value}` : "正在思考...";
    }
    if (status.value === "streaming") {
      return model.value ? `正在生成：${model.value}` : "正在生成...";
    }
    if (status.value === "paused") {
      return currentRunId.value ? `已暂停，可从事件 ${lastEventId.value} 继续` : "已暂停";
    }
    if (status.value === "disconnected") {
      return currentRunId.value ? "连接已断开，可从断点重连" : "连接已断开，可选择重连";
    }
    if (status.value === "reconnecting") {
      return currentRunId.value ? "正在从断点继续输出" : "缺少断点，无法继续";
    }
    if (status.value === "done") {
      return usage.value?.total_tokens ? `完成，Token：${usage.value.total_tokens}` : "回答完成";
    }
    if (status.value === "error") {
      return lastError.value || "流式请求失败";
    }
    return "准备就绪";
  });

  // 把后端返回的 detail 转成可读字符串。
  function stringifyDetail(detail: unknown): string {
    return typeof detail === "string" ? detail : JSON.stringify(detail, null, 2);
  }

  // 从 SSE 数据帧里提取 id 和 data；id 是断点续流的关键位置。
  function parseFrame(frame: string): ParsedFrame | null {
    const lines = frame.split("\n");
    const idLine = lines.find((line) => line.startsWith("id:"));
    const data = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("");

    if (!data) {
      return null;
    }

    const event = JSON.parse(data) as StreamEvent;
    const eventId = Number(idLine?.slice(3).trim() || event.eventId || 0);
    return { id: eventId, event };
  }

  // 单独封装状态判断，避免 TypeScript 在异步循环里过度收窄字面量类型。
  function isDetachedStatus(value: StreamStatus): boolean {
    return value === "paused" || value === "disconnected";
  }

  // 记录后端返回的 runId 和 eventId，后续继续/重连会从这里恢复。
  function rememberStreamPosition(frame: ParsedFrame): void {
    if (frame.event.runId) {
      currentRunId.value = frame.event.runId;
    }
    if (frame.id > 0) {
      lastEventId.value = Math.max(lastEventId.value, frame.id);
    }
  }

  // 根据事件更新流状态和当前助手消息。
  function applyEvent(frame: ParsedFrame): void {
    rememberStreamPosition(frame);
    const event = frame.event;

    if (event.type === "start") {
      model.value = event.model;
      if (status.value !== "reconnecting") {
        status.value = "thinking";
      }
      return;
    }

    if (event.type === "delta") {
      status.value = "streaming";
      if (currentAssistant.value) {
        currentAssistant.value.content += event.content;
      }
      return;
    }

    if (event.type === "usage") {
      usage.value = event.usage ?? null;
      model.value = event.model;
      return;
    }

    if (event.type === "done") {
      usage.value = event.usage ?? null;
      model.value = event.model;
      status.value = "done";
      resetRuntime();
      return;
    }

    throw new Error(stringifyDetail(event.detail));
  }

  // 复位本次浏览器连接状态，但保留 runId 和 lastEventId 供续流使用。
  function resetRuntime(targetController?: AbortController): void {
    if (targetController && controller.value !== targetController) {
      return;
    }
    currentReader.value = null;
    controller.value = null;
  }

  // 统一连接 SSE：新建流、继续流、重连流都走这里。
  async function connectStream(input: RequestInfo | URL, init?: RequestInit): Promise<void> {
    const localController = new AbortController();
    controller.value = localController;

    try {
      const response = await fetch(input, {
        ...init,
        signal: localController.signal,
      });

      if (!response.ok) {
        const data = (await response.json()) as { detail?: unknown };
        throw new Error(stringifyDetail(data.detail ?? data));
      }

      if (!response.body) {
        throw new Error("浏览器没有拿到可读取的流式响应。");
      }

      // 后端会在响应头里提前返回 runId，避免用户很快点击暂停时还没有断点信息。
      const responseRunId = response.headers.get("X-Run-Id");
      if (responseRunId) {
        currentRunId.value = responseRunId;
      }

      currentReader.value = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await currentReader.value.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          const parsedFrame = parseFrame(frame);
          if (parsedFrame) {
            applyEvent(parsedFrame);
          }
        }

        if (done) {
          if (!isDetachedStatus(status.value) && status.value !== "done") {
            status.value = "done";
          }
          resetRuntime(localController);
          break;
        }
      }
    } catch (error) {
      const targetStatus = intentionalAbortStatus.get(localController);
      if (targetStatus && error instanceof DOMException && error.name === "AbortError") {
        // 只处理当前连接自己的 abort，避免旧连接晚返回时把新连接状态覆盖掉。
        if (controller.value === localController) {
          status.value = targetStatus;
        }
        resetRuntime(localController);
        return;
      }
      resetRuntime(localController);
      throw error;
    }
  }

  // 启动一次新的流式请求。
  async function startStream(options: StartStreamOptions): Promise<void> {
    const { request, assistant } = options;
    lastRequest.value = request;
    currentAssistant.value = assistant;
    currentRunId.value = "";
    lastEventId.value = 0;
    usage.value = null;
    lastError.value = "";
    status.value = "thinking";

    await connectStream(apiUrl("/api/chat/stream"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
  }

  // 暂停会断开当前 SSE 订阅；后端 run 继续生成并缓存 eventId 后面的内容。
  async function pauseStream(): Promise<boolean> {
    if (status.value !== "thinking" && status.value !== "streaming") {
      return false;
    }

    status.value = "paused";
    if (currentRunId.value) {
      void fetch(apiUrl(`/api/chat/runs/${encodeURIComponent(currentRunId.value)}/pause`), { method: "POST" });
    }
    const activeController = controller.value;
    if (activeController) {
      intentionalAbortStatus.set(activeController, "paused");
      activeController.abort();
    }
    return true;
  }

  // 根据 runId 和 lastEventId 继续订阅后端缓存，缺失内容会先补发。
  async function resumeStream(): Promise<void> {
    if (status.value !== "paused") {
      return;
    }

    if (!currentRunId.value) {
      throw new Error("当前回答没有 runId，无法从暂停位置继续。请重新发送问题。");
    }

    lastError.value = "";
    status.value = "reconnecting";
    const query = new URLSearchParams({
      runId: currentRunId.value,
      lastEventId: String(lastEventId.value),
    });
    await connectStream(apiUrl(`/api/chat/stream/resume?${query.toString()}`));
  }

  // 主动断开当前网络连接；后端 run 仍会缓存，方便用户点击“重连”恢复。
  function disconnectStream(): void {
    const activeController = controller.value;
    if (activeController) {
      intentionalAbortStatus.set(activeController, "disconnected");
      activeController.abort();
    }
    status.value = "disconnected";
  }

  // 只允许按 eventId 断点续流；没有 runId 时不再偷偷重新生成。
  async function reconnectStream(): Promise<void> {
    if (!currentAssistant.value) {
      return;
    }

    if (!currentRunId.value) {
      throw new Error("当前回答没有 runId，无法从断点重连。请重新发送问题。");
    }

    usage.value = null;
    lastError.value = "";
    status.value = "reconnecting";

    const query = new URLSearchParams({
      runId: currentRunId.value,
      lastEventId: String(lastEventId.value),
    });
    await connectStream(apiUrl(`/api/chat/stream/resume?${query.toString()}`));
  }

  // 统一处理异常，让页面层逻辑更薄。
  function failStream(error: unknown): void {
    lastError.value = error instanceof Error ? error.message : "流式请求失败";
    status.value = "error";
    resetRuntime();
  }

  return {
    status,
    notice,
    usage,
    model,
    currentRunId,
    lastEventId,
    startStream,
    pauseStream,
    resumeStream,
    disconnectStream,
    reconnectStream,
    failStream,
  };
}
