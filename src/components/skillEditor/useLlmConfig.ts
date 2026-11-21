// K-13 大模型档的内存存储——严格对齐 §12-140⑧⑨ 安全纪律：
//  · 密钥只活在 React state 里，刷新页面就没了；
//  · 不进代码、不进产物、不写 localStorage / sessionStorage / cookie；
//  · 只有这一个地方存 LlmConfig，不新建第二份。
import { useCallback, useState } from 'react';
import type { LlmConfig } from './llmClient';

type LlmConfigState = {
  endpoint: string;
  apiKey: string;
  model: string;
};

const EMPTY: LlmConfigState = { endpoint: '', apiKey: '', model: '' };

export function useLlmConfig() {
  const [cfg, setCfg] = useState<LlmConfigState>(EMPTY);

  const update = useCallback((patch: Partial<LlmConfigState>) => {
    setCfg(prev => ({ ...prev, ...patch }));
  }, []);

  const clear = useCallback(() => setCfg(EMPTY), []);

  const hasAll = cfg.endpoint.trim() && cfg.apiKey && cfg.model.trim();

  return {
    cfg: cfg as LlmConfig,
    update,
    clear,
    hasAll: !!hasAll,
    // endpoint 的显示版本：脱敏——协议头保留，后面只露前 12 字符
    maskedEndpoint: cfg.endpoint
      ? (() => {
          const trimmed = cfg.endpoint.trim();
          return trimmed.length > 12 ? trimmed.slice(0, 12) + '…' : trimmed;
        })()
      : '',
    maskedApiKey: cfg.apiKey ? '●'.repeat(Math.min(cfg.apiKey.length, 24)) : '',
  };
}
