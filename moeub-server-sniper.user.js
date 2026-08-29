// ==UserScript==
// @name         MoeUB 服务器自动进服助手
// @namespace    http://tampermonkey.net/
// @version      2.3
// @description  在MoeUB服务器详情弹窗中添加自动进服功能，人数少于阈值时自动连接
// @author       You
// @match        https://cs.moeub.cn/play*
// @match        https://cs.moeub.cn/user*
// @match        https://csgo.moeub.cn/server*
// @icon         https://cs.moeub.cn/favicon.svg
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    const STORAGE_KEY = 'mo_sniper_username';
    const CONFIG = {
        checkInterval: 2000,
        defaultThreshold: 64,
        enableSound: true,
    };

    let monitoring = false;
    let monitorTimer = null;
    let threshold = CONFIG.defaultThreshold;
    const LOG_PREFIX = '[MoeUB自动进服]';

    function log(...args) { console.log(LOG_PREFIX, ...args); }

    function getUsername() { return localStorage.getItem(STORAGE_KEY) || ''; }
    function setUsername(name) { localStorage.setItem(STORAGE_KEY, name); }

    function getSiteType() {
        if (window.location.hostname === 'cs.moeub.cn') return 'new';
        if (window.location.hostname === 'csgo.moeub.cn') return 'old';
        return null;
    }

    function playSound() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.setValueAtTime(800, ctx.currentTime);
            osc.frequency.setValueAtTime(1000, ctx.currentTime + 0.1);
            osc.frequency.setValueAtTime(1200, ctx.currentTime + 0.2);
            gain.gain.setValueAtTime(0.3, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.3);
        } catch(e) {}
    }

    function showNotification(msg, type) {
        const n = document.createElement('div');
        const colors = { success: '#11998e', error: '#f5576c', info: '#667eea' };
        const icons = { success: '✅', error: '❌', info: 'ℹ️' };
        n.style.cssText = `
            position:fixed; top:80px; left:50%; transform:translateX(-50%);
            background:${colors[type]}; color:white; padding:12px 24px;
            border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,0.3);
            z-index:10000; font-size:14px; animation:moFade 3s ease forwards;
        `;
        n.innerHTML = `${icons[type]} ${msg}`;
        document.body.appendChild(n);
        if (!document.getElementById('mo-fade-s')) {
            const s = document.createElement('style');
            s.id = 'mo-fade-s';
            s.textContent = `@keyframes moFade{0%{opacity:0;transform:translateX(-50%) translateY(-20px)}15%{opacity:1;transform:translateX(-50%)}85%{opacity:1;transform:translateX(-50%)}100%{opacity:0;transform:translateX(-50%) translateY(-20px)}}`;
            document.head.appendChild(s);
        }
        setTimeout(() => n.remove(), 3000);
    }

    function showFloatingStatus(msg) {
        hideFloatingStatus();
        const d = document.createElement('div');
        d.id = 'mo-sniper-float';
        d.style.cssText = `
            position:fixed; top:20px; right:20px; z-index:9999;
            background:#667eea; color:white; padding:12px 20px; border-radius:8px;
            box-shadow:0 4px 12px rgba(0,0,0,0.3); font-size:14px;
            display:flex; align-items:center; gap:10px;
        `;
        d.innerHTML = `<span id="mo-float-text">${msg}</span><button id="mo-float-stop" style="background:rgba(255,255,255,0.2);border:none;color:white;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px;">停止</button>`;
        document.body.appendChild(d);
        document.getElementById('mo-float-stop').onclick = stopMonitoring;
    }

    function updateFloatingStatus(msg) { const el = document.getElementById('mo-float-text'); if (el) el.textContent = msg; }
    function hideFloatingStatus() { const d = document.getElementById('mo-sniper-float'); if (d) d.remove(); }

    function connectToServer(host, port) {
        log('connectToServer 被调用, host:', host, 'port:', port);
        if (!host || !port) { showNotification('连接失败：无法获取服务器地址', 'error'); return; }
        const url = `steam://rungame/730/76561202255233023/+connect ${host}:${port}`;
        log('连接URL:', url);
        showNotification(`正在连接 ${host}:${port}...`, 'success');
        if (CONFIG.enableSound) playSound();
        try {
            window.location.href = url;
            log('location.href 已设置');
        } catch(e) {
            log('连接失败:', e);
        }
    }

    function stopMonitoring() {
        if (monitorTimer) { clearInterval(monitorTimer); monitorTimer = null; }
        monitoring = false;
        hideFloatingStatus();
        document.querySelectorAll('.mo-sniper-btn').forEach(btn => {
            btn.textContent = '🎯 自动进服';
            btn.style.background = '';
            btn.dataset.moActive = 'false';
        });
    }

    function isAlreadyInServer(popup) {
        const savedName = getUsername();
        if (!savedName) return false;
        const text = popup.textContent || '';
        // 检查保存的昵称是否出现在弹窗的玩家列表区域
        if (text.includes(savedName)) {
            log('检测到已在服务器中, 昵称:', savedName);
            return true;
        }
        return false;
    }

    function startMonitoring(host, port, serverLabel, btn) {
        stopMonitoring();
        monitoring = true;
        btn.dataset.moActive = 'true';
        btn.textContent = '⏳ 监控中';
        btn.style.background = '#f093fb';

        const popup = btn._moPopup;

        // 启动时先检测是否已在服务器中
        if (isAlreadyInServer(popup)) {
            showNotification(`已在服务器中 (${getUsername()})，跳过连接`, 'info');
            btn.textContent = '✅ 已在服务器';
            btn.style.background = '#11998e';
            monitoring = false;
            return;
        }

        const check = () => {
            log('检查中, host:', host, 'port:', port, 'threshold:', threshold);
            if (!popup || !document.body.contains(popup)) {
                log('弹窗已关闭，停止监控');
                stopMonitoring();
                showNotification('弹窗已关闭，监控已停止', 'info');
                return;
            }

            // 先检测是否已在服务器中
            if (isAlreadyInServer(popup)) {
                log('已在服务器中，停止监控');
                stopMonitoring();
                showNotification(`已在服务器中 (${getUsername()})，停止监控`, 'success');
                return;
            }

            const text = popup.textContent || '';
            const pi = parsePlayerInfo(text);
            if (pi) {
                log(`当前人数: ${pi.current}/${pi.max}, 阈值: ${threshold}`);
                updateFloatingStatus(`#${serverLabel}: ${pi.current}/${pi.max} 人`);
                if (pi.current < threshold) {
                    log('人数满足条件，准备连接...');
                    connectToServer(host, port);
                    stopMonitoring();
                } else {
                    log('人数未满足条件');
                }
            } else {
                log('未匹配到人数, text snippet:', text.substring(0, 150));
            }
        };

        showFloatingStatus(`#${serverLabel}: 监控中...`);
        log('开始监控, 间隔:', CONFIG.checkInterval, 'ms');
        monitorTimer = setInterval(check, CONFIG.checkInterval);
        check();
    }

    function parseIPPort(text) {
        if (!text || typeof text !== 'string') return null;
        const m = text.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d+)/);
        return m ? { host: m[1], port: m[2] } : null;
    }

    function parsePlayerInfo(text) {
        if (!text || typeof text !== 'string') return null;
        if (text.includes('暂无玩家')) return { current: 0, max: 64 };
        const cleaned = text.replace(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+/g, '');
        const m = cleaned.match(/(\d+)\s*[/:]\s*(\d+)/);
        return m ? { current: parseInt(m[1], 10), max: parseInt(m[2], 10) } : null;
    }

    function getPopupForElement(el) {
        let cur = el;
        while (cur && cur !== document.body) {
            const cs = window.getComputedStyle(cur);
            if (cs.position === 'fixed' || cs.position === 'absolute') {
                const zi = parseInt(cs.zIndex || '0', 10);
                if (zi >= 10 || cs.position === 'fixed') {
                    const text = cur.textContent || '';
                    if (text.match(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+/)) {
                        return cur;
                    }
                }
            }
            cur = cur.parentElement;
        }
        return null;
    }

    // ============ 新版网站 (cs.moeub.cn) ============

    let newSiteObserver = null;

    function initNewSite() {
        if (newSiteObserver) newSiteObserver.disconnect();
        newSiteObserver = new MutationObserver(() => {
            try { injectSniperButtonNewSite(); } catch(e) { log('注入出错:', e); }
        });
        newSiteObserver.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => { try { injectSniperButtonNewSite(); } catch(e) { log('初始注入出错:', e); } }, 2000);
    }

    function injectSniperButtonNewSite() {
        const allEls = document.querySelectorAll('span, div, button, a, p');
        for (const el of allEls) {
            let directText = '';
            for (const node of el.childNodes) {
                if (node.nodeType === Node.TEXT_NODE) {
                    directText += node.textContent.trim();
                }
            }
            if (directText !== '加入服务器') continue;

            const joinBtn = el.closest('button') || el.closest('a') || el;
            if (!joinBtn) continue;

            const parent = joinBtn.parentElement;
            if (parent && parent.querySelector('.mo-sniper-btn')) continue;

            const popup = getPopupForElement(joinBtn);
            if (!popup) {
                log('未找到弹窗容器, joinBtn:', joinBtn);
                continue;
            }

            const popupText = popup.textContent || '';

            const addr = parseIPPort(popupText);
            if (!addr) {
                log('未找到 IP:port, popupText snippet:', popupText.substring(0, 200));
                continue;
            }

            const playerInfo = parsePlayerInfo(popupText);
            const maxSlots = playerInfo ? playerInfo.max : 64;
            const currentPlayers = playerInfo ? playerInfo.current : 0;

            const idMatch = popupText.match(/#(-?\d+)/);
            const serverId = idMatch ? idMatch[1] : 'unknown';

            log(`找到服务器 #${serverId}: ${addr.host}:${addr.port}, 玩家: ${currentPlayers}/${maxSlots}`);

            const btn = createSniperButton(serverId, addr.host, addr.port, currentPlayers, maxSlots, popup);
            joinBtn.parentNode.insertBefore(btn, joinBtn);
            log(`已为 #${serverId} 注入自动进服按钮`);
            break;
        }
    }

    function createSniperButton(serverId, host, port, currentPlayers, maxSlots, popup) {
        const btn = document.createElement('button');
        btn.className = 'mo-sniper-btn';
        btn.textContent = '🎯 自动进服';
        btn.title = `监控 #${serverId}，当前 ${currentPlayers}/${maxSlots}`;
        btn._moPopup = popup;
        btn.dataset.moActive = 'false';
        btn.style.cssText = `
            display:inline-flex; align-items:center; gap:4px;
            background:linear-gradient(135deg, #667eea, #764ba2);
            color:white; border:none; padding:8px 16px; border-radius:6px;
            cursor:pointer; font-size:14px; font-weight:500;
            transition:all 0.2s ease;
            box-shadow:0 2px 8px rgba(102,126,234,0.4);
            margin-right:8px; flex-shrink:0; white-space:nowrap; z-index:99999;
        `;
        btn.onmouseenter = () => { btn.style.transform = 'translateY(-1px)'; };
        btn.onmouseleave = () => { btn.style.transform = ''; };
        btn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (monitoring && btn.dataset.moActive === 'true') {
                stopMonitoring();
                return;
            }
            const freshText = popup.textContent || '';
            const freshAddr = parseIPPort(freshText) || { host, port };
            const freshPI = parsePlayerInfo(freshText);
            const freshCurrent = freshPI ? freshPI.current : currentPlayers;
            const freshMax = freshPI ? freshPI.max : maxSlots;
            startMonitoring(freshAddr.host, freshAddr.port, `${serverId} ${freshCurrent}/${freshMax}`, btn);
        };
        return btn;
    }

    // ============ 旧版网站 (csgo.moeub.cn) ============

    function initOldSite() {
        const observer = new MutationObserver(() => { try { injectSniperButtonOldSite(); } catch(e) {} });
        observer.observe(document.body, { childList: true, subtree: true });
        injectSniperButtonOldSite();
    }

    function injectSniperButtonOldSite() {
        const rows = document.querySelectorAll('tr');
        for (const row of rows) {
            if (row.querySelector('.mo-sniper-btn')) continue;
            const cells = row.querySelectorAll('td');
            if (cells.length < 5) continue;
            const idMatch = cells[0].textContent.match(/#(-?\d+)/);
            if (!idMatch) continue;
            const serverId = idMatch[1];
            const joinBtn = row.querySelector('a[href*="connect"]');
            if (!joinBtn) continue;
            const href = joinBtn.getAttribute('href') || '';
            const addrMatch = href.match(/connect\s+([^:]+):(\d+)/);
            if (!addrMatch) continue;
            const host = addrMatch[1], port = addrMatch[2];
            const pm = cells[4].textContent.match(/(\d+)\s*\/\s*(\d+)/);
            const cur = pm ? parseInt(pm[1], 10) : 0;
            const max = pm ? parseInt(pm[2], 10) : 64;

            const btn = document.createElement('button');
            btn.className = 'mo-sniper-btn';
            btn.textContent = '🎯 自动进服';
            btn.dataset.moActive = 'false';
            btn.style.cssText = `
                display:inline-flex; align-items:center; background:linear-gradient(135deg, #667eea, #764ba2);
                color:white; border:none; padding:6px 12px; border-radius:6px;
                cursor:pointer; font-size:13px; margin-right:6px;
            `;
            btn.onclick = (e) => {
                e.preventDefault();
                if (monitoring && btn.dataset.moActive === 'true') { stopMonitoring(); return; }
                startMonitoring(host, port, `${serverId} ${cur}/${max}`, btn);
            };
            joinBtn.parentNode.insertBefore(btn, joinBtn);
        }
    }

    // ============ 用户页面自动抓取昵称 ============

    function initUserPage() {
        const saved = getUsername();
        log('用户页初始化, 当前昵称:', saved || '(未设置)');

        // 用轮询方式检测，直到找到 p.truncate 并注入按钮
        let attempts = 0;
        const timer = setInterval(() => {
            attempts++;
            try { injectUserGrabButton(); } catch(e) { log('注入出错:', e); }
            // 最多尝试 40 次 (20秒)
            if (document.getElementById('mo-grab-user-btn') || attempts >= 40) {
                clearInterval(timer);
                log('用户页注入结束, attempts:', attempts);
            }
        }, 500);
    }

    function injectUserGrabButton() {
        if (document.getElementById('mo-grab-user-btn')) return;

        const allNames = document.querySelectorAll('p.truncate');
        let name = '';
        for (const el of allNames) {
            const t = el.textContent.trim();
            if (t && t !== '游客') { name = t; break; }
        }
        if (!name) { log('用户页: 未找到有效昵称'); return; }

        log('用户页: 找到昵称:', name);

        // 创建浮动按钮，固定在页面顶部
        const wrapper = document.createElement('div');
        wrapper.id = 'mo-grab-user-btn';
        wrapper.style.cssText = `
            position:fixed; top:20px; left:50%; transform:translateX(-50%); z-index:9999;
            padding:12px 24px; border-radius:8px;
            background:linear-gradient(135deg, #667eea, #764ba2);
            color:white; cursor:pointer; font-size:14px; font-weight:500;
            box-shadow:0 4px 20px rgba(0,0,0,0.3);
        `;
        wrapper.innerHTML = `🎯 使用昵称「${name}」作为身份标识`;

        wrapper.onclick = () => {
            setUsername(name);
            showNotification(`已设置昵称: ${name}`, 'success');
            wrapper.remove();
        };

        // 8秒后自动消失
        setTimeout(() => { if (wrapper.parentElement) wrapper.remove(); }, 8000);

        document.body.appendChild(wrapper);
    }

    // ============ 设置面板 ============

    function addSettingsPanel() {
        const currentName = getUsername();
        const panel = document.createElement('div');
        panel.id = 'mo-sniper-settings';
        panel.style.cssText = `
            position:fixed; bottom:20px; right:20px; z-index:9998;
            background:#1a1a2e; color:white; padding:12px 16px; border-radius:10px;
            font-size:13px; min-width:220px; box-shadow:0 4px 20px rgba(0,0,0,0.4);
            border:1px solid rgba(255,255,255,0.1);
        `;
        panel.innerHTML = `
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;font-weight:bold;">
                <span>🎯</span><span>自动进服设置</span>
                <button id="mo-set-toggle" style="margin-left:auto;background:rgba(255,255,255,0.1);border:none;color:white;width:22px;height:22px;border-radius:50%;cursor:pointer;font-size:11px;">-</button>
            </div>
            <div id="mo-set-body">
                <div style="margin-bottom:8px;">
                    <label style="display:block;margin-bottom:2px;">Steam 昵称：</label>
                    <div style="display:flex;align-items:center;gap:6px;">
                        <input type="text" id="mo-username" value="${currentName}" placeholder="留空则不检测" style="flex:1;min-width:0;padding:4px 6px;border:1px solid rgba(255,255,255,0.2);border-radius:4px;background:rgba(255,255,255,0.1);color:white;font-size:13px;">
                        <button id="mo-save-user" style="background:#667eea;border:none;color:white;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:11px;white-space:nowrap;">保存</button>
                    </div>
                    <div style="font-size:10px;color:rgba(255,255,255,0.4);margin-top:2px;">填入你的 Steam 昵称，检测到已在服务器时自动跳过</div>
                </div>
                <div style="margin-bottom:8px;">
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
                        <input type="checkbox" id="mo-sound" ${CONFIG.enableSound?'checked':''} style="width:14px;height:14px;cursor:pointer;">
                        <span>声音提醒</span>
                    </label>
                </div>
                <div style="margin-bottom:8px;">
                    <label style="display:block;margin-bottom:2px;">人数阈值：</label>
                    <div style="display:flex;align-items:center;gap:6px;">
                        <input type="number" id="mo-threshold" value="${threshold}" min="1" max="128" style="width:60px;padding:4px 6px;border:1px solid rgba(255,255,255,0.2);border-radius:4px;background:rgba(255,255,255,0.1);color:white;font-size:13px;">
                        <span style="font-size:11px;color:rgba(255,255,255,0.5);">人</span>
                    </div>
                </div>
                <div>
                    <label style="display:block;margin-bottom:2px;">检查间隔：</label>
                    <div style="display:flex;align-items:center;gap:6px;">
                        <input type="number" id="mo-interval" value="${CONFIG.checkInterval/1000}" min="1" max="30" style="width:60px;padding:4px 6px;border:1px solid rgba(255,255,255,0.2);border-radius:4px;background:rgba(255,255,255,0.1);color:white;font-size:13px;">
                        <span style="font-size:11px;color:rgba(255,255,255,0.5);">秒</span>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(panel);

        document.getElementById('mo-set-toggle').onclick = () => {
            const body = document.getElementById('mo-set-body');
            const btn = document.getElementById('mo-set-toggle');
            const hidden = body.style.display === 'none';
            body.style.display = hidden ? '' : 'none';
            btn.textContent = hidden ? '-' : '+';
        };

        document.getElementById('mo-sound').onchange = (e) => { CONFIG.enableSound = e.target.checked; };
        document.getElementById('mo-threshold').onchange = (e) => { threshold = parseInt(e.target.value, 10) || CONFIG.defaultThreshold; };
        document.getElementById('mo-interval').onchange = (e) => { CONFIG.checkInterval = (parseInt(e.target.value, 10) || 2) * 1000; };

        document.getElementById('mo-save-user').onclick = () => {
            const val = document.getElementById('mo-username').value.trim();
            setUsername(val);
            showNotification(val ? `已保存昵称: ${val}` : '已清除昵称', 'success');
        };
    }

    // ============ 初始化 ============

    let currentPath = '';

    function runForCurrentPage() {
        const siteType = getSiteType();
        const path = window.location.pathname;
        const isUserPage = path.startsWith('/user');
        const isPlayPage = path.startsWith('/play');
        log('页面初始化, 路径:', path, '类型:', siteType);

        // 清理旧的注入元素
        document.querySelectorAll('.mo-sniper-btn, #mo-grab-user-btn').forEach(el => el.remove());
        stopMonitoring();

        if (isUserPage) {
            initUserPage();
        } else if (siteType === 'new' && isPlayPage) {
            initNewSite();
        } else if (siteType === 'old') {
            initOldSite();
        }

        if (!document.getElementById('mo-sniper-settings')) {
            addSettingsPanel();
        }
    }

    function init() {
        currentPath = window.location.pathname;
        log('v2.3 已加载, 昵称:', getUsername() || '(未设置)');
        runForCurrentPage();

        // 监听 SPA 导航（pushState / replaceState）
        const origPush = history.pushState;
        const origReplace = history.replaceState;
        history.pushState = function() { origPush.apply(this, arguments); onNav(); };
        history.replaceState = function() { origReplace.apply(this, arguments); onNav(); };
        window.addEventListener('popstate', onNav);
    }

    let navTimer = null;
    function onNav() {
        if (navTimer) clearTimeout(navTimer);
        navTimer = setTimeout(() => {
            const newPath = window.location.pathname;
            if (newPath !== currentPath) {
                currentPath = newPath;
                log('SPA 导航检测:', newPath);
                runForCurrentPage();
            }
        }, 300);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
