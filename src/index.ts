import express, { Request, Response } from 'express';
import cors from 'cors';
import { getClient, SUPPORTED_MODELS, type ChatCompletionOptions } from './client.js';

const app = express();
// 端口说明: 28000=iflow2api, 28001=embedding_proxy, 28002=iflow-sdk-bridge
const PORT = process.env.PORT || 28002;

app.use(cors());
app.use(express.json({ limit: '50mb' })); // 增加 limit 支持大请求体

// 健康检查
app.get('/health', (_req: Request, res: Response) => {
  const client = getClient();
  const stats = client.getStats();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    stats: {
      totalRequests: stats.totalRequests,
      recentRequests: stats.recentRequests,
      limit: '30/min',
    }
  });
});

// 请求流水日志（内存存储，最多 100 条）
const requestLogs: Array<{
  id: string;
  timestamp: string;
  model: string;
  tier: string;
  latency: number;
  tokens: number;
  status: 'success' | 'error';
  error?: string;
}> = [];
const MAX_LOGS = 100;

// 统计信息（详细状态监控，供 smart-router 看板调用）
app.get('/stats', (_req: Request, res: Response) => {
  const client = getClient();
  const stats = client.getStats();
  res.json({
    requests: {
      total: stats.totalRequests,
      recentPerMinute: stats.recentRequests,
      limitPerMinute: 25,
    },
    session: {
      count: stats.sessionCount,
      currentAgeSec: stats.sessionAgeSec,
      maxAgeSec: 1800, // 30分钟
    },
    security: {
      randomInterval: '300-1500ms',
      sessionRotation: '50 requests or 30 min',
    },
    iflow: {
      connected: client.isConnected(),
      model: client.getCurrentModel(),
    },
    logs: requestLogs.slice(-20), // 最近 20 条
  });
});

// 获取请求日志
app.get('/logs', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 50;
  const status = req.query.status as string;

  let logs = requestLogs;
  if (status === 'error') {
    logs = logs.filter(l => l.status === 'error');
  } else if (status === 'success') {
    logs = logs.filter(l => l.status === 'success');
  }

  res.json({
    total: requestLogs.length,
    logs: logs.slice(-limit),
  });
});

// 获取模型列表
app.get('/v1/models', (_req: Request, res: Response) => {
  const timestamp = Math.floor(Date.now() / 1000);
  res.json({
    object: 'list',
    data: SUPPORTED_MODELS.map(m => ({
      id: m.id,
      object: 'model',
      created: timestamp,
      owned_by: 'iflow',
    })),
  });
});

// Chat Completions API
app.post('/v1/chat/completions', async (req: Request, res: Response) => {
  const options = req.body as ChatCompletionOptions;
  const startTime = Date.now();
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  if (!options.messages || options.messages.length === 0) {
    res.status(400).json({ error: 'messages is required' });
    return;
  }

  const client = getClient();

  try {
    if (options.stream) {
      // 流式响应
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      let totalContent = '';
      for await (const chunk of await client.chatStream(options)) {
        const content = chunk.choices[0]?.delta?.content || '';
        totalContent += content;
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      res.write('data: [DONE]\n\n');
      res.end();

      // 记录日志
      const latency = Date.now() - startTime;
      addLog({
        id: requestId,
        timestamp: new Date().toISOString(),
        model: options.model,
        tier: 'stream',
        latency,
        tokens: totalContent.length, // 粗略估计
        status: 'success',
      });
    } else {
      // 非流式响应
      const response = await client.chat(options);
      res.json(response);

      // 记录日志
      const latency = Date.now() - startTime;
      addLog({
        id: requestId,
        timestamp: new Date().toISOString(),
        model: options.model,
        tier: 'sync',
        latency,
        tokens: response.choices[0]?.message?.content?.length || 0,
        status: 'success',
      });
    }
  } catch (error) {
    console.error('[Error]', error);

    // 记录错误日志
    const latency = Date.now() - startTime;
    addLog({
      id: requestId,
      timestamp: new Date().toISOString(),
      model: options.model,
      tier: 'error',
      latency,
      tokens: 0,
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    if (!res.headersSent) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Internal server error'
      });
    }
  }
});

