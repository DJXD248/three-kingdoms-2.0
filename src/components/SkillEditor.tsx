import { useState, useMemo, useCallback } from 'react';
import { useGameStore } from '../store/gameStore';
import {
  allGenerals, General, Faction, factionColors, SkillTag, allSkillTags, skillTagColors,
  SkillEffect, SkillEffectMode, effectModeLabels, sourceLabels, type GeneralSource,
} from '../data/generals';
import { isRepositoryOfficial, sourceOf } from '../domain/generalProvenance';
import { denialMessage, mayModifyGeneral, type EditDenial } from '../domain/generalPolicy';
import {
  triggerToStr,
  buildTriggerOptionStrings,
  effectGroupHeaders,
  serializeEffectGroup,
  RUNTIME_TYPE_LIST,
  RUNTIME_TARGET_LIST,
} from '../skills/skillExcelFormat';
import { GATE_SYNTAX_HINT } from '../skills/skillGateText';
import {
  parseSkillCell, isDetailedFormat, isRowPerSkillFormat, resolveGeneralByNameFaction,
  parseRowPerSkillSheet, parseLegacyDetailedRow, SkillEditEntry, UnresolvedImportBlock,
} from './skillEditor/skillExcelParsers';
import { describeLockKey, findIdentityConflicts } from '../domain/identity';
import { TriggerEditor } from './skillEditor/TriggerEditor';
import { RuntimeEditor } from './skillEditor/RuntimeEditor';
import { GateEditor } from './skillEditor/GateEditor';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

/** All trigger dropdown options (computed once; pure, module-level). */
const allTriggerOptionStrings = buildTriggerOptionStrings();

type SortBy = 'faction' | 'name' | 'type';

