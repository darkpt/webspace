// ==UserScript==
// @name         TIPO 計時自動重置
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  可設定觸發時間，當倒數計時小於等於設定值時自動點擊重新計時按鈕
// @match        https://tiponet.tipo.gov.tw/gpss*/gpsskmc/gpssbkm*
// @updateURL    https://raw.githubusercontent.com/darkpt/webspace/main/GPSS_counter.js
// @downloadURL  https://raw.githubusercontent.com/darkpt/webspace/main/GPSS_counter.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const STORAGE_KEY = 'tipoAutoReset';
    const CHECK_INTERVAL = 1000;

    // 預設設定
    const DEFAULT_CONFIG = {
        hour: 0,
        min: 30,
        sec: 0,
        enabled: false,
        panelX: null,
        panelY: null,
        minimized: false
    };

    // 載入設定
    function loadConfig() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                return { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
            }
        } catch (e) {
            console.error('[TIPO 自動重置] 載入設定失敗', e);
        }
        return { ...DEFAULT_CONFIG };
    }

    // 儲存設定
    function saveConfig(config) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
        } catch (e) {
            console.error('[TIPO 自動重置] 儲存設定失敗', e);
        }
    }

    let config = loadConfig();

    // 建立 Panel
    function createPanel() {
        const panel = document.createElement('div');
        panel.id = 'tipo-reset-panel';
        panel.innerHTML = `
            <div class="tipo-panel-header">
                <span class="tipo-panel-title">自動重置</span>
                <button class="tipo-panel-toggle">−</button>
            </div>
            <div class="tipo-panel-body">
                <div class="tipo-panel-row">
                    <label>
                        <span>時</span>
                        <select id="tipo-hour">
                            <option value="0">0</option>
                            <option value="1">1</option>
                        </select>
                    </label>
                    <label>
                        <span>分</span>
                        <select id="tipo-min"></select>
                    </label>
                    <label>
                        <span>秒</span>
                        <select id="tipo-sec"></select>
                    </label>
                </div>
                <div class="tipo-panel-row tipo-panel-checkbox">
                    <label>
                        <input type="checkbox" id="tipo-enabled">
                        <span>啟用自動重置</span>
                    </label>
                </div>
                <div class="tipo-panel-status" id="tipo-status">狀態：未啟用</div>
            </div>
        `;

        // 樣式
        const style = document.createElement('style');
        style.textContent = `
            #tipo-reset-panel {
                position: fixed;
                top: 10px;
                right: 10px;
                width: 200px;
                background: #ffffff;
                border: 1px solid #ccc;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                font-family: "Microsoft JhengHei", sans-serif;
                font-size: 14px;
                z-index: 999999;
                user-select: none;
            }
            #tipo-reset-panel.minimized .tipo-panel-body {
                display: none;
            }
            #tipo-reset-panel.minimized {
                width: auto;
            }
            .tipo-panel-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 8px 12px;
                background: #4a90d9;
                color: white;
                border-radius: 7px 7px 0 0;
                cursor: move;
            }
            #tipo-reset-panel.minimized .tipo-panel-header {
                border-radius: 7px;
            }
            .tipo-panel-title {
                font-weight: bold;
            }
            .tipo-panel-toggle {
                background: transparent;
                border: none;
                color: white;
                font-size: 18px;
                cursor: pointer;
                padding: 0 4px;
                line-height: 1;
            }
            .tipo-panel-toggle:hover {
                opacity: 0.8;
            }
            .tipo-panel-body {
                padding: 12px;
            }
            .tipo-panel-row {
                display: flex;
                justify-content: space-between;
                margin-bottom: 10px;
            }
            .tipo-panel-row label {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 4px;
            }
            .tipo-panel-row label span {
                font-size: 12px;
                color: #666;
            }
            .tipo-panel-row select {
                width: 50px;
                padding: 4px;
                border: 1px solid #ccc;
                border-radius: 4px;
                text-align: center;
            }
            .tipo-panel-checkbox {
                justify-content: center;
            }
            .tipo-panel-checkbox label {
                flex-direction: row;
                gap: 8px;
            }
            .tipo-panel-checkbox label span {
                font-size: 14px;
                color: #333;
            }
            .tipo-panel-status {
                text-align: center;
                padding: 8px;
                background: #f5f5f5;
                border-radius: 4px;
                font-size: 12px;
                color: #666;
            }
            .tipo-panel-status.active {
                background: #e8f5e9;
                color: #2e7d32;
            }
            .tipo-panel-status.triggered {
                background: #fff3e0;
                color: #e65100;
            }
        `;
        document.head.appendChild(style);
        document.body.appendChild(panel);

        // 填充 min 和 sec 選項 (0-59)
        const minSelect = panel.querySelector('#tipo-min');
        const secSelect = panel.querySelector('#tipo-sec');
        for (let i = 0; i < 60; i++) {
            const optMin = document.createElement('option');
            optMin.value = i;
            optMin.textContent = i.toString().padStart(2, '0');
            minSelect.appendChild(optMin);

            const optSec = document.createElement('option');
            optSec.value = i;
            optSec.textContent = i.toString().padStart(2, '0');
            secSelect.appendChild(optSec);
        }

        // 載入設定值
        panel.querySelector('#tipo-hour').value = config.hour;
        panel.querySelector('#tipo-min').value = config.min;
        panel.querySelector('#tipo-sec').value = config.sec;
        panel.querySelector('#tipo-enabled').checked = config.enabled;

        // 設定位置
        if (config.panelX !== null && config.panelY !== null) {
            panel.style.right = 'auto';
            panel.style.left = config.panelX + 'px';
            panel.style.top = config.panelY + 'px';
        }

        // 縮放狀態
        if (config.minimized) {
            panel.classList.add('minimized');
            panel.querySelector('.tipo-panel-toggle').textContent = '+';
        }

        updateStatus();

        return panel;
    }

    // 拖曳功能
    function enableDrag(panel) {
        const header = panel.querySelector('.tipo-panel-header');
        let isDragging = false;
        let startX, startY, initialX, initialY;

        header.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('tipo-panel-toggle')) return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = panel.getBoundingClientRect();
            initialX = rect.left;
            initialY = rect.top;
            panel.style.right = 'auto';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            let newX = initialX + dx;
            let newY = initialY + dy;

            // 邊界限制
            const maxX = window.innerWidth - panel.offsetWidth;
            const maxY = window.innerHeight - panel.offsetHeight;
            newX = Math.max(0, Math.min(newX, maxX));
            newY = Math.max(0, Math.min(newY, maxY));

            panel.style.left = newX + 'px';
            panel.style.top = newY + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                config.panelX = parseInt(panel.style.left);
                config.panelY = parseInt(panel.style.top);
                saveConfig(config);
            }
        });
    }

    // 事件綁定
    function bindEvents(panel) {
        const hourSelect = panel.querySelector('#tipo-hour');
        const minSelect = panel.querySelector('#tipo-min');
        const secSelect = panel.querySelector('#tipo-sec');
        const enabledCheckbox = panel.querySelector('#tipo-enabled');
        const toggleBtn = panel.querySelector('.tipo-panel-toggle');

        // 數值變更
        [hourSelect, minSelect, secSelect].forEach(select => {
            select.addEventListener('change', () => {
                config.hour = parseInt(hourSelect.value);
                config.min = parseInt(minSelect.value);
                config.sec = parseInt(secSelect.value);
                saveConfig(config);
                updateStatus();
            });
        });

        // 啟用/停用
        enabledCheckbox.addEventListener('change', () => {
            config.enabled = enabledCheckbox.checked;
            saveConfig(config);
            updateStatus();
        });

        // 縮放
        toggleBtn.addEventListener('click', () => {
            config.minimized = !config.minimized;
            panel.classList.toggle('minimized', config.minimized);
            toggleBtn.textContent = config.minimized ? '+' : '−';
            saveConfig(config);
        });
    }

    // 更新狀態顯示
    function updateStatus(message, type) {
        const statusEl = document.querySelector('#tipo-status');
        if (!statusEl) return;

        statusEl.classList.remove('active', 'triggered');

        if (message) {
            statusEl.textContent = message;
            if (type) statusEl.classList.add(type);
        } else if (config.enabled) {
            const h = config.hour;
            const m = config.min.toString().padStart(2, '0');
            const s = config.sec.toString().padStart(2, '0');
            statusEl.textContent = `監控中：≤ ${h}:${m}:${s} 時觸發`;
            statusEl.classList.add('active');
        } else {
            statusEl.textContent = '狀態：未啟用';
        }
    }

    // 取得目前倒數時間（秒）
    function getCurrentCountdown() {
        const hour0 = document.querySelector('.num.hour0');
        const hour1 = document.querySelector('.num.hour1');
        const min0 = document.querySelector('.num.min0');
        const min1 = document.querySelector('.num.min1');
        const sec0 = document.querySelector('.num.sec0');
        const sec1 = document.querySelector('.num.sec1');

        if (!hour0 || !hour1 || !min0 || !min1 || !sec0 || !sec1) {
            return null;
        }

        const hours = parseInt(hour0.textContent + hour1.textContent);
        const mins = parseInt(min0.textContent + min1.textContent);
        const secs = parseInt(sec0.textContent + sec1.textContent);

        return hours * 3600 + mins * 60 + secs;
    }

    // 取得設定的觸發時間（秒）
    function getThresholdSeconds() {
        return config.hour * 3600 + config.min * 60 + config.sec;
    }

    // 檢查並觸發
    function checkAndReset() {
        if (!config.enabled) return;

        const current = getCurrentCountdown();
        const threshold = getThresholdSeconds();

        if (current === null) {
            updateStatus('錯誤：無法讀取計時器', 'triggered');
            return;
        }

        if (current <= threshold) {
            const resetButton = document.querySelector('input[name="BUTTON"][value="重新計時"]');
            if (resetButton) {
                updateStatus('觸發重新計時！', 'triggered');
                console.log(`[TIPO 自動重置] 觸發：目前 ${current} 秒 ≤ 設定 ${threshold} 秒`);
                resetButton.click();
            }
        }
    }

    // 初始化
    function init() {
        const panel = createPanel();
        enableDrag(panel);
        bindEvents(panel);
        setInterval(checkAndReset, CHECK_INTERVAL);
        console.log('[TIPO 自動重置] 腳本已啟動');
    }

    // DOM 載入後執行
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
