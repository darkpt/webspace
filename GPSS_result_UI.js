// ==UserScript==
// @name         TIPO 專利內文現代化重構 (V3.6 彈窗旋轉功能版)
// @namespace    https://github.com/darkpt/webspace
// @version      3.6
// @description  彈出視窗追加向左/向右旋轉按鈕
// @author       Gemini
// @match        https://tiponet.tipo.gov.tw/gpss*/gpsskmc/*
// @grant        GM_addStyle
// @updateURL    https://raw.githubusercontent.com/darkpt/webspace/main/GPSS_result_UI.js
// @downloadURL  https://raw.githubusercontent.com/darkpt/webspace/main/GPSS_result_UI.js
// ==/UserScript==

(function() {
    'use strict';

    const checkIsDetail = () => document.querySelector('.TI') !== null;
    if (!checkIsDetail()) return;

    const injectStyles = () => {
        if (document.getElementById('modern-style')) return;
        const savedHeight = localStorage.getItem('tipo_gallery_height') || '220';
        GM_addStyle(`
            #modern-style {}
            body { background-color: #f4f7f9 !important; font-family: "PingFang TC", sans-serif !important; overflow: hidden !important; }
            #modern-wrapper { display: flex; position: fixed; top: 140px; left: 0; right: 0; bottom: 0; gap: 0; z-index: 99; background: #f4f7f9; }
            #left-panel { width: 320px; background: #fff; box-shadow: 2px 0 10px rgba(0,0,0,0.1); transition: 0.3s; display: flex; flex-direction: column; border-right: 1px solid #e0e0e0; flex-shrink: 0; }
            #left-panel.collapsed { width: 45px; }
            #panel-toggle { background: #ea4c89; color: #fff; border: none; padding: 15px 5px; cursor: pointer; font-weight: bold; writing-mode: vertical-lr; text-orientation: upright; font-size: 14px; }
            #panel-content { padding: 15px; overflow-y: auto; flex: 1; }
            #left-panel.collapsed #panel-content { visibility: hidden; width: 0; padding: 0; }

            #main-content-area { flex: 1; display: flex; flex-direction: column; padding: 0 15px; overflow: hidden; height: 100%; }
            #cards-container { display: grid; grid-template-columns: 60% calc(40% - 15px); gap: 15px; flex: 1; min-height: 0; margin-bottom: 10px; }
            #right-column-stack { display: flex; flex-direction: column; gap: 10px; height: 100%; min-height: 0; }
            .patent-card { background: #fff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); display: flex; flex-direction: column; border: 1px solid #e0e0e0; overflow: hidden; }
            .card-header { background-color: #e3f2fd; color: #1976d2; padding: 10px 15px; font-weight: bold; border-bottom: 1px solid #d1d9e0; flex-shrink: 0; display: flex; justify-content: space-between; align-items: center; }
            .card-body { padding: 15px; overflow-y: auto; flex: 1; font-size: 15px; line-height: 1.8; }

            .action-panel { flex-shrink: 0; padding: 10px; background: #fff; border-radius: 12px; border: 1px solid #e0e0e0; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
            .nav-icon { cursor: pointer; height: 30px; }
            .pill-btn-pink { background-color: #ea4c89; color: #fff; border: none; border-radius: 50px; padding: 4px 12px; font-size: 12px; cursor: pointer; font-weight: bold; }

            #bottom-gallery-container { display: flex; gap: 10px; flex-shrink: 0; align-items: flex-end; padding-bottom: 5px; }
            #height-controls { display: flex; flex-direction: column; gap: 4px; width: 35px; }
            .h-btn { background: #ea4c89; color: #fff; border: none; border-radius: 6px; width: 32px; height: 32px; cursor: pointer; font-weight: bold; font-size: 18px; line-height: 1; }

            #bottom-gallery { flex: 1; height: ${savedHeight}px; background: #fff; padding: 8px; border-radius: 12px; border: 1px solid #e0e0e0; overflow: hidden; }
            .gallery-container { display: flex !important; flex-direction: row !important; overflow-x: auto !important; gap: 12px; height: 100%; align-items: center; white-space: nowrap; }
            .gallery-container img { max-height: calc(100% - 8px) !important; width: auto !important; border-radius: 4px; cursor: zoom-in; }

            .rectable, .detGP_top, .panel-warning, .container > table:not(.T62), #footer { display: none !important; }
            .T62 { visibility: hidden; height: 0; overflow: hidden; position: absolute; }
        `);
    };

    // V3.6 重點修正：彈窗增加旋轉邏輯
    const openImageWindow = (imgSrc) => {
        const popup = window.open('', '_blank', 'width=1100,height=850,toolbar=no,location=no,status=no,menubar=no,scrollbars=no');
        if (!popup) return;
        // 新增了 rot() 函數，更新了狀態變數 r (rotation)，並在 u() 函數中加入了 rotate() 變形
        popup.document.write(`<html><head><title>圖示細節</title><style>body{margin:0;background:#222;display:flex;height:100vh;overflow:hidden;}
        #sidebar{width:50px;background:#111;display:flex;flex-direction:column;align-items:center;padding-top:20px;gap:15px;border-right:1px solid #333; z-index: 100; position: relative;}
        .btn{width:35px;height:35px;background:#ea4c89;color:white;border:none;border-radius:5px;cursor:pointer;font-weight:bold;font-size:18px;display:flex;align-items:center;justify-content:center;}
        #view{flex:1;display:flex;align-items:center;justify-content:center;cursor:grab; z-index: 1;}
        #view:active{cursor:grabbing;}
        img{transition:0.2s;transform-origin:center;user-select:none;-webkit-user-drag:none;}</style></head><body>
        <div id="sidebar">
            <button class="btn" onclick="z(0.2)" title="放大">＋</button>
            <button class="btn" onclick="z(-0.2)" title="縮小">－</button>
            <button class="btn" onclick="rot(-90)" title="向左旋轉" style="font-size:20px;">↶</button>
            <button class="btn" onclick="rot(90)" title="向右旋轉" style="font-size:20px;">↷</button>
            <button class="btn" onclick="reset()" title="還原" style="font-size:12px">RE</button>
        </div>
        <div id="view"><img id="p" src="${imgSrc}"></div>
        <script>
            let s=1,r=0,x=0,y=0,d=false,sx,sy; const p=document.getElementById('p');
            window.z=(v)=>{s=Math.min(Math.max(0.3,s+v),8);u();};
            window.rot=(v)=>{r+=v;u();};
            window.reset=()=>{s=1;r=0;x=0;y=0;u();};
            function u(){p.style.transform=\`translate(\${x}px,\${y}px) rotate(\${r}deg) scale(\${s})\`;}
            document.getElementById('view').onmousedown=(e)=>{d=true;sx=e.clientX-x;sy=e.clientY-y;e.preventDefault();};
            window.onmousemove=(e)=>{if(!d)return;x=e.clientX-sx;y=e.clientY-sy;u();};
            window.onmouseup=()=>d=false;
            document.getElementById('view').onwheel=(e)=>{e.preventDefault();z(e.deltaY>0?-0.1:0.1);};
        </script></body></html>`);
    };

    const reconstructUI = () => {
        if (!checkIsDetail() || document.getElementById('modern-wrapper')) return;
        injectStyles();
        const savedHeight = localStorage.getItem('tipo_gallery_height') || '220';
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

        if (imgBox) { imgBox.querySelectorAll('img').forEach(img => { const nImg = img.cloneNode(); nImg.onclick = () => openImageWindow(img.src); document.getElementById('g-box').appendChild(nImg); }); }

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
