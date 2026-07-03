// 前端部署后通过环境变量指定后端地址；本地开发为空，继续走 Vite 代理。
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

// 统一拼接后端 API 地址，避免部署后仍请求前端自己的 /api。
export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}
