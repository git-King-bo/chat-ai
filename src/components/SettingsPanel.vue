<script setup lang="ts">
import type { AgentSettings } from "../types";

// 从父组件接收可编辑的模型配置。
const props = defineProps<{
  settings: AgentSettings;
  sending: boolean;
}>();

// 保存和关闭动作交给父组件，便于集中管理状态。
defineEmits<{
  save: [];
  close: [];
}>();
</script>

<template>
  <div class="command-backdrop" @click.self="$emit('close')">
    <section class="command-panel" role="dialog" aria-modal="true" aria-label="配置面板">
      <header class="command-header">
        <div>
          <p class="panel-kicker">快捷配置</p>
          <h2>运行配置</h2>
        </div>
        <button type="button" class="icon-button" @click="$emit('close')">Esc</button>
      </header>

      <section class="credential-card">
        <div class="credential-heading">
          <span>密钥模式</span>
          <small>{{ props.settings.credentialMode === "server" ? "后端 .env 托管" : "当前浏览器输入" }}</small>
        </div>
        <div class="credential-toggle">
          <button
            type="button"
            :class="{ active: props.settings.credentialMode === 'server' }"
            @click="props.settings.credentialMode = 'server'"
          >
            使用平台 Key
          </button>
          <button
            type="button"
            :class="{ active: props.settings.credentialMode === 'user' }"
            @click="props.settings.credentialMode = 'user'"
          >
            使用我的 Key
          </button>
        </div>
        <p class="credential-note">
          {{
            props.settings.credentialMode === "server"
              ? "平台模式不会向前端暴露 API Key，调用时使用后端默认配置。"
              : "自定义模式会通过当前请求传给后端；默认不保存到浏览器本地。"
          }}
        </p>
      </section>

      <template v-if="props.settings.credentialMode === 'user'">
        <label class="field">
          <span>服务地址</span>
          <input v-model="props.settings.apiUrl" type="text" autocomplete="off" />
        </label>

        <label class="field">
          <span>API 密钥</span>
          <input v-model="props.settings.apiKey" type="password" autocomplete="off" />
        </label>

        <label class="check-field">
          <input v-model="props.settings.rememberApiKey" type="checkbox" />
          <span>本机记住密钥，适合个人电脑；公共设备请不要勾选</span>
        </label>
      </template>

      <div class="field-grid">
        <label class="field">
          <span>模型</span>
          <input v-model="props.settings.model" type="text" autocomplete="off" />
        </label>

        <label class="field">
          <span>随机性</span>
          <input v-model.number="props.settings.temperature" type="number" min="0" max="2" step="0.1" />
        </label>
      </div>

      <div class="field-grid">
        <label class="field">
          <span>会话上限</span>
          <input v-model.number="props.settings.historySessionLimit" type="number" min="1" max="100" />
        </label>

        <label class="field">
          <span>单会话消息上限</span>
          <input v-model.number="props.settings.historyMessageLimit" type="number" min="10" max="500" />
        </label>
      </div>

      <footer class="command-footer">
        <span>快捷键 Command / Ctrl + K</span>
        <button type="button" class="primary-button" :disabled="sending" @click="$emit('save')">
          保存配置
        </button>
      </footer>
    </section>
  </div>
</template>
