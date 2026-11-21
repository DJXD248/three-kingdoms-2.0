// K-13 设置面板——齿轮图标点开，三格：API 地址 / 密钥 / 模型名。
// 只在开发者模式里出现（由调用方 gate）；密钥只活在 state 里，绝不持久化。
import { useState } from 'react';
import type { LlmConfig } from './llmClient';

interface Props {
  open: boolean;
  onToggle: () => void;
  cfg: LlmConfig;
  hasAll: boolean;
  maskedEndpoint: string;
  maskedApiKey: string;
  update: (patch: Partial<LlmConfig>) => void;
  clear: () => void;
}

export function LlmSettings({ open, onToggle, cfg, hasAll, maskedEndpoint, maskedApiKey, update, clear }: Props) {
  if (!open) {
    return (
      <button
        type="button"
        onClick={onToggle}
        title="大模型设置（API 地址 / 密钥 / 模型名）·只在本页有效"
        className={`px-2 py-1 rounded border text-[11px] font-bold transition-colors ${
          hasAll
            ? 'border-emerald-600/50 text-emerald-200 hover:bg-emerald-900/30'
            : 'border-gray-600/40 text-gray-400 hover:bg-gray-700/30'
        }`}
      >
        {hasAll ? `🤖 大模型已配（${maskedEndpoint} / ${cfg.model.trim() || '—'}）` : '⚙️ 大模型设置'}
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-amber-700/40 bg-amber-950/20 p-3 space-y-2 text-[11px]">
      <div className="flex items-center justify-between">
        <label className="text-[11px] text-amber-300/80 font-bold">
          ⚙️ 大模型设置（只在本页有效，刷新后重填）
        </label>
        <button onClick={onToggle} className="text-[10px] text-gray-400 hover:text-gray-200 px-1.5">✕</button>
      </div>

      {/* API 地址 */}
      <div>
        <label className="block text-[10px] text-amber-400/70 mb-0.5">API 地址（兼容 OpenAI Chat Completions 格式）</label>
        <input
          type="text"
          value={cfg.endpoint}
          onChange={e => update({ endpoint: e.target.value })}
          placeholder="https://api.deepseek.com/v1  或  https://api.openai.com/v1"
          className="w-full px-2 py-1 rounded bg-black/50 border border-amber-800/30 text-amber-100 text-[11px] focus:outline-none focus:border-amber-500"
        />
        <p className="text-[9px] text-amber-400/50 mt-0.5">末尾可以带 /v1 或 /chat/completions，会自动规整</p>
      </div>

      {/* 密钥 */}
      <div>
        <label className="block text-[10px] text-amber-400/70 mb-0.5">API 密钥</label>
        <SecretInput
          value={cfg.apiKey}
          onChange={v => update({ apiKey: v })}
          placeholder="sk-…（粘贴进来，关闭/刷新就没了）"
        />
        <p className="text-[9px] text-amber-400/50 mt-0.5">⚠️ 密钥只活在本页内存里，不会存进代码、不会存进浏览器本地</p>
      </div>

      {/* 模型名 */}
      <div>
        <label className="block text-[10px] text-amber-400/70 mb-0.5">模型名</label>
        <input
          type="text"
          value={cfg.model}
          onChange={e => update({ model: e.target.value })}
          placeholder="deepseek-chat  /  gpt-4o  /  你自己填"
          className="w-full px-2 py-1 rounded bg-black/50 border border-amber-800/30 text-amber-100 text-[11px] focus:outline-none focus:border-amber-500"
        />
      </div>

      {/* 底部行：状态 + 清除 */}
      <div className="flex items-center justify-between pt-1">
        <span className={`text-[10px] ${hasAll ? 'text-emerald-300' : 'text-rose-400/70'}`}>
          {hasAll ? `✅ 已就绪（密钥 ${maskedApiKey}）` : '✕ 三格还没填齐'}
        </span>
        {hasAll && (
          <button
            type="button"
            onClick={clear}
            className="text-[10px] text-rose-400/70 hover:text-rose-300 border border-rose-800/30 rounded px-2 py-0.5"
          >
            清除全部
          </button>
        )}
      </div>
    </div>
  );
}

/** 密钥输入框——默认打星号，点眼睛按钮切换明文看一眼。 */
function SecretInput({ value, onChange, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="relative">
      <input
        type={revealed ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full px-2 py-1 pr-7 rounded bg-black/50 border border-amber-800/30 text-amber-100 text-[11px] focus:outline-none focus:border-amber-500"
      />
      <button
        type="button"
        onClick={() => setRevealed(r => !r)}
        title={revealed ? '隐藏' : '显示'}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 text-amber-400/60 hover:text-amber-200 text-[10px]"
      >
        {revealed ? '🙈' : '👁'}
      </button>
    </div>
  );
}
