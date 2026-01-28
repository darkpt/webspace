// ==UserScript==
// @name         TIPONET 全文抓取：自動翻頁抓取 (v1.9)
// @namespace    https://tampermonkey.net/
// @version      1.9
// @description  自動翻頁抓取公開公告號，增強穩定性：延長延遲時間、重試機制、分批儲存，輸出 Markdown + CSV 格式
// @match        https://tiponet.tipo.gov.tw/gpss*/gpsskmc/gpssbkm*
// @updateURL    https://raw.githubusercontent.com/darkpt/webspace/main/TIPO_extract.js
// @downloadURL  https://raw.githubusercontent.com/darkpt/webspace/main/TIPO_extract.js
// @run-at       document-idle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_download
// ==/UserScript==

(function () {
  'use strict';

  // === 設定區 ===
  const STORAGE_KEY = 'tiponet_scrape_data';
  const STATUS_KEY = 'tiponet_scrape_running';
  const POSITION_KEY = 'tiponet_toolbar_position';
  const COLLAPSED_KEY = 'tiponet_toolbar_collapsed';
  const PANELS_KEY = 'tiponet_selected_panels';
  const SETTINGS_COLLAPSED_KEY = 'tiponet_settings_collapsed';

  const LINK_SELECTOR = 'td.sumtd2_PN a.link02[href]';
  const DELAY_MS = 1000;        // 增加到 1000ms 以降低伺服器負載
  const PAGE_DELAY_MS = 2000;   // 增加到 2000ms 讓翻頁更穩定
  const BATCH_SIZE = 100;       // 每 100 筆儲存一次,防止記憶體問題

  // 可選擇的段落
  const AVAILABLE_PANELS = [
    { id: 'summary', name: '摘要', default: false },
    { id: 'biblio', name: '書目資料', default: false },
    { id: 'claims', name: '專利範圍', default: false },
    { id: 'description', name: '詳細說明', default: true },
    { id: 'symbols', name: '符號說明', default: false }
  ];

  // 段落名稱對應
  const PANEL_NAME_MAP = {
    'summary': ['摘要'],
    'biblio': ['書目資料'],
    'claims': ['專利範圍', '申請專利範圍'],
    'description': ['詳細說明', '發明說明', '新型說明'],
    'symbols': ['符號說明', '元件符號說明']
  };

  // === 工具函數 ===
  function absUrl(href) {
    return new URL(href, location.href).href;
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function waitForElement(selector, maxRetry = 20) {
    let retry = 0;
    while (!document.querySelector(selector) && retry < maxRetry) {
      await delay(800);  // 增加到 800ms 給予更多載入時間
      retry++;
    }
    return document.querySelector(selector);
  }

  function getPageInfo() {
    const pageEl = document.querySelector('.PG');
    if (!pageEl) return { current: 1, total: 1 };

    const text = pageEl.innerText.trim();
    const match = text.match(/(\d+)\s*\/\s*(\d+)/);
    if (match) {
      return {
        current: parseInt(match[1]),
        total: parseInt(match[2])
      };
    }
    return { current: 1, total: 1 };
  }

  function collectCurrentPageLinks() {
    const anchors = Array.from(document.querySelectorAll(LINK_SELECTOR));
    return anchors.map(a => {
      const row = a.closest('tr');
      const titleEl = row ? row.querySelector('.sumtd2_TI') : null;
      return {
        no: (a.textContent || '').trim(),
        url: absUrl(a.getAttribute('href')),
        listTitle: titleEl ? titleEl.textContent.trim() : ''
      };
    }).filter(item => item.no && item.url);
  }

  async function fetchHtml(url) {
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'same-origin',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.text();
  }

  // 帶重試機制的 fetchHtml
  async function fetchHtmlWithRetry(url, maxRetries = 3) {
    let lastError;

    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await fetch(url, {
          method: 'GET',
          credentials: 'same-origin',
          headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          }
        });

        // 如果是 429 (Too Many Requests),等待更長時間後重試
        if (response.status === 429) {
          const waitTime = (i + 1) * 5000; // 5秒、10秒、15秒
          console.log(`[GPSS] 伺服器繁忙 (429),等待 ${waitTime / 1000} 秒後重試...`);
          await delay(waitTime);
          continue;
        }

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        return await response.text();

      } catch (e) {
        lastError = e;
        if (i < maxRetries - 1) {
          const retryDelay = 2000 * (i + 1); // 2秒、4秒、6秒漸進式延遲
          console.log(`[GPSS] 請求失敗,等待 ${retryDelay / 1000} 秒後重試 (${i + 1}/${maxRetries})...`);
          await delay(retryDelay);
        }
      }
    }

    throw lastError;
  }

  // === 取得用戶選擇的段落 ===
  function getSelectedPanels() {
    const saved = GM_getValue(PANELS_KEY, null);
    if (saved) {
      return saved;
    }
    const defaults = {};
    AVAILABLE_PANELS.forEach(p => {
      defaults[p.id] = p.default;
    });
    return defaults;
  }

  function saveSelectedPanels(panels) {
    GM_setValue(PANELS_KEY, panels);
  }

  function isPanelSelected(panelTitle, selectedPanels) {
    for (const [id, names] of Object.entries(PANEL_NAME_MAP)) {
      if (selectedPanels[id]) {
        for (const name of names) {
          if (panelTitle.includes(name)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  // === 核心擷取函數 ===
  function extractAllPanels(doc, selectedPanels) {
    const results = [];
    const panels = doc.querySelectorAll('.panel');
    let biblioData = {}; // Store parsed bibliographic data

    panels.forEach((panel) => {
      const titleEl = panel.querySelector('.panel-title');
      if (!titleEl) return;

      const titleClone = titleEl.cloneNode(true);
      const moreLink = titleClone.querySelector('.moreLink, .clswitch');
      if (moreLink) moreLink.remove();
      const titleText = titleClone.textContent.trim();

      if (!titleText) return;

      if (!isPanelSelected(titleText, selectedPanels)) {
        return;
      }

      const bodyEl = panel.querySelector('.panel-body');
      const content = bodyEl?.textContent?.trim() || '';

      // Special handling for bibliographic data
      if (titleText.includes('書目資料')) {
        biblioData = parseBiblioTable(bodyEl);
      }

      results.push({
        panelTitle: titleText,
        content: content,
        contentLength: content.length
      });
    });

    return { results, biblioData };
  }

  function parseBiblioTable(panelBody) {
    const fields = {};
    if (!panelBody) return fields;

    const rows = panelBody.querySelectorAll('tr.rectr');
    rows.forEach(row => {
      const nameCell = row.querySelector('td.dettb01');
      const valueCell = row.querySelector('td.dettb02');

      if (nameCell && valueCell) {
        const fieldName = nameCell.textContent.trim();
        // Use structured text content for cleaner data (e.g. replace newlines with space)
        const fieldValue = valueCell.textContent.trim().replace(/\s+/g, ' ');
        fields[fieldName] = fieldValue;
      }
    });
    return fields;
  }

  function extractContent(htmlText, selectedPanels) {
    const doc = new DOMParser().parseFromString(htmlText, 'text/html');
    const title = (doc.querySelector('title')?.textContent || '').trim();

    if (title === 'RefleshHtml' || htmlText.length < 500) {
      return {
        title: '（Session 過期或重導向）',
        panels: [],
        isRedirect: true,
        frurl: null
      };
    }

    const { results: allPanels, biblioData } = extractAllPanels(doc, selectedPanels);

    // 提取 #FRURL 輸入欄位的值
    const frurlInput = doc.querySelector('#FRURL');
    const frurl = frurlInput?.value || null;

    return {
      title,
      panels: allPanels,
      biblioData, // Add biblioData to return object
      isRedirect: false,
      frurl
    };
  }

  // === 進度 UI ===
  let progressDiv = null;

  function showProgress(message, current, total, detail = '') {
    if (!progressDiv) {
      progressDiv = document.createElement('div');
      progressDiv.id = 'tiponet-progress';
      progressDiv.style.cssText = `
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
        background: white; padding: 30px; border-radius: 8px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        z-index: 999999; text-align: center; min-width: 350px;
      `;
      document.body.appendChild(progressDiv);
    }

    const percent = total > 0 ? Math.round((current / total) * 100) : 0;

    progressDiv.innerHTML = `
      <div style="font-size:18px; margin-bottom:15px; font-weight:bold;">${message}</div>
      <div style="font-size:14px; margin-bottom:10px;">${current} / ${total}</div>
      <div style="background:#e0e0e0; height:8px; border-radius:4px;">
        <div style="background:#1976d2; height:100%; width:${percent}%; border-radius:4px; transition:width 0.3s;"></div>
      </div>
      <div style="font-size:12px; color:#666; margin-top:8px;">${detail}</div>
      <button id="tiponet-cancel" style="margin-top:15px; padding:8px 20px; background:#f44336; color:white; border:none; border-radius:4px; cursor:pointer;">
        取消
      </button>
    `;

    document.getElementById('tiponet-cancel').onclick = () => {
      GM_setValue(STATUS_KEY, false);
      hideProgress();
      alert('已取消抓取任務');
      location.reload();
    };
  }

  function hideProgress() {
    if (progressDiv) {
      progressDiv.remove();
      progressDiv = null;
    }
  }

  // === Markdown 報告產生 ===
  function buildMarkdownReport(rows, selectedPanels) {
    const now = new Date().toLocaleString('zh-TW');

    const selectedNames = AVAILABLE_PANELS
      .filter(p => selectedPanels[p.id])
      .map(p => p.name)
      .join('、');

    // 統計
    const successCount = rows.filter(r => !r.error && !r.isRedirect).length;
    const redirectCount = rows.filter(r => r.isRedirect).length;
    const errorCount = rows.filter(r => r.error).length;

    let md = [];

    // 標題與摘要資訊
    md.push(`# TIPONET 匯整報告`);
    md.push(``);
    md.push(`- **產生時間**：${now}`);
    md.push(`- **總筆數**：${rows.length}`);
    md.push(`- **成功**：${successCount} 筆`);
    if (redirectCount > 0) md.push(`- **Session 問題**：${redirectCount} 筆`);
    if (errorCount > 0) md.push(`- **錯誤**：${errorCount} 筆`);
    md.push(`- **擷取段落**：${selectedNames}`);
    md.push(``);

    // 目錄
    md.push(`---`);
    md.push(``);
    md.push(`## 目錄`);
    md.push(``);
    rows.forEach((r, i) => {
      const status = r.error ? '❌' : (r.isRedirect ? '⚠️' : '✅');
      const title = r.title || '（無標題）';
      // 使用公告號作為錨點
      const anchor = r.no.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '-');
      md.push(`${i + 1}. [${r.no} - ${title}](#${anchor}) ${status}`);
    });
    md.push(``);

    // 詳細內容
    md.push(`---`);
    md.push(``);
    md.push(`## 詳細內容`);
    md.push(``);

    rows.forEach((r, i) => {
      const anchor = r.no.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '-');

      md.push(`### ${r.no} {#${anchor}}`);
      md.push(``);

      if (r.title && r.title !== '（Session 過期或重導向）') {
        md.push(`**標題**：${r.title}`);
        md.push(``);
      }

      md.push(`**連結**：[${r.url}](${r.url})`);
      md.push(``);

      if (r.timestamp) {
        md.push(`**抓取時間**：${r.timestamp}`);
        md.push(``);
      }

      // 狀態
      if (r.error) {
        md.push(`> ❌ **錯誤**：${r.error}`);
        md.push(``);
      } else if (r.isRedirect) {
        md.push(`> ⚠️ **Session 問題**：無法取得內容`);
        md.push(``);
      } else if (r.panels && r.panels.length > 0) {
        // 各段落內容
        r.panels.forEach(p => {
          md.push(`#### ${p.panelTitle}`);
          md.push(``);
          md.push(`> ${p.contentLength} 字`);
          md.push(``);
          // 內容使用引用區塊或直接顯示
          if (p.content) {
            // 將內容分段，避免過長
            const content = p.content.trim();
            md.push(content);
            md.push(``);
          } else {
            md.push(`（無內容）`);
            md.push(``);
          }
        });
      } else {
        md.push(`（無符合條件的段落）`);
        md.push(``);
      }

      md.push(`---`);
      md.push(``);
    });

    return md.join('\n');
  }

  // === CSV 報告產生 ===
  function buildCsvReport(rows) {
    const escCsv = (s) => {
      if (s == null) return '';
      const str = String(s);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };

    // Updated fixed headers as requested
    const fixedHeaders = [
      '公告號', '列表標題', '申請日', '公告日', '申請號',
      '公告號(書目)', '證書號', '申請人', '發明人', '代理人',
      '審查委員', '優先權', '引用專利', '公報IPC', 'IPC',
      '公報卷期', '類別碼'
    ];

    const contentHeaders = ['URL', '段落', '內容', '字數', '狀態', '抓取時間'];
    const lines = [[...fixedHeaders, ...contentHeaders].join(',')];

    rows.forEach(r => {
      const status = r.error ? `ERROR:${r.error}` : (r.isRedirect ? 'REDIRECT' : 'OK');
      const biblio = r.biblioData || {};

      // Mapping for fixed columns
      const biblioValues = [
        escCsv(r.no),                // 公告號 (primary key)
        escCsv(r.title),             // 列表標題 (now stored in r.title from list page)
        escCsv(biblio['申請日']),
        escCsv(biblio['公告日']),
        escCsv(biblio['申請號']),
        escCsv(biblio['公告號']),    // 公告號(書目)
        escCsv(biblio['證書號']),
        escCsv(biblio['申請人']),
        escCsv(biblio['發明人']),
        escCsv(biblio['代理人']),
        escCsv(biblio['審查委員']),
        escCsv(biblio['優先權']),
        escCsv(biblio['引用專利']),
        escCsv(biblio['公報IPC']),
        escCsv(biblio['IPC']),
        escCsv(biblio['公報卷期']),
        escCsv(biblio['類別碼'])
      ];

      if (r.panels && r.panels.length > 0) {
        r.panels.forEach(p => {
          lines.push([
            ...biblioValues,
            escCsv(r.url),
            escCsv(p.panelTitle),
            escCsv(p.content),
            p.contentLength || 0,
            escCsv(status),
            escCsv(r.timestamp)
          ].join(','));
        });
      } else {
        lines.push([
          ...biblioValues,
          escCsv(r.url),
          '',
          '',
          0,
          escCsv(status),
          escCsv(r.timestamp)
        ].join(','));
      }
    });

    return lines.join('\n');
  }

  function downloadFile(filename, text, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);

    if (typeof GM_download !== 'undefined') {
      GM_download({
        url,
        name: filename,
        saveAs: true,
        onload: () => URL.revokeObjectURL(url),
        onerror: () => downloadViaAnchor(url, filename)
      });
    } else {
      downloadViaAnchor(url, filename);
    }
  }

  function downloadViaAnchor(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function generateReport(data) {
    const timestamp = Date.now();
    const selectedPanels = getSelectedPanels();

    // Markdown 報告
    const reportMd = buildMarkdownReport(data, selectedPanels);
    downloadFile(`tiponet_report_${timestamp}.md`, reportMd, 'text/markdown;charset=utf-8');

    // CSV 報告（方便匯入試算表）
    const reportCsv = buildCsvReport(data);
    downloadFile(`tiponet_report_${timestamp}.csv`, reportCsv, 'text/csv;charset=utf-8');

    const successCount = data.filter(r => !r.error && !r.isRedirect).length;
    const redirectCount = data.filter(r => r.isRedirect).length;
    const errorCount = data.filter(r => r.error).length;
    const withContentCount = data.filter(r => r.panels && r.panels.length > 0).length;

    return { successCount, redirectCount, errorCount, withContentCount };
  }

  // === 主要抓取流程 ===
  async function scrapeCurrentPage() {
    const pageInfo = getPageInfo();
    const selectedPanels = getSelectedPanels();

    console.log(`[GPSS] 處理第 ${pageInfo.current}/${pageInfo.total} 頁`);

    await waitForElement(LINK_SELECTOR);

    const links = collectCurrentPageLinks();
    console.log(`[GPSS] 本頁找到 ${links.length} 筆連結`);

    if (links.length === 0) {
      return [];
    }

    const currentData = GM_getValue(STORAGE_KEY, []);
    let results = [];

    for (let i = 0; i < links.length; i++) {
      const link = links[i];

      if (currentData.find(item => item.url === link.url)) {
        console.log(`[GPSS] 跳過已存在: ${link.no}`);
        continue;
      }

      showProgress(
        `第 ${pageInfo.current}/${pageInfo.total} 頁`,
        i + 1,
        links.length,
        `抓取: ${link.no}`
      );

      const row = {
        ...link,
        title: '',
        panels: [],
        error: '',
        isRedirect: false,
        timestamp: new Date().toLocaleString('zh-TW'),
        page: pageInfo.current
      };

      try {
        console.log(`[GPSS] 抓取: ${link.no}`);
        const html = await fetchHtmlWithRetry(link.url);  // 使用帶重試機制的版本
        const result = extractContent(html, selectedPanels);

        // 如果有列表頁標題則優先使用，否則使用詳細頁標題
        row.title = link.listTitle || result.title;
        row.panels = result.panels;
        row.biblioData = result.biblioData; // Store biblioData in row
        row.isRedirect = result.isRedirect;

        // 使用從 HTML 中提取的 FRURL (如果有的話),否則使用原始 URL
        if (result.frurl) {
          row.url = result.frurl;
        }

        console.log(`[GPSS] OK: ${link.no}, panels: ${result.panels.length}`);
      } catch (e) {
        row.error = String(e?.message || e);
        console.error(`[GPSS] ERROR: ${link.no}`, e);
      }

      results.push(row);

      // 分批儲存機制:每 BATCH_SIZE 筆儲存一次,釋放記憶體
      if (results.length >= BATCH_SIZE) {
        let allData = GM_getValue(STORAGE_KEY, []);
        allData = allData.concat(results);
        GM_setValue(STORAGE_KEY, allData);
        console.log(`[GPSS] 已分批儲存 ${BATCH_SIZE} 筆資料,累計: ${allData.length} 筆`);
        results = []; // 清空暫存,釋放記憶體
      }

      if (i < links.length - 1) {
        await delay(DELAY_MS);
      }
    }

    return results;
  }

  async function runScrapeProcess() {
    const isRunning = GM_getValue(STATUS_KEY, false);
    if (!isRunning) {
      console.log('[GPSS] 抓取任務未啟動或已取消');
      return;
    }

    try {
      const pageResults = await scrapeCurrentPage();

      let allData = GM_getValue(STORAGE_KEY, []);
      allData = allData.concat(pageResults);
      GM_setValue(STORAGE_KEY, allData);

      console.log(`[GPSS] 本頁完成，累計: ${allData.length} 筆`);

      const pageInfo = getPageInfo();

      if (pageInfo.current < pageInfo.total) {
        showProgress(
          '準備翻頁...',
          pageInfo.current,
          pageInfo.total,
          `已抓取 ${allData.length} 筆，即將前往第 ${pageInfo.current + 1} 頁`
        );

        await delay(PAGE_DELAY_MS);

        const nextBtn = document.querySelector('input[name="_IMG_次頁"]');
        if (nextBtn) {
          console.log(`[GPSS] 翻到第 ${pageInfo.current + 1} 頁`);
          nextBtn.click();
          return;
        } else {
          console.warn('[GPSS] 找不到下一頁按鈕');
        }
      }

      GM_setValue(STATUS_KEY, false);
      hideProgress();

      const stats = generateReport(allData);

      GM_deleteValue(STORAGE_KEY);

      alert(`✅ 抓取任務完成！\n\n` +
        `總計: ${allData.length} 筆\n` +
        `成功: ${stats.successCount} 筆\n` +
        `Session 問題: ${stats.redirectCount} 筆\n` +
        `錯誤: ${stats.errorCount} 筆\n` +
        `有內容: ${stats.withContentCount} 筆\n\n` +
        `已下載 Markdown + CSV 報告`);

    } catch (e) {
      console.error('[GPSS] 執行錯誤:', e);
      GM_setValue(STATUS_KEY, false);
      hideProgress();
      alert('抓取過程發生錯誤: ' + e.message);
    }
  }

  async function startScrape() {
    const pageInfo = getPageInfo();
    const selectedPanels = getSelectedPanels();

    const hasSelection = Object.values(selectedPanels).some(v => v);
    if (!hasSelection) {
      alert('請至少選擇一個要抓取的段落！');
      return;
    }

    const selectedNames = AVAILABLE_PANELS
      .filter(p => selectedPanels[p.id])
      .map(p => p.name)
      .join('、');

    const confirmMsg = `即將開始抓取任務\n\n` +
      `總頁數: ${pageInfo.total} 頁\n` +
      `當前頁: ${pageInfo.current}\n` +
      `擷取段落: ${selectedNames}\n\n` +
      `⚠️ 抓取過程中請勿關閉或切換此分頁\n\n` +
      `確定開始嗎？`;

    if (!confirm(confirmMsg)) {
      return;
    }

    GM_deleteValue(STORAGE_KEY);
    GM_setValue(STATUS_KEY, true);

    console.log('[GPSS] 開始抓取任務');
    await runScrapeProcess();
  }

  async function scrapeCurrentPageOnly() {
    const selectedPanels = getSelectedPanels();

    const hasSelection = Object.values(selectedPanels).some(v => v);
    if (!hasSelection) {
      alert('請至少選擇一個要抓取的段落！');
      return;
    }

    if (!confirm('只抓取當前頁面的資料，確定嗎？')) {
      return;
    }

    showProgress('抓取當前頁面...', 0, 1, '準備中');

    try {
      GM_setValue(STATUS_KEY, true);
      GM_deleteValue(STORAGE_KEY);

      const pageResults = await scrapeCurrentPage();

      GM_setValue(STATUS_KEY, false);
      hideProgress();

      if (pageResults.length === 0) {
        alert('當前頁面沒有找到資料');
        return;
      }

      const stats = generateReport(pageResults);

      alert(`✅ 當前頁面抓取完成！\n\n` +
        `總計: ${pageResults.length} 筆\n` +
        `成功: ${stats.successCount} 筆\n` +
        `有內容: ${stats.withContentCount} 筆\n\n` +
        `已下載 Markdown + CSV 報告`);

    } catch (e) {
      GM_setValue(STATUS_KEY, false);
      hideProgress();
      alert('抓取失敗: ' + e.message);
    }
  }

  // === 可拖曳工具列 UI ===
  function createToolbar() {
    const savedPosition = GM_getValue(POSITION_KEY, { right: 12, bottom: 12 });
    const isCollapsed = GM_getValue(COLLAPSED_KEY, false);
    const isSettingsCollapsed = GM_getValue(SETTINGS_COLLAPSED_KEY, false);
    const selectedPanels = getSelectedPanels();

    const container = document.createElement('div');
    container.id = 'tiponet-toolbar';
    container.style.cssText = `
      position: fixed;
      right: ${savedPosition.right}px;
      bottom: ${savedPosition.bottom}px;
      z-index: 99999;
      display: flex;
      flex-direction: column;
      gap: 6px;
      background: #fff;
      padding: 8px;
      border-radius: 8px;
      box-shadow: 0 4px 15px rgba(0,0,0,0.25);
      border: 1px solid #ddd;
      min-width: 200px;
    `;

    const header = document.createElement('div');
    header.id = 'tiponet-toolbar-header';
    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 10px;
      background: #1976d2;
      color: white;
      border-radius: 4px;
      cursor: move;
      user-select: none;
      font-size: 13px;
      font-weight: bold;
    `;
    header.innerHTML = `<span>📋 TIPONET 工具</span>`;

    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'tiponet-toggle-btn';
    toggleBtn.innerHTML = isCollapsed ? '▼' : '▲';
    toggleBtn.title = isCollapsed ? '展開' : '收合';
    toggleBtn.style.cssText = `
      background: transparent;
      border: none;
      color: white;
      font-size: 12px;
      cursor: pointer;
      padding: 2px 6px;
      margin-left: 8px;
    `;
    header.appendChild(toggleBtn);

    const mainContainer = document.createElement('div');
    mainContainer.id = 'tiponet-main';
    mainContainer.style.cssText = `
      display: ${isCollapsed ? 'none' : 'flex'};
      flex-direction: column;
      gap: 8px;
    `;

    // === 段落選擇區 ===
    const settingsSection = document.createElement('div');
    settingsSection.style.cssText = `
      background: #f5f5f5;
      border-radius: 4px;
      overflow: hidden;
    `;

    const settingsHeader = document.createElement('div');
    settingsHeader.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 10px;
      background: #e0e0e0;
      cursor: pointer;
      font-size: 12px;
      font-weight: bold;
      color: #333;
    `;
    settingsHeader.innerHTML = `<span>⚙️ 擷取段落設定</span>`;

    const settingsToggle = document.createElement('span');
    settingsToggle.innerHTML = isSettingsCollapsed ? '▼' : '▲';
    settingsToggle.style.fontSize = '10px';
    settingsHeader.appendChild(settingsToggle);

    const settingsBody = document.createElement('div');
    settingsBody.id = 'tiponet-settings-body';
    settingsBody.style.cssText = `
      display: ${isSettingsCollapsed ? 'none' : 'block'};
      padding: 8px;
    `;

    AVAILABLE_PANELS.forEach(panel => {
      const label = document.createElement('label');
      label.style.cssText = `
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 0;
        cursor: pointer;
        font-size: 12px;
      `;

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = `panel-${panel.id}`;
      checkbox.checked = selectedPanels[panel.id];
      checkbox.style.cssText = `width: 16px; height: 16px; cursor: pointer;`;

      checkbox.addEventListener('change', () => {
        const current = getSelectedPanels();
        current[panel.id] = checkbox.checked;
        saveSelectedPanels(current);
        updateSelectionCount();
      });

      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(panel.name));
      settingsBody.appendChild(label);
    });

    const selectionCount = document.createElement('div');
    selectionCount.id = 'tiponet-selection-count';
    selectionCount.style.cssText = `
      font-size: 11px;
      color: #666;
      text-align: right;
      padding-top: 6px;
      border-top: 1px solid #ddd;
      margin-top: 6px;
    `;

    function updateSelectionCount() {
      const current = getSelectedPanels();
      const count = Object.values(current).filter(v => v).length;
      selectionCount.textContent = `已選 ${count} / ${AVAILABLE_PANELS.length} 項`;
    }
    updateSelectionCount();

    settingsBody.appendChild(selectionCount);

    const selectBtnsRow = document.createElement('div');
    selectBtnsRow.style.cssText = `display: flex; gap: 6px; margin-top: 6px;`;

    const btnSelectAll = document.createElement('button');
    btnSelectAll.textContent = '全選';
    btnSelectAll.style.cssText = `
      flex: 1; padding: 4px; font-size: 11px;
      background: #1976d2; color: white; border: none; border-radius: 3px; cursor: pointer;
    `;
    btnSelectAll.onclick = () => {
      const all = {};
      AVAILABLE_PANELS.forEach(p => {
        all[p.id] = true;
        document.getElementById(`panel-${p.id}`).checked = true;
      });
      saveSelectedPanels(all);
      updateSelectionCount();
    };

    const btnDeselectAll = document.createElement('button');
    btnDeselectAll.textContent = '取消全選';
    btnDeselectAll.style.cssText = `
      flex: 1; padding: 4px; font-size: 11px;
      background: #757575; color: white; border: none; border-radius: 3px; cursor: pointer;
    `;
    btnDeselectAll.onclick = () => {
      const none = {};
      AVAILABLE_PANELS.forEach(p => {
        none[p.id] = false;
        document.getElementById(`panel-${p.id}`).checked = false;
      });
      saveSelectedPanels(none);
      updateSelectionCount();
    };

    selectBtnsRow.appendChild(btnSelectAll);
    selectBtnsRow.appendChild(btnDeselectAll);
    settingsBody.appendChild(selectBtnsRow);

    settingsSection.appendChild(settingsHeader);
    settingsSection.appendChild(settingsBody);

    settingsHeader.addEventListener('click', () => {
      const isHidden = settingsBody.style.display === 'none';
      settingsBody.style.display = isHidden ? 'block' : 'none';
      settingsToggle.innerHTML = isHidden ? '▲' : '▼';
      GM_setValue(SETTINGS_COLLAPSED_KEY, !isHidden);
    });

    // === 按鈕區 ===
    const buttonsContainer = document.createElement('div');
    buttonsContainer.style.cssText = `display: flex; flex-direction: column; gap: 6px;`;

    const btnStyle = (bg) => `
      padding: 10px 14px; background: ${bg}; color: white;
      border: none; border-radius: 5px; cursor: pointer;
      font-size: 13px; font-weight: bold; text-align: left;
      transition: filter 0.2s;
    `;

    const btnAll = document.createElement('button');
    btnAll.textContent = '📥 抓取全部頁面';
    btnAll.style.cssText = btnStyle('#1976d2');
    btnAll.addEventListener('mouseenter', () => btnAll.style.filter = 'brightness(0.9)');
    btnAll.addEventListener('mouseleave', () => btnAll.style.filter = 'none');
    btnAll.addEventListener('click', startScrape);

    const btnCurrent = document.createElement('button');
    btnCurrent.textContent = '📄 只抓當前頁';
    btnCurrent.style.cssText = btnStyle('#43a047');
    btnCurrent.addEventListener('mouseenter', () => btnCurrent.style.filter = 'brightness(0.9)');
    btnCurrent.addEventListener('mouseleave', () => btnCurrent.style.filter = 'none');
    btnCurrent.addEventListener('click', scrapeCurrentPageOnly);

    const btnClear = document.createElement('button');
    btnClear.textContent = '🗑️ 清除暫存';
    btnClear.style.cssText = btnStyle('#757575');
    btnClear.addEventListener('mouseenter', () => btnClear.style.filter = 'brightness(0.9)');
    btnClear.addEventListener('mouseleave', () => btnClear.style.filter = 'none');
    btnClear.addEventListener('click', () => {
      if (confirm('確定清除所有暫存資料？')) {
        GM_deleteValue(STORAGE_KEY);
        GM_setValue(STATUS_KEY, false);
        alert('已清除');
        location.reload();
      }
    });

    buttonsContainer.appendChild(btnAll);
    buttonsContainer.appendChild(btnCurrent);
    buttonsContainer.appendChild(btnClear);

    // 輸出格式提示
    const formatInfo = document.createElement('div');
    formatInfo.style.cssText = `
      font-size: 10px; color: #888; text-align: center;
      padding: 4px; background: #e3f2fd; border-radius: 3px;
    `;
    formatInfo.textContent = '📝 輸出格式: Markdown + CSV';
    buttonsContainer.appendChild(formatInfo);

    const savedData = GM_getValue(STORAGE_KEY, []);
    if (savedData.length > 0) {
      const infoDiv = document.createElement('div');
      infoDiv.style.cssText = `
        font-size: 11px; color: #666; text-align: center;
        padding: 6px; background: #fff3e0; border-radius: 4px;
      `;
      infoDiv.textContent = `📦 暫存: ${savedData.length} 筆`;
      buttonsContainer.appendChild(infoDiv);
    }

    mainContainer.appendChild(settingsSection);
    mainContainer.appendChild(buttonsContainer);
    container.appendChild(header);
    container.appendChild(mainContainer);
    document.body.appendChild(container);

    // === 展開/收合功能 ===
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isCurrentlyCollapsed = mainContainer.style.display === 'none';

      if (isCurrentlyCollapsed) {
        mainContainer.style.display = 'flex';
        toggleBtn.innerHTML = '▲';
        toggleBtn.title = '收合';
        GM_setValue(COLLAPSED_KEY, false);
      } else {
        mainContainer.style.display = 'none';
        toggleBtn.innerHTML = '▼';
        toggleBtn.title = '展開';
        GM_setValue(COLLAPSED_KEY, true);
      }
    });

    // === 拖曳功能 ===
    let isDragging = false;
    let dragStartX, dragStartY;
    let containerStartRight, containerStartBottom;

    header.addEventListener('mousedown', (e) => {
      if (e.target === toggleBtn) return;
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      const rect = container.getBoundingClientRect();
      containerStartRight = window.innerWidth - rect.right;
      containerStartBottom = window.innerHeight - rect.bottom;
      header.style.cursor = 'grabbing';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const deltaX = dragStartX - e.clientX;
      const deltaY = dragStartY - e.clientY;
      let newRight = containerStartRight + deltaX;
      let newBottom = containerStartBottom + deltaY;
      const containerRect = container.getBoundingClientRect();
      const maxRight = window.innerWidth - containerRect.width - 10;
      const maxBottom = window.innerHeight - containerRect.height - 10;
      newRight = Math.max(10, Math.min(newRight, maxRight));
      newBottom = Math.max(10, Math.min(newBottom, maxBottom));
      container.style.right = `${newRight}px`;
      container.style.bottom = `${newBottom}px`;
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        header.style.cursor = 'move';
        GM_setValue(POSITION_KEY, {
          right: parseInt(container.style.right),
          bottom: parseInt(container.style.bottom)
        });
      }
    });

    // 觸控支援
    header.addEventListener('touchstart', (e) => {
      if (e.target === toggleBtn) return;
      isDragging = true;
      const touch = e.touches[0];
      dragStartX = touch.clientX;
      dragStartY = touch.clientY;
      const rect = container.getBoundingClientRect();
      containerStartRight = window.innerWidth - rect.right;
      containerStartBottom = window.innerHeight - rect.bottom;
      e.preventDefault();
    }, { passive: false });

    document.addEventListener('touchmove', (e) => {
      if (!isDragging) return;
      const touch = e.touches[0];
      const deltaX = dragStartX - touch.clientX;
      const deltaY = dragStartY - touch.clientY;
      let newRight = containerStartRight + deltaX;
      let newBottom = containerStartBottom + deltaY;
      const containerRect = container.getBoundingClientRect();
      const maxRight = window.innerWidth - containerRect.width - 10;
      const maxBottom = window.innerHeight - containerRect.height - 10;
      newRight = Math.max(10, Math.min(newRight, maxRight));
      newBottom = Math.max(10, Math.min(newBottom, maxBottom));
      container.style.right = `${newRight}px`;
      container.style.bottom = `${newBottom}px`;
    }, { passive: false });

    document.addEventListener('touchend', () => {
      if (isDragging) {
        isDragging = false;
        GM_setValue(POSITION_KEY, {
          right: parseInt(container.style.right),
          bottom: parseInt(container.style.bottom)
        });
      }
    });
  }

  // === 初始化 ===
  function init() {
    const isRunning = GM_getValue(STATUS_KEY, false);

    if (isRunning) {
      console.log('[GPSS] 偵測到進行中的任務，繼續執行...');
      setTimeout(() => runScrapeProcess(), 1500);
    }

    createToolbar();

    const savedData = GM_getValue(STORAGE_KEY, []);
    if (savedData.length > 0 && !isRunning) {
      console.log(`[GPSS] 發現 ${savedData.length} 筆暫存資料`);
    }
  }

  init();
})();
