import { IFlowClient, PermissionMode, MessageType } from '@iflow-ai/iflow-cli-sdk';
import type { Message, AssistantMessage } from '@iflow-ai/iflow-cli-sdk';

export interface ChatCompletionOptions {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
  }>;
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface StreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
    };
    finish_reason: string | null;
  }>;
}

// 支持的模型列表 (来自 iFlow CLI)
export const SUPPORTED_MODELS = [
  { id: 'glm-4.6', name: 'GLM-4.6' },
  { id: 'glm-4.7', name: 'GLM-4.7' },
  { id: 'glm-5', name: 'GLM-5' },
  { id: 'deepseek-v3.2-chat', name: 'DeepSeek-V3.2' },
  { id: 'qwen3-coder-plus', name: 'Qwen3-Coder-Plus' },
  { id: 'kimi-k2', name: 'Kimi-K2' },
  { id: 'kimi-k2-thinking', name: 'Kimi-K2-Thinking' },
  { id: 'kimi-k2.5', name: 'Kimi-K2.5' },
  { id: 'minimax-m2.5', name: 'MiniMax-M2.5' },
  { id: 'qwen-vl-max', name: 'Qwen-VL-Max' },
];

// 模型别名映射
const MODEL_ALIASES: Record<string, string> = {
  'claude-opus-4-6': 'glm-5',
  'claude-opus-4': 'glm-5',
  'claude-sonnet-4-6': 'glm-5',
  'claude-sonnet-4': 'glm-5',
  'claude-haiku-4-5': 'glm-5',
  'claude-haiku-4': 'glm-5',
  'opus-4': 'glm-5',
  'sonnet-4': 'glm-5',
  'haiku-4': 'glm-5',
};

export class IFlowSDKClient {
  private client: IFlowClient | null = null;
  private connecting: Promise<void> | null = null;
  private model: string = 'glm-5';
  private lastRequestTime: number = 0;
  private requestCount: number = 0;
  private sessionCreateTime: number = 0;
  private sessionIdCounter: number = 0;
  private silentMode: boolean = false;

  // 请求间隔限制（毫秒）- 随机区间，模拟人类行为
  private readonly MIN_REQUEST_INTERVAL = 300;
  private readonly MAX_REQUEST_INTERVAL = 1500;
  // 每分钟最大请求数
  private readonly MAX_REQUESTS_PER_MINUTE = 25;
  // 会话轮换：每 50 次请求或 30 分钟重连
  private readonly MAX_REQUESTS_PER_SESSION = 50;
  private readonly MAX_SESSION_AGE_MS = 30 * 60 * 1000; // 30分钟

  private requestTimestamps: number[] = [];

  /**
   * 设置静默模式（减少日志输出）
   */
  setSilentMode(silent: boolean): void {
    this.silentMode = silent;
  }

  private log(message: string): void {
    if (!this.silentMode) {
      console.log(message);
    }
  }

  async ensureConnected(): Promise<void> {
    if (this.client?.isConnected()) {
      return;
    }

    // 防止并发连接
    if (this.connecting) {
      return this.connecting;
    }

    this.connecting = this.connect();
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  private async connect(): Promise<void> {
    this.log('[IFlowSDK] 正在连接 iFlow CLI...');

    this.client = new IFlowClient({
      // 自动启动 iFlow 进程
      autoStartProcess: true,
      // 自动批准所有权限（纯对话场景无需工具确认）
      permissionMode: PermissionMode.AUTO,
      // 会话设置：禁用工具调用，专注纯对话
      sessionSettings: {
        system_prompt: 'You are a helpful AI assistant.',
        // 禁用所有工具，纯对话模式
        disallowed_tools: [
          'read_file', 'write_file', 'replace', 'glob', 'search_file_content',
          'list_directory', 'run_shell_command', 'web_fetch', 'web_search',
          'task', 'todo_write', 'todo_read', 'ask_user_question', 'image_read'
        ],
      },
      // 禁用文件访问
      fileAccess: false,
    });

    await this.client.connect();

    // 设置模型
    await this.client.config.set('model', this.model);

    // 记录会话创建时间
    this.sessionCreateTime = Date.now();
    this.sessionIdCounter++;

    this.log(`[IFlowSDK] 已连接到 iFlow CLI (会话 #${this.sessionIdCounter})`);
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
    }
  }

