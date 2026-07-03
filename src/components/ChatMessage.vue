<script setup lang="ts">
import { computed } from "vue";
import CodeBlock from "./CodeBlock.vue";
import { renderBlocks } from "../lib/renderBlocks";
import type { ChatMessage } from "../types";

// 接收父组件传入的一条聊天消息。
const props = defineProps<{
  message: ChatMessage;
  pending?: boolean;
}>();

// 预解析文本和代码块，让模板只负责展示。
const blocks = computed(() => renderBlocks(props.message.content));
</script>

<template>
  <article class="message" :class="message.role">
    <div v-if="message.role === 'assistant'" class="message-avatar" aria-hidden="true">
      <svg viewBox="0 0 32 32">
        <path d="M16 2.8 20.1 9l7.1-.4-3.5 6.2 3.5 6.2-7.1-.4-4.1 6.2-4.1-6.2-7.1.4 3.5-6.2-3.5-6.2 7.1.4L16 2.8Z" />
        <path d="M11.2 16h9.6" />
        <path d="M16 11.2v9.6" />
      </svg>
    </div>
    <section class="message-body">
      <div v-if="pending && !message.content.trim()" class="thinking-indicator">
        <span></span>
        <span></span>
        <span></span>
      </div>
      <template v-for="(block, index) in blocks" :key="index">
        <p v-if="block.kind === 'text'" class="message-text">
          {{ block.value }}
        </p>
        <CodeBlock v-else :code="block.value" :language="block.language" />
      </template>
      <footer class="message-actions">
        <slot name="actions"></slot>
      </footer>
    </section>
  </article>
</template>
