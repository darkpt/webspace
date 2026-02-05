// ==UserScript==
// @name         TIPO Patent Query Builder
// @namespace    https://github.com/darkpt/webspace/
// @version      1.2.3
// @description  專利查詢語法產生器 — 多欄位、多條件、自動組合布林查詢
// @author       darkpt
// @match        https://tiponet.tipo.gov.tw/gpss*/gpsskmc/gpssbkm*
// @updateURL    https://raw.githubusercontent.com/darkpt/webspace/main/Query_Builder.js
// @downloadURL  https://raw.githubusercontent.com/darkpt/webspace/main/Query_Builder.js
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════
  // §1 — CONSTANTS
  // ═══════════════════════════════════════════════════════════

  const CONSTANTS = {
    // — Script identity —
    SCRIPT_NAME: 'TIPO Query Builder',
    VERSION: '1.2.3',
    PREFIX: 'tqb',
    DEBUG: false,

    // — Dimensions —
    PANEL_WIDTH: 560,
    PANEL_MIN_HEIGHT: 200,
    PANEL_BORDER_RADIUS: 14,
    TOGGLE_SIZE: 44,
    ROW_GAP: 6,
    INPUT_HEIGHT: 34,
    BUTTON_HEIGHT: 34,
    SELECT_WIDTH_CONNECTOR: 70,
    SELECT_WIDTH_FIELD: 140,
    CHECKBOX_SIZE: 16,
    INPUT_FLEX: 1,
    Z_INDEX_PANEL: 99990,
    Z_INDEX_TOGGLE: 99991,
    Z_INDEX_TOAST: 99999,

    // — Colors (銀白底 + 淡藍/粉紅 純色) —
    COLORS: {
      PRIMARY_BLUE: '#5b9bd5',
      PRIMARY_BLUE_HOVER: '#4a8bc4',
      PRIMARY_PINK: '#e8839a',
      PRIMARY_PINK_HOVER: '#d6728a',
      BG_PANEL: '#f5f6fa',
      BG_ROW: '#ffffff',
      BG_INPUT: '#ffffff',
      BG_TOGGLE: 'linear-gradient(135deg, #5b9bd5, #e8839a)',
      BORDER_DEFAULT: '#d1d5db',
      BORDER_FOCUS: '#5b9bd5',
      TEXT_PRIMARY: '#1e293b',
      TEXT_SECONDARY: '#64748b',
      TEXT_PLACEHOLDER: '#9ca3af',
      TEXT_ON_COLOR: '#ffffff',
      HEADER_BG: '#ebedf3',
      NOT_DEFAULT_BG: '#f8f9fa',
      NOT_DEFAULT_BORDER: '#d1d5db',
      NOT_DEFAULT_TEXT: '#94a3b8',
      NOT_ACTIVE_BG: '#fee2e2',
      NOT_ACTIVE_BORDER: '#f87171',
      NOT_ACTIVE_TEXT: '#dc2626',
      BUTTON_DANGER_BG: '#fef2f2',
      BUTTON_DANGER_TEXT: '#ef4444',
      BUTTON_DANGER_HOVER_BG: '#fee2e2',
      BUTTON_ADD_BORDER: '#94a3b8',
      BUTTON_ADD_TEXT: '#64748b',
      BUTTON_ADD_HOVER_BORDER: '#5b9bd5',
      BUTTON_ADD_HOVER_TEXT: '#5b9bd5',
      BUTTON_CLEAR_BG: '#f1f5f9',
      BUTTON_CLEAR_TEXT: '#64748b',
      BUTTON_CLEAR_BORDER: '#cbd5e1',
      PREVIEW_BG: '#f0f4f8',
      PREVIEW_TEXT: '#334155',
      PREVIEW_BORDER: '#cbd5e1',
      TOAST_SUCCESS: '#16a34a',
      TOAST_ERROR: '#dc2626',
      CHECKBOX_CHECKED: '#5b9bd5',
      SHADOW_PANEL: '0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)',
      SHADOW_ROW: '0 1px 3px rgba(0,0,0,0.04)',
    },

    // — Hotkeys（熱鍵定義，修改此區即可調整快捷鍵綁定）—
    // 格式：{ key: KeyboardEvent.key, shift/ctrl/alt: boolean }
    HOTKEYS: {
      /** 新增查詢條件列：Shift + ↓ */
      ADD_ROW: { key: 'ArrowDown', shift: true, ctrl: false, alt: false },
    },

    // — Timing —
    TOAST_DURATION_MS: 2500,
    ANIMATION_DURATION_MS: 200,

    // — Selectors (TIPO page detection & query elements) —
    SELECTORS: {
      // 頁面偵測：列表頁排除條件
      LIST_PAGE_INDICATOR: 'select[onchange^="instback"]',
      // 基本搜尋頁
      QUERY_INPUT_BASIC: 'input[name="_21_1_T"]',
      SEARCH_BUTTON_BASIC: 'input[alt="查詢"]',
      // 進階搜尋頁
      QUERY_INPUT_ADVANCED: 'textarea[name="_3_10_X"]',
      SEARCH_BUTTON_ADVANCED: 'input[name="_IMG_檢索"]',
    },

    // — Field definitions —
    FIELD_TYPES: {
      FULLTEXT: 'FULLTEXT',
      KEYWORD: 'KEYWORD',
      RANGE_YEAR: 'RANGE_YEAR',
    },

    CONNECTORS: ['AND', 'OR'],

    // — Year validation —
    YEAR_MIN: 1900,
    YEAR_MAX: 2099,

    // — Element IDs —
    IDS: {
      PANEL: 'tqbPanel',
      TOGGLE: 'tqbToggle',
      ROWS_CONTAINER: 'tqbRowsContainer',
      PREVIEW: 'tqbPreview',
      TOAST: 'tqbToast',
    },
  };

  // ═══════════════════════════════════════════════════════════
  // §2 — FIELD MAP
  // ═══════════════════════════════════════════════════════════

  const FIELD_MAP = buildFieldMap();

  /**
   * 建構欄位定義映射表（TEXT_AT / EXACT_EQ 合併為 KEYWORD）
   * @returns {Map<string, {code: string, label: string, type: string}>}
   */
  function buildFieldMap() {
    const map = new Map();
    const { FIELD_TYPES } = CONSTANTS;

    map.set('FULLTEXT', {
      code: 'FULLTEXT', label: '全文(預設)', type: FIELD_TYPES.FULLTEXT,
    });

    const kwCodes = ['TI', 'AB', 'CL', 'DE', 'PA', 'IN', 'PN', 'AN', 'IC'];
    const kwLabels = {
      TI: '名稱(TI)', AB: '摘要(AB)', CL: '申請範圍(CL)', DE: '說明(DE)',
      PA: '申請人(PA)', IN: '發明人(IN)',
      PN: '公告號(PN)', AN: '申請號(AN)', IC: '國際分類(IC)',
    };
    kwCodes.forEach(code => {
      map.set(code, { code, label: kwLabels[code] || code, type: FIELD_TYPES.KEYWORD });
    });

    const rangeCodes = ['AD', 'ID'];
    const rangeLabels = { AD: '申請日(AD)', ID: '公告日(ID)' };
    rangeCodes.forEach(code => {
      map.set(code, { code, label: rangeLabels[code] || code, type: FIELD_TYPES.RANGE_YEAR });
    });

    return map;
  }

  // ═══════════════════════════════════════════════════════════
  // §3 — CSS STYLES (Template Literal)
  // ═══════════════════════════════════════════════════════════

  const STYLES = `
    /* ── Reset / Base ── */
    #${CONSTANTS.IDS.PANEL} *,
    #${CONSTANTS.IDS.PANEL} *::before,
    #${CONSTANTS.IDS.PANEL} *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    /* ── Layout: Toggle Button ── */
    #${CONSTANTS.IDS.TOGGLE} {
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: ${CONSTANTS.TOGGLE_SIZE}px;
      height: ${CONSTANTS.TOGGLE_SIZE}px;
      border-radius: 50%;
      background: ${CONSTANTS.COLORS.BG_TOGGLE};
      border: none;
      cursor: pointer;
      z-index: ${CONSTANTS.Z_INDEX_TOGGLE};
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 14px rgba(91, 155, 213, 0.35),
                  0 4px 14px rgba(232, 131, 154, 0.25);
      transition: transform ${CONSTANTS.ANIMATION_DURATION_MS}ms ease,
                  box-shadow ${CONSTANTS.ANIMATION_DURATION_MS}ms ease;
    }
    #${CONSTANTS.IDS.TOGGLE}:hover {
      transform: scale(1.1);
      box-shadow: 0 6px 22px rgba(91, 155, 213, 0.45),
                  0 6px 22px rgba(232, 131, 154, 0.35);
    }
    #${CONSTANTS.IDS.TOGGLE} svg {
      width: 22px;
      height: 22px;
      fill: #ffffff;
    }

    /* ── Layout: Panel ── */
    #${CONSTANTS.IDS.PANEL} {
      position: fixed;
      bottom: 76px;
      right: 20px;
      width: ${CONSTANTS.PANEL_WIDTH}px;
      min-height: ${CONSTANTS.PANEL_MIN_HEIGHT}px;
      max-height: 80vh;
      background: ${CONSTANTS.COLORS.BG_PANEL};
      border: 1px solid ${CONSTANTS.COLORS.BORDER_DEFAULT};
      border-radius: ${CONSTANTS.PANEL_BORDER_RADIUS}px;
      z-index: ${CONSTANTS.Z_INDEX_PANEL};
      display: none;
      flex-direction: column;
      overflow: hidden;
      box-shadow: ${CONSTANTS.COLORS.SHADOW_PANEL};
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: ${CONSTANTS.COLORS.TEXT_PRIMARY};
      font-size: 13px;
    }
    #${CONSTANTS.IDS.PANEL}.tqb-visible {
      display: flex;
    }

    /* ── Components: Header ── */
    .tqb-header {
      padding: 12px 16px;
      background: ${CONSTANTS.COLORS.HEADER_BG};
      border-bottom: 1px solid ${CONSTANTS.COLORS.BORDER_DEFAULT};
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }
    .tqb-header-title {
      font-size: 14px;
      font-weight: 700;
      color: ${CONSTANTS.COLORS.PRIMARY_BLUE};
      letter-spacing: 0.3px;
    }

    /* ── Components: Rows Container ── */
    #${CONSTANTS.IDS.ROWS_CONTAINER} {
      padding: 10px 14px;
      overflow-y: auto;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: ${CONSTANTS.ROW_GAP}px;
    }

    /* ── Components: Query Row ── */
    .tqb-row {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 7px 10px;
      background: ${CONSTANTS.COLORS.BG_ROW};
      border: 1px solid ${CONSTANTS.COLORS.BORDER_DEFAULT};
      border-radius: 8px;
      box-shadow: ${CONSTANTS.COLORS.SHADOW_ROW};
      transition: border-color ${CONSTANTS.ANIMATION_DURATION_MS}ms ease;
    }
    .tqb-row:hover {
      border-color: ${CONSTANTS.COLORS.PRIMARY_BLUE};
    }

    /* ── Components: Inputs / Selects ── */
    .tqb-select,
    .tqb-input {
      height: ${CONSTANTS.INPUT_HEIGHT}px;
      background: ${CONSTANTS.COLORS.BG_INPUT};
      border: 1px solid ${CONSTANTS.COLORS.BORDER_DEFAULT};
      border-radius: 6px;
      color: ${CONSTANTS.COLORS.TEXT_PRIMARY};
      font-size: 12px;
      padding: 0 8px;
      outline: none;
      transition: border-color ${CONSTANTS.ANIMATION_DURATION_MS}ms ease,
                  box-shadow ${CONSTANTS.ANIMATION_DURATION_MS}ms ease;
    }
    .tqb-select:focus,
    .tqb-input:focus {
      border-color: ${CONSTANTS.COLORS.BORDER_FOCUS};
      box-shadow: 0 0 0 2px rgba(91, 155, 213, 0.15);
    }
    .tqb-select {
      cursor: pointer;
      -webkit-appearance: none;
      appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%2364748b'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 8px center;
      padding-right: 22px;
    }
    .tqb-select-connector {
      width: ${CONSTANTS.SELECT_WIDTH_CONNECTOR}px;
      flex-shrink: 0;
    }
    .tqb-select-connector.tqb-disabled {
      opacity: 0.4;
      pointer-events: none;
      background: ${CONSTANTS.COLORS.BG_PANEL};
    }
    .tqb-select-field {
      width: ${CONSTANTS.SELECT_WIDTH_FIELD}px;
      flex-shrink: 0;
    }
    .tqb-input-keyword {
      flex: ${CONSTANTS.INPUT_FLEX};
      min-width: 0;
    }
    .tqb-input::placeholder {
      color: ${CONSTANTS.COLORS.TEXT_PLACEHOLDER};
    }
    .tqb-input-year {
      width: 68px;
      flex-shrink: 0;
      text-align: center;
    }
    .tqb-year-sep {
      color: ${CONSTANTS.COLORS.TEXT_SECONDARY};
      font-size: 12px;
      flex-shrink: 0;
    }

    /* ── Components: @ Checkbox ── */
    .tqb-at-checkbox-wrap {
      display: flex;
      align-items: center;
      flex-shrink: 0;
      gap: 2px;
      cursor: pointer;
      user-select: none;
    }
    .tqb-at-checkbox-wrap input[type="checkbox"] {
      width: ${CONSTANTS.CHECKBOX_SIZE}px;
      height: ${CONSTANTS.CHECKBOX_SIZE}px;
      margin: 0;
      cursor: pointer;
      accent-color: ${CONSTANTS.COLORS.CHECKBOX_CHECKED};
    }
    .tqb-at-label {
      font-size: 11px;
      font-weight: 600;
      color: ${CONSTANTS.COLORS.TEXT_SECONDARY};
      line-height: 1;
    }
    .tqb-at-label-active {
      color: ${CONSTANTS.COLORS.PRIMARY_BLUE};
    }

    /* ── Components: NOT toggle ── */
    .tqb-btn-not {
      width: 36px;
      height: ${CONSTANTS.INPUT_HEIGHT}px;
      border-radius: 6px;
      border: 1px solid ${CONSTANTS.COLORS.NOT_DEFAULT_BORDER};
      background: ${CONSTANTS.COLORS.NOT_DEFAULT_BG};
      color: ${CONSTANTS.COLORS.NOT_DEFAULT_TEXT};
      font-size: 10px;
      font-weight: 700;
      cursor: pointer;
      flex-shrink: 0;
      transition: all ${CONSTANTS.ANIMATION_DURATION_MS}ms ease;
    }
    .tqb-btn-not.tqb-active {
      background: ${CONSTANTS.COLORS.NOT_ACTIVE_BG};
      border-color: ${CONSTANTS.COLORS.NOT_ACTIVE_BORDER};
      color: ${CONSTANTS.COLORS.NOT_ACTIVE_TEXT};
    }

    /* ── Components: Row Remove ── */
    .tqb-btn-remove {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      border: 1px solid transparent;
      background: ${CONSTANTS.COLORS.BUTTON_DANGER_BG};
      color: ${CONSTANTS.COLORS.BUTTON_DANGER_TEXT};
      font-size: 13px;
      cursor: pointer;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background ${CONSTANTS.ANIMATION_DURATION_MS}ms ease;
    }
    .tqb-btn-remove:hover {
      background: ${CONSTANTS.COLORS.BUTTON_DANGER_HOVER_BG};
    }

    /* ── Components: Action Buttons Bar (above preview) ── */
    .tqb-actions {
      padding: 8px 14px;
      display: flex;
      gap: 8px;
      flex-shrink: 0;
    }
    .tqb-btn {
      height: ${CONSTANTS.BUTTON_HEIGHT}px;
      border: none;
      border-radius: 8px;
      padding: 0 14px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      transition: background ${CONSTANTS.ANIMATION_DURATION_MS}ms ease,
                  transform 80ms ease;
    }
    .tqb-btn:active {
      transform: scale(0.97);
    }
    .tqb-btn-add {
      background: transparent;
      border: 1px dashed ${CONSTANTS.COLORS.BUTTON_ADD_BORDER};
      color: ${CONSTANTS.COLORS.BUTTON_ADD_TEXT};
      flex: 1;
    }
    .tqb-btn-add:hover {
      border-color: ${CONSTANTS.COLORS.BUTTON_ADD_HOVER_BORDER};
      color: ${CONSTANTS.COLORS.BUTTON_ADD_HOVER_TEXT};
    }
    .tqb-btn-generate {
      background: ${CONSTANTS.COLORS.PRIMARY_BLUE};
      color: ${CONSTANTS.COLORS.TEXT_ON_COLOR};
      flex: 1;
    }
    .tqb-btn-generate:hover {
      background: ${CONSTANTS.COLORS.PRIMARY_BLUE_HOVER};
    }
    .tqb-btn-execute {
      background: ${CONSTANTS.COLORS.PRIMARY_PINK};
      color: ${CONSTANTS.COLORS.TEXT_ON_COLOR};
      flex: 1;
    }
    .tqb-btn-execute:hover {
      background: ${CONSTANTS.COLORS.PRIMARY_PINK_HOVER};
    }

    /* ── Components: Clear Button (header) ── */
    .tqb-btn-clear {
      height: 28px;
      padding: 0 10px;
      font-size: 11px;
      font-weight: 600;
      background: ${CONSTANTS.COLORS.BUTTON_CLEAR_BG};
      border: 1px solid ${CONSTANTS.COLORS.BUTTON_CLEAR_BORDER};
      border-radius: 6px;
      color: ${CONSTANTS.COLORS.BUTTON_CLEAR_TEXT};
      cursor: pointer;
      transition: background ${CONSTANTS.ANIMATION_DURATION_MS}ms ease;
    }
    .tqb-btn-clear:hover {
      background: ${CONSTANTS.COLORS.BORDER_DEFAULT};
    }

    /* ── Components: Preview ── */
    .tqb-preview-section {
      padding: 8px 14px 12px;
      flex-shrink: 0;
    }
    .tqb-preview-label {
      font-size: 10px;
      font-weight: 600;
      color: ${CONSTANTS.COLORS.TEXT_SECONDARY};
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 4px;
    }
    #${CONSTANTS.IDS.PREVIEW} {
      width: 100%;
      min-height: 48px;
      max-height: 80px;
      background: ${CONSTANTS.COLORS.PREVIEW_BG};
      border: 1px solid ${CONSTANTS.COLORS.PREVIEW_BORDER};
      border-radius: 6px;
      color: ${CONSTANTS.COLORS.PREVIEW_TEXT};
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      font-size: 12px;
      padding: 8px 10px;
      resize: none;
      outline: none;
      overflow-y: auto;
      word-break: break-all;
    }

    /* ── Components: Toast ── */
    #${CONSTANTS.IDS.TOAST} {
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 10px 18px;
      border-radius: 8px;
      color: #ffffff;
      font-size: 13px;
      font-weight: 500;
      z-index: ${CONSTANTS.Z_INDEX_TOAST};
      opacity: 0;
      transform: translateY(-10px);
      transition: opacity ${CONSTANTS.ANIMATION_DURATION_MS}ms ease,
                  transform ${CONSTANTS.ANIMATION_DURATION_MS}ms ease;
      pointer-events: none;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    #${CONSTANTS.IDS.TOAST}.tqb-toast-show {
      opacity: 1;
      transform: translateY(0);
    }

    /* ── Utilities ── */
    .tqb-hidden { display: none !important; }
    .tqb-connector-placeholder {
      width: ${CONSTANTS.SELECT_WIDTH_CONNECTOR}px;
      flex-shrink: 0;
    }
  `;

  // ═══════════════════════════════════════════════════════════
  // §4 — NAMESPACE OBJECT
  // ═══════════════════════════════════════════════════════════

  const TQB = {
    // ─── config ───
    config: {
      fieldMap: FIELD_MAP,
      fieldKeys: Array.from(FIELD_MAP.keys()),
    },

    // ─── state ───
    state: {
      isInitialized: false,
      isPanelVisible: false,
      pageType: null,  // 'basic' | 'advanced' | null (不支援的頁面)
      rows: [],
      rowIdCounter: 0,
      toastTimer: null,
    },

    // ─── elements (cached DOM refs) ───
    elements: {
      panel: null,
      toggle: null,
      rowsContainer: null,
      preview: null,
      toast: null,
    },

    // ─────────────────────────────────────────────────────
    // §4.1 — utils (pure functions, no DOM / state)
    // ─────────────────────────────────────────────────────

    utils: {
      /**
       * 將原始輸入拆解為去重 token 列表
       * @param {string} rawInput
       * @returns {string[]}
       */
      splitKeywords(rawInput) {
        if (!rawInput || typeof rawInput !== 'string') return [];
        const separators = [',', '，', ';', '；', '\n'];
        let s = rawInput;
        separators.forEach(sep => { s = s.split(sep).join('\n'); });
        const seen = new Set();
        const tokens = [];
        s.split('\n').forEach(line => {
          const t = line.trim();
          if (t && !seen.has(t)) {
            seen.add(t);
            tokens.push(t);
          }
        });
        return tokens;
      },

      /**
       * 將 token 列表組為 OR 群組字串
       * @param {string[]} tokens
       * @returns {string}
       */
      buildOrGroup(tokens) {
        if (!tokens.length) return '';
        if (tokens.length === 1) return `(${tokens[0]})`;
        return `(${tokens.join(' OR ')})`;
      },

      /**
       * 正規化年份字串
       * @param {string} y
       * @returns {string}
       */
      normalizeYear(y) {
        const trimmed = (y || '').trim();
        if (!/^[0-9]{4}$/.test(trimmed)) return '';
        const num = parseInt(trimmed, 10);
        if (num < CONSTANTS.YEAR_MIN || num > CONSTANTS.YEAR_MAX) return '';
        return trimmed;
      },

      /**
       * 建構日期區間 clause
       * @param {string} fieldCode
       * @param {string} yearFrom
       * @param {string} yearTo
       * @returns {string}
       */
      buildRangeClause(fieldCode, yearFrom, yearTo) {
        let yf = TQB.utils.normalizeYear(yearFrom);
        let yt = TQB.utils.normalizeYear(yearTo);
        if (!yf || !yt) return '';
        if (yf > yt) { [yf, yt] = [yt, yf]; }
        return `(${fieldCode}=${yf}:${yt})`;
      },

      /**
       * 將單一 Row 資料建構為查詢 clause
       * @param {object} rowData
       * @returns {string}
       */
      buildRowClause(rowData) {
        const fieldDef = FIELD_MAP.get(rowData.fieldCode);
        if (!fieldDef) return '';
        const { FIELD_TYPES } = CONSTANTS;

        if (fieldDef.type === FIELD_TYPES.RANGE_YEAR) {
          return TQB.utils.buildRangeYearRow(fieldDef.code, rowData);
        }
        return TQB.utils.buildKeywordRow(fieldDef, rowData);
      },

      /**
       * 處理日期類型 Row
       * @param {string} code
       * @param {object} rowData
       * @returns {string}
       */
      buildRangeYearRow(code, rowData) {
        const clause = TQB.utils.buildRangeClause(
          code, rowData.yearFrom, rowData.yearTo
        );
        return clause || '';
      },

      /**
       * 處理關鍵字類型 Row（依 useAtSyntax 決定 @ 或 = 語法）
       * @param {object} fieldDef
       * @param {object} rowData
       * @returns {string}
       */
      buildKeywordRow(fieldDef, rowData) {
        const { FIELD_TYPES } = CONSTANTS;
        const tokens = TQB.utils.splitKeywords(rowData.rawInput);
        const orGroup = TQB.utils.buildOrGroup(tokens);
        if (!orGroup) return '';

        let clause = '';
        if (fieldDef.type === FIELD_TYPES.FULLTEXT) {
          clause = orGroup;
        } else if (fieldDef.type === FIELD_TYPES.KEYWORD) {
          clause = rowData.useAtSyntax
            ? `(${orGroup}@${fieldDef.code})`
            : `(${fieldDef.code}=${orGroup})`;
        }
        if (!clause) return '';
        return clause;
      },

      /**
       * 將多列 Row 組合為最終查詢字串
       * connector（AND/OR）與 NOT 互斥：
       * - notFlag=true → 該列前綴為 NOT，忽略 connector
       * - notFlag=false → 該列前綴為 connector（AND/OR）
       * - 第一列無前綴
       * @param {object[]} rows
       * @returns {string}
       */
      buildQuery(rows) {
        const clauses = [];
        rows.forEach(row => {
          const clause = TQB.utils.buildRowClause(row);
          if (!clause) return;

          let prefix = '';
          if (clauses.length) {
            prefix = row.notFlag ? 'NOT' : (row.connector || 'AND');
          } else {
            prefix = row.notFlag ? 'NOT' : '';
          }
          clauses.push({ prefix, clause });
        });
        if (!clauses.length) return '';
        return clauses.map(c => {
          return c.prefix ? `${c.prefix} ${c.clause}` : c.clause;
        }).join(' ');
      },
    },

    // ─────────────────────────────────────────────────────
    // §4.2 — dom (all DOM creation / manipulation)
    // ─────────────────────────────────────────────────────

    dom: {
      /** 注入全域樣式 */
      injectStyles() {
        GM_addStyle(STYLES);
      },

      /** 建立 Toast 通知元素 */
      createToast() {
        const toast = document.createElement('div');
        toast.id = CONSTANTS.IDS.TOAST;
        document.body.appendChild(toast);
        TQB.elements.toast = toast;
      },

      /** 建立浮動切換按鈕 */
      createToggleButton() {
        const btn = document.createElement('button');
        btn.id = CONSTANTS.IDS.TOGGLE;
        btn.title = CONSTANTS.SCRIPT_NAME;
        btn.type = 'button';

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z');
        svg.appendChild(path);
        btn.appendChild(svg);

        document.body.appendChild(btn);
        TQB.elements.toggle = btn;
      },

      /**
       * 建立主面板容器
       * 順序：Header → Rows → Actions → Preview
       */
      createPanel() {
        const panel = document.createElement('div');
        panel.id = CONSTANTS.IDS.PANEL;

        panel.appendChild(TQB.dom.createHeader());

        const rowsContainer = document.createElement('div');
        rowsContainer.id = CONSTANTS.IDS.ROWS_CONTAINER;
        panel.appendChild(rowsContainer);

        panel.appendChild(TQB.dom.createActions());
        panel.appendChild(TQB.dom.createPreviewSection());

        document.body.appendChild(panel);
        TQB.elements.panel = panel;
        TQB.elements.rowsContainer = rowsContainer;
      },

      /**
       * 建立面板標題列
       * @returns {HTMLElement}
       */
      createHeader() {
        const header = document.createElement('div');
        header.className = 'tqb-header';

        const title = document.createElement('span');
        title.className = 'tqb-header-title';
        title.textContent = '⚡ Query Builder';
        header.appendChild(title);

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'tqb-btn-clear';
        clearBtn.textContent = '清除全部';
        clearBtn.addEventListener('click', () => TQB.events.handleClearAll());
        header.appendChild(clearBtn);

        return header;
      },

      /**
       * 建立查詢預覽區域
       * @returns {HTMLElement}
       */
      createPreviewSection() {
        const section = document.createElement('div');
        section.className = 'tqb-preview-section';

        const label = document.createElement('div');
        label.className = 'tqb-preview-label';
        label.textContent = 'Query Preview';
        section.appendChild(label);

        const textarea = document.createElement('textarea');
        textarea.id = CONSTANTS.IDS.PREVIEW;
        textarea.readOnly = true;
        textarea.placeholder = '查詢語法將在此顯示...';
        section.appendChild(textarea);

        TQB.elements.preview = textarea;
        return section;
      },

      /**
       * 建立操作按鈕列（位於 rows 與 preview 之間）
       * @returns {HTMLElement}
       */
      createActions() {
        const wrap = document.createElement('div');
        wrap.className = 'tqb-actions';

        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'tqb-btn tqb-btn-add';
        addBtn.textContent = '+ 新增條件';
        addBtn.addEventListener('click', () => TQB.events.handleAddRow());
        wrap.appendChild(addBtn);

        const genBtn = document.createElement('button');
        genBtn.type = 'button';
        genBtn.className = 'tqb-btn tqb-btn-generate';
        genBtn.textContent = '產生語法';
        genBtn.addEventListener('click', () => TQB.events.handleGenerate());
        wrap.appendChild(genBtn);

        const execBtn = document.createElement('button');
        execBtn.type = 'button';
        execBtn.className = 'tqb-btn tqb-btn-execute';
        execBtn.textContent = '執行搜尋';
        execBtn.addEventListener('click', () => TQB.events.handleExecute());
        wrap.appendChild(execBtn);

        return wrap;
      },

      /**
       * 建立單一查詢條件列 DOM
       * @param {number} rowId
       * @param {boolean} isFirst
       * @returns {HTMLElement}
       */
      createRowElement(rowId, isFirst) {
        const row = document.createElement('div');
        row.className = 'tqb-row';
        row.dataset.rowId = String(rowId);

        if (isFirst) {
          const ph = document.createElement('div');
          ph.className = 'tqb-connector-placeholder';
          row.appendChild(ph);
        } else {
          row.appendChild(TQB.dom.createConnectorSelect(rowId));
        }

        row.appendChild(TQB.dom.createNotButton(rowId));
        row.appendChild(TQB.dom.createFieldSelect(rowId));
        row.appendChild(TQB.dom.createAtCheckbox(rowId));
        row.appendChild(TQB.dom.createKeywordInput(rowId));

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'tqb-btn-remove';
        removeBtn.textContent = '✕';
        removeBtn.addEventListener('click', () => {
          TQB.events.handleRemoveRow(rowId);
        });
        row.appendChild(removeBtn);

        return row;
      },

      /**
       * 建立 connector 下拉選單
       * @param {number} rowId
       * @returns {HTMLSelectElement}
       */
      createConnectorSelect(rowId) {
        const sel = document.createElement('select');
        sel.className = 'tqb-select tqb-select-connector';
        sel.dataset.role = 'connector';
        CONSTANTS.CONNECTORS.forEach(val => {
          const opt = document.createElement('option');
          opt.value = val;
          opt.textContent = val;
          sel.appendChild(opt);
        });
        sel.addEventListener('change', () => {
          TQB.events.handleRowChange(rowId, 'connector', sel.value);
        });
        return sel;
      },

      /**
       * 建立 NOT 切換按鈕
       * @param {number} rowId
       * @returns {HTMLButtonElement}
       */
      createNotButton(rowId) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tqb-btn-not';
        btn.textContent = 'NOT';
        btn.dataset.role = 'not';
        btn.addEventListener('click', () => {
          TQB.events.handleToggleNot(rowId, btn);
        });
        return btn;
      },

      /**
       * 建立欄位選擇下拉
       * @param {number} rowId
       * @returns {HTMLSelectElement}
       */
      createFieldSelect(rowId) {
        const sel = document.createElement('select');
        sel.className = 'tqb-select tqb-select-field';
        sel.dataset.role = 'field';
        TQB.config.fieldKeys.forEach(key => {
          const def = FIELD_MAP.get(key);
          const opt = document.createElement('option');
          opt.value = def.code;
          opt.textContent = def.label;
          sel.appendChild(opt);
        });
        sel.addEventListener('change', () => {
          TQB.events.handleFieldChange(rowId, sel.value);
        });
        return sel;
      },

      /**
       * 建立 @ 語法切換 checkbox（false="=", true="@"）
       * FULLTEXT / RANGE_YEAR 欄位時隱藏
       * @param {number} rowId
       * @returns {HTMLLabelElement}
       */
      createAtCheckbox(rowId) {
        const wrap = document.createElement('label');
        wrap.className = 'tqb-at-checkbox-wrap';
        wrap.dataset.role = 'atWrap';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = false;
        cb.dataset.role = 'atCheckbox';

        const labelSpan = document.createElement('span');
        labelSpan.className = 'tqb-at-label';
        labelSpan.textContent = '=';

        cb.addEventListener('change', () => {
          TQB.events.handleAtToggle(rowId, cb.checked, labelSpan);
        });

        wrap.appendChild(cb);
        wrap.appendChild(labelSpan);
        wrap.style.display = 'none';
        return wrap;
      },

      /**
       * 建立關鍵字輸入框
       * @param {number} rowId
       * @returns {HTMLInputElement}
       */
      createKeywordInput(rowId) {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'tqb-input tqb-input-keyword';
        input.dataset.role = 'keyword';
        input.placeholder = '關鍵字（逗號分隔為 OR）';
        input.addEventListener('input', () => {
          TQB.events.handleRowChange(rowId, 'rawInput', input.value);
        });
        return input;
      },

      /**
       * 建立年份區間輸入組
       * @param {number} rowId
       * @returns {DocumentFragment}
       */
      createYearInputs(rowId) {
        const frag = document.createDocumentFragment();

        const fromInput = document.createElement('input');
        fromInput.type = 'text';
        fromInput.className = 'tqb-input tqb-input-year';
        fromInput.dataset.role = 'yearFrom';
        fromInput.placeholder = '起始年';
        fromInput.maxLength = 4;
        fromInput.addEventListener('input', () => {
          TQB.events.handleRowChange(rowId, 'yearFrom', fromInput.value);
        });
        frag.appendChild(fromInput);

        const sep = document.createElement('span');
        sep.className = 'tqb-year-sep';
        sep.textContent = '~';
        frag.appendChild(sep);

        const toInput = document.createElement('input');
        toInput.type = 'text';
        toInput.className = 'tqb-input tqb-input-year';
        toInput.dataset.role = 'yearTo';
        toInput.placeholder = '結束年';
        toInput.maxLength = 4;
        toInput.addEventListener('input', () => {
          TQB.events.handleRowChange(rowId, 'yearTo', toInput.value);
        });
        frag.appendChild(toInput);

        return frag;
      },

      /**
       * 切換 Row 輸入模式（keyword / year）並控制 checkbox
       * @param {HTMLElement} rowEl
       * @param {string} fieldCode
       * @param {number} rowId
       */
      switchRowInputMode(rowEl, fieldCode, rowId) {
        const fieldDef = FIELD_MAP.get(fieldCode);
        if (!fieldDef) return;
        const { FIELD_TYPES } = CONSTANTS;
        const isYear = fieldDef.type === FIELD_TYPES.RANGE_YEAR;
        const isKw = fieldDef.type === FIELD_TYPES.KEYWORD;

        TQB.dom.removeInputElements(rowEl);
        TQB.dom.updateAtCheckboxVisibility(rowEl, isKw);

        const removeBtn = rowEl.querySelector('.tqb-btn-remove');
        if (isYear) {
          const yearFrag = TQB.dom.createYearInputs(rowId);
          rowEl.insertBefore(yearFrag, removeBtn);
          TQB.dom.restoreYearValues(rowEl, rowId);
        } else {
          const kwInput = TQB.dom.createKeywordInput(rowId);
          rowEl.insertBefore(kwInput, removeBtn);
          TQB.dom.restoreKeywordValue(kwInput, rowId);
        }
      },

      /**
       * 回填 keyword input 的值（從 state）
       * @param {HTMLInputElement} input
       * @param {number} rowId
       */
      restoreKeywordValue(input, rowId) {
        const rowData = TQB.state.rows.find(r => r.id === rowId);
        if (rowData && rowData.rawInput) {
          input.value = rowData.rawInput;
        }
      },

      /**
       * 回填 year inputs 的值（從 state）
       * @param {HTMLElement} rowEl
       * @param {number} rowId
       */
      restoreYearValues(rowEl, rowId) {
        const rowData = TQB.state.rows.find(r => r.id === rowId);
        if (!rowData) return;
        const fromInput = rowEl.querySelector('[data-role="yearFrom"]');
        const toInput = rowEl.querySelector('[data-role="yearTo"]');
        if (fromInput && rowData.yearFrom) fromInput.value = rowData.yearFrom;
        if (toInput && rowData.yearTo) toInput.value = rowData.yearTo;
      },

      /**
       * 控制 @ checkbox 的顯示/隱藏
       * @param {HTMLElement} rowEl
       * @param {boolean} show
       */
      updateAtCheckboxVisibility(rowEl, show) {
        const wrap = rowEl.querySelector('[data-role="atWrap"]');
        if (wrap) wrap.style.display = show ? 'flex' : 'none';
      },

      /**
       * 重置 Row 中的 @ checkbox 為預設狀態
       * @param {HTMLElement} rowEl
       */
      resetAtCheckbox(rowEl) {
        const cb = rowEl.querySelector('[data-role="atCheckbox"]');
        const label = rowEl.querySelector('.tqb-at-label');
        if (cb) cb.checked = false;
        if (label) {
          label.textContent = '=';
          label.classList.remove('tqb-at-label-active');
        }
      },

      /**
       * 移除 Row 中的可變動輸入元素
       * @param {HTMLElement} rowEl
       */
      removeInputElements(rowEl) {
        const kwInputs = rowEl.querySelectorAll('.tqb-input-keyword');
        const yearInputs = rowEl.querySelectorAll('.tqb-input-year');
        const seps = rowEl.querySelectorAll('.tqb-year-sep');
        kwInputs.forEach(el => el.remove());
        yearInputs.forEach(el => el.remove());
        seps.forEach(el => el.remove());
      },

      /**
       * 更新預覽區域文字
       * @param {string} queryText
       */
      updatePreview(queryText) {
        if (TQB.elements.preview) {
          TQB.elements.preview.value = queryText;
        }
      },

      /**
       * 顯示 Toast 通知
       * @param {string} message
       * @param {'success'|'error'} type
       */
      showToast(message, type) {
        const toast = TQB.elements.toast;
        if (!toast) return;

        if (TQB.state.toastTimer) clearTimeout(TQB.state.toastTimer);

        toast.textContent = message;
        toast.style.background = type === 'error'
          ? CONSTANTS.COLORS.TOAST_ERROR
          : CONSTANTS.COLORS.TOAST_SUCCESS;
        toast.classList.add('tqb-toast-show');

        TQB.state.toastTimer = setTimeout(() => {
          toast.classList.remove('tqb-toast-show');
          TQB.state.toastTimer = null;
        }, CONSTANTS.TOAST_DURATION_MS);
      },
    },

    // ─────────────────────────────────────────────────────
    // §4.3 — events (all event handlers, dispatch only)
    // ─────────────────────────────────────────────────────

    events: {
      /** 切換面板顯示/隱藏 */
      handleTogglePanel() {
        TQB.state.isPanelVisible = !TQB.state.isPanelVisible;
        TQB.elements.panel.classList.toggle(
          'tqb-visible', TQB.state.isPanelVisible
        );
      },

      /** 新增查詢條件列 */
      handleAddRow() {
        const rowId = TQB.state.rowIdCounter++;
        const isFirst = TQB.state.rows.length === 0;

        const rowData = {
          id: rowId,
          connector: isFirst ? '' : 'AND',
          notFlag: false,
          fieldCode: 'FULLTEXT',
          useAtSyntax: false,
          rawInput: '',
          yearFrom: '',
          yearTo: '',
        };
        TQB.state.rows.push(rowData);

        const rowEl = TQB.dom.createRowElement(rowId, isFirst);
        TQB.elements.rowsContainer.appendChild(rowEl);

        const kwInput = rowEl.querySelector('[data-role="keyword"]');
        if (kwInput) kwInput.focus();
      },

      /**
       * 移除查詢條件列
       * @param {number} rowId
       */
      handleRemoveRow(rowId) {
        TQB.state.rows = TQB.state.rows.filter(r => r.id !== rowId);
        const rowEl = TQB.elements.rowsContainer.querySelector(
          `[data-row-id="${rowId}"]`
        );
        if (rowEl) rowEl.remove();
        TQB.events.refreshFirstRowConnector();
      },

      /** 確保第一列無 connector */
      refreshFirstRowConnector() {
        if (!TQB.state.rows.length) return;
        TQB.state.rows[0].connector = '';
        const firstEl = TQB.elements.rowsContainer.firstElementChild;
        if (!firstEl) return;

        const sel = firstEl.querySelector('[data-role="connector"]');
        if (sel) {
          const ph = document.createElement('div');
          ph.className = 'tqb-connector-placeholder';
          sel.replaceWith(ph);
        }
      },

      /**
       * 處理列資料變更（connector 變更時清除 NOT，互斥）
       * @param {number} rowId
       * @param {string} prop
       * @param {*} value
       */
      handleRowChange(rowId, prop, value) {
        const rowData = TQB.state.rows.find(r => r.id === rowId);
        if (!rowData) return;
        rowData[prop] = value;

        if (prop === 'connector' && value) {
          TQB.events.clearNotFlag(rowId);
        }
      },

      /**
       * 切換 NOT 旗標（啟用時清除 connector，互斥）
       * @param {number} rowId
       * @param {HTMLButtonElement} btn
       */
      handleToggleNot(rowId, btn) {
        const rowData = TQB.state.rows.find(r => r.id === rowId);
        if (!rowData) return;
        rowData.notFlag = !rowData.notFlag;
        btn.classList.toggle('tqb-active', rowData.notFlag);

        if (rowData.notFlag) {
          TQB.events.disableConnector(rowId);
        } else {
          TQB.events.enableConnector(rowId);
        }
      },

      /**
       * 清除指定列的 NOT 旗標並更新 UI
       * @param {number} rowId
       */
      clearNotFlag(rowId) {
        const rowData = TQB.state.rows.find(r => r.id === rowId);
        if (!rowData || !rowData.notFlag) return;
        rowData.notFlag = false;

        const rowEl = TQB.elements.rowsContainer.querySelector(
          `[data-row-id="${rowId}"]`
        );
        if (!rowEl) return;
        const notBtn = rowEl.querySelector('[data-role="not"]');
        if (notBtn) notBtn.classList.remove('tqb-active');
      },

      /**
       * 禁用指定列的 connector（NOT 啟用時）
       * @param {number} rowId
       */
      disableConnector(rowId) {
        const rowData = TQB.state.rows.find(r => r.id === rowId);
        if (rowData) rowData.connector = '';

        const rowEl = TQB.elements.rowsContainer.querySelector(
          `[data-row-id="${rowId}"]`
        );
        if (!rowEl) return;
        const sel = rowEl.querySelector('[data-role="connector"]');
        if (sel) sel.classList.add('tqb-disabled');
      },

      /**
       * 啟用指定列的 connector（NOT 關閉時恢復）
       * @param {number} rowId
       */
      enableConnector(rowId) {
        const rowData = TQB.state.rows.find(r => r.id === rowId);
        const rowEl = TQB.elements.rowsContainer.querySelector(
          `[data-row-id="${rowId}"]`
        );
        if (!rowEl) return;
        const sel = rowEl.querySelector('[data-role="connector"]');
        if (!sel) return;

        sel.classList.remove('tqb-disabled');
        if (rowData) rowData.connector = sel.value || 'AND';
      },

      /**
       * 切換 @ 語法 checkbox
       * @param {number} rowId
       * @param {boolean} checked
       * @param {HTMLElement} labelSpan
       */
      handleAtToggle(rowId, checked, labelSpan) {
        const rowData = TQB.state.rows.find(r => r.id === rowId);
        if (!rowData) return;
        rowData.useAtSyntax = checked;
        labelSpan.textContent = checked ? '@' : '=';
        labelSpan.classList.toggle('tqb-at-label-active', checked);
      },

      /**
       * 處理欄位切換
       * FULLTEXT / KEYWORD 視為同類（文字輸入），切換時保留 rawInput
       * 僅切換至/從 RANGE_YEAR 時才清空輸入值
       * @param {number} rowId
       * @param {string} fieldCode
       */
      handleFieldChange(rowId, fieldCode) {
        const rowData = TQB.state.rows.find(r => r.id === rowId);
        if (!rowData) return;

        const prevDef = FIELD_MAP.get(rowData.fieldCode);
        const newDef = FIELD_MAP.get(fieldCode);
        const { FIELD_TYPES } = CONSTANTS;

        const isTextType = (t) => t === FIELD_TYPES.FULLTEXT || t === FIELD_TYPES.KEYWORD;
        const prevIsText = isTextType(prevDef?.type);
        const newIsText = isTextType(newDef?.type);
        const needsClear = prevIsText !== newIsText;

        rowData.fieldCode = fieldCode;
        rowData.useAtSyntax = false;

        if (needsClear) {
          rowData.rawInput = '';
          rowData.yearFrom = '';
          rowData.yearTo = '';
        }

        const rowEl = TQB.elements.rowsContainer.querySelector(
          `[data-row-id="${rowId}"]`
        );
        if (!rowEl) return;

        TQB.dom.resetAtCheckbox(rowEl);

        if (prevDef?.type !== newDef?.type) {
          TQB.dom.switchRowInputMode(rowEl, fieldCode, rowId);
        } else {
          const isKw = newDef?.type === FIELD_TYPES.KEYWORD;
          TQB.dom.updateAtCheckboxVisibility(rowEl, isKw);
        }
      },

      /** 產生查詢語法並顯示於預覽 */
      handleGenerate() {
        try {
          const query = TQB.utils.buildQuery(TQB.state.rows);
          TQB.dom.updatePreview(query);
          if (!query) {
            TQB.dom.showToast('尚未填入任何查詢條件', 'error');
            return;
          }
          TQB.dom.showToast('查詢語法已產生', 'success');
        } catch (err) {
          TQB.handleError('handleGenerate', err);
        }
      },

      /** 產生查詢並填入 TIPO 搜尋框，執行搜尋 */
      handleExecute() {
        try {
          const query = TQB.utils.buildQuery(TQB.state.rows);
          TQB.dom.updatePreview(query);
          if (!query) {
            TQB.dom.showToast('尚未填入任何查詢條件', 'error');
            return;
          }
          TQB.events.applyToPage(query);
        } catch (err) {
          TQB.handleError('handleExecute', err);
        }
      },

      /**
       * 將查詢字串套用至 TIPO 頁面並觸發搜尋
       * 依 pageType 決定使用基本或進階搜尋的元素
       * @param {string} query
       */
      applyToPage(query) {
        const { SELECTORS } = CONSTANTS;
        const isAdvanced = TQB.state.pageType === 'advanced';

        const inputSel = isAdvanced
          ? SELECTORS.QUERY_INPUT_ADVANCED
          : SELECTORS.QUERY_INPUT_BASIC;
        const btnSel = isAdvanced
          ? SELECTORS.SEARCH_BUTTON_ADVANCED
          : SELECTORS.SEARCH_BUTTON_BASIC;

        const input = document.querySelector(inputSel);
        if (!input) {
          TQB.dom.showToast('找不到查詢輸入框', 'error');
          return;
        }
        input.value = query;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));

        const btn = document.querySelector(btnSel);
        if (!btn) {
          TQB.dom.showToast('語法已填入，但找不到搜尋按鈕', 'error');
          return;
        }
        btn.click();
        TQB.dom.showToast('搜尋已執行', 'success');
      },

      /** 清除所有查詢條件 */
      handleClearAll() {
        TQB.state.rows = [];
        TQB.state.rowIdCounter = 0;
        if (TQB.elements.rowsContainer) {
          TQB.elements.rowsContainer.textContent = '';
        }
        TQB.dom.updatePreview('');
      },

      /**
       * 全域熱鍵分派器
       * 熱鍵定義集中於 CONSTANTS.HOTKEYS，修改該區即可調整綁定
       * @param {KeyboardEvent} e
       */
      handleHotkey(e) {
        if (!TQB.state.isPanelVisible) return;
        const hk = CONSTANTS.HOTKEYS.ADD_ROW;
        const matched = e.key === hk.key
          && e.shiftKey === hk.shift
          && e.ctrlKey === hk.ctrl
          && e.altKey === hk.alt;
        if (matched) {
          e.preventDefault();
          TQB.events.handleAddRow();
        }
      },
    },

    // ─────────────────────────────────────────────────────
    // §4.4 — handleError (unified)
    // ─────────────────────────────────────────────────────

    /**
     * 統一錯誤處理
     * @param {string} context
     * @param {Error} error
     */
    handleError(context, error) {
      console.error(`[${CONSTANTS.SCRIPT_NAME}] Error in ${context}:`, error);
      TQB.dom.showToast(`操作失敗：${context}`, 'error');
    },

    // ─────────────────────────────────────────────────────
    // §4.5 — init (single entry point)
    // ─────────────────────────────────────────────────────

    /**
     * 偵測當前頁面類型
     * @returns {'basic'|'advanced'|null}
     */
    detectPageType() {
      const { SELECTORS } = CONSTANTS;

      // 列表頁排除
      if (document.querySelector(SELECTORS.LIST_PAGE_INDICATOR)) {
        return null;
      }
      // 基本搜尋頁
      if (document.querySelector(SELECTORS.QUERY_INPUT_BASIC)) {
        return 'basic';
      }
      // 進階搜尋頁
      if (document.querySelector(SELECTORS.QUERY_INPUT_ADVANCED)) {
        return 'advanced';
      }
      // 其他頁面（內文等）
      return null;
    },

    /** 初始化腳本：偵測頁面、注入樣式、建立 DOM、綁定事件 */
    init() {
      if (TQB.state.isInitialized) return;
      TQB.state.isInitialized = true;

      // 頁面偵測
      TQB.state.pageType = TQB.detectPageType();
      if (!TQB.state.pageType) {
        if (CONSTANTS.DEBUG) {
          console.log(`[${CONSTANTS.SCRIPT_NAME}] 非搜尋頁面，略過初始化`);
        }
        return;
      }

      try {
        TQB.dom.injectStyles();
        TQB.dom.createToast();
        TQB.dom.createToggleButton();
        TQB.dom.createPanel();

        TQB.elements.toggle.addEventListener('click', () => {
          TQB.events.handleTogglePanel();
        });

        // 全域熱鍵監聽（定義見 CONSTANTS.HOTKEYS）
        document.addEventListener('keydown', TQB.events.handleHotkey);

        TQB.events.handleAddRow();

        if (CONSTANTS.DEBUG) {
          console.log(
            `[${CONSTANTS.SCRIPT_NAME}] v${CONSTANTS.VERSION} initialized (${TQB.state.pageType}).`
          );
        }
      } catch (err) {
        TQB.handleError('init', err);
      }
    },
  };

  // ═══════════════════════════════════════════════════════════
  // §5 — INITIALIZATION
  // ═══════════════════════════════════════════════════════════

  TQB.init();
})();