export default function SkillEditor({ onClose }: { onClose: () => void }) {
  const skillEdits = useGameStore(s => s.skillEdits);
  const generalEdits = useGameStore(s => s.generalEdits);
  // Subscription anchor: any disable write changes this set's reference, which
  // is what forces the rows below to re-read the policy-filtered one.
  useGameStore(s => s.disabledGenerals);
  const updateSkillEdit = useGameStore(s => s.updateSkillEdit);
  const updateGeneralEdit = useGameStore(s => s.updateGeneralEdit);
  const batchDeleteEdits = useGameStore(s => s.batchDeleteEdits);
  const toggleDisabledGeneral = useGameStore(s => s.toggleDisabledGeneral);
  const batchToggleDisabled = useGameStore(s => s.batchToggleDisabled);
  const importSkillEditsFromText = useGameStore(s => s.importSkillEditsFromText);
  const identityRegistry = useGameStore(s => s.identityRegistry);
  const addIdentity = useGameStore(s => s.addIdentity);
  const renameIdentity = useGameStore(s => s.renameIdentity);
  const deleteIdentity = useGameStore(s => s.deleteIdentity);
  const developerMode = useGameStore(s => s.developerMode);
  const authoredGenerals = useGameStore(s => s.authoredGenerals);
  const addAuthoredGeneral = useGameStore(s => s.addAuthoredGeneral);
  const removeAuthoredGeneral = useGameStore(s => s.removeAuthoredGeneral);
  // v2.8.8 N2 (§H8): the manual (white) lock surface — a local id set, shown
  // on rows and toggled per-row or in batch. The gold lock is never stored;
  // it is §H3 rendered (derived per row below through the same policy root).
  const lockedGenerals = useGameStore(s => s.lockedGeneralIds);
  const toggleGeneralLock = useGameStore(s => s.toggleGeneralLock);
  const batchToggleLocked = useGameStore(s => s.batchToggleLocked);
  // §H3: the editor asks the same policy root the store guards with, so a
  // read-only general is greyed out before it can be written, not after.
  const mayEditGeneral = useGameStore(s => s.mayEditGeneral);
  const effectiveDisabledGenerals = useGameStore(s => s.effectiveDisabledGenerals);
  const readBlockedEdits = useGameStore(s => s.blockedEdits);
  const blocked = readBlockedEdits();
  // What the game will actually treat as disabled this session — a blocked
  // official disable must not strike the row through.
  const liveDisabled = effectiveDisabledGenerals();

  const [search, setSearch] = useState('');
  const [factionFilter, setFactionFilter] = useState<Faction | '全部'>('全部');
  const [sortBy, setSortBy] = useState<SortBy>('faction');
  const [incompleteOnly, setIncompleteOnly] = useState(false);
  const [selectedGeneral, setSelectedGeneral] = useState<General | null>(null);
  const [editingSkills, setEditingSkills] = useState<SkillEditEntry[]>([]);
  const [editName, setEditName] = useState('');
  const [editFaction, setEditFaction] = useState<Faction>('魏');
  const [editHp, setEditHp] = useState(4);
  const [editMeleeAtk, setEditMeleeAtk] = useState(2);
  const [editRangedAtk, setEditRangedAtk] = useState(1);
  // v2.8.0 identity pick: '__default__' = 跟随名字, '__none__' = 无身份·不锁,
  // anything else = registry entry (选身份，不是自由文本).
  const [editIdentity, setEditIdentity] = useState('__default__');
  const [showIdentities, setShowIdentities] = useState(false);
  // v2.8.5 authoring surface (§H1/§H2)
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createFaction, setCreateFaction] = useState<Faction>('蜀');
  const [createHp, setCreateHp] = useState(4);
  const [createIdentity, setCreateIdentity] = useState('__default__');
  const [createSource, setCreateSource] = useState<GeneralSource>('DIY');
  const [createResult, setCreateResult] = useState('');
  const [newIdentityName, setNewIdentityName] = useState('');
  const [identityNotice, setIdentityNotice] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importResult, setImportResult] = useState('');
  /** 导入时 Excel 里没看懂的原文（门槛栏/触发栏），逐条常驻显示（不自动消失，必须人工处理）。 */
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  /** §H8: unresolved import blocks deferred for user resolution (create new / modify existing / skip). */
  const [pendingImports, setPendingImports] = useState<UnresolvedImportBlock[]>([]);
  const [saved, setSaved] = useState(false);
  /** §H3: why a save/import/delete was refused. Persistent until the next try. */
  const [readOnlyNotice, setReadOnlyNotice] = useState('');

  // Multi-select state
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const factions: (Faction | '全部')[] = ['全部', '魏', '蜀', '吴', '群', '晋'];
  const factionOptions: Faction[] = ['魏', '蜀', '吴', '群', '晋'];

  const getEditedGeneral = useCallback((g: General) => {
    const gEdit = generalEdits[g.id];
    const sEdit = skillEdits[g.id];
    const result = { ...g };
    if (gEdit) {
      if (gEdit.name) result.name = gEdit.name;
      if (gEdit.faction) result.faction = gEdit.faction;
      if (gEdit.identity !== undefined) result.identity = gEdit.identity;
      if (gEdit.hp != null) { result.hp = gEdit.hp; result.type = gEdit.hp >= 4 ? '武将' : '文将'; }
      if (gEdit.meleeAtk != null) result.meleeAtk = gEdit.meleeAtk;
      if (gEdit.rangedAtk != null) result.rangedAtk = gEdit.rangedAtk;
    }
    if (sEdit) result.skills = sEdit.map(s => ({ name: s.name, description: s.description, tag: s.tag, trigger: s.trigger, effects: s.effects, effectMode: s.effectMode, forced: s.forced }));
    return result;
  }, [generalEdits, skillEdits]);

  // Check if a general has incomplete skill setup
  const isSkillIncomplete = useCallback((g: General): boolean => {
    return g.skills.some(sk => {
      // Single-effect mode: check trigger and description
      if (!sk.effects || sk.effects.length === 0) {
        if (!sk.description && !sk.trigger) return true;
        if (!sk.description) return true;
        if (!sk.trigger) return true;
        return false;
      }
      // Multi-effect mode: check each effect (incl. structured runtime completeness)
      return sk.effects.some(eff => !eff.description || !eff.trigger || (eff.runtime != null && eff.runtime.value == null));
    });
  }, []);

  const filtered = useMemo(() => {
    let list = [...allGenerals, ...authoredGenerals].map(g => ({ original: g, edited: getEditedGeneral(g) })).filter(({ edited }) => {
      if (factionFilter !== '全部' && edited.faction !== factionFilter) return false;
      if (incompleteOnly && !isSkillIncomplete(edited)) return false;
      if (search) {
        const s = search.toLowerCase();
        return edited.name.toLowerCase().includes(s) ||
          edited.faction.includes(s) ||
          edited.skills.some(sk => sk.name.toLowerCase().includes(s));
      }
      return true;
    });

    if (sortBy === 'faction') {
      const order: Record<string, number> = { '魏': 0, '蜀': 1, '吴': 2, '群': 3, '晋': 4 };
      list = [...list].sort((a, b) => order[a.edited.faction] - order[b.edited.faction] || a.edited.name.localeCompare(b.edited.name, 'zh-CN'));
    } else if (sortBy === 'type') {
      list = [...list].sort((a, b) => (a.edited.type === b.edited.type ? 0 : a.edited.type === '武将' ? -1 : 1) || a.edited.name.localeCompare(b.edited.name, 'zh-CN'));
    } else {
      list = [...list].sort((a, b) => a.edited.name.localeCompare(b.edited.name, 'zh-CN'));
    }

    return list;
  }, [search, factionFilter, sortBy, skillEdits, generalEdits, getEditedGeneral, authoredGenerals]);

  // Count how many in the filtered list have edits
  const editedInList = useMemo(() =>
    filtered.filter(({ original }) => !!skillEdits[original.id] || !!generalEdits[original.id]),
    [filtered, skillEdits, generalEdits]
  );

  const handleSelectGeneral = (g: General) => {
    if (multiSelectMode) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(g.id)) next.delete(g.id); else next.add(g.id);
        return next;
      });
      return;
    }
    setSelectedGeneral(g);
    const edited = getEditedGeneral(g);
    setEditingSkills(edited.skills.map(s => ({ name: s.name, description: s.description, tag: s.tag, trigger: s.trigger, effects: s.effects, effectMode: s.effectMode, forced: s.forced })));
    setEditName(edited.name);
    setEditFaction(edited.faction);
    setEditHp(edited.hp);
    setEditMeleeAtk(edited.meleeAtk);
    setEditRangedAtk(edited.rangedAtk);
    const idEdit = generalEdits[g.id]?.identity;
    setEditIdentity(idEdit === undefined ? '__default__' : idEdit === '' ? '__none__' : idEdit);
    setSaved(false);
  };

  const handleSave = () => {
    if (!selectedGeneral) return;
    const identityChoice = editIdentity === '__default__' ? undefined : editIdentity === '__none__' ? '' : editIdentity;
    const skillDecision = updateSkillEdit(selectedGeneral.id, editingSkills);
    const generalDecision = updateGeneralEdit(selectedGeneral.id, {
      name: editName !== selectedGeneral.name ? editName : undefined,
      faction: editFaction !== selectedGeneral.faction ? editFaction : undefined,
      hp: editHp !== selectedGeneral.hp ? editHp : undefined,
      meleeAtk: editMeleeAtk !== selectedGeneral.meleeAtk ? editMeleeAtk : undefined,
      rangedAtk: editRangedAtk !== selectedGeneral.rangedAtk ? editRangedAtk : undefined,
      identity: identityChoice !== selectedGeneral.identity ? identityChoice : undefined,
    });
    // §H3 layer ①: the store already refused the write; report why, in the
    // user's words, instead of showing a green "已保存" over an empty change.
    const denied = [skillDecision, generalDecision].find(d => !d.allowed);
    if (denied && !denied.allowed) {
      setReadOnlyNotice(denialMessage(denied.denial));
      setSaved(false);
      return;
    }
    setReadOnlyNotice('');
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleIdentityPickChange = (value: string) => {
    if (value === '__new__') {
      const raw = window.prompt('新建身份（写入身份注册表）：');
      const name = raw?.trim() ?? '';
      if (name === '') return;
      if (addIdentity(name)) {
        setEditIdentity(name);
        setIdentityNotice(`已新建并选用身份「${name}」`);
      } else {
        setIdentityNotice(`身份「${name}」已存在，请直接选用`);
      }
      return;
    }
    setEditIdentity(value);
  };

  const handleDeleteIdentity = (name: string) => {
    const result = deleteIdentity(name);
    setIdentityNotice(result.ok
      ? `已删除身份「${name}」`
      : `无法删除：身份「${name}」仍被 ${result.referrers.length} 名将领使用（${result.referrers.join('、')}）`);
  };

  const handleRenameIdentity = (name: string) => {
    const raw = window.prompt(`把身份「${name}」改名为：`, name);
    const next = raw?.trim() ?? '';
    if (next === '' || next === name) return;
    setIdentityNotice(renameIdentity(name, next)
      ? `已改名「${name}」→「${next}」，引用该身份的将领编辑已级联更新`
      : `改名失败：「${next}」为空或已存在`);
  };

  const handleAddSkill = () => setEditingSkills(prev => [...prev, { name: '', description: '' }]);
  const handleRemoveSkill = (index: number) => setEditingSkills(prev => prev.filter((_, i) => i !== index));
  const handleSkillChange = (index: number, field: 'name' | 'description', value: string) =>
    setEditingSkills(prev => prev.map((s, i) => i === index ? { ...s, [field]: value } : s));
  const handleSkillTagChange = (index: number, tag: SkillTag | '') =>
    setEditingSkills(prev => prev.map((s, i) => i === index ? { ...s, tag: tag === '' ? undefined : tag as SkillTag } : s));

  /** v2.8.8: 两类拒绝各说各话——系统禁改 vs 用户自己的白锁，绝不并栏（§12-55）。 */
  const denialNotice = (official: string[], locked: string[]) =>
    [
      official.length > 0 ? `${denialMessage('OFFICIAL_READ_ONLY')}｜${official.join('、')}` : '',
      locked.length > 0 ? `${denialMessage('USER_LOCKED')}｜${locked.join('、')}` : '',
    ].filter(Boolean).join('\n');

  const handleImportText = () => {
    const { count, rejected, deniedLock } = importSkillEditsFromText(importText);
    setImportResult(
      `成功导入 ${count} 名将领的技能数据` +
      (rejected.length > 0 ? `；${rejected.length} 名被系统禁改：${rejected.join('、')}` : '') +
      (deniedLock.length > 0 ? `；${deniedLock.length} 名被白锁挡住：${deniedLock.join('、')}` : ''),
    );
    setReadOnlyNotice(denialNotice(rejected, deniedLock));
    setImportText('');
    setTimeout(() => setImportResult(''), 3000);
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase();

    if (ext === 'xlsx' || ext === 'xls') {
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const data = new Uint8Array(evt.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });

          let count = 0;
          let skipped = 0;
          let sheetCount = 0;
          const unreadableCells: string[] = [];
          // v2.8.8: each refused row keeps its OWN denial (system vs white
          // lock) — the report must name the two kinds apart, never merge.
          const rejectedRows: { name: string; denial: EditDenial }[] = [];
          // §H3 layer ①+②: a row lands through the guarded store actions — the
          // old direct `useGameStore.setState` was a second write path that
          // skipped the policy gate entirely.
          type GeneralEditInput = Parameters<typeof updateGeneralEdit>[1];
          const writeRow = (
            general: General,
            skills: Parameters<typeof updateSkillEdit>[1] | null,
            gEdit: GeneralEditInput | null,
          ): boolean => {
            const decisions: ReturnType<typeof updateSkillEdit>[] = [];
            if (skills && skills.length > 0) decisions.push(updateSkillEdit(general.id, skills));
            if (gEdit) decisions.push(updateGeneralEdit(general.id, gEdit));
            const denied = decisions.find(d => !d.allowed);
            if (denied && !denied.allowed) {
              rejectedRows.push({ name: general.name, denial: denied.denial });
              return false;
            }
            return true;
          };

          for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName];
            if (!sheet) continue;
            const rows: (string | number | undefined)[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
            if (rows.length < 2) continue;
            let sheetHasData = false;
            const detailed = isDetailedFormat(rows);

            if (detailed && isRowPerSkillFormat(rows[0])) {
              // New row-per-skill format — two-phase: auto-apply unique + defer ambiguous/missing
              const fullPool = [...allGenerals, ...authoredGenerals];
              const { entries, parseWarnings, unresolved } = parseRowPerSkillSheet(rows, fullPool);
              unreadableCells.push(...parseWarnings);
              
              // Auto-apply uniquely resolved rows immediately
              for (const entry of entries) {
                const ge = entry.gEdit;
                const wrote = writeRow(
                  entry.general,
                  entry.skills.length > 0 ? entry.skills : null,
                  ge.faction || ge.hp || ge.meleeAtk != null || ge.rangedAtk != null ? ge as GeneralEditInput : null,
                );
                if (!wrote) continue;
                count++;
                sheetHasData = true;
              }
              
              // Defer unresolved blocks to pending list
              if (unresolved.length > 0) {
                setPendingImports(prev => [...prev, ...unresolved]);
              }
            } else if (detailed) {
              // Legacy 5-col-per-skill format
              for (const row of rows.slice(1)) {
                if (!row || row.length < 6) continue;
                const parsed = parseLegacyDetailedRow(row);
                if (!parsed || !parsed.general) continue;
                const ge = parsed.gEdit;
                const wrote = writeRow(
                  parsed.general,
                  parsed.skills.length > 0 ? parsed.skills : null,
                  ge.faction || ge.hp || ge.meleeAtk != null || ge.rangedAtk != null ? ge as GeneralEditInput : null,
                );
                if (!wrote) continue;
                count++;
                sheetHasData = true;
              }
            } else {
              // Simple format: name | skill1Cell | skill2Cell | ...
              for (const row of rows) {
                if (!row || row.length < 2) continue;
                const generalName = String(row[0] || '').trim();
                if (!generalName) continue;
                const general = resolveGeneralByNameFaction(generalName);
                if (!general) continue;
                const skills: { name: string; description?: string; tag?: SkillTag }[] = [];
                for (let col = 1; col < row.length; col++) {
                  const cellValue = String(row[col] || '').trim();
                  if (!cellValue) continue;
                  const parsed = parseSkillCell(cellValue);
                  if (parsed) skills.push(parsed);
                }
                if (skills.length > 0) {
                  const origSkills = general.skills;
                  const same = skills.length === origSkills.length && skills.every((s: {name:string;description?:string;tag?:SkillTag}, si: number) => {
                    const o = origSkills[si]; if (!o) return false;
                    return s.name === o.name && (s.description || '') === (o.description || '') && (s.tag || '') === (o.tag || '');
                  });
                  if (same) { skipped++; continue; }
                  if (!writeRow(general, skills, null)) continue;
                  count++; sheetHasData = true;
                }
              }
            }
            if (sheetHasData) sheetCount++;
          }

          setParseWarnings(unreadableCells);
          // Refused rows are named and stay on screen: a silently skipped row
          // is the worst failure shape (§12-46①), and here it would be a
          // permission refusal dressed up as a successful import.
          const deniedOfficial = [...new Set(rejectedRows.filter(r => r.denial === 'OFFICIAL_READ_ONLY').map(r => r.name))];
          const deniedLocked = [...new Set(rejectedRows.filter(r => r.denial === 'USER_LOCKED').map(r => r.name))];
          const refusedTotal = deniedOfficial.length + deniedLocked.length;
          setReadOnlyNotice(refusedTotal > 0
            ? denialNotice(deniedOfficial, deniedLocked) + `｜本次未录入 ${refusedTotal} 名`
            : '');
          setImportResult(`✅ 从 ${sheetCount} 个工作表导入 ${count} 名将领${skipped > 0 ? `，跳过 ${skipped} 名无变化` : ''}${refusedTotal > 0 ? `，拒录 ${refusedTotal} 名` : ''}${unreadableCells.length > 0 ? `；⚠ ${unreadableCells.length} 处没看懂，见下方清单` : ''}`);
          setTimeout(() => setImportResult(''), 5000);
        } catch {
          setImportResult('❌ Excel文件解析失败，请检查格式');
          setTimeout(() => setImportResult(''), 4000);
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = () => setImportText(reader.result as string);
      reader.readAsText(file);
    }
    e.target.value = '';
  };

  // §H8: resolve a pending import block (create new / modify existing / skip)
  const handleResolvePending = (idx: number, action: 'create' | 'modify' | 'skip', targetGeneralId?: string) => {
    const block = pendingImports[idx];
    if (!block) return;

    if (action === 'skip') {
      setPendingImports(prev => prev.filter((_, i) => i !== idx));
      return;
    }

    if (action === 'create') {
      // Create as new authored general (DIY by default, official only in dev mode)
      const result = addAuthoredGeneral({
        name: block.name,
        faction: block.factionText as Faction || '群',
        hp: block.hp || 4,
        skills: block.skills.map(s => ({
          name: s.name,
          description: s.description || '',
          tag: s.tag,
          trigger: s.trigger,
          effects: s.effects,
          effectMode: s.effectMode,
          forced: s.forced,
        })),
      }, developerMode ? 'official' : 'DIY');
      
      if (result.ok) {
        setImportResult(`✅ 已新建将领「${block.name}」`);
        setPendingImports(prev => prev.filter((_, i) => i !== idx));
      } else {
        setImportResult(`❌ 新建失败：${result.reason}`);
      }
      setTimeout(() => setImportResult(''), 5000);
      return;
    }

    if (action === 'modify' && targetGeneralId) {
      // Modify existing general
      type GeneralEditInput = Parameters<typeof updateGeneralEdit>[1];
      const facList: Faction[] = ['魏','蜀','吴','群','晋'];
      const ge: GeneralEditInput = {
        faction: (block.factionText && facList.includes(block.factionText as Faction)) ? block.factionText as Faction : undefined,
        hp: block.hp,
        meleeAtk: block.meleeAtk,
        rangedAtk: block.rangedAtk,
      };
      const decisions: ReturnType<typeof updateSkillEdit>[] = [];
      if (block.skills.length > 0) decisions.push(updateSkillEdit(targetGeneralId, block.skills));
      if (ge.faction || ge.hp || ge.meleeAtk != null || ge.rangedAtk != null) {
        decisions.push(updateGeneralEdit(targetGeneralId, ge));
      }
      const denied = decisions.find(d => !d.allowed);
      if (denied && !denied.allowed) {
        setReadOnlyNotice(`${denialMessage(denied.denial)}｜无法修改「${block.name}」`);
        return;
      }
      setImportResult(`✅ 已更新将领「${block.name}」`);
      setPendingImports(prev => prev.filter((_, i) => i !== idx));
      setTimeout(() => setImportResult(''), 5000);
    }
  };

  // Master button: create all pending as new
  const handleCreateAllPending = () => {
    let successCount = 0;
    let failCount = 0;
    for (const block of pendingImports) {
      const result = addAuthoredGeneral({
        name: block.name,
        faction: block.factionText as Faction || '群',
        hp: block.hp || 4,
        skills: block.skills.map(s => ({
          name: s.name,
          description: s.description || '',
          tag: s.tag,
          trigger: s.trigger,
          effects: s.effects,
          effectMode: s.effectMode,
          forced: s.forced,
        })),
      }, developerMode ? 'official' : 'DIY');
      if (result.ok) successCount++;
      else failCount++;
    }
    if (successCount > 0) {
      setImportResult(`✅ 批量新建 ${successCount} 名将领${failCount > 0 ? `，${failCount} 名失败` : ''}`);
      setPendingImports([]);
    } else {
      setImportResult(`❌ 全部新建失败`);
    }
    setTimeout(() => setImportResult(''), 5000);
  };

  // ── Trigger <-> string and Excel effect-group helpers live in the pure
  // module src/skills/skillExcelFormat.ts (unit-tested there). ──

  const isIncompleteForExport = useCallback((g: General): string => {
    const reasons: string[] = [];
    for (const sk of g.skills) {
      if (!sk.effects || sk.effects.length === 0) {
        if (!sk.description) reasons.push(`${sk.name}:描述空`);
        if (!sk.trigger) reasons.push(`${sk.name}:触发未设`);
      } else {
        for (const eff of sk.effects) {
          if (!eff.description) reasons.push(`${sk.name}/${eff.label||'效果'}:描述空`);
          if (!eff.trigger) reasons.push(`${sk.name}/${eff.label||'效果'}:触发未设`);
          if (eff.runtime && eff.runtime.value == null) reasons.push(`${sk.name}/${eff.label||'效果'}:结构化数值空`);
        }
      }
    }
    return reasons.length > 0 ? reasons.join('; ') : '';
  }, []);

  // ── Export to Excel using ExcelJS ──
  // Format: one row per SKILL (not per general). Each general occupies N rows (N = number of skills).
  // Multi-effect skills: sub-effects occupy additional columns within the skill row.
  // Effect group (7 cols): 标注 | 触发 | 效果类型 | 数值 | 目标 | 描述 | 门槛 — 只有填了效果类型(+数值)的效果
  // 才会被技能编译器接入对局结算（见 skills/skillCompiler.ts）；门槛=该效果的发动条件（可空）。
  // Columns: 将领 | 势力 | 体力 | 近战 | 远程 | 技能名 | 标签 | 强制发动 | 触发时机 | 效果模式 | 技能描述 | 效果1标注 | 效果1触发 | 效果1效果类型 | 效果1数值 | 效果1目标 | 效果1描述 | ... | 设定备注
  const handleExport = useCallback(async () => {
    try {
      const factionOrder: Faction[] = ['魏', '蜀', '吴', '群', '晋'];
      const tagList = ['无', ...allSkillTags].join(',');
      const forcedList = '无,是,否';
      const modeList = '无,全部生效,选择其一';
      const factionList = '魏,蜀,吴,群,晋';
      const triggerList = allTriggerOptionStrings.join(',');

      const wb = new ExcelJS.Workbook();

      for (const faction of factionOrder) {
        const generals = allGenerals.filter(g => getEditedGeneral(g).faction === faction);
        if (generals.length === 0) continue;

        // Find max effects count across all skills
        let maxEffects = 0;
        for (const g of generals) {
          const ed = getEditedGeneral(g);
          for (const sk of ed.skills) {
            if (sk.effects) maxEffects = Math.max(maxEffects, sk.effects.length);
          }
        }

        const ws = wb.addWorksheet(faction);

        // Build header
        const header: string[] = ['将领名称', '势力', '体力', '近战', '远程', '技能名称', '技能标签', '强制发动', '触发时机', '效果模式', '技能描述'];
        for (let e = 0; e < maxEffects; e++) header.push(...effectGroupHeaders(e + 1));
        header.push('设定备注');

        const hdr = ws.addRow(header);
        hdr.eachCell(c => {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2D1B0E' } };
          c.font = { bold: true, color: { argb: 'FFFFD700' } };
        });
        const gateColIdx = header.findIndex(h => h.endsWith('门槛'));
        if (gateColIdx >= 0) {
          hdr.getCell(gateColIdx + 1).note = { texts: [{ text: GATE_SYNTAX_HINT }] };
        }

        // Data rows — one row per skill
        let dataRowIdx = 1; // tracks row number (1-indexed, after header)
        for (const g of generals) {
          const ed = getEditedGeneral(g);
          const incNote = isIncompleteForExport(ed);
          const noteColIdx = header.length;

          for (let si = 0; si < ed.skills.length; si++) {
            const sk = ed.skills[si];
            const row: (string | number)[] = [];

            // General info only on the first skill row
            if (si === 0) {
              row.push(ed.name, ed.faction, ed.hp, ed.meleeAtk, ed.rangedAtk);
            } else {
              row.push('', '', '', '', '');
            }

            // Skill basic info
            row.push(
              sk.name || '无',
              sk.tag || '无',
              sk.forced ? '是' : '无',
              triggerToStr(sk.trigger),
              sk.effectMode === 'choice' ? '选择其一' : sk.effectMode === 'all' ? '全部生效' : '无',
              sk.description || '无',
            );

            // Sub-effects (7-col groups: runtime fields + 发动门槛)
            for (let e = 0; e < maxEffects; e++) {
              row.push(...serializeEffectGroup(sk.effects?.[e], 7));
            }

            // Note (only on first skill row)
            row.push(si === 0 ? (incNote || '✓ 已完成') : '');

            const dataRow = ws.addRow(row);
            dataRowIdx++;

            // Style note cell
            if (si === 0) {
              const noteCell = dataRow.getCell(noteColIdx);
              if (incNote) {
                noteCell.font = { color: { argb: 'FFFF4444' } };
                noteCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3D1111' } };
              } else {
                noteCell.font = { color: { argb: 'FF44CC44' } };
              }
            }

            // Dropdowns
            const r = dataRowIdx;
            ws.getCell(r, 2).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${factionList}"`] };
            ws.getCell(r, 7).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${tagList}"`] };
            ws.getCell(r, 8).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${forcedList}"`] };
            ws.getCell(r, 9).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${triggerList}"`] };
            ws.getCell(r, 10).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${modeList}"`] };
            for (let ei = 0; ei < maxEffects; ei++) {
              // v3 group layout (1-based): 标注=12+7n | 触发=13+7n | 类型=14+7n | 数值=15+7n | 目标=16+7n | 描述=17+7n | 门槛=18+7n
              ws.getCell(r, 13 + ei * 7).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${triggerList}"`] };
              ws.getCell(r, 14 + ei * 7).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${RUNTIME_TYPE_LIST}"`] };
              ws.getCell(r, 16 + ei * 7).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${RUNTIME_TARGET_LIST}"`] };
            }
          }
        }

        // Column widths
        const widths = [14, 6, 5, 5, 5, 14, 10, 8, 20, 10, 40];
        for (let e = 0; e < maxEffects; e++) widths.push(10, 20, 12, 8, 12, 40, 26);
        widths.push(30);
        widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
      }

      const buf = await wb.xlsx.writeBuffer();
      saveAs(new Blob([buf]), '将领数据_' + new Date().toISOString().slice(0, 10) + '.xlsx');
      setImportResult('✅ 已导出Excel文件');
      setTimeout(() => setImportResult(''), 3000);
    } catch (err) {
      console.error('Export error:', err);
      setImportResult('❌ 导出失败: ' + String(err));
      setTimeout(() => setImportResult(''), 5000);
    }
  }, [getEditedGeneral, isIncompleteForExport]);

  // Multi-select actions
  const toggleMultiSelect = () => {
    setMultiSelectMode(prev => !prev);
    setSelectedIds(new Set());
    if (!multiSelectMode) setSelectedGeneral(null);
  };

  const selectAllEdited = () => {
    const ids = new Set(editedInList.map(({ original }) => original.id));
    setSelectedIds(ids);
  };

  const nameByIds = (ids: string[]) => ids.map(id =>
    [...allGenerals, ...authoredGenerals].find(g => g.id === id)?.name ?? id);

  const handleBatchDelete = () => {
    const { applied, rejected, deniedLock } = batchDeleteEdits(Array.from(selectedIds));
    setSelectedIds(new Set());
    setShowDeleteConfirm(false);
    setReadOnlyNotice(denialNotice(nameByIds(rejected), nameByIds(deniedLock)));
    setImportResult(`✅ 已清除 ${applied.length} 名将领的编辑数据${rejected.length + deniedLock.length > 0 ? `；${rejected.length + deniedLock.length} 名无权清除，数据原样保留` : ''}`);
    setTimeout(() => setImportResult(''), 3000);
  };

  const handleBatchDisable = (disabled: boolean) => {
    const { applied, rejected, deniedLock } = batchToggleDisabled(Array.from(selectedIds), disabled);
    setSelectedIds(new Set());
    setReadOnlyNotice(denialNotice(nameByIds(rejected), nameByIds(deniedLock)));
    setImportResult(`${disabled ? '🚫 已禁用' : '✅ 已启用'} ${applied.length} 名${rejected.length + deniedLock.length > 0 ? `；${rejected.length + deniedLock.length} 名无权改动，保持原样` : ''}`);
    setTimeout(() => setImportResult(''), 3000);
  };

  // v2.8.8 N2 (§H8): batch 自选锁定/解锁 — the toggle itself is gated by the
  // system layer only, so a non-developer's selection of repository officials
  // is refused and named (the gold lock is §H3's, not a switch to flip).
  const handleBatchLock = (locked: boolean) => {
    const { applied, rejected } = batchToggleLocked(Array.from(selectedIds), locked);
    setSelectedIds(new Set());
    setReadOnlyNotice(rejected.length > 0
      ? `官方将领的金色锁由系统判定（开发者模式外必锁），不能手动加/解白锁｜${nameByIds(rejected).join('、')}`
      : '');
    setImportResult(`${locked ? '🔒 已锁定' : '🔓 已解锁'} ${applied.length} 名${rejected.length > 0 ? `；${rejected.length} 名不可${locked ? '加锁' : '解锁'}` : ''}`);
    setTimeout(() => setImportResult(''), 3000);
  };

  // v2.8.0: 撞键显式提示 — old saves may already host same-key generals;
  // we surface them, never silently rewrite (契约表 格12).
  const identityConflicts = useMemo(
    () => findIdentityConflicts([...allGenerals, ...authoredGenerals].map(g => getEditedGeneral(g))),
    [getEditedGeneral, authoredGenerals],
  );
  const identityReferrers = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const g of [...allGenerals, ...authoredGenerals]) {
      const ed = getEditedGeneral(g);
      const name = ed.identity !== undefined ? ed.identity : undefined;
      if (name !== undefined && name.trim() !== '') map.set(name.trim(), [...(map.get(name.trim()) ?? []), ed.name]);
    }
    return map;
  }, [getEditedGeneral, authoredGenerals]);

  const AUTHORING_REFUSAL_TEXT: Record<string, string> = {
    NAME_REQUIRED: '名字不能为空',
    HP_INVALID: '体力必须是大于 0 的数字',
    ID_SOURCE_UNAVAILABLE: '本机无法生成编号（浏览器未提供随机编号源）',
  };

  const handleCreateGeneral = () => {
    const identity = createIdentity === '__default__'
      ? undefined
      : createIdentity === '__none__' ? '' : createIdentity;
    const result = addAuthoredGeneral(
      { name: createName, faction: createFaction, hp: createHp, identity },
      createSource,
    );
    if (!result.ok) {
      setCreateResult(`❌ 未创建：${AUTHORING_REFUSAL_TEXT[result.reason] ?? result.reason}`);
      return;
    }
    const g = result.general;
    const layer = isRepositoryOfficial(g) ? '仓库官方' : sourceOf(g) === 'official' ? '官方本地草稿' : '玩家自制';
    setCreateResult(`✅ 已新建「${g.name}·${g.faction}」（${layer}，编号 ${g.id}，身份 ${g.identity ?? '未填'}）`);
    setCreateName('');
  };

  // v2.8.8: removeAuthoredGeneral no longer returns a boolean — branch on
  // `.ok` explicitly (a truthy `{ok:false}` object once fooled this handler
  // into reporting success on a refused delete).
  const handleRemoveAuthored = (g: General) => {
    const result = removeAuthoredGeneral(g.id);
    if (result.ok) {
      setCreateResult(`🗑 已删除自建将领「${g.name}」`);
      return;
    }
    if (result.denial) {
      setCreateResult(`❌ 未删除：${denialMessage(result.denial)}`);
      return;
    }
    setCreateResult(`❌ 未删除：${g.name} 不是本机自建的将领`);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur-sm text-white">
      <div className="mx-4 w-full max-w-6xl h-[90vh] rounded-2xl border border-purple-600/40 bg-gradient-to-b from-gray-900 via-gray-900 to-black shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-purple-800/30 bg-purple-900/10 flex-shrink-0">
          <h2 className="text-xl font-black text-purple-300">🛠️ 将领编辑器</h2>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowIdentities(v => !v)}
              className={`px-3 py-1.5 rounded-lg border text-sm font-bold transition-all ${showIdentities ? 'bg-cyan-700/60 border-cyan-500/40 text-cyan-100' : 'bg-purple-800/40 border-purple-700/30 text-purple-200 hover:bg-purple-700/40'}`}>
              🪪 身份管理
            </button>
            <button onClick={() => setShowCreate(v => !v)}
              className={`px-3 py-1.5 rounded-lg border text-sm font-bold transition-all ${showCreate ? 'bg-emerald-700/60 border-emerald-500/40 text-emerald-100' : 'bg-purple-800/40 border-purple-700/30 text-purple-200 hover:bg-purple-700/40'}`}>
              ➕ 新建将领
            </button>
            <button onClick={() => setShowImport(!showImport)}
              className={`px-3 py-1.5 rounded-lg border text-sm font-bold transition-all ${showImport ? 'bg-purple-700/60 border-purple-500/40 text-purple-100' : 'bg-purple-800/40 border-purple-700/30 text-purple-200 hover:bg-purple-700/40'}`}>
              📄 导入
            </button>
            <button onClick={handleExport}
              className="px-3 py-1.5 rounded-lg border bg-green-800/40 border-green-700/30 text-green-200 text-sm font-bold hover:bg-green-700/40 transition-all active:scale-95">
              📤 导出Excel
            </button>
            {importResult && !showImport && <span className={`text-xs font-bold ${importResult.includes('❌') ? 'text-red-400' : 'text-green-400'}`}>{importResult}</span>}
            <button onClick={toggleMultiSelect}
              className={`px-3 py-1.5 rounded-lg border text-sm font-bold transition-all ${multiSelectMode ? 'bg-red-700/60 border-red-500/40 text-red-100' : 'bg-purple-800/40 border-purple-700/30 text-purple-200 hover:bg-purple-700/40'}`}>
              {multiSelectMode ? '✕ 退出多选' : '🗑️ 批量删除'}
            </button>
            <button onClick={onClose}
              className="px-4 py-1.5 rounded-lg bg-gray-700 text-white text-sm font-bold hover:bg-gray-600">
              关闭
            </button>
          </div>
        </div>

        {/* v2.8.8 N2 (§H8): 两把锁一眼可分——金锁是系统禁改的可视化（关不掉），
            白锁是玩家自己点的保护（随时可解）。非开发者第一次进来要知道自己
            能碰什么。 */}
        {!developerMode && (
          <div className="px-6 py-2 border-b border-purple-800/30 bg-purple-900/20 text-[11px] leading-relaxed text-purple-200/80 flex-shrink-0">
            🔑 金色锁＝官方将领，不开开发者模式改不了（系统判定，点不开）；白色锁＝你自己锁的卡，锁住期间编辑/删除/导入都不落档，随时能解。自己新建的将领随便改。
          </div>
        )}

        {/* Authoring panel (v2.8.5 新建将领, §H1/§H2) */}
        {showCreate && (
          <div className="px-6 py-3 border-b border-emerald-800/30 bg-emerald-900/10 space-y-2 flex-shrink-0">
            <div className="flex flex-wrap items-center gap-2">
              <input type="text" value={createName} onChange={e => setCreateName(e.target.value)}
                placeholder="名字（允许与已有将领同名）"
                className="w-44 px-2 py-1 rounded bg-gray-800 border border-gray-700 text-sm" />
              <select value={createFaction} onChange={e => setCreateFaction(e.target.value as Faction)}
                className="px-2 py-1 rounded bg-gray-800 border border-gray-700 text-sm">
                {factionOptions.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
              <input type="number" min={1} value={createHp} onChange={e => setCreateHp(Number(e.target.value))}
                className="w-16 px-2 py-1 rounded bg-gray-800 border border-gray-700 text-sm" title="体力" />
              <select value={createIdentity} onChange={e => setCreateIdentity(e.target.value)}
                className="px-2 py-1 rounded bg-gray-800 border border-gray-700 text-sm" title="身份">
                <option value="__default__">身份：默认同名字</option>
                <option value="__none__">身份：无（不参与身份锁）</option>
                {identityRegistry.map(name => <option key={name} value={name}>身份：{name}</option>)}
              </select>
              <select value={createSource} onChange={e => setCreateSource(e.target.value as GeneralSource)}
                className="px-2 py-1 rounded bg-gray-800 border border-gray-700 text-sm" title="归属">
                <option value="DIY">{sourceLabels.DIY}</option>
                {developerMode && <option value="official">{sourceLabels.official}（本地草稿）</option>}
              </select>
              <button onClick={handleCreateGeneral}
                className="px-3 py-1 rounded bg-emerald-700 text-white text-sm font-bold hover:bg-emerald-600">
                创建
              </button>
            </div>
            <p className="text-[11px] text-emerald-200/70">
              创建即定死：编号与归属之后不可改（改名/改血量/导出再导入都不重新发号）。身份可以之后在编辑面板里改。
              新建的将进入本地征召池；AI 标准自动对局仍只用仓库官方池，要成为仓库官方须人工合进 generals.ts。
            </p>
            {createResult && <p className="text-xs font-bold text-emerald-200">{createResult}</p>}
          </div>
        )}

        {/* Identity registry panel (v2.8.0 身份管理) */}
        {showIdentities && (
          <div className="px-6 py-3 border-b border-cyan-800/30 bg-cyan-900/10 space-y-2 flex-shrink-0 max-h-[30vh] overflow-y-auto">
            <div className="flex items-center gap-2">
              <input type="text" value={newIdentityName} onChange={e => setNewIdentityName(e.target.value)}
                placeholder="新身份名（如：关羽）"
                className="flex-1 px-2 py-1 rounded-lg bg-black/50 border border-cyan-700/30 text-cyan-100 text-sm focus:outline-none focus:border-cyan-500" />
              <button onClick={() => {
                  if (addIdentity(newIdentityName)) { setIdentityNotice(`已新建身份「${newIdentityName.trim()}」`); setNewIdentityName(''); }
                  else setIdentityNotice('新建失败：名称为空或已存在');
                }} disabled={!newIdentityName.trim()}
                className={`px-3 py-1 rounded-lg text-sm font-bold ${newIdentityName.trim() ? 'bg-cyan-700 text-white hover:bg-cyan-600' : 'bg-gray-800 text-gray-500 cursor-not-allowed'}`}>
                ＋ 新建
              </button>
            </div>
            <p className="text-[10px] text-cyan-300/50">
              官方将领的默认身份由名字派生、不可删除；注册表身份可改名（引用级联）与删除（被引用时拒删）。
            </p>
            {identityRegistry.length === 0 && <p className="text-xs text-gray-500">（注册表为空）</p>}
            {identityRegistry.map(name => {
              const referrers = identityReferrers.get(name) ?? [];
              return (
                <div key={name} className="flex items-center gap-2 text-sm">
                  <span className="w-40 truncate text-cyan-100 font-bold">{name}</span>
                  <span className="flex-1 text-[10px] text-cyan-300/60 truncate">
                    {referrers.length > 0 ? `被 ${referrers.length} 名编辑将领使用：${referrers.join('、')}` : '暂无引用'}
                  </span>
                  <button onClick={() => handleRenameIdentity(name)}
                    className="px-2 py-0.5 rounded bg-cyan-800/40 text-cyan-200 text-[10px] font-bold hover:bg-cyan-700/40">✏️ 改名</button>
                  <button onClick={() => handleDeleteIdentity(name)}
                    className="px-2 py-0.5 rounded bg-red-900/40 text-red-200 text-[10px] font-bold hover:bg-red-800/40">🗑 删除</button>
                </div>
              );
            })}
            {identityConflicts.length > 0 && (
              <div className="rounded-lg border border-amber-600/40 bg-amber-900/20 p-2 text-[11px] text-amber-200 space-y-0.5">
                <p className="font-bold">⚠ 同身份同势力撞键（不会静默改写，仅供知悉）：</p>
                {identityConflicts.map(c => (
                  <p key={c.key}>{describeLockKey(c.key)}：{c.names.join('、')}</p>
                ))}
              </div>
            )}
            {identityNotice && <p className="text-xs font-bold text-cyan-300">{identityNotice}</p>}
          </div>
        )}

        {/* Import panel */}
        {showImport && (
          <div className="px-6 py-3 border-b border-purple-800/20 bg-purple-900/5 flex-shrink-0">
            <div className="mb-2 rounded-lg bg-black/30 border border-purple-800/20 p-3 text-xs text-purple-300/70 space-y-1">
              <p className="font-bold text-green-300">📤 导出格式（每行一个技能，可直接再导入）：</p>
              <p>将领 | 势力 | 体力 | 近战 | 远程 | 技能名 | 标签 | 强制发动 | 触发时机 | 效果模式 | 技能描述 | 效果1标注 | 效果1触发 | 效果1类型 | 效果1数值 | 效果1目标 | 效果1描述 | 效果1门槛 | ...</p>
              <p>同一将领的多个技能占多行，将领属性仅第一行填写。<span className="text-green-400">含下拉菜单和设定备注。</span>旧版3列/6列效果组的文件仍兼容导入（旧文件没有门槛栏，导入后该效果按「无门槛」处理）。</p>
              <p><span className="text-emerald-300">⚡ 结构化效果：</span>效果组中填写<span className="text-emerald-300">效果类型（摸牌/伤害）+ 数值</span>后，该效果才会在对局中被引擎真实结算；不填＝纯描述。</p>
              <p className="text-amber-300">🚪 门槛栏（每个效果一栏，可留空）：{GATE_SYNTAX_HINT}</p>
              <p className="font-bold text-purple-200 mt-1.5">📋 简单格式（也支持导入）：</p>
              <p>将领名称 | <span className="text-amber-300">技能名：描述</span> | <span className="text-amber-300">技能名：描述</span> | ...</p>
            </div>
            <div className="flex gap-2 mb-2">
              <textarea
                value={importText}
                onChange={e => setImportText(e.target.value)}
                placeholder={'文本导入：曹操|奸雄,护驾|描述1,描述2|锁定技,'}
                className="flex-1 h-14 px-3 py-2 rounded-lg bg-black/50 border border-purple-700/30 text-purple-100 text-sm resize-none focus:outline-none focus:border-purple-500"
              />
            </div>
            <div className="flex gap-2 items-center flex-wrap">
              <label className="px-3 py-1.5 rounded-lg bg-green-900/40 border border-green-700/30 text-green-300 text-sm font-bold cursor-pointer hover:bg-green-800/40 transition-all">
                📂 导入 Excel (.xlsx)
                <input type="file" accept=".xlsx,.xls" onChange={handleImportFile} className="hidden" />
              </label>
              <label className="px-3 py-1.5 rounded-lg bg-purple-900/30 border border-purple-700/30 text-purple-300 text-sm font-bold cursor-pointer hover:bg-purple-800/40 transition-all">
                📂 导入文本文件
                <input type="file" accept=".txt,.csv,.md" onChange={handleImportFile} className="hidden" />
              </label>
              <button onClick={handleImportText} disabled={!importText.trim()}
                className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${importText.trim() ? 'bg-purple-700 text-white hover:bg-purple-600' : 'bg-gray-800 text-gray-500 cursor-not-allowed'}`}>
                导入文本
              </button>
              {importResult && <span className={`text-sm font-bold ${importResult.includes('❌') ? 'text-red-400' : 'text-green-400'}`}>{importResult}</span>}
            </div>
          </div>
        )}

        {/* 没看懂的格子（门槛/触发）：常驻清单，不自动消失——这些内容确实没有生效 */}
        {parseWarnings.length > 0 && (
          <div className="px-6 py-2 border-b border-amber-700/40 bg-amber-950/25 flex-shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-amber-300">⚠ 有 {parseWarnings.length} 处没看懂，这些内容没有被记下来（技能会照「没写」那样发动）：</span>
              <div className="flex-1" />
              <button onClick={() => setParseWarnings([])}
                className="text-[10px] px-1.5 py-0.5 rounded text-amber-400/70 hover:text-amber-200 hover:bg-amber-900/30">知道了</button>
            </div>
            <p className="text-[10px] text-amber-200/60 mt-1 italic">门槛的认法：{GATE_SYNTAX_HINT}</p>
            <ul className="mt-1 space-y-0.5 max-h-28 overflow-y-auto">
              {parseWarnings.map((w, i) => <li key={i} className="text-[10px] text-amber-200">· {w}</li>)}
            </ul>
          </div>
        )}

        {/* §H8: Pending import blocks — unresolved generals awaiting user choice */}
        {pendingImports.length > 0 && (
          <div className="px-6 py-3 border-b border-blue-700/40 bg-blue-950/25 flex-shrink-0">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-bold text-blue-300">📋 待处理导入（{pendingImports.length} 名将领无法自动识别）</span>
              <div className="flex-1" />
              <button onClick={handleCreateAllPending}
                className="px-3 py-1 rounded-lg bg-green-700/40 text-green-200 text-[10px] font-bold hover:bg-green-600/40 transition-all">
                ✅ 全部按新建
              </button>
              <button onClick={() => setPendingImports([])}
                className="text-[10px] px-1.5 py-0.5 rounded text-blue-400/70 hover:text-blue-200 hover:bg-blue-900/30">清空</button>
            </div>
            <p className="text-[10px] text-blue-200/60 mb-2">每行可选择：① 新建为 DIY 将领 ② 挂到现有将领上修改 ③ 跳过不导入</p>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {pendingImports.map((block, idx) => (
                <div key={idx} className="bg-black/30 border border-blue-700/30 rounded p-2 text-[10px]">
                  <div className="flex items-start gap-2 mb-1">
                    <div className="flex-1">
                      <span className="font-bold text-blue-100">{block.name}</span>
                      {block.factionText && <span className="text-blue-300/70 ml-2">势力：{block.factionText}</span>}
                      {block.hp && <span className="text-blue-300/70 ml-2">体力：{block.hp}</span>}
                      <span className="text-blue-400/50 ml-2">行 {block.rowNumbers}</span>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => handleResolvePending(idx, 'create')}
                        className="px-2 py-0.5 rounded bg-green-700/40 text-green-200 hover:bg-green-600/40 text-[9px]">
                        新建
                      </button>
                      {block.candidates.length > 0 && (
                        <select
                          onChange={e => handleResolvePending(idx, 'modify', e.target.value)}
                          defaultValue=""
                          className="px-1 py-0.5 rounded bg-purple-700/40 text-purple-200 text-[9px] cursor-pointer">
                          <option value="">挂到…</option>
                          {block.candidates.map(c => (
                            <option key={c.id} value={c.id}>{c.name}（{c.faction}）</option>
                          ))}
                        </select>
                      )}
                      <button onClick={() => handleResolvePending(idx, 'skip')}
                        className="px-2 py-0.5 rounded bg-gray-700/40 text-gray-300 hover:bg-gray-600/40 text-[9px]">
                        跳过
                      </button>
                    </div>
                  </div>
                  {block.resolution === 'missing' && (
                    <p className="text-amber-300/70">原因：找不到名为「{block.name}」的将领</p>
                  )}
                  {block.resolution === 'ambiguous' && block.candidates.length === 0 && (
                    <p className="text-amber-300/70">原因：同名将领太多，无法确定是哪一个</p>
                  )}
                  {block.skills.length > 0 && (
                    <p className="text-blue-200/50 mt-1">包含 {block.skills.length} 个技能：{block.skills.map(s => s.name).join('、')}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Multi-select toolbar */}
        {multiSelectMode && (
          <div className="px-6 py-2 border-b border-red-800/20 bg-red-900/10 flex items-center gap-2 flex-wrap flex-shrink-0">
            <span className="text-sm text-red-300">
              已选 <strong className="text-red-100">{selectedIds.size}</strong>
            </span>
            <div className="flex-1" />
            <button onClick={selectAllEdited} disabled={editedInList.length === 0}
              className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${editedInList.length > 0 ? 'bg-amber-800/40 text-amber-200 hover:bg-amber-700/40' : 'bg-gray-800 text-gray-500 cursor-not-allowed'}`}>
              全选已编辑
            </button>
            <button onClick={() => { const allIds = new Set(filtered.map(x => x.original.id)); setSelectedIds(allIds); }}
              className="px-2 py-1 rounded-lg bg-purple-800/40 text-purple-200 text-[10px] font-bold hover:bg-purple-700/40">
              全选当前
            </button>
            <button onClick={() => setSelectedIds(new Set())} disabled={selectedIds.size === 0}
              className="px-2 py-1 rounded-lg bg-gray-700/40 text-gray-300 text-[10px] font-bold hover:bg-gray-600/40 transition-all">
              清空
            </button>
            <div className="w-px h-5 bg-gray-700/40" />
            <button onClick={() => handleBatchDisable(true)}
              disabled={selectedIds.size === 0}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${selectedIds.size > 0 ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' : 'bg-gray-800 text-gray-500 cursor-not-allowed'}`}>
              🚫 禁用 ({selectedIds.size})
            </button>
            <button onClick={() => handleBatchDisable(false)}
              disabled={selectedIds.size === 0}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${selectedIds.size > 0 ? 'bg-green-800 text-green-200 hover:bg-green-700' : 'bg-gray-800 text-gray-500 cursor-not-allowed'}`}>
              ✅ 启用 ({selectedIds.size})
            </button>
            <button onClick={() => handleBatchLock(true)}
              disabled={selectedIds.size === 0}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${selectedIds.size > 0 ? 'bg-sky-800 text-sky-100 hover:bg-sky-700' : 'bg-gray-800 text-gray-500 cursor-not-allowed'}`}>
              🔒 锁定 ({selectedIds.size})
            </button>
            <button onClick={() => handleBatchLock(false)}
              disabled={selectedIds.size === 0}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${selectedIds.size > 0 ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' : 'bg-gray-800 text-gray-500 cursor-not-allowed'}`}>
              🔓 解锁 ({selectedIds.size})
            </button>
            <button onClick={() => setShowDeleteConfirm(true)} disabled={selectedIds.size === 0}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${selectedIds.size > 0 ? 'bg-red-700 text-white hover:bg-red-600' : 'bg-gray-800 text-gray-500 cursor-not-allowed'}`}>
              🗑️ 删除编辑 ({selectedIds.size})
            </button>
          </div>
        )}

        {/* v2.8.8: 批量/单行的拒绝发生在多选或未选中状态时，右侧面板没有
            落脚点——常驻提示条兜住，绝不静默吞（§12-46①）。 */}
        {readOnlyNotice && (multiSelectMode || !selectedGeneral) && (
          <div className="px-6 py-2 border-b border-red-800/30 bg-red-950/30 flex-shrink-0">
            <div className="flex items-start gap-2">
              <p className="flex-1 text-xs font-bold text-red-300 whitespace-pre-wrap">{readOnlyNotice}</p>
              <button onClick={() => setReadOnlyNotice('')}
                className="text-[10px] px-1.5 py-0.5 rounded text-red-400/70 hover:text-red-200 hover:bg-red-900/30">知道了</button>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* Left: General list */}
          <div className="w-1/3 border-r border-purple-800/20 flex flex-col">
            <div className="p-3 border-b border-purple-800/20 space-y-2 flex-shrink-0">
              <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="搜索将领名或技能..."
                className="w-full px-3 py-1.5 rounded-lg bg-black/50 border border-purple-700/30 text-purple-100 text-sm placeholder-purple-700/40 focus:outline-none focus:border-purple-500" />
              <div className="flex gap-1 flex-wrap">
                {factions.map(f => (
                  <button key={f} onClick={() => setFactionFilter(f)}
                    className={`px-2 py-1 rounded text-[11px] font-bold transition-all ${factionFilter === f ? 'text-white' : 'bg-black/30 text-gray-500 hover:text-white'}`}
                    style={factionFilter === f ? { backgroundColor: f === '全部' ? '#7c3aed' : factionColors[f] } : {}}>
                    {f}
                  </button>
                ))}
              </div>
              <div className="flex gap-1">
                {([['faction', '势力'], ['name', '名字'], ['type', '类型']] as [SortBy, string][]).map(([k, l]) => (
                  <button key={k} onClick={() => setSortBy(k)}
                    className={`px-2 py-0.5 rounded text-[11px] font-bold ${sortBy === k ? 'bg-purple-700 text-white' : 'bg-black/30 text-gray-500'}`}>
                    {l}
                  </button>
                ))}
                <div className="flex-1" />
                <button onClick={() => setIncompleteOnly(v => !v)}
                  className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${incompleteOnly ? 'bg-amber-600 text-white' : 'bg-black/30 text-gray-500 hover:text-gray-300'}`}>
                  ⚠ 未完成
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
              {filtered.map(({ original, edited }) => {
                const isSelected = !multiSelectMode && selectedGeneral?.id === original.id;
                const isChecked = multiSelectMode && selectedIds.has(original.id);
                const hasEdits = !!skillEdits[original.id] || !!generalEdits[original.id];
                // §H3 layer ③: an overlay can exist in the save file and still
                // be blocked from applying — the row must say which of the two.
                // v2.8.8 N2 (§H8): the two locks are TWO independent readings —
                // gold = §H3 derived per row (never stored), white = the local
                // lock set. 一眼可分: different colour, different title.
                const goldLocked = !mayModifyGeneral(original.id, { developerMode }).allowed;
                const whiteLocked = lockedGenerals.has(original.id);
                const blockedHere = goldLocked && blocked.some(b => b.id === original.id);
                const isDisabled = liveDisabled.has(original.id);
                const incomplete = isSkillIncomplete(edited);
                return (
                  <div key={original.id} className={`flex items-center gap-1 rounded-lg transition-all ${
                    isSelected ? 'bg-purple-900/40 border border-purple-500/40' :
                    isChecked ? 'bg-red-900/30 border border-red-500/40' :
                    'hover:bg-purple-900/20 border border-transparent'
                  } ${isDisabled ? 'opacity-40' : ''}`}>
                    <button
                      onClick={() => handleSelectGeneral(original)}
                      className="flex-1 text-left px-2 py-1.5 flex items-center gap-2 min-w-0">
                      {multiSelectMode && (
                        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                          isChecked ? 'border-red-400 bg-red-500' : 'border-purple-600'
                        }`}>
                          {isChecked && <span className="text-[8px] text-white font-black">✓</span>}
                        </div>
                      )}
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: factionColors[edited.faction] }} />
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-bold truncate ${isDisabled ? 'text-gray-500 line-through' : 'text-amber-100'}`}>
                          {edited.name}
                          {!isRepositoryOfficial(original) && (
                            <span className="ml-1 text-[9px] px-1 rounded bg-emerald-800/60 text-emerald-200" title={`本机自建，编号 ${original.id} 创建后不可改`}>
                              {sourceOf(original) === 'official' ? '官方草稿' : '自建'}
                            </span>
                          )}
                        </p>
                        <p className="text-[10px] text-purple-400/60 truncate">
                          {edited.skills.map(s => s.tag ? `${s.name}<${s.tag}>` : s.name).join('、')}
                        </p>
                      </div>
                      {incomplete && !multiSelectMode && <span className="text-[10px] text-amber-400 flex-shrink-0" title="技能设定未完成">⚠</span>}
                    {goldLocked && !multiSelectMode && <span className="text-[10px] text-yellow-400 flex-shrink-0" title="金锁（系统判定）：官方将领在开发者模式外禁改，不可手动解除">🔒</span>}
                    {!goldLocked && whiteLocked && !multiSelectMode && <span className="text-[10px] text-sky-200 flex-shrink-0" title="白锁（你手动锁定）：编辑/删除/覆盖都不会被记录，解锁后恢复">🔒</span>}
                    {hasEdits && !multiSelectMode && (blockedHere
                      ? <span className="text-[10px] text-red-400 flex-shrink-0" title="改动仍在存档里，但对局已停止应用（开发者模式外不改官方将）">🚫</span>
                      : <span className="text-[10px] text-green-400 flex-shrink-0">✏️</span>)}
                    </button>
                    {/* v2.8.8 N2: the white-lock switch — only offered where the
                        SYSTEM layer allows a toggle (金锁卡不出现此按钮；白锁永远
                        可解，锁不会把自己锁死). */}
                    {!multiSelectMode && !goldLocked && (
                      <button onClick={(e) => {
                        e.stopPropagation();
                        const decision = toggleGeneralLock(original.id);
                        if (!decision.allowed) setReadOnlyNotice(denialMessage(decision.denial));
                      }}
                        title={whiteLocked ? '解锁（白锁）：恢复允许编辑/删除/覆盖' : '锁定（白锁）：编辑/删除/覆盖将不会被记录'}
                        className={`flex-shrink-0 px-1.5 py-0.5 rounded border text-[10px] font-bold transition-all mr-1 ${whiteLocked ? 'bg-sky-800/50 border-sky-500/40 text-sky-100 hover:bg-sky-700/50' : 'bg-gray-800/60 border-gray-600/40 text-gray-300 hover:bg-gray-700/60'}`}>
                        {whiteLocked ? '🔓' : '🔒'}
                      </button>
                    )}
                    {!multiSelectMode && (
                      <button onClick={(e) => {
                        e.stopPropagation();
                        const decision = toggleDisabledGeneral(original.id);
                        if (!decision.allowed) setReadOnlyNotice(denialMessage(decision.denial));
                        else setReadOnlyNotice('');
                      }}
                        title={isDisabled ? '启用该将领' : '禁用该将领'}
                        className={`flex-shrink-0 w-7 h-4 rounded-full relative transition-all mr-1 ${isDisabled ? 'bg-gray-700' : 'bg-green-600'}`}>
                        <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${isDisabled ? 'left-0.5' : 'left-3.5'}`} />
                      </button>
                    )}
                    {!multiSelectMode && !isRepositoryOfficial(original) && (
                      <button onClick={(e) => { e.stopPropagation(); handleRemoveAuthored(original); }}
                        title="删除这张本机自建的将领（仓库内的将领不可删除）"
                        className="flex-shrink-0 px-1.5 py-0.5 rounded bg-red-900/40 border border-red-800/40 text-red-200 text-[10px] font-bold hover:bg-red-800/50 mr-1">
                        🗑
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: Editor */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {selectedGeneral && !multiSelectMode ? (
              <>
                <div className="p-4 border-b border-purple-800/20 flex-shrink-0">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-4 h-4 rounded-full" style={{ backgroundColor: factionColors[editFaction] }} />
                    <h3 className="text-2xl font-black text-amber-100">{editName}</h3>
                    <span className="text-sm text-purple-400/60">{editFaction} · {editHp >= 4 ? '武将' : '文将'}</span>
                  </div>
                  <div className="grid grid-cols-6 gap-3">
                    <div>
                      <label className="text-[10px] text-purple-400/60 mb-1 block">名称</label>
                      <input type="text" value={editName} onChange={e => setEditName(e.target.value)}
                        className="w-full px-2 py-1.5 rounded-lg bg-black/50 border border-purple-700/30 text-purple-100 text-sm focus:outline-none focus:border-purple-500" />
                    </div>
                    <div>
                      <label className="text-[10px] text-purple-400/60 mb-1 block">身份</label>
                      <select value={editIdentity} onChange={e => handleIdentityPickChange(e.target.value)}
                        className="w-full px-2 py-1.5 rounded-lg bg-black/50 border border-cyan-700/40 text-cyan-100 text-sm focus:outline-none focus:border-cyan-500">
                        <option value="__default__">默认＝本名</option>
                        <option value="__none__">无身份·不锁</option>
                        {identityRegistry.map(name => <option key={name} value={name}>{name}</option>)}
                        <option value="__new__">＋ 新建身份…</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-purple-400/60 mb-1 block">势力</label>
                      <select value={editFaction} onChange={e => setEditFaction(e.target.value as Faction)}
                        className="w-full px-2 py-1.5 rounded-lg bg-black/50 border border-purple-700/30 text-purple-100 text-sm focus:outline-none focus:border-purple-500">
                        {factionOptions.map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-purple-400/60 mb-1 block">体力 ❤️</label>
                      <input type="number" min={1} max={10} value={editHp} onChange={e => setEditHp(parseInt(e.target.value) || 1)}
                        className="w-full px-2 py-1.5 rounded-lg bg-black/50 border border-purple-700/30 text-purple-100 text-sm focus:outline-none focus:border-purple-500" />
                    </div>
                    <div>
                      <label className="text-[10px] text-purple-400/60 mb-1 block">近战 ⚔️</label>
                      <input type="number" min={0} max={10} value={editMeleeAtk} onChange={e => setEditMeleeAtk(parseInt(e.target.value) || 0)}
                        className="w-full px-2 py-1.5 rounded-lg bg-black/50 border border-purple-700/30 text-purple-100 text-sm focus:outline-none focus:border-purple-500" />
                    </div>
                    <div>
                      <label className="text-[10px] text-purple-400/60 mb-1 block">远程 🏹</label>
                      <input type="number" min={0} max={10} value={editRangedAtk} onChange={e => setEditRangedAtk(parseInt(e.target.value) || 0)}
                        className="w-full px-2 py-1.5 rounded-lg bg-black/50 border border-purple-700/30 text-purple-100 text-sm focus:outline-none focus:border-purple-500" />
                    </div>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  <h4 className="text-xs font-bold text-purple-400/80 uppercase tracking-wider">技能列表</h4>
                  {editingSkills.map((skill, i) => {
                    const hasEffects = skill.effects && skill.effects.length > 0;
                    const updateSkill = (patch: Partial<typeof skill>) => setEditingSkills(prev => prev.map((s, j) => j === i ? { ...s, ...patch } : s));
                    const addEffect = () => {
                      const efs = [...(skill.effects || [])];
                      efs.push({ id: `e${Date.now()}_${efs.length}`, label: `效果${efs.length + 1}`, description: '' });
                      updateSkill({ effects: efs, effectMode: skill.effectMode || 'all' });
                    };
                    const removeEffect = (ei: number) => {
                      const efs = (skill.effects || []).filter((_, j) => j !== ei);
                      updateSkill({ effects: efs.length > 0 ? efs : undefined, effectMode: efs.length > 0 ? skill.effectMode : undefined });
                    };
                    const updateEffect = (ei: number, patch: Partial<SkillEffect>) => {
                      const efs = (skill.effects || []).map((e, j) => j === ei ? { ...e, ...patch } : e);
                      updateSkill({ effects: efs });
                    };

                    return (
                    <div key={i} className="rounded-xl border border-purple-800/30 bg-black/30 p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-purple-400/60 font-bold">技能 {i + 1}</span>
                          {skill.tag && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold border"
                              style={{ color: skillTagColors[skill.tag], borderColor: skillTagColors[skill.tag] + '50', backgroundColor: skillTagColors[skill.tag] + '15' }}>
                              {skill.tag}
                            </span>
                          )}
                          {skill.forced && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-900/30 text-red-300 border border-red-800/30">强制</span>}
                          {hasEffects && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-cyan-900/30 text-cyan-300 border border-cyan-800/30">{skill.effects!.length}个效果</span>}
                        </div>
                        <button onClick={() => handleRemoveSkill(i)}
                          className="text-xs text-red-400 hover:text-red-300 px-2 py-0.5 rounded hover:bg-red-900/20">
                          删除
                        </button>
                      </div>
                      <div className="space-y-2">
                        <div className="flex gap-2">
                          <div className="flex-1">
                            <label className="text-[10px] text-purple-400/60 mb-1 block">技能名</label>
                            <input type="text" value={skill.name} onChange={e => handleSkillChange(i, 'name', e.target.value)}
                              className="w-full px-3 py-1.5 rounded-lg bg-black/50 border border-purple-700/30 text-purple-100 text-sm focus:outline-none focus:border-purple-500" />
                          </div>
                          <div className="w-28">
                            <label className="text-[10px] text-purple-400/60 mb-1 block">标签</label>
                            <select value={skill.tag || ''} onChange={e => handleSkillTagChange(i, e.target.value as SkillTag | '')}
                              className="w-full px-2 py-1.5 rounded-lg bg-black/50 border border-purple-700/30 text-purple-100 text-sm focus:outline-none focus:border-purple-500">
                              <option value="">无</option>
                              {allSkillTags.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </div>
                          <div className="w-20 flex flex-col items-center">
                            <label className="text-[10px] text-purple-400/60 mb-1 block">强制发动</label>
                            <button onClick={() => updateSkill({ forced: !skill.forced })}
                              className={`w-10 h-5 rounded-full relative transition-all ${skill.forced ? 'bg-red-600' : 'bg-gray-700'}`}
                              title={skill.forced ? '强制发动：满足条件自动发动，需满足代价' : '非强制：由玩家选择是否发动'}>
                              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${skill.forced ? 'left-5' : 'left-0.5'}`} />
                            </button>
                          </div>
                        </div>

                        {/* Single-effect mode (no sub-effects) */}
                        {!hasEffects && (
                          <>
                            <TriggerEditor trigger={skill.trigger} onChange={t => updateSkill({ trigger: t })} />
                            <div>
                              <label className="text-[10px] text-purple-400/60 mb-1 block">技能描述</label>
                              <textarea value={skill.description || ''} onChange={e => handleSkillChange(i, 'description', e.target.value)}
                                placeholder="输入技能效果描述..."
                                className="w-full px-3 py-1.5 rounded-lg bg-black/50 border border-purple-700/30 text-purple-100 text-sm h-14 resize-none focus:outline-none focus:border-purple-500" />
                            </div>
                          </>
                        )}

                        {/* Multi-effect mode */}
                        {hasEffects && (
                          <div className="space-y-2">
                            {/* Overall description */}
                            <div>
                              <label className="text-[10px] text-purple-400/60 mb-1 block">技能总述（可选）</label>
                              <input type="text" value={skill.description || ''} onChange={e => handleSkillChange(i, 'description', e.target.value)}
                                placeholder="技能总体描述..."
                                className="w-full px-3 py-1.5 rounded-lg bg-black/50 border border-purple-700/30 text-purple-100 text-sm focus:outline-none focus:border-purple-500" />
                            </div>
                            {/* Effect mode selector */}
                            <div className="flex items-center gap-2">
                              <label className="text-[10px] text-orange-400/70 font-bold whitespace-nowrap">多效果模式</label>
                              <select value={skill.effectMode || 'all'} onChange={e => updateSkill({ effectMode: e.target.value as SkillEffectMode })}
                                className="flex-1 px-2 py-1 rounded bg-black/50 border border-orange-800/30 text-orange-200 text-[11px] focus:outline-none focus:border-orange-500">
                                {(Object.entries(effectModeLabels) as [SkillEffectMode, string][]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                              </select>
                            </div>
                            {/* 选择其一 × 门槛：编译期整组拒录（CONDITION_CHOICE_UNSUPPORTED），必须让录入者当场看见 */}
                            {skill.effectMode === 'choice' && skill.effects!.some(e => (e.conditions?.length ?? 0) > 0) && (
                              <p className="text-[10px] text-red-300 leading-tight">
                                ⚠ 「选择其一」暂时不能配门槛：只要任一选项写了门槛，这条技能整条不会发动（编译时诚实跳过，不会假装生效）。
                                要么把模式改成「全部生效」，要么先把门槛清空。
                              </p>
                            )}
                            {skill.effects!.map((eff, ei) => (
                              <div key={eff.id} className="rounded-lg border border-orange-800/25 bg-orange-950/10 p-3 space-y-1.5 ml-2">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-bold text-orange-400/80">
                                      {skill.effectMode === 'choice' ? `选项 ${ei + 1}` : `效果 ${ei + 1}`}
                                    </span>
                                    <input type="text" value={eff.label || ''} onChange={e => updateEffect(ei, { label: e.target.value })}
                                      placeholder="效果标注..."
                                      className="px-2 py-0.5 rounded bg-black/40 border border-orange-800/20 text-orange-200 text-[10px] w-28 focus:outline-none focus:border-orange-500" />
                                  </div>
                                  <button onClick={() => removeEffect(ei)}
                                    className="text-[10px] text-red-400 hover:text-red-300 px-1.5 py-0.5 rounded hover:bg-red-900/20">✕</button>
                                </div>
                                <TriggerEditor trigger={eff.trigger} onChange={t => updateEffect(ei, { trigger: t })} />
                                <GateEditor conditions={eff.conditions} onChange={c => updateEffect(ei, { conditions: c })} />
                                <RuntimeEditor runtime={eff.runtime} onChange={rt => updateEffect(ei, { runtime: rt })} />
                                <textarea value={eff.description || ''} onChange={e => updateEffect(ei, { description: e.target.value })}
                                  placeholder="该效果的描述..."
                                  className="w-full px-2 py-1 rounded bg-black/40 border border-orange-800/20 text-orange-100 text-[11px] h-12 resize-none focus:outline-none focus:border-orange-500" />
                              </div>
                            ))}
                            <button onClick={addEffect}
                              className="w-full py-1.5 rounded-lg border border-dashed border-orange-700/30 text-orange-400/60 text-[11px] font-bold hover:bg-orange-900/10 hover:text-orange-300">
                              + 添加效果
                            </button>
                          </div>
                        )}

                        {/* Toggle to switch between single/multi effect */}
                        {!hasEffects && (
                          <button onClick={addEffect}
                            className="w-full py-1 rounded text-[10px] text-cyan-500/50 hover:text-cyan-300 hover:bg-cyan-900/10 transition-all">
                            ＋ 切换为多效果模式
                          </button>
                        )}
                        {hasEffects && (
                          <button onClick={() => updateSkill({ effects: undefined, effectMode: undefined })}
                            className="w-full py-1 rounded text-[10px] text-gray-500/50 hover:text-gray-300 hover:bg-gray-900/20 transition-all">
                            切换为单效果模式（将清除所有子效果）
                          </button>
                        )}
                      </div>
                    </div>
                    );
                  })}

                  <button onClick={handleAddSkill}
                    className="w-full py-3 rounded-xl border-2 border-dashed border-purple-700/30 text-purple-400 text-sm font-bold hover:bg-purple-900/20 hover:border-purple-600/40 transition-all">
                    + 添加技能
                  </button>
                </div>

                {/* §H3 layer ①: a general this session may not touch offers no
                    write path at all, and says which of the two locks says no
                    (金锁=系统禁改 / 白锁=你自己锁的). */}
                {!mayEditGeneral(selectedGeneral.id) && (
                  <div className="px-4 pt-3 text-xs font-bold text-red-300 flex-shrink-0 flex items-center gap-2">
                    <span>🔒 {mayModifyGeneral(selectedGeneral.id, { developerMode }).allowed
                      ? denialMessage('USER_LOCKED')
                      : denialMessage('OFFICIAL_READ_ONLY')}</span>
                    {mayModifyGeneral(selectedGeneral.id, { developerMode }).allowed && lockedGenerals.has(selectedGeneral.id) && (
                      <button onClick={() => toggleGeneralLock(selectedGeneral.id)}
                        className="px-2 py-0.5 rounded bg-sky-800/60 border border-sky-500/40 text-sky-100 text-[10px] font-bold hover:bg-sky-700/60">
                        🔓 在此解锁
                      </button>
                    )}
                  </div>
                )}
                {readOnlyNotice && (
                  <div className="px-4 pt-2 text-xs font-bold text-red-300 flex-shrink-0 whitespace-pre-wrap">
                    {readOnlyNotice}
                  </div>
                )}
                <div className="p-4 border-t border-purple-800/20 flex items-center gap-3 flex-shrink-0">
                  <button onClick={handleSave}
                    disabled={!mayEditGeneral(selectedGeneral.id)}
                    className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-all ${!mayEditGeneral(selectedGeneral.id) ? 'bg-gray-800 text-gray-500 cursor-not-allowed' : saved ? 'bg-green-600 text-white' : 'bg-purple-700 text-white hover:bg-purple-600'}`}>
                    {saved ? '✅ 已保存' : '💾 保存修改'}
                  </button>
                  <button onClick={() => setSelectedGeneral(null)}
                    className="px-4 py-2.5 rounded-xl bg-gray-700 text-white font-bold text-sm hover:bg-gray-600">
                    关闭
                  </button>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-purple-400/30">
                <div className="text-center">
                  <div className="text-6xl mb-4">{multiSelectMode ? '🗑️' : '🛠️'}</div>
                  <p className="text-lg">
                    {multiSelectMode
                      ? '点击左侧将领进行多选'
                      : '从左侧选择一名将领开始编辑'}
                  </p>
                  <p className="text-sm mt-2 text-purple-500/30">
                    {multiSelectMode
                      ? '选中后可批量禁用/启用、批量锁定/解锁或删除编辑数据'
                      : '支持编辑名称、势力、体力、攻击力、技能及标签'}
                  </p>
                  <p className="text-sm mt-3 text-purple-500/30">
                    当前已禁用 <span className="text-red-400">{liveDisabled.size}</span> 名将领（禁用的将领不会出现在游戏选将中）
                  </p>
                  {blocked.length > 0 && (
                    <div className="mt-4 max-w-md rounded-xl border border-red-800/40 bg-red-900/20 p-3 text-left text-xs text-red-200">
                      <p className="font-bold mb-1">🚫 {denialMessage('OFFICIAL_READ_ONLY')}（{blocked.length} 处已停用，数据原样保留）</p>
                      <p className="whitespace-pre-wrap">{[...new Set(blocked.map(b => b.name))].join('、')}</p>
                      {!developerMode && <p className="mt-1 text-red-300/70">进入开发者模式即可继续编辑这些官方将领；改动本身不会被删除或回滚。</p>}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-sm rounded-2xl border border-red-600/40 bg-gradient-to-b from-gray-900 to-black p-8 text-center shadow-2xl">
            <div className="text-5xl mb-4">🗑️</div>
            <h2 className="text-2xl font-black text-red-300 mb-3">确认删除？</h2>
            <p className="text-amber-100/60 text-sm mb-2">
              将清除 <strong className="text-red-300">{selectedIds.size}</strong> 名将领的所有编辑数据
            </p>
            <p className="text-amber-100/40 text-xs mb-6">（包括名称、势力、体力、攻击力、技能的修改）</p>
            <div className="flex gap-3">
              <button onClick={handleBatchDelete}
                className="flex-1 py-3 rounded-xl bg-red-700 text-white font-bold hover:bg-red-600 transition-all">
                确认删除
              </button>
              <button onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 py-3 rounded-xl bg-gray-700 text-white font-bold hover:bg-gray-600 transition-all">
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