  setModel(model: string): void {
    // 应用别名
    this.model = MODEL_ALIASES[model] || model;
  }

  /**
   * 检查并等待频率限制
   * 防止高频调用被检测为异常行为
   */
  private async checkRateLimit(): Promise<void> {
    const now = Date.now();

    // 清理一分钟前的时间戳
    this.requestTimestamps = this.requestTimestamps.filter(t => now - t < 60000);

    // 检查每分钟请求限制
    if (this.requestTimestamps.length >= this.MAX_REQUESTS_PER_MINUTE) {
      const oldestInWindow = this.requestTimestamps[0];
      const waitTime = 60000 - (now - oldestInWindow) + this.randomDelay(1000, 5000);
      this.log(`[IFlowSDK] 频率限制：等待 ${Math.ceil(waitTime / 1000)}秒`);
      await this.sleep(waitTime);
    }

    // 检查最小请求间隔 - 随机化
    const timeSinceLastRequest = now - this.lastRequestTime;
    const targetInterval = this.randomDelay(this.MIN_REQUEST_INTERVAL, this.MAX_REQUEST_INTERVAL);
    if (timeSinceLastRequest < targetInterval) {
      const waitTime = targetInterval - timeSinceLastRequest;
      await this.sleep(waitTime);
    }

    // 记录本次请求
    this.lastRequestTime = Date.now();
    this.requestTimestamps.push(this.lastRequestTime);
    this.requestCount++;

    // 会话轮换检查
    await this.checkSessionRotation();
  }

  /**
   * 检查是否需要轮换会话
   * 定期断开重连，避免长时间同一会话被追踪
   */
  private async checkSessionRotation(): Promise<void> {
    const now = Date.now();
    const needsRotation =
      this.requestCount >= this.MAX_REQUESTS_PER_SESSION ||
      (this.sessionCreateTime && now - this.sessionCreateTime > this.MAX_SESSION_AGE_MS);

    if (needsRotation && this.client?.isConnected()) {
      this.log('[IFlowSDK] 会话轮换：断开重连...');
      await this.disconnect();
      // 添加随机延迟后再重连
      await this.sleep(this.randomDelay(2000, 5000));
    }
  }