// 辅助函数：添加日志
function addLog(log: typeof requestLogs[0]) {
  if (requestLogs.length >= MAX_LOGS) {
    requestLogs.shift();
  }
  requestLogs.push(log);
}

// Anthropic 兼容端点 /v1/messages
app.post('/v1/messages', async (req: Request, res: Response) => {
  const { model, messages, max_tokens, stream } = req.body;

  if (!messages || messages.length === 0) {
    res.status(400).json({ error: 'messages is required' });
    return;
  }

  // 转换 Anthropic 格式到 OpenAI 格式
  const openaiMessages = messages.map((m: { role: string; content: string | Array<{ type: string; text?: string }> }) => {
    let content = '';
    if (typeof m.content === 'string') {
      content = m.content;
    } else if (Array.isArray(m.content)) {
      content = m.content
        .filter((c: { type: string }) => c.type === 'text')
        .map((c: { text?: string }) => c.text || '')
        .join('');
    }
    return {
      role: m.role === 'assistant' ? 'assistant' as const : 'user' as const,
      content,
    };
  });

  const client = getClient();

  try {
    if (stream) {
      // 流式响应 - Anthropic SSE 格式
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const chatId = `msg_${Date.now()}`;

      // 发送 message_start 事件
      res.write(`event: message_start\ndata: ${JSON.stringify({
        type: 'message_start',
        message: {
          id: chatId,
          type: 'message',
          role: 'assistant',
          content: [],
          model,
          stop_reason: null,
        }
      })}\n\n`);

      // 发送 content_block_start
      res.write(`event: content_block_start\ndata: ${JSON.stringify({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' }
      })}\n\n`);

      let textIndex = 0;
      for await (const chunk of await client.chatStream({
        model,
        messages: openaiMessages,
        stream: true,
      })) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          res.write(`event: content_block_delta\ndata: ${JSON.stringify({
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: content }
          })}\n\n`);
          textIndex++;
        }
      }

      // 发送 content_block_stop
      res.write(`event: content_block_stop\ndata: ${JSON.stringify({
        type: 'content_block_stop',
        index: 0
      })}\n\n`);

      // 发送 message_delta
      res.write(`event: message_delta\ndata: ${JSON.stringify({
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 0 }
      })}\n\n`);

      // 发送 message_stop
      res.write(`event: message_stop\ndata: ${JSON.stringify({
        type: 'message_stop'
      })}\n\n`);

      res.end();
    } else {
      // 非流式响应 - Anthropic 格式
      const response = await client.chat({
        model,
        messages: openaiMessages,
        stream: false,
      });

      res.json({
        id: response.id,
        type: 'message',
        role: 'assistant',
        content: [{
          type: 'text',
          text: response.choices[0].message.content,
        }],
        model: response.model,
        stop_reason: 'end_turn',
        usage: {
          input_tokens: response.usage.prompt_tokens,
          output_tokens: response.usage.completion_tokens,
        },
      });
    }
  } catch (error) {
    console.error('[Error]', error);
    if (!res.headersSent) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Internal server error'
      });
    }
  }
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`[iflow-sdk-bridge] Server running on http://localhost:${PORT}`);
  console.log(`[iflow-sdk-bridge] Models endpoint: http://localhost:${PORT}/v1/models`);
  console.log(`[iflow-sdk-bridge] Chat endpoint: http://localhost:${PORT}/v1/chat/completions`);
  console.log(`[iflow-sdk-bridge] Anthropic endpoint: http://localhost:${PORT}/v1/messages`);
});

// 优雅关闭
process.on('SIGINT', async () => {
  console.log('\n[iflow-sdk-bridge] Shutting down...');
  const client = getClient();
  await client.disconnect();
  process.exit(0);
});
