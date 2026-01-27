// ==UserScript==
// @name         Prompt Template Panel (Safe DOM + SPA + Import/Export)
// @namespace    https://example.local/
// @version      0.4.1
// @description  Collapsible right panel: templates, save, import/export, copy Markdown. Safe DOM build + SPA resilient.
// @match        https://chatgpt.com/c/*
// @match        https://gemini.google.com/app/*
// @match        https://claude.ai/chat/*
// @updateURL    https://raw.githubusercontent.com/darkpt/webspace/main/Prompt_Template_Panel.js
// @downloadURL  https://raw.githubusercontent.com/darkpt/webspace/main/Prompt_Template_Panel.js
// @run-at       document-end
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function () {
  'use strict';

  const PANEL_ID = 'tm_prompt_panel_v1';
  const STYLE_ID = 'tm_prompt_panel_style_v1';
  const STORAGE_KEY = 'tm_prompt_templates_v1';

  // 內建模板
  const BUILTIN_TEMPLATES = [
    {
      id: 'builtin_general',
      name: '通用助理',
      role: '你是專業的助理,回答要結構化且可直接執行。',
      goal: '在不增加不必要寒暄的前提下,提供精準、可驗收的輸出。',
      workflow: '先列理解稿（目標/依據/限制/輸出/驗收）,再輸出結果,最後附自我驗收清單。',
      limits: '避免臆測；資訊不足先列缺口；避免冗長與情緒化語句。'
    },
    {
      id: 'builtin_dev_spec',
      name: '開發規格撰寫',
      role: '你是資深軟體規格工程師。',
      goal: '把需求轉成可實作的規格與驗收條件。',
      workflow: '輸入分類→需求釐清→資料結構/介面→流程→錯誤處理→驗收案例。',
      limits: '不假設未提供的環境/依賴；必要時提出最小可行預設。'
    }
  ];

  function safeJsonParse(str, fallback) {
    try {
      const v = JSON.parse(str);
      return v ?? fallback;
    } catch {
      return fallback;
    }
  }

  function loadUserTemplates() {
    const raw = GM_getValue(STORAGE_KEY, '[]');
    const arr = safeJsonParse(raw, []);
    return Array.isArray(arr) ? arr : [];
  }

  function saveUserTemplates(arr) {
    GM_setValue(STORAGE_KEY, JSON.stringify(arr));
  }

  function normalizeTemplateLike(obj) {
    // 僅接受有 name 的物件；其餘欄位缺省補空字串
    if (!obj || typeof obj !== 'object') return null;
    const name = typeof obj.name === 'string' ? obj.name.trim() : '';
    if (!name) return null;

    const pick = (k) => (typeof obj[k] === 'string' ? obj[k] : '');
    return {
      id: typeof obj.id === 'string' && obj.id ? obj.id : `user_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      name,
      role: pick('role'),
      goal: pick('goal'),
      workflow: pick('workflow'),
      limits: pick('limits')
    };
  }

  function getAllTemplates() {
    return [...BUILTIN_TEMPLATES, ...loadUserTemplates()];
  }

  function toMarkdown({ role, goal, workflow, limits }) {
    return [
      '## Role', (role || '').trim(), '',
      '## Goal', (goal || '').trim(), '',
      '## Workflow', (workflow || '').trim(), '',
      '## Limits', (limits || '').trim(), ''
    ].join('\n');
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) {}

    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (_) {
      return false;
    }
  }

  // 2) 安全處理樣式表：style + TextNode
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const css = `
      :root {
        --ptp-surface: rgba(255,255,255,0.98);
        --ptp-border: rgba(15, 23, 42, 0.12);
        --ptp-text: rgba(15, 23, 42, 0.92);
        --ptp-muted: rgba(15, 23, 42, 0.62);
        --ptp-accent: #14b8a6;
        --ptp-accent-2: #0ea5e9;
        --ptp-shadow: 0 12px 30px rgba(15, 23, 42, 0.14);
      }

      #${PANEL_ID}{
        position: fixed;
        top: 90px;
        right: 0;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", Arial, sans-serif;
        color: var(--ptp-text);
      }

      /* 6) 減少收合的寬度：把手更窄 */
      #${PANEL_ID} .handle{
        position:absolute; top:0; left:-28px;
        width:28px; height:96px;
        border:1px solid var(--ptp-border);
        border-right:none;
        border-radius:12px 0 0 12px;
        background: linear-gradient(180deg, rgba(20,184,166,0.10), rgba(14,165,233,0.06)), var(--ptp-surface);
        display:flex; align-items:center; justify-content:center;
        cursor:pointer; user-select:none;
        box-shadow: var(--ptp-shadow);
        color: rgba(15,23,42,0.78);
        font-weight: 800;
      }

      #${PANEL_ID}.collapsed .panel { width:0; padding:0; border:none; overflow:hidden; }

      #${PANEL_ID} .panel{
        width:392px;
        height:72vh;
        background: var(--ptp-surface);
        border:1px solid var(--ptp-border);
        border-right:none;
        border-radius:0px 0 0 16px;
        padding:12px 12px 10px 12px;
        box-shadow: var(--ptp-shadow);
        overflow:auto;
      }

      #${PANEL_ID} .title{
        font-weight:700;
        font-size:13px;
        margin-bottom:10px;
        display:flex;
        align-items:center;
        gap:8px;
      }
      #${PANEL_ID} .dot{
        width:10px; height:10px;
        border-radius:999px;
        background: linear-gradient(135deg, var(--ptp-accent), var(--ptp-accent-2));
        box-shadow: 0 0 0 3px rgba(20,184,166,0.10);
      }

      /* 修改：第一行按鈕區 Grid 佈局 */
      #${PANEL_ID} .button-row {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
        margin-bottom: 10px;
      }

      /* 修改：第二行選單+複製按鈕 Grid 佈局 */
      #${PANEL_ID} .select-row {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 8px;
        align-items: center;
        margin-bottom: 10px;
      }

      #${PANEL_ID} select{
        padding:7px 10px;
        border-radius:10px;
        border:1px solid var(--ptp-border);
        background:#fff;
        font-size:13px;
        outline:none;
      }
      #${PANEL_ID} select:focus{
        border-color: rgba(20,184,166,0.55);
        box-shadow: 0 0 0 4px rgba(20,184,166,0.14);
      }

      #${PANEL_ID} button{
        padding:8px 10px;
        border-radius:10px;
        border:1px solid var(--ptp-border);
        background: #fff;
        cursor:pointer;
        font-size:13px;
        color: rgba(15,23,42,0.88);
        transition: box-shadow 160ms ease, border-color 160ms ease, transform 60ms ease;
        outline: none;
      }
      #${PANEL_ID} button:active{ transform: translateY(1px); }
      #${PANEL_ID} button:hover{
        border-color: rgba(20,184,166,0.40);
        box-shadow: 0 0 0 4px rgba(20,184,166,0.10);
      }

      /* 3) 複製按鈕周邊變色 */
      #${PANEL_ID} button.copy-flash{
        border-color: rgba(14,165,233,0.80) !important;
        box-shadow: 0 0 0 4px rgba(14,165,233,0.22) !important;
      }
      #${PANEL_ID} button.copy-fail{
        border-color: rgba(239,68,68,0.80) !important;
        box-shadow: 0 0 0 4px rgba(239,68,68,0.18) !important;
      }

      #${PANEL_ID} label{
        display:block;
        font-size:12px;
        margin:10px 0 6px;
        color: var(--ptp-muted);
      }
      #${PANEL_ID} textarea{
        width:100%;
        min-height:74px;
        resize: vertical;
        padding:9px 10px;
        border-radius:12px;
        border:1px solid var(--ptp-border);
        background:#fff;
        font-size:13px;
        line-height:1.45;
        box-sizing:border-box;
        outline:none;
      }
      #${PANEL_ID} textarea:focus{
        border-color: rgba(20,184,166,0.55);
        box-shadow: 0 0 0 4px rgba(20,184,166,0.14);
      }

      #${PANEL_ID} .status{
        margin-top:8px;
        font-size:12px;
        color: var(--ptp-muted);
        min-height:16px;
        white-space: pre-wrap;
      }
    `;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.appendChild(document.createTextNode(css));
    (document.head || document.documentElement).appendChild(style);
  }

  // 1) 替換 DOM 注入方式：完全不用 innerHTML
  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'className') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'htmlFor') node.htmlFor = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v !== undefined && v !== null) node.setAttribute(k, String(v));
    }
    for (const c of children) node.appendChild(c);
    return node;
  }

  function setStatus(statusEl, msg) {
    statusEl.textContent = msg || '';
    if (msg) {
      window.clearTimeout(setStatus._t);
      setStatus._t = window.setTimeout(() => (statusEl.textContent = ''), 1800);
    }
  }

  function buildPanel() {
    ensureStyle();

    // root
    const root = el('div', { id: PANEL_ID, className: 'collapsed' });

    const handle = el('div', { className: 'handle', title: '展開/收合', text: '≡' });
    root.appendChild(handle);

    const panel = el('div', { className: 'panel' });
    root.appendChild(panel);

    const title = el('div', { className: 'title' }, [
      el('span', { className: 'dot' }),
      el('span', { text: 'PROMPT 模版' })
    ]);
    panel.appendChild(title);

    // === 修改開始：重新組織按鈕結構 ===

    // 第一行：儲存、匯入、匯出三個按鈕
    const buttonRow = el('div', { className: 'button-row' });
    panel.appendChild(buttonRow);

    const saveBtn = el('button', { id: `${PANEL_ID}_save`, title: '將目前內容存成新模板', text: '儲存' });
    const importBtn = el('button', { id: `${PANEL_ID}_import`, title: '匯入 JSON 模板（貼上）', text: '匯入' });
    const exportBtn = el('button', { id: `${PANEL_ID}_export`, title: '匯出 JSON 模板（下載）', text: '匯出' });

    buttonRow.appendChild(saveBtn);
    buttonRow.appendChild(importBtn);
    buttonRow.appendChild(exportBtn);

    // 第二行：下拉選單 + 複製按鈕
    const selectRow = el('div', { className: 'select-row' });
    panel.appendChild(selectRow);

    const selectEl = el('select', { id: `${PANEL_ID}_select` });
    const copyBtn = el('button', { id: `${PANEL_ID}_copy`, title: '將目前四欄合併為 Markdown 並複製', text: '複製' });

    selectRow.appendChild(selectEl);
    selectRow.appendChild(copyBtn);

    // === 修改結束 ===

    // 4) label 文案依你的要求
    const roleLabel = el('label', { htmlFor: `${PANEL_ID}_role`, text: '請填入：角色' });
    const roleEl = el('textarea', { id: `${PANEL_ID}_role`, placeholder: 'role...' });

    const goalLabel = el('label', { htmlFor: `${PANEL_ID}_goal`, text: '請填入：工作目標' });
    const goalEl = el('textarea', { id: `${PANEL_ID}_goal`, placeholder: 'goal...' });

    const workflowLabel = el('label', { htmlFor: `${PANEL_ID}_workflow`, text: '請填入：流程項目' });
    const workflowEl = el('textarea', { id: `${PANEL_ID}_workflow`, placeholder: 'workflow...' });

    const limitsLabel = el('label', { htmlFor: `${PANEL_ID}_limits`, text: '請填入：限制要求' });
    const limitsEl = el('textarea', { id: `${PANEL_ID}_limits`, placeholder: 'limits...' });

    const statusEl = el('div', { className: 'status', id: `${PANEL_ID}_status` });

    panel.appendChild(roleLabel);
    panel.appendChild(roleEl);
    panel.appendChild(goalLabel);
    panel.appendChild(goalEl);
    panel.appendChild(workflowLabel);
    panel.appendChild(workflowEl);
    panel.appendChild(limitsLabel);
    panel.appendChild(limitsEl);
    panel.appendChild(statusEl);

    function rebuildSelect(selectedId) {
      const all = getAllTemplates();
      selectEl.textContent = '';
      for (const tpl of all) {
        const opt = el('option', { value: tpl.id, text: tpl.name });
        selectEl.appendChild(opt);
      }
      const firstId = all[0]?.id || '';
      const next = selectedId && all.some(t => t.id === selectedId) ? selectedId : firstId;
      selectEl.value = next;
      return next;
    }

    function findTemplateById(id) {
      return getAllTemplates().find(t => t.id === id);
    }

    function loadTemplateIntoTextareas(tpl) {
      if (!tpl) return;
      roleEl.value = tpl.role || '';
      goalEl.value = tpl.goal || '';
      workflowEl.value = tpl.workflow || '';
      limitsEl.value = tpl.limits || '';
    }

    // Init
    const initSelected = rebuildSelect();
    loadTemplateIntoTextareas(findTemplateById(initSelected));

    // Toggle
    handle.addEventListener('click', () => root.classList.toggle('collapsed'));

    // Select change
    selectEl.addEventListener('change', () => {
      loadTemplateIntoTextareas(findTemplateById(selectEl.value));
      setStatus(statusEl, '已載入模板');
    });

    // Save (新增一筆 user 模板)
    saveBtn.addEventListener('click', () => {
      const name = window.prompt('請輸入要儲存的模板名稱：', `自訂模板 ${new Date().toLocaleString()}`);
      if (!name) return;

      const user = loadUserTemplates();
      const id = `user_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      user.push({
        id,
        name: name.trim(),
        role: roleEl.value || '',
        goal: goalEl.value || '',
        workflow: workflowEl.value || '',
        limits: limitsEl.value || ''
      });
      saveUserTemplates(user);

      rebuildSelect(id);
      setStatus(statusEl, '已儲存並加入下拉選單');
    });

    // 5) 匯入：貼上 JSON（支援陣列或單一物件）
    importBtn.addEventListener('click', () => {
      const raw = window.prompt(
        '請貼上要匯入的 JSON：\n- 可貼上單一模板物件\n- 或模板陣列\n欄位：name, role, goal, workflow, limits（id 可省略）',
        ''
      );
      if (!raw) return;

      const parsed = safeJsonParse(raw, null);
      if (!parsed) {
        setStatus(statusEl, '匯入失敗：JSON 解析錯誤');
        return;
      }

      const arr = Array.isArray(parsed) ? parsed : [parsed];
      const normalized = arr.map(normalizeTemplateLike).filter(Boolean);

      if (!normalized.length) {
        setStatus(statusEl, '匯入失敗：找不到有效模板（至少需要 name）');
        return;
      }

      const user = loadUserTemplates();
      // 以 id 去重；若撞 id，改新 id
      const existingIds = new Set(user.map(t => t.id));
      for (const t of normalized) {
        if (existingIds.has(t.id) || t.id.startsWith('builtin_')) {
          t.id = `user_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        }
        existingIds.add(t.id);
        user.push(t);
      }

      saveUserTemplates(user);
      const lastId = normalized[normalized.length - 1].id;
      rebuildSelect(lastId);
      loadTemplateIntoTextareas(findTemplateById(lastId));
      setStatus(statusEl, `已匯入 ${normalized.length} 筆模板`);
    });

    // 5) 匯出：下載 JSON（只匯出 user 模板）
    exportBtn.addEventListener('click', async () => {
      const user = loadUserTemplates();
      const json = JSON.stringify(user, null, 2);

      // 先嘗試複製到剪貼簿（方便你貼到別處）
      const ok = await copyText(json);

      // 同時提供下載
      try {
        const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = el('a', { href: url, download: 'prompt-templates.json' });
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (_) {}

      setStatus(statusEl, ok ? '已匯出（已複製 JSON + 下載檔案）' : '已匯出（已下載檔案；剪貼簿可能受限）');
    });

    // Copy (3) 按鈕周邊變色
    copyBtn.addEventListener('click', async () => {
      copyBtn.classList.remove('copy-flash', 'copy-fail');

      const md = toMarkdown({
        role: roleEl.value,
        goal: goalEl.value,
        workflow: workflowEl.value,
        limits: limitsEl.value
      });

      const ok = await copyText(md);
      copyBtn.classList.add(ok ? 'copy-flash' : 'copy-fail');
      window.setTimeout(() => copyBtn.classList.remove('copy-flash', 'copy-fail'), 600);

      setStatus(statusEl, ok ? '已複製 Markdown 到剪貼簿' : '複製失敗（瀏覽器限制）');
    });

    return root;
  }

  function mountPanel() {
    if (document.getElementById(PANEL_ID)) return;
    if (!document.body) return;
    const root = buildPanel();
    document.body.appendChild(root);
  }

  // 4) SPA：MutationObserver 確保主介面重繪後仍會掛上
  function ensureMountedWithObserver() {
    mountPanel();

    const obs = new MutationObserver(() => {
      // 若 panel 被移除（或 body 重建），補掛
      if (!document.getElementById(PANEL_ID)) {
        mountPanel();
      }
    });

    obs.observe(document.documentElement, { childList: true, subtree: true });
  }

  // DOM ready guard
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureMountedWithObserver, { once: true });
  } else {
    ensureMountedWithObserver();
  }
})();
