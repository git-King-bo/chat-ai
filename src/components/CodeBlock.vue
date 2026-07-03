<script setup lang="ts">
import { computed } from "vue";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";

// 只注册常用语言，避免把完整语言包都打进前端产物。
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("css", css);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("python", python);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);

const props = defineProps<{
  code: string;
  language?: string;
}>();

// 把模型常见的语言别名归一化为 highlight.js 能识别的名字。
const languageAlias: Record<string, string> = {
  html: "xml",
  js: "javascript",
  jsx: "javascript",
  md: "markdown",
  py: "python",
  shell: "bash",
  sh: "bash",
  ts: "typescript",
  tsx: "typescript",
  vue: "xml",
  zsh: "bash",
};

const normalizedLanguage = computed(() => {
  const rawLanguage = props.language?.trim().toLowerCase() || "";
  return languageAlias[rawLanguage] ?? rawLanguage;
});

const languageLabel = computed(() => props.language?.trim() || "text");

const highlightedCode = computed(() => {
  const language = normalizedLanguage.value;

  try {
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(props.code, { language, ignoreIllegals: true }).value;
    }

    return hljs.highlightAuto(props.code).value;
  } catch {
    return escapeHtml(props.code);
  }
});

// 高亮失败时手动转义，避免原始 HTML 被 v-html 渲染。
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// 复制当前代码块内容。
async function copyCode(): Promise<void> {
  await navigator.clipboard.writeText(props.code);
}
</script>

<template>
  <div class="code-shell">
    <div class="code-bar">
      <span>{{ languageLabel }}</span>
      <button type="button" class="code-copy" @click="copyCode">
        复制
      </button>
    </div>
    <pre><code :class="`language-${normalizedLanguage}`" v-html="highlightedCode"></code></pre>
  </div>
</template>
