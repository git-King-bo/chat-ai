# frontend-vue

Vue 3 + TypeScript + Vite frontend for the chat agent.

## Install

```bash
npm install
```

## Run

```bash
npm run dev
```

The Vite dev server runs on `http://127.0.0.1:5173`.

## Deploy

部署到 Vercel 时，需要配置后端地址：

```bash
VITE_API_BASE_URL=https://chat-llm-olive.vercel.app
```

本地开发不配置该变量时，前端会继续通过 Vite 代理请求 `http://127.0.0.1:8000`。

## Key Modes

- `使用平台 Key`：前端只发送消息和模型参数，后端使用 `.env` 中的默认 API Key。
- `使用我的 Key`：用户在配置面板输入自己的 API URL / API Key；默认不保存 API Key，只有勾选“本机记住密钥”才写入浏览器本地存储。
