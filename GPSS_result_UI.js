// ==UserScript==
// @name         TIPO 專利內文現代化重構 (V5.0)
// @namespace    http://tampermonkey.net/
// @version      5.0
// @description  增加MEMO快速筆記，修正整體架構
// @author       Claude
// @match        https://tiponet.tipo.gov.tw/gpss*/gpsskmc/*
// @updateURL    https://raw.githubusercontent.com/darkpt/webspace/main/GPSS_result_UI.js
// @downloadURL  https://raw.githubusercontent.com/darkpt/webspace/main/GPSS_result_UI.js
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==


(function() {
    'use strict';

    // ========================================
    // 常數定義區
    // ========================================
    const CONSTANTS = {
        // 尺寸相關
        DEFAULT_GALLERY_HEIGHT: 220,
        MIN_GALLERY_HEIGHT: 100,
        MAX_GALLERY_HEIGHT: 600,
        GALLERY_HEIGHT_STEP: 50,
        LEFT_PANEL_WIDTH: 320,
        LEFT_PANEL_COLLAPSED_WIDTH: 45,
        FAV_PANEL_WIDTH: 350,
        MEMO_PANEL_WIDTH: 410,
        HEADER_HEIGHT: 60,
        WRAPPER_TOP_OFFSET: 70,

        // 時間相關（毫秒）
        TOAST_DURATION: 2000,
        CLEANUP_DELAY: 500,
        DOWNLOAD_CLEANUP_DELAY: 1000,

        // 儲存鍵值
        STORAGE_KEYS: {
            FAVORITES: 'tipo_saved_patents',
            MEMOS: 'tipo_patent_memos',
            GALLERY_HEIGHT: 'tipo_gallery_height'
        },

        // 選擇器
        SELECTORS: {
            TITLE: '.TI',
            PANEL_BODY: '.panel-body',
            IMAGE_BOX: '#g2, .detGP',
            DETAIL_ROW: 'tr.rectr',
            GPS_TITLE: '#gps_title',
            FR_URL: '#FRURL'
        },

        // 訊息
        MESSAGES: {
            ALREADY_SAVED: '此專利已在收藏中',
            SAVE_SUCCESS: '收藏成功',
            INVALID_PATENT_INFO: '專利資訊無效',
            EMPTY_ANNOTATION: '標註內容不可為空',
            ANNOTATION_EXISTS: '此標註已存在',
            ANNOTATION_ADDED: '已加入MEMO',
            STORAGE_FAILED: '儲存失敗',
            NO_PATENT_NUMBER: '無法取得專利號碼',
            SELECT_TEXT_FIRST: '請先選取文字',
            COPY_SUCCESS: '已複製',
            COPY_FAILED: '複製失敗',
            NO_MEMO_TO_EXPORT: '無MEMO可匯出',
            EXPORT_SUCCESS: '已匯出',
            DOWNLOAD_BLOCKED: '下載失敗,請檢查瀏覽器設定是否阻擋下載'
        },

        // 檔案類型
        MIME_TYPES: {
            JSON: 'application/json',
            CSV: 'text/csv;charset=utf-8',
            TEXT: 'text/plain;charset=utf-8',
            PDF: 'application/pdf'
        }
    };

    // ========================================
    // 工具函式模組
    // ========================================
    const Utils = {
        /**
         * 顯示 Toast 通知
         * @param {string} message - 通知訊息
         * @param {number} duration - 顯示時長（毫秒）
         */
        showToast(message, duration = CONSTANTS.TOAST_DURATION) {
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
        },

        /**
         * HTML 轉義
         * @param {string} text - 原始文字
         * @returns {string} 轉義後的 HTML
         */
        escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        },

        /**
         * 從文字中提取專利號碼
         * @param {string} text - 原始文字
         * @returns {string} 專利號碼
         */
        extractPatentNumber(text) {
            if (!text) return '';
            const normalized = String(text).replace(/\s+/g, ' ').trim();
            const match = normalized.match(/\b(?:TWI\d+B|TWM\d+U|TW\d+A)\b/i);
            return match ? match[0].trim() : '';
        },

        /**
         * 檢查是否為詳細頁面
         * @returns {boolean} 是否為詳細頁面
         */
        checkIsDetail() {
            return document.querySelector(CONSTANTS.SELECTORS.TITLE) !== null;
        },

        /**
         * 下載檔案（統一方法）
         * @param {string} content - 檔案內容
         * @param {string} filename - 檔案名稱
         * @param {string} mimeType - MIME 類型
         */
        downloadFile(content, filename, mimeType) {
            try {
                const bom = mimeType.includes('text') ? '\uFEFF' : '';
                const blob = new Blob([bom + content], { type: mimeType });
                const url = URL.createObjectURL(blob);

                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();

                setTimeout(() => {
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                }, CONSTANTS.DOWNLOAD_CLEANUP_DELAY);

            } catch (e) {
                console.error('[Download Error]', e);
                this.fallbackDownload(content, filename, mimeType);
            }
        },

        /**
         * 備用下載方法（使用 data URI）
         * @param {string} content - 檔案內容
         * @param {string} filename - 檔案名稱
         * @param {string} mimeType - MIME 類型
         */
        fallbackDownload(content, filename, mimeType) {
            try {
                const dataUri = `data:${mimeType};charset=utf-8,${encodeURIComponent(content)}`;
                const a = document.createElement('a');
                a.href = dataUri;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                setTimeout(() => document.body.removeChild(a), CONSTANTS.CLEANUP_DELAY);
            } catch (e) {
                console.error('[Fallback Download Error]', e);
                alert(CONSTANTS.MESSAGES.DOWNLOAD_BLOCKED);
            }
        }
    };

    // ========================================
    // 收藏管理模組
    // ========================================
    const FavoriteManager = {
        /**
         * 取得所有收藏
         * @returns {Array<Object>} 收藏列表
         */
        getAll() {
            return GM_getValue(CONSTANTS.STORAGE_KEYS.FAVORITES, []);
        },

        /**
         * 儲存專利到收藏
         * @param {Object} patent - 專利資訊
         * @returns {Object} 操作結果
         */
        save(patent) {
            const saved = this.getAll();
            const exists = saved.find(p => p.number === patent.number);

            if (exists) {
                return {
                    success: false,
                    message: CONSTANTS.MESSAGES.ALREADY_SAVED
                };
            }

            saved.unshift({
                ...patent,
                savedAt: new Date().toISOString()
            });
            GM_setValue(CONSTANTS.STORAGE_KEYS.FAVORITES, saved);

            return {
                success: true,
                message: CONSTANTS.MESSAGES.SAVE_SUCCESS
            };
        },

        /**
         * 移除單一收藏
         * @param {string} number - 專利號碼
         */
        remove(number) {
            const saved = this.getAll();
            const filtered = saved.filter(p => p.number !== number);
            GM_setValue(CONSTANTS.STORAGE_KEYS.FAVORITES, filtered);
        },

        /**
         * 批次移除收藏
         * @param {Array<string>} numbers - 專利號碼陣列
         */
        removeMultiple(numbers) {
            const saved = this.getAll();
            const filtered = saved.filter(p => !numbers.includes(p.number));
            GM_setValue(CONSTANTS.STORAGE_KEYS.FAVORITES, filtered);
        },

        /**
         * 清空所有收藏
         */
        clear() {
            GM_setValue(CONSTANTS.STORAGE_KEYS.FAVORITES, []);
        },

        /**
         * 匯出為 JSON 格式
         */
        exportJSON() {
            const data = JSON.stringify(this.getAll(), null, 2);
            const filename = `patents_${this.getDateString()}.json`;
            Utils.downloadFile(data, filename, CONSTANTS.MIME_TYPES.JSON);
        },

        /**
         * 匯出為 CSV 格式
         */
        exportCSV() {
            const saved = this.getAll();
            const headers = ['公告/公開號', '專利名稱', '申請人', '連結', '收藏時間'];
            const rows = saved.map(p => [
                p.number,
                `"${(p.title || '').replace(/"/g, '""')}"`,
                `"${(p.applicant || '').replace(/"/g, '""')}"`,
                p.url,
                p.savedAt
            ]);

            const csv = [
                headers.join(','),
                ...rows.map(r => r.join(','))
            ].join('\n');

            const filename = `patents_${this.getDateString()}.csv`;
            Utils.downloadFile(csv, filename, CONSTANTS.MIME_TYPES.CSV);
        },

        /**
         * 取得當前日期字串
         * @returns {string} YYYY-MM-DD 格式
         */
        getDateString() {
            return new Date().toISOString().slice(0, 10);
        }
    };

    // ========================================
    // MEMO 管理模組
    // ========================================
    const MemoManager = {
        /**
         * 取得所有 MEMO
         * @returns {Object} MEMO 資料物件
         */
        getAll() {
            try {
                const data = GM_getValue(CONSTANTS.STORAGE_KEYS.MEMOS, {});
                if (typeof data !== 'object' || data === null || Array.isArray(data)) {
                    console.warn('[MEMO] 資料格式異常，重新初始化');
                    return {};
                }
                return data;
            } catch (e) {
                console.error('[MEMO] getAll 錯誤:', e);
                return {};
            }
        },

        /**
         * 取得特定專利的 MEMO
         * @param {string} patentNumber - 專利號碼
         * @returns {Object|null} MEMO 資料
         */
        getMemo(patentNumber) {
            const all = this.getAll();
            return all[patentNumber] || null;
        },

        /**
         * 新增標註到 MEMO
         * @param {Object} patent - 專利資訊
         * @param {string} text - 標註文字
         * @returns {Object} 操作結果
         */
        addAnnotation(patent, text) {
            if (!patent || !patent.number) {
                return {
                    success: false,
                    message: CONSTANTS.MESSAGES.INVALID_PATENT_INFO
                };
            }

            const trimmedText = (text || '').trim();
            if (!trimmedText) {
                return {
                    success: false,
                    message: CONSTANTS.MESSAGES.EMPTY_ANNOTATION
                };
            }

            try {
                const all = this.getAll();

                if (!all[patent.number]) {
                    all[patent.number] = {
                        number: patent.number,
                        title: patent.title || '',
                        url: patent.url || '',
                        createdAt: new Date().toISOString(),
                        annotations: []
                    };
                }

                const exists = all[patent.number].annotations
                    .some(a => a.text === trimmedText);

                if (exists) {
                    return {
                        success: false,
                        message: CONSTANTS.MESSAGES.ANNOTATION_EXISTS
                    };
                }

                all[patent.number].annotations.push({
                    text: trimmedText,
                    addedAt: new Date().toISOString()
                });

                GM_setValue(CONSTANTS.STORAGE_KEYS.MEMOS, all);

                return {
                    success: true,
                    message: CONSTANTS.MESSAGES.ANNOTATION_ADDED
                };
            } catch (e) {
                console.error('[MEMO] addAnnotation 錯誤:', e);
                return {
                    success: false,
                    message: `${CONSTANTS.MESSAGES.STORAGE_FAILED}: ${e.message}`
                };
            }
        },

        /**
         * 移除單一標註
         * @param {string} patentNumber - 專利號碼
         * @param {number} index - 標註索引
         */
        removeAnnotation(patentNumber, index) {
            const all = this.getAll();
            if (all[patentNumber] && all[patentNumber].annotations[index] !== undefined) {
                all[patentNumber].annotations.splice(index, 1);

                if (all[patentNumber].annotations.length === 0) {
                    delete all[patentNumber];
                }

                GM_setValue(CONSTANTS.STORAGE_KEYS.MEMOS, all);
            }
        },

        /**
         * 移除整個專利的 MEMO
         * @param {string} patentNumber - 專利號碼
         */
        removePatentMemo(patentNumber) {
            const all = this.getAll();
            delete all[patentNumber];
            GM_setValue(CONSTANTS.STORAGE_KEYS.MEMOS, all);
        },

        /**
         * 清空所有 MEMO
         */
        clearAll() {
            GM_setValue(CONSTANTS.STORAGE_KEYS.MEMOS, {});
        },

        /**
         * 取得專利數量
         * @returns {number} 專利數量
         */
        getPatentCount() {
            return Object.keys(this.getAll()).length;
        },

        /**
         * 取得標註總數
         * @returns {number} 標註總數
         */
        getTotalAnnotationCount() {
            const all = this.getAll();
            return Object.values(all)
                .reduce((sum, p) => sum + p.annotations.length, 0);
        },

        /**
         * 匯出單一專利 MEMO
         * @param {string} patentNumber - 專利號碼
         * @returns {Object} 操作結果
         */
        exportSingleMemo(patentNumber) {
            const memo = this.getMemo(patentNumber);
            if (!memo) {
                return {
                    success: false,
                    message: '找不到該專利MEMO'
                };
            }

            const content = this.formatMemoContent([memo]);
            const filename = `MEMO_${patentNumber}.txt`;

            Utils.downloadFile(content, filename, CONSTANTS.MIME_TYPES.TEXT);
            return {
                success: true,
                message: CONSTANTS.MESSAGES.EXPORT_SUCCESS
            };
        },

        /**
         * 匯出所有 MEMO（TXT 格式）
         * @returns {Object} 操作結果
         */
        exportAllMemos() {
            const all = this.getAll();
            const patents = Object.values(all);

            if (patents.length === 0) {
                return {
                    success: false,
                    message: CONSTANTS.MESSAGES.NO_MEMO_TO_EXPORT
                };
            }

            const sections = patents.map(memo => this.formatMemoContent([memo]));
            const content = sections.join('\n\n========================================\n\n');
            const filename = `MEMO_ALL_${FavoriteManager.getDateString()}.txt`;

            Utils.downloadFile(content, filename, CONSTANTS.MIME_TYPES.TEXT);
            return {
                success: true,
                message: '已匯出所有MEMO'
            };
        },

        /**
         * 匯出所有 MEMO（JSON 格式）
         */
        exportAllAsJSON() {
            const all = this.getAll();
            const data = JSON.stringify(all, null, 2);
            const filename = `MEMO_ALL_${FavoriteManager.getDateString()}.json`;

            Utils.downloadFile(data, filename, CONSTANTS.MIME_TYPES.JSON);
        },

        /**
         * 格式化 MEMO 內容
         * @param {Array<Object>} memos - MEMO 陣列
         * @returns {string} 格式化後的內容
         */
        formatMemoContent(memos) {
            return memos.map(memo => {
                const lines = [
                    `專利名稱：${memo.title}`,
                    `專利號：${memo.number}`,
                    '',
                    '---',
                    ...memo.annotations.map(a => a.text),
                    '---'
                ];
                return lines.join('\n');
            }).join('\n\n');
        }
    };

    // ========================================
    // 頁面資訊提取模組
    // ========================================
    const PageExtractor = {
        /**
         * 提取當前專利資訊
         * @returns {Object} 專利資訊物件
         */
        extractCurrentPatent() {
            const title = this.extractTitle();
            const number = this.extractPatentNumber();
            const applicant = this.extractApplicant();
            const url = this.extractURL();

            return { number, title, applicant, url };
        },

        /**
         * 提取專利名稱
         * @returns {string} 專利名稱
         */
        extractTitle() {
            const titleEl = document.querySelector(CONSTANTS.SELECTORS.TITLE);
            return titleEl ? titleEl.textContent.trim().split('\n')[0].trim() : '';
        },

        /**
         * 提取專利號碼
         * @returns {string} 專利號碼
         */
        extractPatentNumber() {
            let number = '';
            const wantedLabels = new Set(['公告號', '公開號', '公開公告號', '公開編號']);

            document.querySelectorAll(CONSTANTS.SELECTORS.DETAIL_ROW).forEach(row => {
                const label = row.querySelector('td.dettb01')?.textContent?.trim() || '';
                const valueText = row.querySelector('td.dettb02')?.textContent || '';

                if (!number && wantedLabels.has(label)) {
                    number = Utils.extractPatentNumber(valueText);
                }
            });

            if (!number) {
                const gpsTitle = document.querySelector(CONSTANTS.SELECTORS.GPS_TITLE)?.textContent || '';
                number = Utils.extractPatentNumber(gpsTitle);
            }

            if (!number) {
                const urlInput = document.getElementById('FRURL');
                const url = urlInput ? urlInput.value : window.location.href;
                const match = String(url || '').match(/!!FRURL([A-Z0-9]+)/i);
                if (match) number = match[1].trim();
            }

            return number;
        },

        /**
         * 提取申請人
         * @returns {string} 申請人
         */
        extractApplicant() {
            let applicant = '';

            document.querySelectorAll(CONSTANTS.SELECTORS.DETAIL_ROW).forEach(row => {
                const label = row.querySelector('td.dettb01');
                const value = row.querySelector('td.dettb02');

                if (label?.textContent.trim() === '申請人') {
                    const firstLink = value?.querySelector('a');
                    applicant = firstLink
                        ? firstLink.textContent.trim()
                        : (value?.textContent.trim().split(';')[0].trim() || '');
                }
            });

            return applicant;
        },

        /**
         * 提取專利連結
         * @returns {string} 專利連結
         */
        extractURL() {
            const urlInput = document.getElementById('FRURL');
            return urlInput ? urlInput.value : window.location.href;
        },

        /**
         * 提取頁面資訊（用於標題顯示）
         * @returns {Object} 頁面資訊物件
         */
        extractPageInfo() {
            const title = this.extractTitle();
            const nums = FullTextDownloader.extractPatentNumbers();

            return {
                title,
                grantNumber: nums.grantNumber,
                publicationNumber: nums.publicationNumber
            };
        }
    };

    // ========================================
    // 全文下載模組
    // ========================================
    const FullTextDownloader = {
        /**
         * 提取路徑參數
         * @returns {Object|null} 路徑參數物件
         */
        extractPathParams() {
            const nums = this.extractPatentNumbers();
            const raw = nums?.grantNumber || nums?.publicationNumber || '';
            const core = this.extractCoreNumber(raw);

            const candidates = this.findImageURLs();
            const parsed = candidates.map(this.parseImageURL).filter(Boolean);

            if (core) {
                const hit = parsed.find(x => x.href.includes(core));
                if (hit) return { gpssNum: hit.gpssNum, usrCode: hit.usrCode };
            }

            const gpss2 = parsed.find(x => x.gpssNum === '2');
            if (gpss2) return { gpssNum: gpss2.gpssNum, usrCode: gpss2.usrCode };

            if (parsed.length) {
                return {
                    gpssNum: parsed[0].gpssNum,
                    usrCode: parsed[0].usrCode
                };
            }

            return this.fallbackExtractFromHTML();
        },

        /**
         * 從原始號碼提取核心數字
         * @param {string} raw - 原始號碼
         * @returns {string} 核心數字
         */
        extractCoreNumber(raw) {
            const s = String(raw).trim();
            let match = s.match(/^TWI(\d+)B$/i);
            if (match) return match[1];

            match = s.match(/^TWM(\d+)U$/i);
            if (match) return match[1];

            match = s.match(/^TW(\d+)A$/i);
            if (match) return match[1];

            match = s.match(/(\d{6,})/);
            return match ? match[1] : '';
        },

        /**
         * 尋找圖片 URL
         * @returns {Array<string>} URL 陣列
         */
        findImageURLs() {
            return Array.from(
                document.querySelectorAll('a[href*="/gpssbkmusr/"][href$=".png"]')
            )
            .map(a => a.getAttribute('href'))
            .filter(Boolean);
        },

        /**
         * 解析圖片 URL
         * @param {string} href - 圖片 URL
         * @returns {Object|null} 解析結果
         */
        parseImageURL(href) {
            const match = String(href).match(/\/gpss(\d)\/gpssbkmusr\/(\d{5})\//i);
            return match ? {
                gpssNum: match[1],
                usrCode: match[2],
                href
            } : null;
        },

        /**
         * 從 HTML 內容提取（備用方法）
         * @returns {Object|null} 路徑參數
         */
        fallbackExtractFromHTML() {
            const html = document.body?.innerHTML || '';
            const match = html.match(/\/gpss(\d)\/gpssbkmusr\/(\d{5})\//i);
            return match ? { gpssNum: match[1], usrCode: match[2] } : null;
        },

        /**
         * 專利號碼規則
         */
        rules: {
            TW: {
                inventionGrant: (certNum) => {
                    const n = String(certNum || '').trim().replace(/^I/i, '');
                    return `TWBN-I${n}`;
                },
                utilityGrant: (certNum) => {
                    const n = String(certNum || '').trim().replace(/^M/i, '');
                    return `TWBN-M${n}`;
                },
                inventionPublication: (pubNum) => {
                    const n = String(pubNum || '').trim();
                    return `TWAN-${n}`;
                },
                parse: (rawNumber) => {
                    if (!rawNumber) return null;
                    const num = String(rawNumber).trim();

                    let match = num.match(/^TWI(\d+)B$/i);
                    if (match) return { type: 'inventionGrant', number: match[1] };

                    match = num.match(/^TWM(\d+)U$/i);
                    if (match) return { type: 'utilityGrant', number: match[1] };

                    match = num.match(/^TW(\d+)A$/i);
                    if (match) return { type: 'inventionPublication', number: match[1] };

                    match = num.match(/^M(\d+)$/i);
                    if (match) return { type: 'utilityGrant', number: match[1] };

                    match = num.match(/^I(\d+)$/i);
                    if (match) return { type: 'inventionGrant', number: match[1] };

                    match = num.match(/^(\d{6,})$/);
                    if (match) return { type: 'inventionPublication', number: match[1] };

                    return null;
                }
            }
        },

        /**
         * 提取專利號碼
         * @returns {Object} 專利號碼物件
         */
        extractPatentNumbers() {
            const result = { grantNumber: null, publicationNumber: null };

            document.querySelectorAll(CONSTANTS.SELECTORS.DETAIL_ROW).forEach(row => {
                const label = row.querySelector('td.dettb01')?.textContent?.trim() || '';
                const valueCell = row.querySelector('td.dettb02');
                const cellText = valueCell?.textContent || '';

                if (label === '公告號' && !result.grantNumber) {
                    result.grantNumber = Utils.extractPatentNumber(cellText) || null;

                    const pubLink = valueCell?.querySelector('span.linkan a');
                    if (pubLink && !result.publicationNumber) {
                        result.publicationNumber = pubLink.textContent.trim();
                    }
                }

                if ((label === '公開號' || label === '公開公告號' || label === '公開編號') &&
                    !result.publicationNumber) {
                    result.publicationNumber = Utils.extractPatentNumber(cellText) || null;
                }
            });

            if (!result.grantNumber && !result.publicationNumber) {
                const gpsTitle = document.querySelector(CONSTANTS.SELECTORS.GPS_TITLE)?.textContent || '';
                const n = Utils.extractPatentNumber(gpsTitle);
                if (n) result.grantNumber = n;
            }

            return result;
        },

        /**
         * 產生下載 URL
         * @param {string} country - 國家代碼
         * @returns {Object|null} URL 物件
         */
        generateDownloadURL(country = 'TW') {
            const pathParams = this.extractPathParams();
            if (!pathParams) return null;

            const patentNums = this.extractPatentNumbers();
            const rules = this.rules[country];
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

        /**
         * 下載全文 PDF
         * @param {string} country - 國家代碼
         */
        async download(country = 'TW') {
            const result = this.generateDownloadURL(country);

            if (!result) {
                alert('無法產生下載連結');
                return;
            }

            try {
                const response = await this.fetchPDF(result.url);

                if (!response.ok) {
                    this.handleDownloadError(response.status, result.url);
                    return;
                }

                const buffer = await response.arrayBuffer();

                if (!this.validatePDF(buffer, result.url)) {
                    return;
                }

                this.savePDF(buffer, result.filename);

            } catch (e) {
                this.handleDownloadException(e, result.url);
            }
        },

        /**
         * 取得 PDF 檔案
         * @param {string} url - PDF URL
         * @returns {Promise<Response>} Fetch Response
         */
        async fetchPDF(url) {
            return await fetch(url, {
                method: 'GET',
                credentials: 'include',
                cache: 'no-store'
            });
        },

        /**
         * 驗證 PDF 內容
         * @param {ArrayBuffer} buffer - PDF 內容
         * @param {string} url - PDF URL
         * @returns {boolean} 驗證結果
         */
        validatePDF(buffer, url) {
            if (buffer.byteLength < 5) {
                alert('下載內容異常（內容過短），將開啟原連結供確認。');
                window.open(url, '_blank', 'noopener');
                return false;
            }

            const head = new TextDecoder('ascii').decode(buffer.slice(0, 4));
            if (head !== '%PDF') {
                alert('下載到的內容不是 PDF（可能是導頁/錯誤頁/權限頁），將開啟原連結供確認。');
                window.open(url, '_blank', 'noopener');
                return false;
            }

            return true;
        },

        /**
         * 儲存 PDF 檔案
         * @param {ArrayBuffer} buffer - PDF 內容
         * @param {string} filename - 檔案名稱
         */
        savePDF(buffer, filename) {
            const blob = new Blob([buffer], { type: CONSTANTS.MIME_TYPES.PDF });
            const objectUrl = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = objectUrl;
            a.download = filename;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();

            setTimeout(() => {
                URL.revokeObjectURL(objectUrl);
                document.body.removeChild(a);
            }, CONSTANTS.CLEANUP_DELAY);
        },

        /**
         * 處理下載錯誤
         * @param {number} status - HTTP 狀態碼
         * @param {string} url - PDF URL
         */
        handleDownloadError(status, url) {
            alert(`下載失敗：HTTP ${status}\n將開啟原連結供確認。`);
            window.open(url, '_blank', 'noopener');
        },

        /**
         * 處理下載例外
         * @param {Error} error - 錯誤物件
         * @param {string} url - PDF URL
         */
        handleDownloadException(error, url) {
            alert(`下載例外：${error?.message || error}\n將開啟原連結供確認。`);
            window.open(url, '_blank', 'noopener');
        }
    };

    // ========================================
    // 樣式注入模組
    // ========================================
    const StyleInjector = {
        /**
         * 注入所有樣式
         */
        inject() {
            if (document.getElementById('modern-style')) return;

            const savedHeight = localStorage.getItem(CONSTANTS.STORAGE_KEYS.GALLERY_HEIGHT) ||
                               CONSTANTS.DEFAULT_GALLERY_HEIGHT;

            const styles = `
                #modern-style {}
                body {
                    background-color: #f4f7f9 !important;
                    font-family: "PingFang TC", sans-serif !important;
                    overflow: hidden !important;
                    margin: 0;
                    padding: 0;
                }

                /* ========================================
                   隱藏原有元素
                   ======================================== */
                #header,
                .navbar,
                .T62,
                .rectable,
                .detGP_top,
                .panel-warning,
                .container > table:not(.T62),
                #footer {
                    display: none !important;
                }

                /* ========================================
                   頂部標題列
                   ======================================== */
                #modern-header {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    height: ${CONSTANTS.HEADER_HEIGHT}px;
                    background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%);
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 0 20px;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.15);
                    z-index: 1000;
                }

                #header-left {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    max-width: 55%;
                }

                #header-title-area {
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    overflow: hidden;
                }

                #header-title {
                    color: #fff;
                    font-size: 16px;
                    font-weight: bold;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                #header-numbers {
                    display: flex;
                    gap: 12px;
                    margin-top: 4px;
                }

                .header-num-badge {
                    background: rgba(255,255,255,0.2);
                    color: #fff;
                    padding: 2px 10px;
                    border-radius: 12px;
                    font-size: 12px;
                }

                .header-num-badge.publication {
                    background: rgba(234,76,137,0.8);
                }

                #header-right {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

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

                .header-nav-btn:hover {
                    background: rgba(255,255,255,0.3);
                }

                .header-download-btn {
                    background: #ea4c89;
                    color: #fff;
                    border: none;
                    border-radius: 20px;
                    padding: 8px 16px;
                    font-size: 13px;
                    font-weight: bold;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .header-download-btn:hover {
                    background: #d63d7a;
                }

                /* ========================================
                   收藏按鈕
                   ======================================== */
                .header-fav-btn {
                    background: rgba(255,193,7,0.9);
                    color: #333;
                    border: none;
                    border-radius: 6px;
                    padding: 6px 12px;
                    font-size: 13px;
                    font-weight: bold;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .header-fav-btn:hover {
                    background: rgba(255,193,7,1);
                }

                .header-fav-btn.saved {
                    background: rgba(255,193,7,0.4);
                    color: #fff;
                }

                /* ========================================
                   已存按鈕
                   ======================================== */
                .header-list-btn {
                    background: rgba(255,255,255,0.15);
                    border: 1px solid rgba(255,255,255,0.3);
                    border-radius: 6px;
                    padding: 6px 12px;
                    font-size: 13px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: all 0.2s;
                    color: #fff;
                }

                .header-list-btn:hover {
                    background: rgba(255,255,255,0.3);
                }

                /* ========================================
                   MEMO 按鈕
                   ======================================== */
                .header-memo-btn {
                    background: rgba(76, 175, 80, 0.9);
                    color: #fff;
                    border: none;
                    border-radius: 6px;
                    padding: 6px 12px;
                    font-size: 13px;
                    font-weight: bold;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .header-memo-btn:hover {
                    background: rgba(76, 175, 80, 1);
                }

                /* ========================================
                   收藏側邊面板
                   ======================================== */
                #fav-panel {
                    position: fixed;
                    top: ${CONSTANTS.HEADER_HEIGHT}px;
                    right: -${CONSTANTS.FAV_PANEL_WIDTH + 10}px;
                    width: ${CONSTANTS.FAV_PANEL_WIDTH}px;
                    height: calc(100vh - ${CONSTANTS.HEADER_HEIGHT}px);
                    background: #fff;
                    box-shadow: -4px 0 15px rgba(0,0,0,0.15);
                    transition: right 0.3s ease;
                    z-index: 1001;
                    display: flex;
                    flex-direction: column;
                }

                #fav-panel.open {
                    right: 0;
                }

                #fav-panel-header {
                    background: #1976d2;
                    color: #fff;
                    padding: 15px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }

                #fav-panel-header h3 {
                    margin: 0;
                    font-size: 16px;
                }

                #fav-panel-close {
                    background: none;
                    border: none;
                    color: #fff;
                    font-size: 20px;
                    cursor: pointer;
                }

                #fav-panel-actions {
                    padding: 10px 15px;
                    border-bottom: 1px solid #e0e0e0;
                    display: flex;
                    gap: 8px;
                    flex-wrap: wrap;
                }

                .fav-action-btn {
                    background: #f5f5f5;
                    border: 1px solid #ddd;
                    border-radius: 4px;
                    padding: 5px 10px;
                    font-size: 12px;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .fav-action-btn:hover {
                    background: #e0e0e0;
                }

                .fav-action-btn.danger {
                    color: #d32f2f;
                }

                .fav-action-btn.danger:hover {
                    background: #ffebee;
                }

                #fav-panel-list {
                    flex: 1;
                    overflow-y: auto;
                    padding: 10px;
                }

                .fav-item {
                    background: #f9f9f9;
                    border: 1px solid #e0e0e0;
                    border-radius: 8px;
                    padding: 12px;
                    margin-bottom: 10px;
                    position: relative;
                }

                .fav-item:hover {
                    border-color: #1976d2;
                }

                .fav-item-header {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-bottom: 6px;
                }

                .fav-item-checkbox {
                    width: 16px;
                    height: 16px;
                    cursor: pointer;
                }

                .fav-item-number {
                    font-weight: bold;
                    color: #1976d2;
                    font-size: 13px;
                    text-decoration: none;
                }

                .fav-item-number:hover {
                    text-decoration: underline;
                }

                .fav-item-title {
                    font-size: 13px;
                    color: #333;
                    line-height: 1.4;
                    display: -webkit-box;
                    -webkit-line-clamp: 2;
                    -webkit-box-orient: vertical;
                    overflow: hidden;
                }

                .fav-item-meta {
                    font-size: 11px;
                    color: #888;
                    margin-top: 6px;
                    display: flex;
                    justify-content: space-between;
                }

                .fav-item-delete {
                    position: absolute;
                    top: 8px;
                    right: 8px;
                    background: none;
                    border: none;
                    color: #999;
                    cursor: pointer;
                    font-size: 14px;
                    padding: 2px 6px;
                    border-radius: 4px;
                }

                .fav-item-delete:hover {
                    background: #ffebee;
                    color: #d32f2f;
                }

                #fav-panel-empty {
                    text-align: center;
                    color: #999;
                    padding: 40px 20px;
                }

                /* ========================================
                   MEMO 側邊面板
                   ======================================== */
                #memo-panel {
                    position: fixed;
                    top: ${CONSTANTS.HEADER_HEIGHT}px;
                    right: -${CONSTANTS.MEMO_PANEL_WIDTH + 10}px;
                    width: ${CONSTANTS.MEMO_PANEL_WIDTH}px;
                    height: calc(100vh - ${CONSTANTS.HEADER_HEIGHT}px);
                    background: #fff;
                    box-shadow: -4px 0 15px rgba(0,0,0,0.15);
                    transition: right 0.3s ease;
                    z-index: 1002;
                    display: flex;
                    flex-direction: column;
                }

                #memo-panel.open {
                    right: 0;
                }

                #memo-panel-header {
                    background: #4caf50;
                    color: #fff;
                    padding: 15px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }

                #memo-panel-header h3 {
                    margin: 0;
                    font-size: 16px;
                }

                #memo-panel-close {
                    background: none;
                    border: none;
                    color: #fff;
                    font-size: 20px;
                    cursor: pointer;
                }

                #memo-panel-actions {
                    padding: 10px 15px;
                    border-bottom: 1px solid #e0e0e0;
                    display: flex;
                    gap: 8px;
                    flex-wrap: wrap;
                }

                .memo-action-btn {
                    background: #f5f5f5;
                    border: 1px solid #ddd;
                    border-radius: 4px;
                    padding: 5px 10px;
                    font-size: 12px;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .memo-action-btn:hover {
                    background: #e0e0e0;
                }

                .memo-action-btn.danger {
                    color: #d32f2f;
                }

                .memo-action-btn.danger:hover {
                    background: #ffebee;
                }

                .memo-action-btn.primary {
                    background: #e8f5e9;
                    color: #2e7d32;
                }

                .memo-action-btn.primary:hover {
                    background: #c8e6c9;
                }

                #memo-panel-list {
                    flex: 1;
                    overflow-y: auto;
                    padding: 10px;
                }

                .memo-patent-group {
                    background: #f9f9f9;
                    border: 1px solid #e0e0e0;
                    border-radius: 8px;
                    margin-bottom: 12px;
                    overflow: hidden;
                }

                .memo-patent-header {
                    background: #e8f5e9;
                    padding: 10px 12px;
                    cursor: pointer;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    border-bottom: 1px solid #c8e6c9;
                }

                .memo-patent-header:hover {
                    background: #c8e6c9;
                }

                .memo-patent-info {
                    flex: 1;
                }

                .memo-patent-number {
                    font-weight: bold;
                    color: #2e7d32;
                    font-size: 13px;
                }

                .memo-patent-title {
                    font-size: 12px;
                    color: #666;
                    margin-top: 2px;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    max-width: 280px;
                }

                .memo-patent-actions {
                    display: flex;
                    gap: 4px;
                }

                .memo-patent-action-btn {
                    background: none;
                    border: none;
                    cursor: pointer;
                    font-size: 14px;
                    padding: 4px 6px;
                    border-radius: 4px;
                    color: #666;
                }

                .memo-patent-action-btn:hover {
                    background: rgba(0,0,0,0.1);
                }

                .memo-patent-action-btn.delete:hover {
                    background: #ffebee;
                    color: #d32f2f;
                }

                .memo-annotations {
                    padding: 8px 12px;
                }

                .memo-annotations.collapsed {
                    display: none;
                }

                .memo-annotation-item {
                    background: #fff;
                    border: 1px solid #e0e0e0;
                    border-radius: 6px;
                    padding: 10px 12px;
                    margin-bottom: 8px;
                    position: relative;
                    font-size: 13px;
                    line-height: 1.6;
                    color: #333;
                }

                .memo-annotation-item:last-child {
                    margin-bottom: 0;
                }

                .memo-annotation-delete {
                    position: absolute;
                    top: 6px;
                    right: 6px;
                    background: none;
                    border: none;
                    color: #bbb;
                    cursor: pointer;
                    font-size: 12px;
                    padding: 2px 5px;
                    border-radius: 3px;
                }

                .memo-annotation-delete:hover {
                    background: #ffebee;
                    color: #d32f2f;
                }

                .memo-annotation-meta {
                    font-size: 10px;
                    color: #aaa;
                    margin-top: 6px;
                }

                #memo-panel-empty {
                    text-align: center;
                    color: #999;
                    padding: 40px 20px;
                }

                #memo-panel-stats {
                    padding: 8px 15px;
                    background: #f5f5f5;
                    border-bottom: 1px solid #e0e0e0;
                    font-size: 12px;
                    color: #666;
                }

                /* ========================================
                   自訂右鍵選單
                   ======================================== */
                #custom-context-menu {
                    position: fixed;
                    background: #fff;
                    border: 1px solid #ddd;
                    border-radius: 8px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                    z-index: 10000;
                    min-width: 160px;
                    padding: 6px 0;
                    display: none;
                }

                .context-menu-item {
                    padding: 10px 16px;
                    cursor: pointer;
                    font-size: 13px;
                    color: #333;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .context-menu-item:hover {
                    background: #e8f5e9;
                    color: #2e7d32;
                }

                .context-menu-item .icon {
                    font-size: 15px;
                }

                .context-menu-divider {
                    height: 1px;
                    background: #e0e0e0;
                    margin: 4px 0;
                }

                /* ========================================
                   主內容區域
                   ======================================== */
                #modern-wrapper {
                    display: flex;
                    position: fixed;
                    top: ${CONSTANTS.WRAPPER_TOP_OFFSET}px;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    gap: 0;
                    z-index: 99;
                    background: #f4f7f9;
                }

                /* ========================================
                   書目面板
                   ======================================== */
                #left-panel {
                    width: ${CONSTANTS.LEFT_PANEL_WIDTH}px;
                    background: #fff;
                    box-shadow: 2px 0 10px rgba(0,0,0,0.1);
                    transition: 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                    display: flex;
                    flex-direction: column;
                    border-right: 1px solid #e0e0e0;
                    flex-shrink: 0;
                    z-index: 101;
                }

                #left-panel.collapsed {
                    width: ${CONSTANTS.LEFT_PANEL_COLLAPSED_WIDTH}px;
                }

                #panel-toggle {
                    background: #ea4c89;
                    color: #fff;
                    border: none;
                    padding: 15px 5px;
                    cursor: pointer;
                    font-weight: bold;
                    writing-mode: vertical-lr;
                    text-orientation: upright;
                    font-size: 14px;
                    min-height: 100px;
                }

                #panel-content {
                    padding: 15px;
                    overflow-y: auto;
                    flex: 1;
                    transition: opacity 0.2s;
                }

                #left-panel.collapsed #panel-content {
                    opacity: 0;
                    pointer-events: none;
                    width: 0;
                    padding: 0;
                    overflow: hidden;
                }

                #main-content-area {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    padding: 0 15px;
                    overflow: hidden;
                    height: 100%;
                    position: relative;
                }

                #cards-container {
                    display: grid;
                    grid-template-columns: 60% calc(40% - 15px);
                    gap: 15px;
                    flex: 1;
                    min-height: 0;
                    overflow: hidden;
                    margin-bottom: 10px;
                    z-index: 1;
                }

                #right-column-stack {
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    height: 100%;
                    min-height: 0;
                    overflow: hidden;
                }

                .patent-card {
                    background: #fff;
                    border-radius: 12px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.08);
                    display: flex;
                    flex-direction: column;
                    border: 1px solid #e0e0e0;
                    overflow: hidden;
                    height: 100%;
                }

                .card-header {
                    background-color: #e3f2fd;
                    color: #1976d2;
                    padding: 10px 15px;
                    font-weight: bold;
                    border-bottom: 1px solid #d1d9e0;
                    flex-shrink: 0;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }

                .card-body {
                    padding: 15px;
                    overflow-y: auto;
                    flex: 1;
                    font-size: 15px;
                    line-height: 1.8;
                }

                .pill-btn-pink {
                    background-color: #ea4c89;
                    color: #fff;
                    border: none;
                    border-radius: 50px;
                    padding: 4px 12px;
                    font-size: 12px;
                    cursor: pointer;
                    font-weight: bold;
                }

                /* ========================================
                   圖示底部區域
                   ======================================== */
                #bottom-gallery-container {
                    display: flex;
                    gap: 10px;
                    flex-shrink: 0;
                    align-items: flex-end;
                    padding-bottom: 8px;
                    background: #f4f7f9;
                    z-index: 10;
                    position: relative;
                    border-top: 1px solid #e0e0e0;
                    padding-top: 5px;
                }

                #height-controls {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                    width: 35px;
                }

                .h-btn {
                    background: #ea4c89;
                    color: #fff;
                    border: none;
                    border-radius: 6px;
                    width: 32px;
                    height: 32px;
                    cursor: pointer;
                    font-weight: bold;
                    font-size: 18px;
                    line-height: 1;
                }

                #bottom-gallery {
                    flex: 1;
                    height: ${savedHeight}px;
                    background: #fff;
                    padding: 8px;
                    border-radius: 12px;
                    border: 1px solid #e0e0e0;
                    overflow: hidden;
                }

                .gallery-container {
                    display: flex !important;
                    flex-direction: row !important;
                    overflow-x: auto !important;
                    gap: 12px;
                    height: 100%;
                    align-items: center;
                    white-space: nowrap;
                }

                .gallery-container img {
                    max-height: calc(100% - 8px) !important;
                    width: auto !important;
                    border-radius: 4px;
                    cursor: zoom-in;
                }

                /* ========================================
                   Toast 通知
                   ======================================== */
                .toast-notify {
                    position: fixed;
                    bottom: 30px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: #333;
                    color: #fff;
                    padding: 12px 24px;
                    border-radius: 8px;
                    font-size: 14px;
                    z-index: 9999;
                    opacity: 0;
                    transition: opacity 0.3s;
                }

                .toast-notify.show {
                    opacity: 1;
                }
            `;

            GM_addStyle(styles);
        }
    };

    // ========================================
    // UI 組件模組
    // ========================================
    const UIComponents = {
        /**
         * 建立收藏面板
         * @returns {HTMLElement} 收藏面板元素
         */
        createFavPanel() {
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

            this.bindFavPanelEvents(panel);
            return panel;
        },

        /**
         * 綁定收藏面板事件
         * @param {HTMLElement} panel - 面板元素
         */
        bindFavPanelEvents(panel) {
            document.getElementById('fav-panel-close').onclick = () => {
                panel.classList.remove('open');
            };

            document.getElementById('fav-select-all').onclick = () => {
                const checkboxes = panel.querySelectorAll('.fav-item-checkbox');
                const allChecked = Array.from(checkboxes).every(cb => cb.checked);
                checkboxes.forEach(cb => cb.checked = !allChecked);
            };

            document.getElementById('fav-delete-selected').onclick = () => {
                this.handleFavDeleteSelected(panel);
            };

            document.getElementById('fav-export-json').onclick = () => {
                FavoriteManager.exportJSON();
                Utils.showToast('已匯出 JSON');
            };

            document.getElementById('fav-export-csv').onclick = () => {
                FavoriteManager.exportCSV();
                Utils.showToast('已匯出 CSV');
            };
        },

        /**
         * 處理刪除已選收藏
         * @param {HTMLElement} panel - 面板元素
         */
        handleFavDeleteSelected(panel) {
            const checked = Array.from(panel.querySelectorAll('.fav-item-checkbox:checked'));

            if (checked.length === 0) {
                Utils.showToast('請先勾選要刪除的項目');
                return;
            }

            if (!confirm(`確定刪除 ${checked.length} 筆收藏？`)) return;

            const numbers = checked.map(cb => cb.dataset.number);
            FavoriteManager.removeMultiple(numbers);
            this.renderFavList();
            this.updateFavCount();
            Utils.showToast(`已刪除 ${numbers.length} 筆`);
        },

        /**
         * 渲染收藏列表
         */
        renderFavList() {
            const listContainer = document.getElementById('fav-panel-list');
            const saved = FavoriteManager.getAll();

            if (saved.length === 0) {
                listContainer.innerHTML = '<div id="fav-panel-empty">尚無收藏專利<br>點擊「⭐ 收藏」加入</div>';
                return;
            }

            listContainer.innerHTML = saved.map(p => this.createFavItemHTML(p)).join('');
            this.bindFavItemEvents(listContainer);
        },

        /**
         * 建立收藏項目 HTML
         * @param {Object} patent - 專利資訊
         * @returns {string} HTML 字串
         */
        createFavItemHTML(patent) {
            return `
                <div class="fav-item" data-number="${patent.number}">
                    <button class="fav-item-delete" title="刪除">✕</button>
                    <div class="fav-item-header">
                        <input type="checkbox" class="fav-item-checkbox" data-number="${patent.number}">
                        <a href="${patent.url}" class="fav-item-number" target="_blank">${patent.number}</a>
                    </div>
                    <div class="fav-item-title" title="${patent.title || ''}">${patent.title || '(無標題)'}</div>
                    <div class="fav-item-meta">
                        <span>${patent.applicant || '(無申請人)'}</span>
                        <span>${patent.savedAt ? patent.savedAt.slice(0, 10) : ''}</span>
                    </div>
                </div>
            `;
        },

        /**
         * 綁定收藏項目事件
         * @param {HTMLElement} container - 容器元素
         */
        bindFavItemEvents(container) {
            container.querySelectorAll('.fav-item-delete').forEach(btn => {
                btn.onclick = (e) => {
                    const item = e.target.closest('.fav-item');
                    const number = item.dataset.number;
                    FavoriteManager.remove(number);
                    this.renderFavList();
                    this.updateFavCount();
                    Utils.showToast('已移除收藏');
                };
            });
        },

        /**
         * 更新收藏數量顯示
         */
        updateFavCount() {
            const btn = document.getElementById('fav-list-btn');
            if (btn) {
                const count = FavoriteManager.getAll().length;
                btn.textContent = `📂 已存 (${count})`;
            }
        },

        /**
         * 更新收藏按鈕狀態
         */
        updateFavButtonState() {
            const btn = document.getElementById('fav-add-btn');
            if (!btn) return;

            const current = PageExtractor.extractCurrentPatent();
            const saved = FavoriteManager.getAll();
            const isSaved = saved.some(p => p.number === current.number);

            btn.classList.toggle('saved', isSaved);
            btn.textContent = isSaved ? '⭐ 已收藏' : '⭐ 收藏';
        },

        /**
         * 建立 MEMO 面板
         * @returns {HTMLElement} MEMO 面板元素
         */
        createMemoPanel() {
            const panel = document.createElement('div');
            panel.id = 'memo-panel';
            panel.innerHTML = `
                <div id="memo-panel-header">
                    <h3>📝 MEMO 標註</h3>
                    <button id="memo-panel-close">✕</button>
                </div>
                <div id="memo-panel-stats"></div>
                <div id="memo-panel-actions">
                    <button class="memo-action-btn primary" id="memo-export-all-txt">匯出全部 TXT</button>
                    <button class="memo-action-btn" id="memo-export-all-json">匯出 JSON</button>
                    <button class="memo-action-btn danger" id="memo-clear-all">清除全部</button>
                </div>
                <div id="memo-panel-list"></div>
            `;
            document.body.appendChild(panel);

            this.bindMemoPanelEvents(panel);
            return panel;
        },

        /**
         * 綁定 MEMO 面板事件
         * @param {HTMLElement} panel - 面板元素
         */
        bindMemoPanelEvents(panel) {
            document.getElementById('memo-panel-close').onclick = () => {
                panel.classList.remove('open');
            };

            document.getElementById('memo-export-all-txt').onclick = () => {
                const result = MemoManager.exportAllMemos();
                Utils.showToast(result.message);
            };

            document.getElementById('memo-export-all-json').onclick = () => {
                MemoManager.exportAllAsJSON();
                Utils.showToast('已匯出 JSON');
            };

            document.getElementById('memo-clear-all').onclick = () => {
                this.handleMemoClearAll();
            };
        },

        /**
         * 處理清除所有 MEMO
         */
        handleMemoClearAll() {
            const count = MemoManager.getPatentCount();

            if (count === 0) {
                Utils.showToast('無MEMO可清除');
                return;
            }

            if (!confirm(`確定清除全部 ${count} 個專利的MEMO？`)) return;

            MemoManager.clearAll();
            this.renderMemoList();
            this.updateMemoCount();
            Utils.showToast('已清除全部MEMO');
        },

        /**
         * 渲染 MEMO 列表
         */
        renderMemoList() {
            const listContainer = document.getElementById('memo-panel-list');
            const statsContainer = document.getElementById('memo-panel-stats');
            const all = MemoManager.getAll();
            const patents = Object.values(all);

            this.updateMemoStats(statsContainer, patents);

            if (patents.length === 0) {
                listContainer.innerHTML = '<div id="memo-panel-empty">尚無MEMO標註<br>選取文字後按右鍵加入</div>';
                return;
            }

            listContainer.innerHTML = patents.map(memo => this.createMemoGroupHTML(memo)).join('');
            this.bindMemoGroupEvents(listContainer);
        },

        /**
         * 更新 MEMO 統計資訊
         * @param {HTMLElement} container - 統計容器
         * @param {Array<Object>} patents - 專利陣列
         */
        updateMemoStats(container, patents) {
            const totalAnnotations = patents.reduce((sum, p) => sum + p.annotations.length, 0);
            container.textContent = `共 ${patents.length} 個專利，${totalAnnotations} 條標註`;
        },

        /**
         * 建立 MEMO 群組 HTML
         * @param {Object} memo - MEMO 資料
         * @returns {string} HTML 字串
         */
        createMemoGroupHTML(memo) {
            return `
                <div class="memo-patent-group" data-number="${memo.number}">
                    <div class="memo-patent-header">
                        <div class="memo-patent-info">
                            <div class="memo-patent-number">${memo.number}</div>
                            <div class="memo-patent-title" title="${memo.title || ''}">${memo.title || '(無標題)'}</div>
                        </div>
                        <div class="memo-patent-actions">
                            <button class="memo-patent-action-btn export" title="匯出此專利MEMO">📄</button>
                            <button class="memo-patent-action-btn delete" title="刪除此專利全部MEMO">🗑️</button>
                            <button class="memo-patent-action-btn toggle" title="展開/收合">▼</button>
                        </div>
                    </div>
                    <div class="memo-annotations">
                        ${memo.annotations.map((a, idx) => this.createAnnotationItemHTML(a, idx)).join('')}
                    </div>
                </div>
            `;
        },

        /**
         * 建立標註項目 HTML
         * @param {Object} annotation - 標註資料
         * @param {number} index - 索引
         * @returns {string} HTML 字串
         */
        createAnnotationItemHTML(annotation, index) {
            const timeStr = annotation.addedAt ?
                annotation.addedAt.slice(0, 16).replace('T', ' ') : '';

            return `
                <div class="memo-annotation-item" data-index="${index}">
                    <button class="memo-annotation-delete" title="刪除此標註">✕</button>
                    <div class="memo-annotation-text">${Utils.escapeHtml(annotation.text)}</div>
                    <div class="memo-annotation-meta">${timeStr}</div>
                </div>
            `;
        },

        /**
         * 綁定 MEMO 群組事件
         * @param {HTMLElement} container - 容器元素
         */
        bindMemoGroupEvents(container) {
            container.querySelectorAll('.memo-patent-group').forEach(group => {
                const number = group.dataset.number;
                const header = group.querySelector('.memo-patent-header');
                const annotations = group.querySelector('.memo-annotations');
                const toggleBtn = group.querySelector('.toggle');
                const exportBtn = group.querySelector('.export');
                const deleteBtn = group.querySelector('.memo-patent-actions .delete');

                this.bindToggleEvent(header, annotations, toggleBtn);
                this.bindExportEvent(exportBtn, number);
                this.bindDeletePatentEvent(deleteBtn, number);
                this.bindDeleteAnnotationEvents(group, number);
            });
        },

        /**
         * 綁定展開/收合事件
         * @param {HTMLElement} header - 標頭元素
         * @param {HTMLElement} annotations - 標註容器
         * @param {HTMLElement} toggleBtn - 切換按鈕
         */
        bindToggleEvent(header, annotations, toggleBtn) {
            const toggle = () => {
                annotations.classList.toggle('collapsed');
                toggleBtn.textContent = annotations.classList.contains('collapsed') ? '▶' : '▼';
            };

            toggleBtn.onclick = (e) => {
                e.stopPropagation();
                toggle();
            };

            header.onclick = toggle;
        },

        /**
         * 綁定匯出事件
         * @param {HTMLElement} btn - 按鈕元素
         * @param {string} number - 專利號碼
         */
        bindExportEvent(btn, number) {
            btn.onclick = (e) => {
                e.stopPropagation();
                MemoManager.exportSingleMemo(number);
                Utils.showToast(`已匯出 ${number} 的MEMO`);
            };
        },

        /**
         * 綁定刪除專利事件
         * @param {HTMLElement} btn - 按鈕元素
         * @param {string} number - 專利號碼
         */
        bindDeletePatentEvent(btn, number) {
            btn.onclick = (e) => {
                e.stopPropagation();
                if (!confirm(`確定刪除 ${number} 的全部標註？`)) return;

                MemoManager.removePatentMemo(number);
                this.renderMemoList();
                this.updateMemoCount();
                Utils.showToast('已刪除');
            };
        },

        /**
         * 綁定刪除標註事件
         * @param {HTMLElement} group - 群組元素
         * @param {string} number - 專利號碼
         */
        bindDeleteAnnotationEvents(group, number) {
            group.querySelectorAll('.memo-annotation-delete').forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    const item = e.target.closest('.memo-annotation-item');
                    const index = parseInt(item.dataset.index);

                    MemoManager.removeAnnotation(number, index);
                    this.renderMemoList();
                    this.updateMemoCount();
                    Utils.showToast('已刪除標註');
                };
            });
        },

        /**
         * 更新 MEMO 數量顯示
         */
        updateMemoCount() {
            const btn = document.getElementById('memo-btn');
            if (btn) {
                const count = MemoManager.getTotalAnnotationCount();
                btn.textContent = `📝 MEMO (${count})`;
            }
        },

        /**
         * 建立右鍵選單
         * @returns {HTMLElement} 選單元素
         */
        createContextMenu() {
            const menu = document.createElement('div');
            menu.id = 'custom-context-menu';
            menu.innerHTML = `
                <div class="context-menu-item" id="ctx-add-memo">
                    <span class="icon">📝</span>
                    <span>加入 MEMO</span>
                </div>
                <div class="context-menu-divider"></div>
                <div class="context-menu-item" id="ctx-copy">
                    <span class="icon">📋</span>
                    <span>複製</span>
                </div>
            `;
            document.body.appendChild(menu);

            this.bindContextMenuEvents(menu);
            return menu;
        },

        /**
         * 綁定右鍵選單事件
         * @param {HTMLElement} menu - 選單元素
         */
        bindContextMenuEvents(menu) {
            let currentSelectedText = '';

            document.getElementById('ctx-add-memo').onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (currentSelectedText) {
                    const patent = PageExtractor.extractCurrentPatent();

                    if (!patent.number) {
                        Utils.showToast(CONSTANTS.MESSAGES.NO_PATENT_NUMBER);
                    } else {
                        const result = MemoManager.addAnnotation(patent, currentSelectedText);
                        Utils.showToast(result.message);

                        if (result.success) {
                            this.updateMemoCount();
                            const memoPanel = document.getElementById('memo-panel');
                            if (memoPanel && memoPanel.classList.contains('open')) {
                                this.renderMemoList();
                            }
                        }
                    }
                } else {
                    Utils.showToast(CONSTANTS.MESSAGES.SELECT_TEXT_FIRST);
                }

                ContextMenuManager.hide();
                currentSelectedText = '';
            };

            document.getElementById('ctx-copy').onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (currentSelectedText) {
                    navigator.clipboard.writeText(currentSelectedText)
                        .then(() => Utils.showToast(CONSTANTS.MESSAGES.COPY_SUCCESS))
                        .catch(() => Utils.showToast(CONSTANTS.MESSAGES.COPY_FAILED));
                }

                ContextMenuManager.hide();
                currentSelectedText = '';
            };

            ContextMenuManager.setTextCapture(() => {
                currentSelectedText = window.getSelection().toString().trim();
            });
        }
    };

    // ========================================
    // 右鍵選單管理模組
    // ========================================
    const ContextMenuManager = {
        textCaptureCallback: null,

        /**
         * 設定文字捕獲回呼
         * @param {Function} callback - 回呼函式
         */
        setTextCapture(callback) {
            this.textCaptureCallback = callback;
        },

        /**
         * 顯示右鍵選單
         * @param {number} x - X 座標
         * @param {number} y - Y 座標
         */
        show(x, y) {
            const menu = document.getElementById('custom-context-menu') ||
                        UIComponents.createContextMenu();

            if (this.textCaptureCallback) {
                this.textCaptureCallback();
            }

            menu.style.display = 'block';

            const menuRect = menu.getBoundingClientRect();
            const posX = this.adjustPosition(x, menuRect.width, window.innerWidth);
            const posY = this.adjustPosition(y, menuRect.height, window.innerHeight);

            menu.style.left = `${posX}px`;
            menu.style.top = `${posY}px`;
        },

        /**
         * 調整位置避免超出視窗
         * @param {number} pos - 原始位置
         * @param {number} size - 選單尺寸
         * @param {number} max - 視窗尺寸
         * @returns {number} 調整後位置
         */
        adjustPosition(pos, size, max) {
            return (pos + size > max) ? (max - size - 10) : pos;
        },

        /**
         * 隱藏右鍵選單
         */
        hide() {
            const menu = document.getElementById('custom-context-menu');
            if (menu) {
                menu.style.display = 'none';
            }
        },

        /**
         * 設置右鍵選單事件監聽
         */
        setupEvents() {
            document.addEventListener('contextmenu', (e) => {
                const selectedText = window.getSelection().toString().trim();
                const target = e.target;

                const isInContentArea = target.closest('#d-body') ||
                                       target.closest('.card-body') ||
                                       target.closest('#panel-content') ||
                                       target.closest('#modern-wrapper');

                if (selectedText && selectedText.length > 0 && isInContentArea) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.show(e.clientX, e.clientY);
                } else {
                    this.hide();
                }
            }, true);

            document.addEventListener('click', (e) => {
                const menu = document.getElementById('custom-context-menu');
                if (menu && !menu.contains(e.target)) {
                    this.hide();
                }
            });

            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    this.hide();
                }
            });
        }
    };

    // ========================================
    // 圖片檢視器模組
    // ========================================
    const ImageViewer = {
        /**
         * 開啟圖片檢視器
         * @param {string} imgSrc - 圖片來源
         */
        async open(imgSrc) {
            if (window.documentPictureInPicture) {
                try {
                    const pipWindow = await window.documentPictureInPicture.requestWindow({
                        width: 1000,
                        height: 800
                    });
                    this.setupContent(pipWindow, imgSrc);
                    return;
                } catch (e) {
                    console.warn("PiP 請求失敗，轉向獨立視窗模式");
                }
            }

            const popup = window.open('', '_blank', 'width=1100,height=850,toolbar=no,location=no');
            if (popup) {
                this.setupContent(popup, imgSrc);
            } else {
                alert("請允許彈出視窗以檢視圖片");
            }
        },

        /**
         * 設置檢視器內容
         * @param {Window} win - 視窗物件
         * @param {string} imgSrc - 圖片來源
         */
        setupContent(win, imgSrc) {
            this.injectStyles(win);
            this.createHTML(win, imgSrc);
            this.bindControls(win);
        },

        /**
         * 注入樣式
         * @param {Window} win - 視窗物件
         */
        injectStyles(win) {
            const style = win.document.createElement("style");
            style.textContent = `
                body {
                    margin: 0;
                    background: #222;
                    display: flex;
                    height: 100vh;
                    overflow: hidden;
                    font-family: sans-serif;
                }
                #sidebar {
                    width: 55px;
                    background: #111;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    padding-top: 20px;
                    gap: 15px;
                    border-right: 1px solid #333;
                    z-index: 100;
                    position: relative;
                }
                .btn {
                    width: 38px;
                    height: 38px;
                    background: #ea4c89;
                    color: white;
                    border: none;
                    border-radius: 8px;
                    cursor: pointer;
                    font-weight: bold;
                    font-size: 20px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                #view {
                    flex: 1;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: grab;
                    z-index: 1;
                }
                img {
                    transition: 0.15s ease-out;
                    transform-origin: center;
                    user-select: none;
                    -webkit-user-drag: none;
                }
            `;
            win.document.head.append(style);
        },

        /**
         * 建立 HTML 結構
         * @param {Window} win - 視窗物件
         * @param {string} imgSrc - 圖片來源
         */
        createHTML(win, imgSrc) {
            win.document.body.innerHTML = `
                <div id="sidebar">
                    <button id="z-in" class="btn">＋</button>
                    <button id="z-out" class="btn">－</button>
                    <button id="r-l" class="btn">↶</button>
                    <button id="r-r" class="btn">↷</button>
                    <button id="reset" class="btn" style="font-size:10px">RESET</button>
                </div>
                <div id="view">
                    <img id="p" src="${imgSrc}">
                </div>
            `;
        },

        /**
         * 綁定控制事件
         * @param {Window} win - 視窗物件
         */
        bindControls(win) {
            let scale = 1;
            let rotation = 0;
            let posX = 0;
            let posY = 0;
            let isDragging = false;
            let startX, startY;

            const img = win.document.getElementById('p');
            const view = win.document.getElementById('view');

            const updateTransform = () => {
                img.style.transform = `translate(${posX}px, ${posY}px) rotate(${rotation}deg) scale(${scale})`;
            };

            win.document.getElementById('z-in').onclick = () => {
                scale = Math.min(8, scale + 0.2);
                updateTransform();
            };

            win.document.getElementById('z-out').onclick = () => {
                scale = Math.max(0.3, scale - 0.2);
                updateTransform();
            };

            win.document.getElementById('r-l').onclick = () => {
                rotation -= 90;
                updateTransform();
            };

            win.document.getElementById('r-r').onclick = () => {
                rotation += 90;
                updateTransform();
            };

            win.document.getElementById('reset').onclick = () => {
                scale = 1;
                rotation = 0;
                posX = 0;
                posY = 0;
                updateTransform();
            };

            view.onmousedown = (e) => {
                isDragging = true;
                startX = e.clientX - posX;
                startY = e.clientY - posY;
                e.preventDefault();
            };

            win.onmousemove = (e) => {
                if (!isDragging) return;
                posX = e.clientX - startX;
                posY = e.clientY - startY;
                updateTransform();
            };

            win.onmouseup = () => {
                isDragging = false;
            };

            view.onwheel = (e) => {
                e.preventDefault();
                scale = Math.min(Math.max(0.3, scale + (e.deltaY > 0 ? -0.1 : 0.1)), 8);
                updateTransform();
            };
        }
    };

    // ========================================
    // 主 UI 重構模組
    // ========================================
    const MainUI = {
        /**
         * 重構 UI
         */
        reconstruct() {
            if (!Utils.checkIsDetail() || document.getElementById('modern-wrapper')) {
                return;
            }

            StyleInjector.inject();
            this.createHeader();
            this.createMainContent();
            this.hideOriginalElements();
            ContextMenuManager.setupEvents();
            UIComponents.createContextMenu();
        },

        /**
         * 建立頂部標題列
         */
        createHeader() {
            const pageInfo = PageExtractor.extractPageInfo();
            const header = document.createElement('div');
            header.id = 'modern-header';

            const leftSection = this.createHeaderLeft(pageInfo);
            const rightSection = this.createHeaderRight();

            header.appendChild(leftSection);
            header.appendChild(rightSection);
            document.body.appendChild(header);

            UIComponents.updateFavButtonState();
        },

        /**
         * 建立標題列左側
         * @param {Object} pageInfo - 頁面資訊
         * @returns {HTMLElement} 左側元素
         */
        createHeaderLeft(pageInfo) {
            const left = document.createElement('div');
            left.id = 'header-left';

            const favBtn = this.createFavButton();
            const titleArea = this.createTitleArea(pageInfo);

            left.appendChild(favBtn);
            left.appendChild(titleArea);

            return left;
        },

        /**
         * 建立收藏按鈕
         * @returns {HTMLElement} 收藏按鈕
         */
        createFavButton() {
            const btn = document.createElement('button');
            btn.id = 'fav-add-btn';
            btn.className = 'header-fav-btn';
            btn.textContent = '⭐ 收藏';

            btn.onclick = () => {
                const patent = PageExtractor.extractCurrentPatent();

                if (!patent.number) {
                    Utils.showToast(CONSTANTS.MESSAGES.NO_PATENT_NUMBER);
                    return;
                }

                const result = FavoriteManager.save(patent);
                Utils.showToast(result.message);
                UIComponents.updateFavButtonState();
                UIComponents.updateFavCount();
            };

            return btn;
        },

/**
         * 建立標題區域
         * @param {Object} pageInfo - 頁面資訊
         * @returns {HTMLElement} 標題區域元素
         */
        createTitleArea(pageInfo) {
            const area = document.createElement('div');
            area.id = 'header-title-area';

            const title = document.createElement('div');
            title.id = 'header-title';
            title.textContent = pageInfo.title;
            title.title = pageInfo.title;

            const numbers = this.createNumberBadges(pageInfo);

            area.appendChild(title);
            area.appendChild(numbers);

            return area;
        },

        /**
         * 建立號碼徽章
         * @param {Object} pageInfo - 頁面資訊
         * @returns {HTMLElement} 號碼容器
         */
        createNumberBadges(pageInfo) {
            const container = document.createElement('div');
            container.id = 'header-numbers';

            if (pageInfo.grantNumber) {
                const badge = document.createElement('span');
                badge.className = 'header-num-badge';
                badge.textContent = `公告 ${pageInfo.grantNumber}`;
                container.appendChild(badge);
            }

            if (pageInfo.publicationNumber) {
                const badge = document.createElement('span');
                badge.className = 'header-num-badge publication';
                badge.textContent = `公開 ${pageInfo.publicationNumber}`;
                container.appendChild(badge);
            }

            return container;
        },

        /**
         * 建立標題列右側
         * @returns {HTMLElement} 右側元素
         */
        createHeaderRight() {
            const right = document.createElement('div');
            right.id = 'header-right';

            const memoBtn = this.createMemoButton();
            const navButtons = this.createNavButtons();
            const downloadBtn = this.createDownloadButton();
            const favListBtn = this.createFavListButton();

            right.appendChild(memoBtn);
            navButtons.forEach(btn => right.appendChild(btn));
            right.appendChild(downloadBtn);
            right.appendChild(favListBtn);

            return right;
        },

        /**
         * 建立 MEMO 按鈕
         * @returns {HTMLElement} MEMO 按鈕
         */
        createMemoButton() {
            const btn = document.createElement('button');
            btn.id = 'memo-btn';
            btn.className = 'header-memo-btn';
            btn.textContent = `📝 MEMO (${MemoManager.getTotalAnnotationCount()})`;

            btn.onclick = () => {
                const favPanel = document.getElementById('fav-panel');
                if (favPanel) favPanel.classList.remove('open');

                const panel = document.getElementById('memo-panel') ||
                             UIComponents.createMemoPanel();
                UIComponents.renderMemoList();
                panel.classList.toggle('open');
            };

            return btn;
        },

        /**
         * 建立導覽按鈕
         * @returns {Array<HTMLElement>} 按鈕陣列
         */
        createNavButtons() {
            const navDefs = [
                { name: '_IMG_回查詢', label: '回查詢', icon: '🔍' },
                { name: '_IMG_回簡目', label: '回簡目', icon: '📋' },
                { name: '_IMG_前筆', label: '◀ 前筆' },
                { name: '_IMG_次筆', label: '次筆 ▶' }
            ];

            return navDefs.map(def => {
                const originalBtn = document.querySelector(`input[name="${def.name}"]`);
                if (!originalBtn) return null;

                const btn = document.createElement('button');
                btn.className = 'header-nav-btn';
                btn.innerHTML = def.icon ? `${def.icon} ${def.label}` : def.label;
                btn.onclick = () => originalBtn.click();

                return btn;
            }).filter(Boolean);
        },

        /**
         * 建立下載按鈕
         * @returns {HTMLElement} 下載按鈕
         */
        createDownloadButton() {
            const btn = document.createElement('button');
            btn.className = 'header-download-btn';
            btn.innerHTML = '📄 下載全文';
            btn.onclick = () => FullTextDownloader.download('TW');

            return btn;
        },

        /**
         * 建立收藏列表按鈕
         * @returns {HTMLElement} 收藏列表按鈕
         */
        createFavListButton() {
            const btn = document.createElement('button');
            btn.id = 'fav-list-btn';
            btn.className = 'header-list-btn';
            btn.textContent = `📂 已存 (${FavoriteManager.getAll().length})`;

            btn.onclick = () => {
                const memoPanel = document.getElementById('memo-panel');
                if (memoPanel) memoPanel.classList.remove('open');

                const panel = document.getElementById('fav-panel') ||
                             UIComponents.createFavPanel();
                UIComponents.renderFavList();
                panel.classList.toggle('open');
            };

            return btn;
        },

        /**
         * 建立主內容區
         */
        createMainContent() {
            const panels = document.querySelectorAll(CONSTANTS.SELECTORS.PANEL_BODY);
            const bibData = panels[1]?.innerHTML || "";
            const claimsContent = (panels[2]?.innerHTML || "").trim();
            const detailContent = (panels[3]?.innerHTML || "").trim();
            const hasImpl = detailContent.includes('【實施方式】');

            const savedHeight = localStorage.getItem(CONSTANTS.STORAGE_KEYS.GALLERY_HEIGHT) ||
                               CONSTANTS.DEFAULT_GALLERY_HEIGHT;

            const wrapper = document.createElement('div');
            wrapper.id = 'modern-wrapper';
            wrapper.innerHTML = this.createWrapperHTML(
                bibData,
                detailContent,
                claimsContent,
                hasImpl,
                savedHeight
            );

            document.body.appendChild(wrapper);

            this.setupLeftPanel();
            this.setupGallery();
            this.setupGalleryControls();

            if (hasImpl) {
                this.setupImplJump();
            }
        },

        /**
         * 建立包裝器 HTML
         * @param {string} bibData - 書目資料
         * @param {string} detailContent - 詳細說明內容
         * @param {string} claimsContent - 專利範圍內容
         * @param {boolean} hasImpl - 是否有實施方式
         * @param {string} savedHeight - 儲存的高度
         * @returns {string} HTML 字串
         */
        createWrapperHTML(bibData, detailContent, claimsContent, hasImpl, savedHeight) {
            return `
                <div id="left-panel" class="collapsed">
                    <button id="panel-toggle">案件書目 —</button>
                    <div id="panel-content">
                        <h4 style="color:#1976d2; border-bottom:2px solid #ea4c89; padding-bottom:5px; margin-top:0;">
                            書目詳細
                        </h4>
                        ${bibData}
                    </div>
                </div>
                <div id="main-content-area">
                    <div id="cards-container">
                        <div class="patent-card" style="display: ${detailContent ? 'flex' : 'none'};">
                            <div class="card-header">
                                詳細說明
                                <button id="jump-impl" class="pill-btn-pink" style="display: ${hasImpl ? 'block' : 'none'};">
                                    跳至實施方式
                                </button>
                            </div>
                            <div id="d-body" class="card-body">${detailContent}</div>
                        </div>
                        <div id="right-column-stack" style="display: ${claimsContent ? 'flex' : 'none'};">
                            <div class="patent-card" style="flex:1;">
                                <div class="card-header">專利範圍</div>
                                <div class="card-body">${claimsContent}</div>
                            </div>
                        </div>
                    </div>
                    <div id="bottom-gallery-container">
                        <div id="height-controls">
                            <button id="h-p" class="h-btn">＋</button>
                            <button id="h-m" class="h-btn">－</button>
                        </div>
                        <div id="bottom-gallery" style="height: ${savedHeight}px;">
                            <div id="g-box" class="gallery-container"></div>
                        </div>
                    </div>
                </div>
            `;
        },

        /**
         * 設置左側書目面板
         */
        setupLeftPanel() {
            document.getElementById('panel-toggle').onclick = function() {
                const panel = document.getElementById('left-panel');
                panel.classList.toggle('collapsed');
                this.innerText = panel.classList.contains('collapsed') ?
                    '案件書目 —' : '收合面板 <<';
            };
        },

        /**
         * 設置圖庫
         */
        setupGallery() {
            const imgBox = document.querySelector(CONSTANTS.SELECTORS.IMAGE_BOX);
            if (!imgBox) return;

            const gBox = document.getElementById('g-box');
            imgBox.querySelectorAll('img').forEach(img => {
                const nImg = img.cloneNode();
                nImg.onclick = () => ImageViewer.open(img.src);
                gBox.appendChild(nImg);
            });
        },

        /**
         * 設置圖庫高度控制
         */
        setupGalleryControls() {
            const gallery = document.getElementById('bottom-gallery');

            document.getElementById('h-p').onclick = () => {
                const currentHeight = parseInt(gallery.style.height);
                const newHeight = Math.min(
                    CONSTANTS.MAX_GALLERY_HEIGHT,
                    currentHeight + CONSTANTS.GALLERY_HEIGHT_STEP
                );
                gallery.style.height = `${newHeight}px`;
                localStorage.setItem(CONSTANTS.STORAGE_KEYS.GALLERY_HEIGHT, newHeight);
            };

            document.getElementById('h-m').onclick = () => {
                const currentHeight = parseInt(gallery.style.height);
                const newHeight = Math.max(
                    CONSTANTS.MIN_GALLERY_HEIGHT,
                    currentHeight - CONSTANTS.GALLERY_HEIGHT_STEP
                );
                gallery.style.height = `${newHeight}px`;
                localStorage.setItem(CONSTANTS.STORAGE_KEYS.GALLERY_HEIGHT, newHeight);
            };
        },

        /**
         * 設置跳至實施方式
         */
        setupImplJump() {
            document.getElementById('jump-impl').onclick = () => {
                const body = document.getElementById('d-body');
                const target = Array.from(body.querySelectorAll('span'))
                    .find(el => el.textContent.includes('【實施方式】'));

                if (target) {
                    target.scrollIntoView({ behavior: 'auto', block: 'start' });
                }
            };
        },

        /**
         * 隱藏原始元素
         */
        hideOriginalElements() {
            const container = document.querySelector('.container');
            if (container) {
                Array.from(container.children).forEach(child => {
                    if (!child.classList.contains('T62')) {
                        child.style.display = 'none';
                    }
                });
            }
        }
    };

    // ========================================
    // 初始化
    // ========================================
    const observer = new MutationObserver(() => {
        if (!document.getElementById('modern-wrapper') && Utils.checkIsDetail()) {
            MainUI.reconstruct();
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    MainUI.reconstruct();
})();
