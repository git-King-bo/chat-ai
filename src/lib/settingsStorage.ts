import type { AgentSettings } from "../types";

// 配置仍然保存在 localStorage，读写简单，且不会产生大数据量。
const SETTINGS_KEY = "code-agent-settings";

// 默认配置与当前 Python 后端默认值保持一致。
export function defaultSettings(): AgentSettings {
  return {
    credentialMode: "server",
    apiUrl: "https://ws-jnefwues8byo66qg.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
    apiKey: "",
    rememberApiKey: false,
    model: "qwen-plus",
    temperature: 0.2,
    historySessionLimit: 20,
    historyMessageLimit: 80,
  };
}

// 读取配置，没有保存过就回退到默认值。
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