  /**
   * 生成随机延迟时间
   */
  private randomDelay(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * 异步 sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 生成随机 ID（避免时间戳特征）
   */
  private generateId(prefix: string): string {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let id = '';
    for (let i = 0; i < 12; i++) {
      id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `${prefix}-${id}`;
  }

  /**
   * 获取请求统计信息
   */
  getStats(): {
    totalRequests: number;
    recentRequests: number;
    sessionCount: number;
    sessionAgeSec: number;
  } {
    const now = Date.now();
    const recentCount = this.requestTimestamps.filter(t => now - t < 60000).length;
    return {
      totalRequests: this.requestCount,
      recentRequests: recentCount,
      sessionCount: this.sessionIdCounter,
      sessionAgeSec: this.sessionCreateTime ? Math.floor((now - this.sessionCreateTime) / 1000) : 0,
    };
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.client?.isConnected() ?? false;
  }

  /**
   * 获取当前模型
   */
  getCurrentModel(): string {
    return this.model;
  }

  async chat(options: ChatCompletionOptions): Promise<ChatCompletionResponse> {
    // 频率限制检查
    await this.checkRateLimit();

    await this.ensureConnected();

    // 设置模型
    const model = MODEL_ALIASES[options.model] || options.model;
    await this.client!.config.set('model', model);

    // 构建提示词
    const prompt = this.buildPrompt(options.messages);

    // 发送消息
    await this.client!.sendMessage(prompt);

    // 收集响应
    let fullResponse = '';
    for await (const message of this.client!.receiveMessages()) {
      if (message.type === MessageType.ASSISTANT) {
        const assistantMsg = message as AssistantMessage;
        if (assistantMsg.chunk?.text) {
          fullResponse += assistantMsg.chunk.text;
        }
        if (assistantMsg.chunk?.thought) {
          // 思考过程，可选是否包含
          // fullResponse += assistantMsg.chunk.thought;
        }
      } else if (message.type === MessageType.TASK_FINISH) {
        break;
      }
    }

    return {
      id: this.generateId('chatcmpl'),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: options.model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: fullResponse,
        },
        finish_reason: 'stop',
      }],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
    };
  }

  async *chatStream(options: ChatCompletionOptions): AsyncGenerator<StreamChunk> {
    // 频率限制检查
    await this.checkRateLimit();

    await this.ensureConnected();

    // 设置模型
    const model = MODEL_ALIASES[options.model] || options.model;
    await this.client!.config.set('model', model);

    // 构建提示词
    const prompt = this.buildPrompt(options.messages);

    // 发送消息
    await this.client!.sendMessage(prompt);

    const chatId = this.generateId('chatcmpl');
    const created = Math.floor(Date.now() / 1000);

    // 发送角色 delta
    yield {
      id: chatId,
      object: 'chat.completion.chunk',
      created,
      model: options.model,
      choices: [{
        index: 0,
        delta: { role: 'assistant' },
        finish_reason: null,
      }],
    };

    // 流式接收响应
    for await (const message of this.client!.receiveMessages()) {
      if (message.type === MessageType.ASSISTANT) {
        const assistantMsg = message as AssistantMessage;
        if (assistantMsg.chunk?.text) {
          yield {
            id: chatId,
            object: 'chat.completion.chunk',
            created,
            model: options.model,
            choices: [{
              index: 0,
              delta: { content: assistantMsg.chunk.text },
              finish_reason: null,
            }],
          };
        }
      } else if (message.type === MessageType.TASK_FINISH) {
        // 发送结束 chunk
        yield {
          id: chatId,
          object: 'chat.completion.chunk',
          created,
          model: options.model,
          choices: [{
            index: 0,
            delta: {},
            finish_reason: 'stop',
          }],
        };
        break;
      }
    }
  }

  private buildPrompt(messages: ChatCompletionOptions['messages']): string {
    const parts: string[] = [];

    for (const msg of messages) {
      // 提取文本内容
      let textContent = '';
      if (typeof msg.content === 'string') {
        textContent = msg.content;
      } else if (Array.isArray(msg.content)) {
        textContent = msg.content
          .filter(item => item.type === 'text' && item.text)
          .map(item => item.text)
          .join('\n');
      }

      if (msg.role === 'system') {
        parts.push(`[System]: ${textContent}`);
      } else if (msg.role === 'user') {
        parts.push(textContent);
      } else if (msg.role === 'assistant') {
        parts.push(`[Assistant]: ${textContent}`);
      }
    }

    // 只返回最后一条用户消息（iFlow SDK 是对话式的）
    // 如果需要完整上下文，可以传递所有内容
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    if (lastUserMsg) {
      if (typeof lastUserMsg.content === 'string') {
        return lastUserMsg.content;
      } else if (Array.isArray(lastUserMsg.content)) {
        return lastUserMsg.content
          .filter(item => item.type === 'text' && item.text)
          .map(item => item.text)
          .join('\n');
      }
    }
    return parts.join('\n\n');
  }
}

// 单例实例
let globalClient: IFlowSDKClient | null = null;

export function getClient(): IFlowSDKClient {
  if (!globalClient) {
    globalClient = new IFlowSDKClient();
  }
  return globalClient;
}
