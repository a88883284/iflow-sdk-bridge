# iFlow SDK Bridge

一个安全的 OpenAI 兼容 API 代理，使用**官方 iFlow CLI SDK** 而非直接 HTTP 调用。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)

## 为什么选择这个项目？

与其他直接向 `apis.iflow.cn` 发送 HTTP 请求的 iFlow API 代理不同，本项目使用**官方 `@iflow-ai/iflow-cli-sdk`**，提供：

### 安全优势

| 特性 | SDK Bridge | 直接 HTTP |
|------|------------|-----------|
| TLS 指纹 | ✅ Node.js 原生 (自动) | ⚠️ 需要 curl_cffi 伪装 |
| 遥测上报 | ✅ CLI 自动处理 | ⚠️ 需手动模拟 |
| traceparent 头 | ✅ CLI 自动处理 | ⚠️ 需手动模拟 |
| 请求头对齐 | ✅ CLI 自动处理 | ⚠️ 需手动对齐 |
| 被检测风险 | **低** | 较高 |

**工作原理：**

```
你的应用 → SDK Bridge → 本地 iFlow CLI 进程 → 远程 API
                            ↓
                  自动处理 TLS/遥测/traceparent
```

iFlow CLI 进程自动处理所有网络层安全特性，使这种方式比直接 HTTP 调用**天然更安全**。

## 功能特性

- 🔒 **设计安全** - 使用官方 SDK，自动处理安全特性
- 🔀 **OpenAI 兼容** - 可直接替换 OpenAI API
- 🎭 **敏感信息过滤** - 智能过滤，使用自然替换词
- ⚡ **流式支持** - 完整支持 SSE 流式响应
- 🌐 **CORS 支持** - 可用于浏览器客户端

## 前置要求

- Node.js 18+
- 已安装并登录 iFlow CLI (`iflow login`)

## 安装

```bash
# 克隆仓库
git clone https://github.com/YOUR_USERNAME/iflow-sdk-bridge.git
cd iflow-sdk-bridge

# 安装依赖
npm install

# 编译
npm run build
```

## 使用方法

### 启动服务

```bash
# 开发模式
npm run dev

# 生产模式
npm run build
npm start
```

服务默认在 `http://localhost:28002` 启动。

### API 端点

| 端点 | 方法 | 描述 |
|------|------|------|
| `/v1/chat/completions` | POST | 聊天补全 (OpenAI 兼容) |
| `/v1/models` | GET | 获取可用模型列表 |
| `/stats` | GET | 获取服务统计信息 |

### 请求示例

```bash
curl http://localhost:28002/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "glm-5",
    "messages": [{"role": "user", "content": "你好！"}],
    "stream": true
  }'
```

### 与 OpenAI SDK 配合使用

```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://localhost:28002/v1',
  apiKey: 'not-needed',
});

const response = await client.chat.completions.create({
  model: 'glm-5',
  messages: [{ role: 'user', content: '你好！' }],
});
```

### 与 Claude Code 配合使用

在配置文件中配置：

```json
{
  "iflow-provider": {
    "baseUrl": "http://localhost:28002/v1",
    "apiKey": "sk-xxxx"
  }
}
```

## 支持的模型

| 模型 ID | 描述 |
|---------|------|
| `glm-5` | GLM-5 (推荐) |
| `glm-4.7` | GLM-4.7 |
| `glm-4.6` | GLM-4.6 |
| `deepseek-v3.2-chat` | DeepSeek V3.2 |
| `qwen3-coder-plus` | Qwen3 Coder |
| `kimi-k2` | Kimi K2 |
| `kimi-k2-thinking` | Kimi K2 思考版 |
| `kimi-k2.5` | Kimi K2.5 |
| `minimax-m2.5` | MiniMax M2.5 |
| `qwen-vl-max` | Qwen VL Max (视觉) |

## 配置

### 环境变量

| 变量 | 默认值 | 描述 |
|------|--------|------|
| `PORT` | `28002` | 服务端口 |
| `IFLOW_SDK_SILENT` | `false` | 静默 SDK 日志 |

### 模型别名

Claude 模型名会自动映射：

```
claude-opus-4-6  → glm-5
claude-sonnet-4  → glm-5
claude-haiku-4   → glm-5
```

## 敏感信息过滤

Bridge 会自动过滤敏感信息，使用自然替换词：

| 原始内容 | 替换为 |
|----------|--------|
| `/Users/xxx/projects` | `/home/user/workspace` |
| `api_key: "sk-xxx"` | `api_key: "xxx"` |
| `localhost:28002` | `localhost:8080` |

## 与 iflow2api 对比

| 方面 | iFlow SDK Bridge | iflow2api |
|------|------------------|-----------|
| 语言 | Node.js/TypeScript | Python |
| 实现方式 | 官方 SDK | 直接 HTTP |
| 安全性 | 原生支持 | 需手动模拟 |
| 复杂度 | 简单 | 复杂 |
| 风险等级 | 低 | 较高 |

## PM2 部署

```bash
# 安装 PM2
npm install -g pm2

# 启动服务
pm2 start dist/index.js --name iflow-sdk-bridge

# 开机自启
pm2 save
pm2 startup
```

## 许可证

MIT License - 详见 [LICENSE](LICENSE)

## 致谢

- [iFlow CLI](https://github.com/iflow-ai/iflow-cli) - 官方 CLI 工具
- [iflow2api](https://github.com/cacaview/iflow2api) - 本项目的灵感来源
