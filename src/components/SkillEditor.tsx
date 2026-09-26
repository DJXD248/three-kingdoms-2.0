import { useState, useMemo, useCallback } from 'react';
import { useGameStore } from '../store/gameStore';
import {
  allGenerals, General, Faction, factionColors, SkillTag, allSkillTags, skillTagColors,
  SkillEffect, SkillEffectMode, effectModeLabels,
} from '../data/generals';
import {
  triggerToStr,
  buildTriggerOptionStrings,
  effectGroupHeaders,
  serializeEffectGroup,
  RUNTIME_TYPE_LIST,
  RUNTIME_TARGET_LIST,
} from '../skills/skillExcelFormat';
import {
  parseSkillCell, isDetailedFormat, isRowPerSkillFormat, resolveGeneralByNameFaction,
  parseRowPerSkillSheet, parseLegacyDetailedRow, SkillEditEntry,
} from './skillEditor/skillExcelParsers';
import { describeLockKey, findIdentityConflicts } from '../domain/identity';
import { TriggerEditor } from './skillEditor/TriggerEditor';
import { RuntimeEditor } from './skillEditor/RuntimeEditor';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

/** All trigger dropdown options (computed once; pure, module-level). */
const allTriggerOptionStrings = buildTriggerOptionStrings();

type SortBy = 'faction' | 'name' | 'type';

