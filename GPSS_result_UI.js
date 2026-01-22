// ==UserScript==
// @name         TIPO 專利內文現代化重構 (V3.7 內嵌懸浮拖拽版)
// @namespace    http://tampermonkey.net/
// @version      3.7
// @description  將圖示視窗改為內嵌懸浮卡片，支援拖拽、縮放、旋轉與平移，且不被內文遮蔽
// @author       Gemini
// @match        https://tiponet.tipo.gov.tw/gpss*/gpsskmc/*
// @updateURL    https://raw.githubusercontent.com/darkpt/webspace/main/GPSS_result_UI.js
// @downloadURL  https://raw.githubusercontent.com/darkpt/webspace/main/GPSS_result_UI.js
// @grant        GM_addStyle
// ==/UserScript==

(function() {
    'use strict';

    const checkIsDetail = () => document.querySelector('.TI') !== null;
    if (!checkIsDetail()) return;

    let savedHeight = localStorage.getItem('tipo_gallery_height') || '220';

    const injectStyles = () => {
        if (document.getElementById('modern-style')) return;
        GM_addStyle(`
            #modern-style {}
            body { background-color: #f4f7f9 !important; font-family: "PingFang TC", sans-serif !important; overflow: hidden !important; }
            #modern-wrapper { display: flex; position: fixed; top: 140px; left: 0; right: 0; bottom: 0; gap: 0; z-index: 99; background: #f4f7f9; }
            #left-panel { width: 320px; background: #fff; box-shadow: 2px 0 10px rgba(0,0,0,0.1); transition: 0.3s; display: flex; flex-direction: column; border-right: 1px solid #e0e0e0; flex-shrink: 0; }
            #left-panel.collapsed { width: 45px; }
            #panel-toggle { background: #ea4c89; color: #fff; border: none; padding: 15px 5px; cursor: pointer; font-weight: bold; writing-mode: vertical-lr; text-orientation: upright; font-size: 14px; }
            #panel-content { padding: 15px; overflow-y: auto; flex: 1; }
            #main-content-area { flex: 1; display: flex; flex-direction: column; padding: 0 15px; overflow: hidden; height: 100%; }
            #cards-container { display: grid; grid-template-columns: 60% calc(40% - 15px); gap: 15px; flex: 1; min-height: 0; margin-bottom: 10px; }
            .patent-card { background: #fff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); display: flex; flex-direction: column; border: 1px solid #e0e0e0; overflow: hidden; }
            .card-header { background-color: #e3f2fd; color: #1976d2; padding: 10px 15px; font-weight: bold; border-bottom: 1px solid #d1d9e0; flex-shrink: 0; display: flex; justify-content: space-between; align-items: center; }
            .card-body { padding: 15px; overflow-y: auto; flex: 1; font-size: 15px; line-height: 1.8; }
            .action-panel { flex-shrink: 0; padding: 10px; background: #fff; border-radius: 12px; border: 1px solid #e0e0e0; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
            .nav-icon { cursor: pointer; height: 30px; }
            .pill-btn-pink { background-color: #ea4c89; color: #fff; border: none; border-radius: 50px; padding: 4px 12px; font-size: 12px; cursor: pointer; font-weight: bold; }

            /* 底部圖示區域 */
            #bottom-gallery-container { display: flex; gap: 10px; flex-shrink: 0; align-items: flex-end; padding-bottom: 5px; }
            #height-controls { display: flex; flex-direction: column; gap: 4px; width: 35px; }
            .h-btn { background: #ea4c89; color: #fff; border: none; border-radius: 6px; width: 32px; height: 32px; cursor: pointer; font-weight: bold; font-size: 18px; line-height: 1; }
            #bottom-gallery { flex: 1; height: ${savedHeight}px; background: #fff; padding: 8px; border-radius: 12px; border: 1px solid #e0e0e0; overflow: hidden; }
            .gallery-container { display: flex !important; flex-direction: row !important; overflow-x: auto !important; gap: 12px; height: 100%; align-items: center; white-space: nowrap; }
            .gallery-container img { max-height: calc(100% - 8px) !important; width: auto !important; border-radius: 4px; cursor: pointer; }

            /* 懸浮分析卡片樣式 */
            #floating-image-viewer {
                position: fixed; top: 150px; left: 350px; width: 600px; height: 450px;
                background: #fff; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.2);
                z-index: 9999; display: none; flex-direction: column; border: 1px solid #ddd;
            }
            #viewer-header { background: #222; color: #fff; padding: 8px 15px; cursor: move; border-top-left-radius: 11px; border-top-right-radius: 11px; display: flex; justify-content: space-between; align-items: center; }
            #viewer-main { flex: 1; display: flex; overflow: hidden; background: #333; }
            #viewer-sidebar { width: 50px; background: #111; display: flex; flex-direction: column; align-items: center; padding: 15px 0; gap: 12px; z-index: 10; }
            #viewer-content { flex: 1; position: relative; cursor: grab; display: flex; align-items: center; justify-content: center; overflow: hidden; }
            #viewer-content:active { cursor: grabbing; }
            #viewer-img { transition: transform 0.1s; transform-origin: center; user-select: none; -webkit-user-drag: none; }
            .v-btn { width: 32px; height: 32px; background: #ea4c89; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 16px; }

            .rectable, .detGP_top, .panel-warning, .container > table:not(.T62), #footer { display: none !important; }
            .T62 { visibility: hidden; height: 0; overflow: hidden; position: absolute; }
        `);
    };

    // 建立懸浮檢視器 DOM
    const initFloatingViewer = () => {
        if (document.getElementById('floating-image-viewer')) return;
        const v = document.createElement('div');
        v.id = 'floating-image-viewer';
        v.innerHTML = `
            <div id="viewer-header"><span>專利圖示分析</span><button id="close-viewer" style="background:none; border:none; color:#fff; cursor:pointer; font-size:18px;">×</button></div>
            <div id="viewer-main">
                <div id="viewer-sidebar">
                    <button id="z-in" class="v-btn">＋</button>
                    <button id="z-out" class="v-btn">－</button>
                    <button id="r-l" class="v-btn">↶</button>
                    <button id="r-r" class="v-btn">↷</button>
                    <button id="v-reset" class="v-btn" style="font-size:10px">R</button>
                </div>
                <div id="viewer-content"><img id="viewer-img"></div>
            </div>`;
        document.body.appendChild(v);

        let s=1, r=0, x=0, y=0, d=false, sx, sy, vx=0, vy=0, vd=false;
        const img = document.getElementById('viewer-img');
        const content = document.getElementById('viewer-content');
        const header = document.getElementById('viewer-header');

        const update = () => { img.style.transform = `translate(${x}px, ${y}px) rotate(${r}deg) scale(${s})`; };
        
        // 圖片平移與縮放
        content.onmousedown = (e) => { d=true; sx=e.clientX-x; sy=e.clientY-y; e.preventDefault(); };
        window.addEventListener('mousemove', (e) => { if(!d) return; x=e.clientX-sx; y=e.clientY-sy; update(); });
        window.addEventListener('mouseup', () => { d=false; vd=false; });
        content.onwheel = (e) => { e.preventDefault(); s = Math.min(Math.max(0.3, s + (e.deltaY > 0 ? -0.1 : 0.1)), 8); update(); };

        // 視窗拖拽
        header.onmousedown = (e) => { vd=true; vx=e.clientX - v.offsetLeft; vy=e.clientY - v.offsetTop; };
        window.addEventListener('mousemove', (e) => { if(!vd) return; v.style.left = (e.clientX - vx) + 'px'; v.style.top = (e.clientY - vy) + 'px'; });

        document.getElementById('z-in').onclick = () => { s=Math.min(8, s+0.2); update(); };
        document.getElementById('z-out').onclick = () => { s=Math.max(0.3, s-0.2); update(); };
        document.getElementById('r-l').onclick = () => { r-=90; update(); };
        document.getElementById('r-r').onclick = () => { r+=90; update(); };
        document.getElementById('v-reset').onclick = () => { s=1; r=0; x=0; y=0; update(); };
        document.getElementById('close-viewer').onclick = () => { v.style.display = 'none'; };
    };

    const reconstructUI = () => {
        if (!checkIsDetail() || document.getElementById('modern-wrapper')) return;
        injectStyles();
        initFloatingViewer();

        const panels = document.querySelectorAll('.panel-body');
        const bibData = panels[1]?.innerHTML || "";
        const claimsContent = (panels[2]?.innerHTML || "").trim();
        const detailContent = (panels[3]?.innerHTML || "").trim();
        const hasImpl = detailContent.includes('【實施方式】');

        const actionPanel = document.createElement('div');
        actionPanel.className = 'action-panel';
        actionPanel.innerHTML = '<span style="font-size:12px; font-weight:bold; color:#666;">導覽操作：</span>';
        ["_IMG_回查詢", "_IMG_回簡目", "_IMG_前筆", "_IMG_次筆"].forEach(name => {
            const originalBtn = document.querySelector(`input[name="${name}"]`);
            if (originalBtn) {
                const btnImg = document.createElement('img');
                btnImg.src = originalBtn.src;
                btnImg.className = 'nav-icon';
                btnImg.onclick = () => originalBtn.click();
                actionPanel.appendChild(btnImg);
            }
        });

        const imgBox = document.querySelector('#g2') || document.querySelector('.detGP');
        const wrapper = document.createElement('div');
        wrapper.id = 'modern-wrapper';
        wrapper.innerHTML = `
            <div id="left-panel" class="collapsed"><button id="panel-toggle">書目資料 >></button><div id="panel-content"><h4 style="color:#1976d2; border-bottom:2px solid #ea4c89; padding-bottom:5px; margin-top:0;">書目詳細</h4>${bibData}</div></div>
            <div id="main-content-area">
                <div id="cards-container">
                    <div class="patent-card" style="display: ${detailContent ? 'flex' : 'none'};"><div class="card-header">詳細說明<button id="jump-impl" class="pill-btn-pink" style="display: ${hasImpl ? 'block' : 'none'};">跳至實施方式</button></div><div id="d-body" class="card-body">${detailContent}</div></div>
                    <div id="right-column-stack"><div id="n-box"></div><div class="patent-card" style="flex:1; display: ${claimsContent ? 'flex' : 'none'};"><div class="card-header">專利範圍</div><div class="card-body">${claimsContent}</div></div></div>
                </div>
                <div id="bottom-gallery-container"><div id="height-controls"><button id="h-p" class="h-btn">＋</button><button id="h-m" class="h-btn">－</button></div><div id="bottom-gallery" style="height: ${savedHeight}px;"><div id="g-box" class="gallery-container"></div></div></div>
            </div>`;
        document.body.appendChild(wrapper);
        document.getElementById('n-box').appendChild(actionPanel);

        if (imgBox) {
            const galleryBox = document.getElementById('g-box');
            imgBox.querySelectorAll('img').forEach(img => {
                const nImg = img.cloneNode();
                nImg.onclick = () => {
                    const fv = document.getElementById('floating-image-viewer');
                    const fi = document.getElementById('viewer-img');
                    fi.src = img.src;
                    fv.style.display = 'flex';
                };
                galleryBox.appendChild(nImg);
            });
        }
        
        const gallery = document.getElementById('bottom-gallery');
        document.getElementById('h-p').onclick = () => { let h = Math.min(600, parseInt(gallery.style.height) + 50); gallery.style.height = h + 'px'; localStorage.setItem('tipo_gallery_height', h); };
        document.getElementById('h-m').onclick = () => { let h = Math.max(100, parseInt(gallery.style.height) - 50); gallery.style.height = h + 'px'; localStorage.setItem('tipo_gallery_height', h); };
        document.getElementById('panel-toggle').onclick = () => { document.getElementById('left-panel').classList.toggle('collapsed'); document.getElementById('panel-toggle').innerText = document.getElementById('left-panel').classList.contains('collapsed') ? '書目資料 >>' : '收合面板 <<'; };
        if (hasImpl) { document.getElementById('jump-impl').onclick = () => { const t = Array.from(document.getElementById('d-body').querySelectorAll('span')).find(el => el.textContent.includes('【實施方式】')); if (t) t.scrollIntoView({ behavior: 'auto', block: 'start' }); }; }
        const container = document.querySelector('.container');
        if (container) Array.from(container.children).forEach(c => { if (!c.classList.contains('T62')) c.style.display = 'none'; });
    };

    const observer = new MutationObserver(() => { if (!document.getElementById('modern-wrapper') && checkIsDetail()) reconstructUI(); });
    observer.observe(document.body, { childList: true, subtree: true });
    reconstructUI();
})();
