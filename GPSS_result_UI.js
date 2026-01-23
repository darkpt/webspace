// ==UserScript==
// @name         TIPO 專利內文現代化重構 (V4.3 收藏功能版)
// @namespace    http://tampermonkey.net/
// @version      4.3.1
// @description  新增專利收藏功能：本地儲存、側邊面板檢視、匯出
// @author       Gemini & Claude
// @match        https://tiponet.tipo.gov.tw/gpss*/gpsskmc/*
// @updateURL    https://raw.githubusercontent.com/darkpt/webspace/main/GPSS_result_UI.js
// @downloadURL  https://raw.githubusercontent.com/darkpt/webspace/main/GPSS_result_UI.js
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function() {
    'use strict';

    const checkIsDetail = () => document.querySelector('.TI') !== null;
    if (!checkIsDetail()) return;

    let savedHeight = localStorage.getItem('tipo_gallery_height') || '220';

    // ========== 收藏模組 ==========
    const FavoriteManager = {
        STORAGE_KEY: 'tipo_saved_patents',

        getAll: () => {
            return GM_getValue(FavoriteManager.STORAGE_KEY, []);
        },

        save: (patent) => {
            const saved = FavoriteManager.getAll();
            const exists = saved.find(p => p.number === patent.number);
            if (exists) return { success: false, message: '此專利已在收藏中' };

            saved.unshift({ ...patent, savedAt: new Date().toISOString() });
            GM_setValue(FavoriteManager.STORAGE_KEY, saved);
            return { success: true, message: '收藏成功' };
        },

        remove: (number) => {
            const saved = FavoriteManager.getAll();
            const filtered = saved.filter(p => p.number !== number);
            GM_setValue(FavoriteManager.STORAGE_KEY, filtered);
        },

        removeMultiple: (numbers) => {
            const saved = FavoriteManager.getAll();
            const filtered = saved.filter(p => !numbers.includes(p.number));
            GM_setValue(FavoriteManager.STORAGE_KEY, filtered);
        },

        clear: () => {
            GM_setValue(FavoriteManager.STORAGE_KEY, []);
        },

        exportJSON: () => {
            const data = JSON.stringify(FavoriteManager.getAll(), null, 2);
            const blob = new Blob([data], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `patents_${new Date().toISOString().slice(0,10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
        },

        exportCSV: () => {
            const saved = FavoriteManager.getAll();
            const headers = ['公告/公開號', '專利名稱', '申請人', '連結', '收藏時間'];
            const rows = saved.map(p => [
                p.number,
                `"${(p.title || '').replace(/"/g, '""')}"`,
                `"${(p.applicant || '').replace(/"/g, '""')}"`,
                p.url,
                p.savedAt
            ]);
            const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
            const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `patents_${new Date().toISOString().slice(0,10)}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        }
    };

// ========== 頁面資訊提取 ==========
const extractCurrentPatent = () => {
    // 專利名稱
    const titleEl = document.querySelector('.TI');
    const title = titleEl ? titleEl.textContent.trim().split('\n')[0].trim() : '';

    // 用 regex 抓「看起來像專利/公開號」的第一個 token
    const pickPatentNo = (text) => {
        if (!text) return '';
        const normalized = String(text).replace(/\s+/g, ' ').trim();
        // 常見格式：TWI901952B、TW202334885A、USxxxx、CNxxxx 等
        const m = normalized.match(/\b[A-Z]{2,}\d+[A-Z0-9]*\b/);
        return m ? m[0].trim() : '';
    };

    // 公告號/公開號（多標籤 + 文字抽取，不依賴 childNodes[0]）
    let number = '';
    const wantedLabels = new Set(['公告號', '公開號', '公開公告號', '公開編號']);
    document.querySelectorAll('tr.rectr').forEach(row => {
        const label = row.querySelector('td.dettb01')?.textContent?.trim() || '';
        const valueText = row.querySelector('td.dettb02')?.textContent || '';
        if (!number && wantedLabels.has(label)) {
            number = pickPatentNo(valueText);
        }
    });

    // fallback 1：#gps_title（範例頁會是 "TWI901952B-..."）
    if (!number) {
        const gpsTitle = document.querySelector('#gps_title')?.textContent || '';
        number = pickPatentNo(gpsTitle);
    }

    // 申請人
    let applicant = '';
    document.querySelectorAll('tr.rectr').forEach(row => {
        const label = row.querySelector('td.dettb01');
        const value = row.querySelector('td.dettb02');
        if (label?.textContent.trim() === '申請人') {
            const firstLink = value?.querySelector('a');
            applicant = firstLink
                ? firstLink.textContent.trim()
                : (value?.textContent.trim().split(';')[0].trim() || '');
        }
    });

    // 連結 (從 #FRURL 取得)
    const urlInput = document.getElementById('FRURL');
    const url = urlInput ? urlInput.value : window.location.href;

    // fallback 2：從 FRURL 字串中抽號（例如 ...?!!FRURLTWI901952B）
    if (!number) {
        const m = String(url || '').match(/!!FRURL([A-Z0-9]+)/i);
        if (m) number = m[1].trim();
    }

    return { number, title, applicant, url };
};


    // ========== 全文下載模組 ==========
    const FullTextDownloader = {
        extractPathParams: () => {
            const html = document.body.innerHTML;
            const match = html.match(/\/gpss(\d)\/gpssbkmusr\/(\d{5})\//);
            return match ? { gpssNum: match[1], usrCode: match[2] } : null;
        },

        rules: {
            TW: {
                inventionGrant: (certNum) => `TWBN-${certNum}`,
                utilityGrant: (certNum) => `TWBN-${certNum}`,
                inventionPublication: (pubNum) => `TWAN-${pubNum}`,
                parse: (rawNumber) => {
                    if (!rawNumber) return null;
                    const num = rawNumber.trim();
                    if (/^TWI\d+B$/.test(num)) return { type: 'inventionGrant', number: num.slice(2, -1) };
                    if (/^TWM\d+U$/.test(num)) return { type: 'utilityGrant', number: num.slice(2, -1) };
                    if (/^TW\d+A$/.test(num)) return { type: 'inventionPublication', number: num.slice(2, -1) };
                    return null;
                }
            },
        },

extractPatentNumbers: () => {
    const result = { grantNumber: null, publicationNumber: null };

    const pickPatentNo = (text) => {
        if (!text) return '';
        const normalized = String(text).replace(/\s+/g, ' ').trim();
        const m = normalized.match(/\b[A-Z]{2,}\d+[A-Z0-9]*\b/);
        return m ? m[0].trim() : '';
    };

    document.querySelectorAll('tr.rectr').forEach(row => {
        const label = row.querySelector('td.dettb01')?.textContent?.trim() || '';
        const valueCell = row.querySelector('td.dettb02');

        // 公告號（授權號）
        if (!result.grantNumber && label === '公告號') {
            const cellText = valueCell?.textContent || '';
            result.grantNumber = pickPatentNo(cellText) || null;

            // 同一格內的 span.linkan a 通常是「公開」連結
            const pubLink = valueCell?.querySelector('span.linkan a');
            if (pubLink) result.publicationNumber = pubLink.textContent.trim();
        }

        // 若頁面沒有公告號，可能只有公開號
        if (!result.publicationNumber && (label === '公開號' || label === '公開公告號' || label === '公開編號')) {
            const cellText = valueCell?.textContent || '';
            result.publicationNumber = pickPatentNo(cellText) || null;
        }
    });

    // fallback：#gps_title
    if (!result.grantNumber && !result.publicationNumber) {
        const gpsTitle = document.querySelector('#gps_title')?.textContent || '';
        const n = pickPatentNo(gpsTitle);
        if (n) result.grantNumber = n; // 先放 grantNumber，後續流程可照舊走
    }

    // fallback：FRURL
    if (!result.grantNumber && !result.publicationNumber) {
        const urlInput = document.getElementById('FRURL');
        const url = urlInput ? urlInput.value : window.location.href;
        const m = String(url || '').match(/!!FRURL([A-Z0-9]+)/i);
        if (m) result.grantNumber = m[1].trim();
    }

    return result;
},

        generateDownloadURL: (country = 'TW') => {
            const pathParams = FullTextDownloader.extractPathParams();
            if (!pathParams) return null;
            const patentNums = FullTextDownloader.extractPatentNumbers();
            const rules = FullTextDownloader.rules[country];
            if (!rules) return null;
            const targetNumber = patentNums.grantNumber || patentNums.publicationNumber;
            const parsed = rules.parse(targetNumber);
            if (!parsed) return null;
            const filename = rules[parsed.type](parsed.number);
            return {
                url: `https://tiponet.tipo.gov.tw/gpss${pathParams.gpssNum}/gpssbkmusr/${pathParams.usrCode}/pdf/${filename}.pdf`,
                filename: `${filename}.pdf`
            };
        },

        download: (country = 'TW') => {
            const result = FullTextDownloader.generateDownloadURL(country);
            if (!result) { alert('無法產生下載連結'); return; }
            const a = document.createElement('a');
            a.href = result.url;
            a.download = result.filename;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            setTimeout(() => document.body.removeChild(a), 100);
        }
    };

    // ========== 頁面資訊提取（頂部顯示用） ==========
    const extractPageInfo = () => {
        const titleEl = document.querySelector('.TI');
        const title = titleEl ? titleEl.textContent.trim().split('\n')[0].trim() : '專利名稱';
        const nums = FullTextDownloader.extractPatentNumbers();
        return { title, grantNumber: nums.grantNumber, publicationNumber: nums.publicationNumber };
    };

    const injectStyles = () => {
        if (document.getElementById('modern-style')) return;
        GM_addStyle(`
            #modern-style {}
            body { background-color: #f4f7f9 !important; font-family: "PingFang TC", sans-serif !important; overflow: hidden !important; margin: 0; padding: 0; }

            /* 隱藏原有元素 */
            #header, .navbar, .T62, .rectable, .detGP_top, .panel-warning, .container > table:not(.T62), #footer { display: none !important; }

            /* 新頂部列 */
            #modern-header {
                position: fixed; top: 0; left: 0; right: 0; height: 60px;
                background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%);
                display: flex; align-items: center; justify-content: space-between;
                padding: 0 20px; box-shadow: 0 2px 10px rgba(0,0,0,0.15); z-index: 1000;
            }
            #header-left { display: flex; align-items: center; gap: 12px; max-width: 55%; }
            #header-title-area { display: flex; flex-direction: column; justify-content: center; overflow: hidden; }
            #header-title {
                color: #fff; font-size: 16px; font-weight: bold;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            }
            #header-numbers { display: flex; gap: 12px; margin-top: 4px; }
            .header-num-badge {
                background: rgba(255,255,255,0.2); color: #fff;
                padding: 2px 10px; border-radius: 12px; font-size: 12px;
            }
            .header-num-badge.publication { background: rgba(234,76,137,0.8); }

            #header-right { display: flex; align-items: center; gap: 8px; }
            .header-nav-btn {
                background: rgba(255,255,255,0.15);
                border: 1px solid rgba(255,255,255,0.3);
                border-radius: 6px;
                padding: 6px 12px;
                cursor: pointer;
                transition: all 0.2s;
                color: #fff;
                font-size: 13px;
                font-weight: 500;
            }
            .header-nav-btn:hover { background: rgba(255,255,255,0.3); }
            .header-download-btn {
                background: #ea4c89; color: #fff; border: none;
                border-radius: 20px; padding: 8px 16px; font-size: 13px;
                font-weight: bold; cursor: pointer; transition: all 0.2s;
            }
            .header-download-btn:hover { background: #d63d7a; }

            /* 收藏按鈕 */
            .header-fav-btn {
                background: rgba(255,193,7,0.9); color: #333; border: none;
                border-radius: 6px; padding: 6px 12px; font-size: 13px;
                font-weight: bold; cursor: pointer; transition: all 0.2s;
            }
            .header-fav-btn:hover { background: rgba(255,193,7,1); }
            .header-fav-btn.saved { background: rgba(255,193,7,0.4); color: #fff; }

            /* 已存按鈕 */
            .header-list-btn {
                background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.3);
                border-radius: 6px; padding: 6px 12px; font-size: 13px;
                font-weight: 500; cursor: pointer; transition: all 0.2s; color: #fff;
            }
            .header-list-btn:hover { background: rgba(255,255,255,0.3); }

            /* 側邊收藏面板 */
            #fav-panel {
                position: fixed; top: 60px; right: -360px; width: 350px; height: calc(100vh - 60px);
                background: #fff; box-shadow: -4px 0 15px rgba(0,0,0,0.15);
                transition: right 0.3s ease; z-index: 1001; display: flex; flex-direction: column;
            }
            #fav-panel.open { right: 0; }
            #fav-panel-header {
                background: #1976d2; color: #fff; padding: 15px;
                display: flex; justify-content: space-between; align-items: center;
            }
            #fav-panel-header h3 { margin: 0; font-size: 16px; }
            #fav-panel-close { background: none; border: none; color: #fff; font-size: 20px; cursor: pointer; }
            #fav-panel-actions {
                padding: 10px 15px; border-bottom: 1px solid #e0e0e0;
                display: flex; gap: 8px; flex-wrap: wrap;
            }
            .fav-action-btn {
                background: #f5f5f5; border: 1px solid #ddd; border-radius: 4px;
                padding: 5px 10px; font-size: 12px; cursor: pointer; transition: all 0.2s;
            }
            .fav-action-btn:hover { background: #e0e0e0; }
            .fav-action-btn.danger { color: #d32f2f; }
            .fav-action-btn.danger:hover { background: #ffebee; }
            #fav-panel-list {
                flex: 1; overflow-y: auto; padding: 10px;
            }
            .fav-item {
                background: #f9f9f9; border: 1px solid #e0e0e0; border-radius: 8px;
                padding: 12px; margin-bottom: 10px; position: relative;
            }
            .fav-item:hover { border-color: #1976d2; }
            .fav-item-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
            .fav-item-checkbox { width: 16px; height: 16px; cursor: pointer; }
            .fav-item-number {
                font-weight: bold; color: #1976d2; font-size: 13px;
                text-decoration: none;
            }
            .fav-item-number:hover { text-decoration: underline; }
            .fav-item-title {
                font-size: 13px; color: #333; line-height: 1.4;
                display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
                overflow: hidden;
            }
            .fav-item-meta {
                font-size: 11px; color: #888; margin-top: 6px;
                display: flex; justify-content: space-between;
            }
            .fav-item-delete {
                position: absolute; top: 8px; right: 8px;
                background: none; border: none; color: #999; cursor: pointer;
                font-size: 14px; padding: 2px 6px; border-radius: 4px;
            }
            .fav-item-delete:hover { background: #ffebee; color: #d32f2f; }
            #fav-panel-empty {
                text-align: center; color: #999; padding: 40px 20px;
            }

            /* 主內容區 */
            #modern-wrapper {
                display: flex; position: fixed; top: 70px; left: 0; right: 0; bottom: 0;
                gap: 0; z-index: 99; background: #f4f7f9;
            }

            /* 書目面板 */
            #left-panel { width: 320px; background: #fff; box-shadow: 2px 0 10px rgba(0,0,0,0.1); transition: 0.3s cubic-bezier(0.4, 0, 0.2, 1); display: flex; flex-direction: column; border-right: 1px solid #e0e0e0; flex-shrink: 0; z-index: 101; }
            #left-panel.collapsed { width: 45px; }
            #panel-toggle { background: #ea4c89; color: #fff; border: none; padding: 15px 5px; cursor: pointer; font-weight: bold; writing-mode: vertical-lr; text-orientation: upright; font-size: 14px; min-height: 100px; }
            #panel-content { padding: 15px; overflow-y: auto; flex: 1; transition: opacity 0.2s; }
            #left-panel.collapsed #panel-content { opacity: 0; pointer-events: none; width: 0; padding: 0; overflow: hidden; }

            #main-content-area { flex: 1; display: flex; flex-direction: column; padding: 0 15px; overflow: hidden; height: 100%; position: relative; }
            #cards-container { display: grid; grid-template-columns: 60% calc(40% - 15px); gap: 15px; flex: 1; min-height: 0; overflow: hidden; margin-bottom: 10px; z-index: 1; }
            #right-column-stack { display: flex; flex-direction: column; gap: 10px; height: 100%; min-height: 0; overflow: hidden; }
            .patent-card { background: #fff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); display: flex; flex-direction: column; border: 1px solid #e0e0e0; overflow: hidden; height: 100%; }
            .card-header { background-color: #e3f2fd; color: #1976d2; padding: 10px 15px; font-weight: bold; border-bottom: 1px solid #d1d9e0; flex-shrink: 0; display: flex; justify-content: space-between; align-items: center; }
            .card-body { padding: 15px; overflow-y: auto; flex: 1; font-size: 15px; line-height: 1.8; }
            .pill-btn-pink { background-color: #ea4c89; color: #fff; border: none; border-radius: 50px; padding: 4px 12px; font-size: 12px; cursor: pointer; font-weight: bold; }

            /* 圖示底部 */
            #bottom-gallery-container { display: flex; gap: 10px; flex-shrink: 0; align-items: flex-end; padding-bottom: 8px; background: #f4f7f9; z-index: 10; position: relative; border-top: 1px solid #e0e0e0; padding-top: 5px; }
            #height-controls { display: flex; flex-direction: column; gap: 4px; width: 35px; }
            .h-btn { background: #ea4c89; color: #fff; border: none; border-radius: 6px; width: 32px; height: 32px; cursor: pointer; font-weight: bold; font-size: 18px; line-height: 1; }
            #bottom-gallery { flex: 1; height: ${savedHeight}px; background: #fff; padding: 8px; border-radius: 12px; border: 1px solid #e0e0e0; overflow: hidden; }
            .gallery-container { display: flex !important; flex-direction: row !important; overflow-x: auto !important; gap: 12px; height: 100%; align-items: center; white-space: nowrap; }
            .gallery-container img { max-height: calc(100% - 8px) !important; width: auto !important; border-radius: 4px; cursor: zoom-in; }

            /* Toast 通知 */
            .toast-notify {
                position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%);
                background: #333; color: #fff; padding: 12px 24px; border-radius: 8px;
                font-size: 14px; z-index: 9999; opacity: 0; transition: opacity 0.3s;
            }
            .toast-notify.show { opacity: 1; }
        `);
    };

    // ========== Toast 通知 ==========
    const showToast = (message, duration = 2000) => {
        let toast = document.getElementById('tipo-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'tipo-toast';
            toast.className = 'toast-notify';
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), duration);
    };

    // ========== 收藏面板 ==========
    const createFavPanel = () => {
        const panel = document.createElement('div');
        panel.id = 'fav-panel';
        panel.innerHTML = `
            <div id="fav-panel-header">
                <h3>📂 已收藏專利</h3>
                <button id="fav-panel-close">✕</button>
            </div>
            <div id="fav-panel-actions">
                <button class="fav-action-btn" id="fav-select-all">全選</button>
                <button class="fav-action-btn danger" id="fav-delete-selected">刪除勾選</button>
                <button class="fav-action-btn" id="fav-export-json">匯出 JSON</button>
                <button class="fav-action-btn" id="fav-export-csv">匯出 CSV</button>
            </div>
            <div id="fav-panel-list"></div>
        `;
        document.body.appendChild(panel);

        // 事件綁定
        document.getElementById('fav-panel-close').onclick = () => panel.classList.remove('open');
        document.getElementById('fav-select-all').onclick = () => {
            const checkboxes = panel.querySelectorAll('.fav-item-checkbox');
            const allChecked = Array.from(checkboxes).every(cb => cb.checked);
            checkboxes.forEach(cb => cb.checked = !allChecked);
        };
        document.getElementById('fav-delete-selected').onclick = () => {
            const checked = Array.from(panel.querySelectorAll('.fav-item-checkbox:checked'));
            if (checked.length === 0) { showToast('請先勾選要刪除的項目'); return; }
            if (!confirm(`確定刪除 ${checked.length} 筆收藏？`)) return;
            const numbers = checked.map(cb => cb.dataset.number);
            FavoriteManager.removeMultiple(numbers);
            renderFavList();
            updateFavCount();
            showToast(`已刪除 ${numbers.length} 筆`);
        };
        document.getElementById('fav-export-json').onclick = () => {
            FavoriteManager.exportJSON();
            showToast('已匯出 JSON');
        };
        document.getElementById('fav-export-csv').onclick = () => {
            FavoriteManager.exportCSV();
            showToast('已匯出 CSV');
        };

        return panel;
    };

    const renderFavList = () => {
        const listContainer = document.getElementById('fav-panel-list');
        const saved = FavoriteManager.getAll();

        if (saved.length === 0) {
            listContainer.innerHTML = '<div id="fav-panel-empty">尚無收藏專利<br>點擊「⭐ 收藏」加入</div>';
            return;
        }

        listContainer.innerHTML = saved.map(p => `
            <div class="fav-item" data-number="${p.number}">
                <button class="fav-item-delete" title="刪除">✕</button>
                <div class="fav-item-header">
                    <input type="checkbox" class="fav-item-checkbox" data-number="${p.number}">
                    <a href="${p.url}" class="fav-item-number" target="_blank">${p.number}</a>
                </div>
                <div class="fav-item-title" title="${p.title || ''}">${p.title || '(無標題)'}</div>
                <div class="fav-item-meta">
                    <span>${p.applicant || '(無申請人)'}</span>
                    <span>${p.savedAt ? p.savedAt.slice(0, 10) : ''}</span>
                </div>
            </div>
        `).join('');

        // 單筆刪除事件
        listContainer.querySelectorAll('.fav-item-delete').forEach(btn => {
            btn.onclick = (e) => {
                const item = e.target.closest('.fav-item');
                const number = item.dataset.number;
                FavoriteManager.remove(number);
                renderFavList();
                updateFavCount();
                showToast('已移除收藏');
            };
        });
    };

    const updateFavCount = () => {
        const btn = document.getElementById('fav-list-btn');
        if (btn) {
            const count = FavoriteManager.getAll().length;
            btn.textContent = `📂 已存 (${count})`;
        }
    };

    const updateFavButtonState = () => {
        const btn = document.getElementById('fav-add-btn');
        if (!btn) return;
        const current = extractCurrentPatent();
        const saved = FavoriteManager.getAll();
        const isSaved = saved.some(p => p.number === current.number);
        btn.classList.toggle('saved', isSaved);
        btn.textContent = isSaved ? '⭐ 已收藏' : '⭐ 收藏';
    };

    // ========== 圖片檢視器 ==========
    const openViewer = async (imgSrc) => {
        if (window.documentPictureInPicture) {
            try {
                const pipWindow = await window.documentPictureInPicture.requestWindow({ width: 1000, height: 800 });
                setupViewerContent(pipWindow, imgSrc);
                return;
            } catch (e) { console.warn("PiP 請求失敗，轉向獨立視窗模式"); }
        }
        const popup = window.open('', '_blank', 'width=1100,height=850,toolbar=no,location=no');
        if (popup) setupViewerContent(popup, imgSrc);
        else alert("請允許彈出視窗以檢視圖片");
    };

    const setupViewerContent = (win, imgSrc) => {
        const style = win.document.createElement("style");
        style.textContent = `
            body { margin: 0; background: #222; display: flex; height: 100vh; overflow: hidden; font-family: sans-serif; }
            #sidebar { width: 55px; background: #111; display: flex; flex-direction: column; align-items: center; padding-top: 20px; gap: 15px; border-right: 1px solid #333; z-index: 100; position: relative; }
            .btn { width: 38px; height: 38px; background: #ea4c89; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 20px; display: flex; align-items: center; justify-content: center; }
            #view { flex: 1; display: flex; align-items: center; justify-content: center; cursor: grab; z-index: 1; }
            img { transition: 0.15s ease-out; transform-origin: center; user-select: none; -webkit-user-drag: none; }
        `;
        win.document.head.append(style);
        win.document.body.innerHTML = `
            <div id="sidebar">
                <button id="z-in" class="btn">＋</button><button id="z-out" class="btn">－</button>
                <button id="r-l" class="btn">↶</button><button id="r-r" class="btn">↷</button>
                <button id="reset" class="btn" style="font-size:10px">RESET</button>
            </div>
            <div id="view"><img id="p" src="${imgSrc}"></div>
        `;
        let s=1, r=0, x=0, y=0, d=false, sx, sy;
        const p = win.document.getElementById('p'), view = win.document.getElementById('view');
        const u = () => { p.style.transform = `translate(${x}px, ${y}px) rotate(${r}deg) scale(${s})`; };
        win.document.getElementById('z-in').onclick = () => { s=Math.min(8, s+0.2); u(); };
        win.document.getElementById('z-out').onclick = () => { s=Math.max(0.3, s-0.2); u(); };
        win.document.getElementById('r-l').onclick = () => { r-=90; u(); };
        win.document.getElementById('r-r').onclick = () => { r+=90; u(); };
        win.document.getElementById('reset').onclick = () => { s=1; r=0; x=0; y=0; u(); };
        view.onmousedown = (e) => { d=true; sx=e.clientX-x; sy=e.clientY-y; e.preventDefault(); };
        win.onmousemove = (e) => { if(!d) return; x=e.clientX-sx; y=e.clientY-sy; u(); };
        win.onmouseup = () => { d=false; };
        view.onwheel = (e) => { e.preventDefault(); s = Math.min(Math.max(0.3, s + (e.deltaY > 0 ? -0.1 : 0.1)), 8); u(); };
    };

    // ========== 主 UI 重構 ==========
    const reconstructUI = () => {
        if (!checkIsDetail() || document.getElementById('modern-wrapper')) return;
        injectStyles();

        const pageInfo = extractPageInfo();
        const savedHeight = localStorage.getItem('tipo_gallery_height') || '220';
        const panels = document.querySelectorAll('.panel-body');
        const bibData = panels[1]?.innerHTML || "";
        const claimsContent = (panels[2]?.innerHTML || "").trim();
        const detailContent = (panels[3]?.innerHTML || "").trim();
        const hasImpl = detailContent.includes('【實施方式】');

        // ===== 建立新頂部 =====
        const header = document.createElement('div');
        header.id = 'modern-header';

        // 左側：收藏按鈕 + 標題 + 號碼
        const headerLeft = document.createElement('div');
        headerLeft.id = 'header-left';

        // 收藏按鈕
        const favAddBtn = document.createElement('button');
        favAddBtn.id = 'fav-add-btn';
        favAddBtn.className = 'header-fav-btn';
        favAddBtn.textContent = '⭐ 收藏';
        favAddBtn.onclick = () => {
            const patent = extractCurrentPatent();
            if (!patent.number) { showToast('無法取得專利號碼'); return; }
            const result = FavoriteManager.save(patent);
            showToast(result.message);
            updateFavButtonState();
            updateFavCount();
        };
        headerLeft.appendChild(favAddBtn);

        // 標題區
        const titleArea = document.createElement('div');
        titleArea.id = 'header-title-area';

        const titleEl = document.createElement('div');
        titleEl.id = 'header-title';
        titleEl.textContent = pageInfo.title;
        titleEl.title = pageInfo.title;
        titleArea.appendChild(titleEl);

        const numbersEl = document.createElement('div');
        numbersEl.id = 'header-numbers';
        if (pageInfo.grantNumber) {
            const grantBadge = document.createElement('span');
            grantBadge.className = 'header-num-badge';
            grantBadge.textContent = `公告 ${pageInfo.grantNumber}`;
            numbersEl.appendChild(grantBadge);
        }
        if (pageInfo.publicationNumber) {
            const pubBadge = document.createElement('span');
            pubBadge.className = 'header-num-badge publication';
            pubBadge.textContent = `公開 ${pageInfo.publicationNumber}`;
            numbersEl.appendChild(pubBadge);
        }
        titleArea.appendChild(numbersEl);
        headerLeft.appendChild(titleArea);
        header.appendChild(headerLeft);

        // 右側：導覽按鈕
        const headerRight = document.createElement('div');
        headerRight.id = 'header-right';

        const navButtons = [
            { name: '_IMG_回查詢', label: '回查詢', icon: '🔍' },
            { name: '_IMG_回簡目', label: '回簡目', icon: '📋' },
            { name: '_IMG_前筆', label: '◀ 前筆' },
            { name: '_IMG_次筆', label: '次筆 ▶' }
        ];

        navButtons.forEach(btn => {
            const originalBtn = document.querySelector(`input[name="${btn.name}"]`);
            if (originalBtn) {
                const btnEl = document.createElement('button');
                btnEl.className = 'header-nav-btn';
                btnEl.innerHTML = btn.icon ? `${btn.icon} ${btn.label}` : btn.label;
                btnEl.onclick = () => originalBtn.click();
                headerRight.appendChild(btnEl);
            }
        });

        // 下載按鈕
        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'header-download-btn';
        downloadBtn.innerHTML = '📄 下載全文';
        downloadBtn.onclick = () => FullTextDownloader.download('TW');
        headerRight.appendChild(downloadBtn);

        // 已存按鈕
        const favListBtn = document.createElement('button');
        favListBtn.id = 'fav-list-btn';
        favListBtn.className = 'header-list-btn';
        favListBtn.textContent = `📂 已存 (${FavoriteManager.getAll().length})`;
        favListBtn.onclick = () => {
            const panel = document.getElementById('fav-panel') || createFavPanel();
            renderFavList();
            panel.classList.toggle('open');
        };
        headerRight.appendChild(favListBtn);

        header.appendChild(headerRight);
        document.body.appendChild(header);

        // 初始化收藏按鈕狀態
        updateFavButtonState();

        // ===== 主內容區 =====
        const imgBox = document.querySelector('#g2') || document.querySelector('.detGP');
        const wrapper = document.createElement('div');
        wrapper.id = 'modern-wrapper';
        wrapper.innerHTML = `
            <div id="left-panel" class="collapsed">
                <button id="panel-toggle">案件書目 —</button>
                <div id="panel-content"><h4 style="color:#1976d2; border-bottom:2px solid #ea4c89; padding-bottom:5px; margin-top:0;">書目詳細</h4>${bibData}</div>
            </div>
            <div id="main-content-area">
                <div id="cards-container">
                    <div class="patent-card" style="display: ${detailContent ? 'flex' : 'none'};">
                        <div class="card-header">詳細說明<button id="jump-impl" class="pill-btn-pink" style="display: ${hasImpl ? 'block' : 'none'};">跳至實施方式</button></div>
                        <div id="d-body" class="card-body">${detailContent}</div>
                    </div>
                    <div id="right-column-stack" style="display: ${claimsContent ? 'flex' : 'none'};">
                        <div class="patent-card" style="flex:1;"><div class="card-header">專利範圍</div><div class="card-body">${claimsContent}</div></div>
                    </div>
                </div>
                <div id="bottom-gallery-container">
                    <div id="height-controls"><button id="h-p" class="h-btn">＋</button><button id="h-m" class="h-btn">－</button></div>
                    <div id="bottom-gallery" style="height: ${savedHeight}px;"><div id="g-box" class="gallery-container"></div></div>
                </div>
            </div>`;
        document.body.appendChild(wrapper);

        if (imgBox) {
            const gBox = document.getElementById('g-box');
            imgBox.querySelectorAll('img').forEach(img => {
                const nImg = img.cloneNode();
                nImg.onclick = () => openViewer(img.src);
                gBox.appendChild(nImg);
            });
        }

        const gallery = document.getElementById('bottom-gallery');
        document.getElementById('h-p').onclick = () => { let h = Math.min(600, parseInt(gallery.style.height) + 50); gallery.style.height = h + 'px'; localStorage.setItem('tipo_gallery_height', h); };
        document.getElementById('h-m').onclick = () => { let h = Math.max(100, parseInt(gallery.style.height) - 50); gallery.style.height = h + 'px'; localStorage.setItem('tipo_gallery_height', h); };
        document.getElementById('panel-toggle').onclick = function() {
            const panel = document.getElementById('left-panel');
            panel.classList.toggle('collapsed');
            this.innerText = panel.classList.contains('collapsed') ? '案件書目 —' : '收合面板 <<';
        };
        if (hasImpl) {
            document.getElementById('jump-impl').onclick = () => {
                const t = Array.from(document.getElementById('d-body').querySelectorAll('span')).find(el => el.textContent.includes('【實施方式】'));
                if (t) t.scrollIntoView({ behavior: 'auto', block: 'start' });
            };
        }
        const container = document.querySelector('.container');
        if (container) Array.from(container.children).forEach(c => { if (!c.classList.contains('T62')) c.style.display = 'none'; });
    };

    const observer = new MutationObserver(() => { if (!document.getElementById('modern-wrapper') && checkIsDetail()) reconstructUI(); });
    observer.observe(document.body, { childList: true, subtree: true });
    reconstructUI();
})();
