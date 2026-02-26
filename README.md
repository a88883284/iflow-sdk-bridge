# iFlow SDK Bridge

A secure OpenAI-compatible API proxy that uses the **official iFlow CLI SDK** instead of direct HTTP calls.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)

## Why This Project?

Unlike other iFlow API proxies that make direct HTTP requests to `apis.iflow.cn`, this project uses the **official `@iflow-ai/iflow-cli-sdk`** which provides:

### Security Advantages

| Feature | SDK Bridge | Direct HTTP |
|---------|------------|-------------|
| TLS Fingerprint | ✅ Native Node.js (auto) | ⚠️ Requires curl_cffi |
| Telemetry Reporting | ✅ CLI handles it | ⚠️ Manual simulation |
| traceparent Header | ✅ CLI handles it | ⚠️ Manual simulation |
| Request Headers | ✅ CLI handles it | ⚠️ Manual alignment |
| Detection Risk | **Low** | Higher |

**How it works:**

```
Your App → SDK Bridge → Local iFlow CLI Process → Remote API
                              ↓
                    Automatic TLS/Telemetry/traceparent
```

The iFlow CLI process handles all network-level security features automatically, making this approach **inherently safer** than direct HTTP calls.

## Features

- 🔒 **Secure by Design** - Uses official SDK with automatic security features
- 🔀 **OpenAI Compatible** - Drop-in replacement for OpenAI API
- 🎭 **Sensitive Info Filter** - Smart sanitization with natural replacements
- ⚡ **Streaming Support** - Full SSE streaming support
- 🌐 **CORS Enabled** - Ready for browser-based clients

## Prerequisites

- Node.js 18+
- iFlow CLI installed and authenticated (`iflow login`)

## Installation

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/iflow-sdk-bridge.git
cd iflow-sdk-bridge

# Install dependencies
npm install

# Build
npm run build
```

## Usage

### Start the Server

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

The server will start on `http://localhost:28002` by default.

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/chat/completions` | POST | Chat completions (OpenAI compatible) |
| `/v1/models` | GET | List available models |
| `/stats` | GET | Get server statistics |

### Example Request

```bash
curl http://localhost:28002/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "glm-5",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'
```

### Use with OpenAI SDK

```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://localhost:28002/v1',
  apiKey: 'not-needed',
});

const response = await client.chat.completions.create({
  model: 'glm-5',
  messages: [{ role: 'user', content: 'Hello!' }],
});
```

### Use with Claude Code

Configure in your config file:

```json
{
  "iflow-provider": {
    "baseUrl": "http://localhost:28002/v1",
    "apiKey": "sk-xxxx"
  }
}
```

## Supported Models

| Model ID | Description |
|----------|-------------|
| `glm-5` | GLM-5 (Recommended) |
| `glm-4.7` | GLM-4.7 |
| `glm-4.6` | GLM-4.6 |
| `deepseek-v3.2-chat` | DeepSeek V3.2 |
| `qwen3-coder-plus` | Qwen3 Coder |
| `kimi-k2` | Kimi K2 |
| `kimi-k2-thinking` | Kimi K2 Thinking |
| `kimi-k2.5` | Kimi K2.5 |
| `minimax-m2.5` | MiniMax M2.5 |
| `qwen-vl-max` | Qwen VL Max (Vision) |

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `28002` | Server port |
| `IFLOW_SDK_SILENT` | `false` | Suppress SDK logs |

### Model Aliases

Claude model names are automatically mapped:

```
claude-opus-4-6  → glm-5
claude-sonnet-4  → glm-5
claude-haiku-4   → glm-5
```

## Sensitive Info Filtering

The bridge automatically sanitizes sensitive information with natural replacements:

| Original | Replaced With |
|----------|---------------|
| `/Users/xxx/projects` | `/home/user/workspace` |
| `api_key: "sk-xxx"` | `api_key: "xxx"` |
| `localhost:28002` | `localhost:8080` |

## Comparison: SDK Bridge vs Direct API Calls

| Aspect | iFlow SDK Bridge | Direct API Calls |
|--------|------------------|------------------|
| Approach | Official SDK | HTTP requests |
| Security | Native | Manual simulation |
| Complexity | Simple | Complex |
| Risk Level | Low | Higher |
| TLS Fingerprint | ✅ Auto (Node.js) | ⚠️ Needs curl_cffi |
| Telemetry | ✅ CLI handles | ⚠️ Manual simulation |
| Headers | ✅ CLI handles | ⚠️ Manual alignment |

## License

MIT License - see [LICENSE](LICENSE)

## Acknowledgments

- [iFlow CLI](https://github.com/iflow-ai/iflow-cli) - Official CLI tool
- [iflow2api](https://github.com/cacaview/iflow2api) - Inspiration for this project
