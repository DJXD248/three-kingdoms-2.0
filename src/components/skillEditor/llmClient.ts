// LLM client for K-13 大模型档 —— 纯函数层，零状态、零持久化。
//
// 设计要点（逐字对齐 §12-140⑧⑨）：
//  ① 密钥只存调用方内存，绝不进代码、不进产物、不写浏览器本地存储；
//  ② 不绑死任何服务商——用 OpenAI Chat Completions 格式（/v1/chat/completions），
//     兼容 OpenAI / DeepSeek / Azure / OneAPI 等主流；
//  ③ 模型只改写文字，可选尝试给出积木载荷草稿（但仍由离线反解 parseSkillText
//     验证过滤后才进，绝不绕过那套闸）；
//  ④ 所有 fetch 失败/超时/4xx/5xx 都返回结构化错误，不抛异常。

export interface LlmConfig {
  apiKey: string;
  endpoint: string;           // 形如 https://api.openai.com/v1 或 https://api.deepseek.com/v1
  model: string;              // 形如 gpt-4o / deepseek-chat
}

export interface LlmRewriteResult {
  /** 改写后的文字——这是一定会有的，即使模型没听懂也返回原文。 */
  rewrittenText: string;
  /** 可选：模型尝试给出的积木载荷 JSON 草稿（纯字符串）。玩家选了"尝试生成载荷"时才会有。 */
  payloadDraft?: string;
  /** 给玩家看的说明，比如"网络超时"、"API Key 无效"、"模型说它不认识这件事"。 */
  note?: string;
}

export type LlmErrorKind =
  | 'emptyConfig'       // 调用方没填 endpoint / apiKey / model
  | 'network'           // fetch 本身挂了（断网、DNS 解析失败、CORS）
  | 'timeout'           // fetch 超时
  | 'http'              // 服务器回了 4xx / 5xx
  | 'emptyResponse'     // 返回结构里没有 content
  | 'unknown';

export interface LlmInvokeError {
  kind: LlmErrorKind;
  message: string;
  status?: number;
}

const INVOKE_TIMEOUT_MS = 30_000;

/** 把 endpoint 规整成不带 /chat/completions 后缀的基址，末尾没有 /。 */
function normalizeEndpoint(base: string): string {
  let s = base.trim();
  // 用户可能直接填到 /chat/completions
  s = s.replace(/\/chat\/completions\s*$/, '');
  // 也可能漏 /v1 —— 简单处理：如果没有版本段就补 /v1；有就保持原样
  if (!/\/v\d+$/.test(s)) {
    s = s.replace(/\/+$/, '') + '/v1';
  } else {
    s = s.replace(/\/+$/, '');
  }
  return s;
}

/**
 * 调一次大模型，让它把玩家写的那段话改写得更规范，
 * 并可选让它尝试生成积木载荷草稿。
 *
 * 不抛异常——成功/失败全在返回对象里说。
 */
export async function callLlmRewrite(
  rawConfig: LlmConfig,
  userText: string,
  opts: { attemptPayload?: boolean; context?: 'general' | 'skill' } = {},
): Promise<{ ok: true; data: LlmRewriteResult } | { ok: false; error: LlmInvokeError }> {
  const cfg = {
    apiKey: rawConfig.apiKey.trim(),
    endpoint: normalizeEndpoint(rawConfig.endpoint),
    model: rawConfig.model.trim(),
  };

  if (!cfg.apiKey) return { ok: false, error: { kind: 'emptyConfig', message: 'API 密钥没填' } };
  if (!cfg.endpoint) return { ok: false, error: { kind: 'emptyConfig', message: 'API 地址没填' } };
  if (!cfg.model) return { ok: false, error: { kind: 'emptyConfig', message: '模型名没填' } };
  const text = userText.trim();
  if (!text) return { ok: false, error: { kind: 'emptyConfig', message: '要改写的话是空的' } };

  const sysPrompt = buildSystemPrompt(opts.context ?? 'general', !!opts.attemptPayload);
  const url = `${cfg.endpoint}/chat/completions`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INVOKE_TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: text },
        ],
        temperature: 0.3,
        ...(opts.attemptPayload ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) {
      const body = await safeText(resp);
      return {
        ok: false,
        error: {
          kind: 'http',
          message: `模型服务器回了 ${resp.status} ${resp.statusText}${body ? '：' + body.slice(0, 200) : ''}`,
          status: resp.status,
        },
      };
    }

    const data = await resp.json();
    const content: string | undefined = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      return { ok: false, error: { kind: 'emptyResponse', message: '模型没回内容' } };
    }

    // 模型回 JSON 时尝试解析；回纯文本时直接当 rewrittenText
    let rewrittenText = content.trim();
    let payloadDraft: string | undefined;

    if (opts.attemptPayload) {
      try {
        const parsed = JSON.parse(content);
        if (typeof parsed.rewritten === 'string' && parsed.rewritten.trim()) {
          rewrittenText = parsed.rewritten.trim();
        }
        if (typeof parsed.payload === 'string' && parsed.payload.trim()) {
          payloadDraft = parsed.payload.trim();
        } else if (parsed.payload && typeof parsed.payload === 'object') {
          payloadDraft = JSON.stringify(parsed.payload);
        }
      } catch {
        // 不是合法 JSON——整条当 rewrittenText，不解析
      }
    }

    return { ok: true, data: { rewrittenText, payloadDraft } };
  } catch (e: unknown) {
    clearTimeout(timer);
    if (e instanceof DOMException && e.name === 'AbortError') {
      return { ok: false, error: { kind: 'timeout', message: '模型服务器 30 秒没回音——超时了' } };
    }
    return {
      ok: false,
      error: { kind: 'network', message: `网络层报错：${e instanceof Error ? e.message : String(e)}` },
    };
  }
}

async function safeText(resp: Response): Promise<string> {
  try { return await resp.text(); } catch { return ''; }
}

function buildSystemPrompt(context: 'general' | 'skill', attemptPayload: boolean): string {
  const role = context === 'general'
    ? '三国卡牌游戏将领反解助手'
    : '三国卡牌游戏技能句式改写助手';

  const rules = context === 'general'
    ? [
        '将玩家写的口语化将领描述，改写为更规范、更易被游戏离线反解器识别的句式。',
        '常用写法对照：",体力4"→",体力 4"；"近战攻击力2远程1"→"近战2，远程1"。',
        '势力写全称（魏/蜀/吴/群/晋），不要缩写或别名。',
        '体力写具体数字（1–9），不要写"若干"、"一些"。',
        '技能名只记名，效果描述留给技能编辑页。',
      ]
    : [
        '将玩家写的口语化技能描述，改写为更规范、更易被游戏离线反解器识别的句式。',
        '时机写法："受到伤害后"、"成为目标时"、"将领登场时"、"回合结束时"、"自己回合开始时"。',
        '效果动作：摸 X 张牌、对目标造成 X 点伤害、回复 X 点体力、获得 X 点护甲、弃置 X 张手牌。',
        '对象写法：自身、伤害来源、目标（游戏只认这三种，不要写"别人"、"对方"、"敌方"）。',
        '复合效果用"以下依次生效"开头，不要用"若…则…"。',
      ];

  const format = attemptPayload
    ? [
        '请以 JSON 对象回复，两个字段：',
        '  "rewritten": 改写后的规范句式（字符串）',
        '  "payload":    可选，积木载荷草稿（JSON 字符串），不确定就不写这个字段',
      ].join('\n')
    : '请只回复改写后的规范句式，不加解释。';

  return `你是${role}。\n${rules.map(r => '· ' + r).join('\n')}\n\n${format}`;
}