export default function SkillEditor({ onClose }: { onClose: () => void }) {
  const skillEdits = useGameStore(s => s.skillEdits);
  const generalEdits = useGameStore(s => s.generalEdits);
  const disabledGenerals = useGameStore(s => s.disabledGenerals);
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
  const [newIdentityName, setNewIdentityName] = useState('');
  const [identityNotice, setIdentityNotice] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importResult, setImportResult] = useState('');
  const [saved, setSaved] = useState(false);

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
    let list = allGenerals.map(g => ({ original: g, edited: getEditedGeneral(g) })).filter(({ edited }) => {
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
  }, [search, factionFilter, sortBy, skillEdits, generalEdits, getEditedGeneral]);

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
    updateSkillEdit(selectedGeneral.id, editingSkills);
    const identityChoice = editIdentity === '__default__' ? undefined : editIdentity === '__none__' ? '' : editIdentity;
    updateGeneralEdit(selectedGeneral.id, {
      name: editName !== selectedGeneral.name ? editName : undefined,
      faction: editFaction !== selectedGeneral.faction ? editFaction : undefined,
      hp: editHp !== selectedGeneral.hp ? editHp : undefined,
      meleeAtk: editMeleeAtk !== selectedGeneral.meleeAtk ? editMeleeAtk : undefined,
      rangedAtk: editRangedAtk !== selectedGeneral.rangedAtk ? editRangedAtk : undefined,
      identity: identityChoice !== selectedGeneral.identity ? identityChoice : undefined,
    });
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

  const handleImportText = () => {
    const count = importSkillEditsFromText(importText);
    setImportResult(`成功导入 ${count} 名将领的技能数据`);
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
          const sEdits = { ...useGameStore.getState().skillEdits };
          const gEdits = { ...useGameStore.getState().generalEdits };

          for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName];
            if (!sheet) continue;
            const rows: (string | number | undefined)[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
            if (rows.length < 2) continue;
            let sheetHasData = false;
            const detailed = isDetailedFormat(rows);

            if (detailed && isRowPerSkillFormat(rows[0])) {
              // New row-per-skill format
              const { entries } = parseRowPerSkillSheet(rows);
              for (const entry of entries) {
                if (entry.skills.length > 0) sEdits[entry.general.id] = entry.skills;
                const ge = entry.gEdit;
                if (ge.faction || ge.hp || ge.meleeAtk != null || ge.rangedAtk != null) {
                  gEdits[entry.general.id] = ge as typeof gEdits[string];
                }
                count++;
                sheetHasData = true;
              }
            } else if (detailed) {
              // Legacy 5-col-per-skill format
              for (const row of rows.slice(1)) {
                if (!row || row.length < 6) continue;
                const parsed = parseLegacyDetailedRow(row);
                if (!parsed || !parsed.general) continue;
                if (parsed.skills.length > 0) sEdits[parsed.general.id] = parsed.skills;
                const ge = parsed.gEdit;
                if (ge.faction || ge.hp || ge.meleeAtk != null || ge.rangedAtk != null) {
                  gEdits[parsed.general.id] = ge as typeof gEdits[string];
                }
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
                  sEdits[general.id] = skills; count++; sheetHasData = true;
                }
              }
            }
            if (sheetHasData) sheetCount++;
          }

          try { localStorage.setItem('three_kingdoms_skill_edits', JSON.stringify(sEdits)); } catch { /* storage unavailable; in-memory edits still applied */ }
          try { localStorage.setItem('three_kingdoms_general_edits', JSON.stringify(gEdits)); } catch { /* storage unavailable; in-memory edits still applied */ }
          useGameStore.setState({ skillEdits: sEdits, generalEdits: gEdits });

          setImportResult(`✅ 从 ${sheetCount} 个工作表导入 ${count} 名将领${skipped > 0 ? `，跳过 ${skipped} 名无变化` : ''}`);
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
  // Effect group (6 cols): 标注 | 触发 | 效果类型 | 数值 | 目标 | 描述 — 只有填了效果类型(+数值)的效果
  // 才会被技能编译器接入对局结算（见 skills/skillCompiler.ts）。
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

            // Sub-effects (6-col groups incl. structured runtime fields)
            for (let e = 0; e < maxEffects; e++) {
              row.push(...serializeEffectGroup(sk.effects?.[e], 6));
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
              // v2 group layout (1-based): 标注=12+6n | 触发=13+6n | 类型=14+6n | 数值=15+6n | 目标=16+6n | 描述=17+6n
              ws.getCell(r, 13 + ei * 6).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${triggerList}"`] };
              ws.getCell(r, 14 + ei * 6).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${RUNTIME_TYPE_LIST}"`] };
              ws.getCell(r, 16 + ei * 6).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${RUNTIME_TARGET_LIST}"`] };
            }
          }
        }

        // Column widths
        const widths = [14, 6, 5, 5, 5, 14, 10, 8, 20, 10, 40];
        for (let e = 0; e < maxEffects; e++) widths.push(10, 20, 12, 8, 12, 40);
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

  const handleBatchDelete = () => {
    batchDeleteEdits(Array.from(selectedIds));
    setSelectedIds(new Set());
    setShowDeleteConfirm(false);
    setImportResult(`✅ 已清除 ${selectedIds.size} 名将领的编辑数据`);
    setTimeout(() => setImportResult(''), 3000);
  };

  // v2.8.0: 撞键显式提示 — old saves may already host same-key generals;
  // we surface them, never silently rewrite (契约表 格12).
  const identityConflicts = useMemo(
    () => findIdentityConflicts(allGenerals.map(g => getEditedGeneral(g))),
    [getEditedGeneral],
  );
  const identityReferrers = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const g of allGenerals) {
      const ed = getEditedGeneral(g);
      const name = ed.identity !== undefined ? ed.identity : undefined;
      if (name !== undefined && name.trim() !== '') map.set(name.trim(), [...(map.get(name.trim()) ?? []), ed.name]);
    }
    return map;
  }, [getEditedGeneral]);

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
              <p>将领 | 势力 | 体力 | 近战 | 远程 | 技能名 | 标签 | 强制发动 | 触发时机 | 效果模式 | 技能描述 | 效果1标注 | 效果1触发 | 效果1类型 | 效果1数值 | 效果1目标 | 效果1描述 | ...</p>
              <p>同一将领的多个技能占多行，将领属性仅第一行填写。<span className="text-green-400">含下拉菜单和设定备注。</span>旧版3列效果组（标注/触发/描述）的文件仍兼容导入。</p>
              <p><span className="text-emerald-300">⚡ 结构化效果：</span>效果组中填写<span className="text-emerald-300">效果类型（摸牌/伤害）+ 数值</span>后，该效果才会在对局中被引擎真实结算；不填＝纯描述。</p>
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
            <button onClick={() => { batchToggleDisabled(Array.from(selectedIds), true); setSelectedIds(new Set()); }}
              disabled={selectedIds.size === 0}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${selectedIds.size > 0 ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' : 'bg-gray-800 text-gray-500 cursor-not-allowed'}`}>
              🚫 禁用 ({selectedIds.size})
            </button>
            <button onClick={() => { batchToggleDisabled(Array.from(selectedIds), false); setSelectedIds(new Set()); }}
              disabled={selectedIds.size === 0}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${selectedIds.size > 0 ? 'bg-green-800 text-green-200 hover:bg-green-700' : 'bg-gray-800 text-gray-500 cursor-not-allowed'}`}>
              ✅ 启用 ({selectedIds.size})
            </button>
            <button onClick={() => setShowDeleteConfirm(true)} disabled={selectedIds.size === 0}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${selectedIds.size > 0 ? 'bg-red-700 text-white hover:bg-red-600' : 'bg-gray-800 text-gray-500 cursor-not-allowed'}`}>
              🗑️ 删除编辑 ({selectedIds.size})
            </button>
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
                const isDisabled = disabledGenerals.has(original.id);
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
                        <p className={`text-sm font-bold truncate ${isDisabled ? 'text-gray-500 line-through' : 'text-amber-100'}`}>{edited.name}</p>
                        <p className="text-[10px] text-purple-400/60 truncate">
                          {edited.skills.map(s => s.tag ? `${s.name}<${s.tag}>` : s.name).join('、')}
                        </p>
                      </div>
                      {incomplete && !multiSelectMode && <span className="text-[10px] text-amber-400 flex-shrink-0" title="技能设定未完成">⚠</span>}
                    {hasEdits && !multiSelectMode && <span className="text-[10px] text-green-400 flex-shrink-0">✏️</span>}
                    </button>
                    {!multiSelectMode && (
                      <button onClick={(e) => { e.stopPropagation(); toggleDisabledGeneral(original.id); }}
                        title={isDisabled ? '启用该将领' : '禁用该将领'}
                        className={`flex-shrink-0 w-7 h-4 rounded-full relative transition-all mr-1 ${isDisabled ? 'bg-gray-700' : 'bg-green-600'}`}>
                        <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${isDisabled ? 'left-0.5' : 'left-3.5'}`} />
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
                            {/* Effect cards */}
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

                <div className="p-4 border-t border-purple-800/20 flex items-center gap-3 flex-shrink-0">
                  <button onClick={handleSave}
                    className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-all ${saved ? 'bg-green-600 text-white' : 'bg-purple-700 text-white hover:bg-purple-600'}`}>
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
                      ? '选中后可批量禁用/启用或删除编辑数据'
                      : '支持编辑名称、势力、体力、攻击力、技能及标签'}
                  </p>
                  <p className="text-sm mt-3 text-purple-500/30">
                    当前已禁用 <span className="text-red-400">{disabledGenerals.size}</span> 名将领（禁用的将领不会出现在游戏选将中）
                  </p>
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
