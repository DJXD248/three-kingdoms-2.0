/**
 * 「我听谁」这一维的**两种写法各只有一个出处**（v2.9.13 按需池第一刀·甲档）。
 *
 * 为什么这一条值得单独钉：这一刀一次加了**两档档位**（听除自身以外／听敌方（其他席位））
 * 与**五种定语写法**（用户在卡面上会写的那种），而档位名与定语写法是同一批档位的
 * 两张脸——下拉、Excel 列、生成句、反解、编辑器提示五处都在用同一批词。
 * 只要任何一处开始**手抄**，下一位加档位的人就会只改词表、不改那一处，
 * 于是"界面上数得出的档位"与"引擎认得的档位"分叉（§12-110 的适用现场：
 * 玩家看得见、又填得回引擎的词，同轮必须补"只进不出"别名＋全库白名单钉）。
 *
 * 三条判据＝①两张词表同键同序（少一档 TS 与这一条都会红）；
 * ②用户那种写法**只进不出**（反解认得它，但下拉全集／Excel 列表／生成句里没有它）；
 * ③全仓 `src` 下（证人文件除外）**零处手抄拼好的整串**——拼法只有
 *   `deployTimingWithIntent` 一个出处。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  allTriggerTypes, listenerScopeIntentWords, listenerScopeLabels,
  supportsListenerScope, triggerTypeLabels, deployTimingWithIntent,
  ListenerScope, SkillTriggerConfig,
} from './generals';
import { LISTENER_SCOPE_LIST, buildTriggerOptionStrings } from '../skills/skillExcelFormat';
import { triggerPhrase } from '../skills/skillSentence';
import { parseSkillText } from '../skills/skillTextParse';

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const ALL_SCOPES = Object.keys(listenerScopeLabels) as ListenerScope[];

describe('「我听谁」两种写法的单一出处', () => {
  it('档位名与用户定语两张表同键同序（加档位漏一张当场红）', () => {
    expect(Object.keys(listenerScopeIntentWords)).toEqual(Object.keys(listenerScopeLabels));
  });

  it('用户那种写法只进不出：反解认得它，下拉全集／Excel 列表／生成句里没有它', () => {
    const dropdown = buildTriggerOptionStrings();
    const excelList = LISTENER_SCOPE_LIST.split(',');
    for (const scope of ALL_SCOPES) {
      const alias = deployTimingWithIntent(scope);
      const cfg: SkillTriggerConfig = { type: 'onDeploy', listenerScope: scope };
      // ①解得回来，且解成与档位名那一路**同一个值**。
      const draft = parseSkillText(`${alias}，摸 1 张牌。`);
      expect(draft.issues.map(i => i.raw), alias).toEqual([]);
      expect(draft.effects[0].trigger, alias).toEqual(cfg);
      // ②写不出去：那一格的生成句是档位名那一串，不是定语那一串。
      expect(triggerPhrase(cfg)).not.toBe(alias);
      expect(dropdown).not.toContain(alias);
      expect(excelList).not.toContain(alias);
    }
    // 定语那一串确实挂在「登场时」这一格上（其余时机不替用户造句）。
    expect(deployTimingWithIntent('others')).toBe(`${listenerScopeIntentWords.others}登场时`);
    expect(deployTimingWithIntent('others')).toBe(triggerTypeLabels.onDeploy.replace(/^将领/, listenerScopeIntentWords.others));
  });

  it('全仓 src（证人除外）零处手抄拼好的定语整串＝拼法只有一个出处', () => {
    const pattern = /(自身|己方角色|其他角色|敌方角色|场上所有角色)登场时/;
    const files = walk(srcRoot);
    expect(files.length).toBeGreaterThan(100);
    const offenders = files
      .filter(file => pattern.test(readFileSync(file, 'utf8')))
      .map(file => path.relative(srcRoot, file));
    expect(offenders).toEqual([]);
  });

  it('认这一栏的时机名单也只有一个出处：词表改了，提示与编译面跟着走', () => {
    const wired = allTriggerTypes.filter(supportsListenerScope);
    // 「登场时」必须在册（这一刀就是在它上面加的），而「其他将领登场时」那型
    // 的细分自带"谁登场"，刻意**不**再叠这一维（两处各写一份＝迟早矛盾）。
    expect(wired).toContain('onDeploy');
    expect(wired).not.toContain('onOtherDeploy');
  });
});
