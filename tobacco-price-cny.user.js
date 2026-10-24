// ==UserScript==
// @name         烟草商城汇率助手
// @name:en      Tobacco Shop CNY Price Converter
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  在春日商事、70Cigars、PIPEUNCLE 的商品价格旁显示人民币参考价；汇率来自接口盒子（阿里云社区文章），按自然日缓存，一天只请求一次
// @description:en Show CNY reference prices on Kasuga, 70Cigars and PIPEUNCLE; exchange rate is cached per day to avoid repeated requests
// @author       itodouble
// @match        https://kasugashoji.net/*
// @match        https://www.kasugashoji.net/*
// @match        https://70cigars.com/*
// @match        https://www.70cigars.com/*
// @match        https://www.pipeuncle.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=kasugashoji.net
// @connect      cn.apihz.cn
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    /* ------------------------------------------------------------------ *
     * 配置
     * ------------------------------------------------------------------ */

    const SCRIPT_NAME = '烟草商城汇率助手';
    const LOG_PREFIX = '[' + SCRIPT_NAME + ']';

    // 接口盒子（https://cn.apihz.cn/api/jinrong/huilv.php），文档见
    // https://developer.aliyun.com/article/1696000
    const API_URL = 'https://cn.apihz.cn/api/jinrong/huilv.php';
    const DEFAULT_API_ID = '88888888';
    const DEFAULT_API_KEY = '88888888';

    const TARGET_CURRENCY = 'CNY';
    const CACHE_ZONE = 'Asia/Shanghai';

    const STORAGE = {
        cache: 'tm_tobacco_rate_cache_v1',
        apiId: 'tm_tobacco_rate_api_id_v1',
        apiKey: 'tm_tobacco_rate_api_key_v1',
        badge: 'tm_tobacco_rate_badge_v1'
    };

    const EXCLUDE_SELECTOR = [
        'script', 'style', 'noscript', 'textarea', 'select', 'option', 'head',
        'del', 's', '[hidden]', '.visually-hidden', '.screen-reader-text', '.sr-only',
        '.tm-cny-price', '#tm-rate-badge', '[data-tm-ignore]'
    ].join(',');

    const PRICE_PATTERNS = {
        // $12.34 / USD $12.34
        USD: /^(?:USD\s*)?\$\s*([\d,]+(?:\.\d+)?)$/i,
        // 9,980円 / ¥9,980
        JPY: /^(?:[¥￥]\s*([\d,]+(?:\.\d+)?)|([\d,]+(?:\.\d+)?)\s*円)$/
    };

    const SITES = {
        kasuga: { key: 'kasuga', currency: 'JPY' },
        cigars: { key: 'cigars', currency: 'USD' },
        pipeuncle: { key: 'pipeuncle', currency: 'USD' }
    };

    const state = {
        site: detectSite(),
        entry: null,
        observer: null,
        pending: new Set(),
        timer: null,
        refreshing: false
    };

    if (!state.site) return;

    const currency = state.site.currency;

    /* ------------------------------------------------------------------ *
     * 通用小工具
     * ------------------------------------------------------------------ */

    function log() {
        console.log.apply(console, [LOG_PREFIX].concat(Array.prototype.slice.call(arguments)));
    }

    function detectSite() {
        const host = location.hostname.replace(/^www\./i, '').toLowerCase();
        if (host === 'kasugashoji.net') return SITES.kasuga;
        if (host === '70cigars.com') return SITES.cigars;
        if (host === 'pipeuncle.com') return SITES.pipeuncle;
        return null;
    }

    function todayKey() {
        try {
            const parts = new Intl.DateTimeFormat('en', {
                timeZone: CACHE_ZONE,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            }).formatToParts(new Date());
            const map = {};
            parts.forEach(function (part) { map[part.type] = part.value; });
            return map.year + '-' + map.month + '-' + map.day;
        } catch (e) {
            const d = new Date();
            return d.getFullYear() + '-' +
                String(d.getMonth() + 1).padStart(2, '0') + '-' +
                String(d.getDate()).padStart(2, '0');
        }
    }

    function formatMoney(value) {
        if (!isFinite(value)) return '';
        if (value > 0 && value < 0.01) return value.toFixed(4);
        return value.toLocaleString('zh-CN', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    function formatRate(value) {
        if (value >= 1) return String(Number(value.toFixed(4)));
        return String(Number(value.toFixed(6)));
    }

    function formatTime(timestamp) {
        try {
            return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
        } catch (e) {
            return '';
        }
    }

    function parsePrice(text, cur) {
        const pattern = PRICE_PATTERNS[cur];
        if (!pattern) return null;
        const value = String(text == null ? '' : text).replace(/\u00a0/g, ' ').trim();
        const match = value.match(pattern);
        if (!match) return null;
        const raw = match[1] != null ? match[1] : match[2];
        const amount = Number(String(raw).replace(/,/g, ''));
        return isFinite(amount) ? amount : null;
    }

    function looksLikePrice(text) {
        return parsePrice(text, currency) !== null;
    }

    function isVisible(el) {
        if (!el || !el.isConnected) return false;
        if (typeof el.getClientRects === 'function' && el.getClientRects().length === 0) return false;
        const style = getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
    }

    function isExcluded(el) {
        return !!(el && el.closest && el.closest(EXCLUDE_SELECTOR));
    }

    /* ------------------------------------------------------------------ *
     * 汇率缓存（按自然日）
     * ------------------------------------------------------------------ */

    function readCache() {
        try {
            const raw = GM_getValue(STORAGE.cache, '');
            if (!raw) return {};
            const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
            return data && typeof data === 'object' ? data : {};
        } catch (e) {
            return {};
        }
    }

    function writeCache(cache) {
        GM_setValue(STORAGE.cache, JSON.stringify(cache));
    }

    function getCachedEntry(cur) {
        const entry = readCache()[cur];
        if (!entry || !(Number(entry.rate) > 0)) return null;
        return entry;
    }

    function getTodayEntry(cur) {
        const entry = getCachedEntry(cur);
        return entry && entry.day === todayKey() ? entry : null;
    }

    function getApiId() {
        return String(GM_getValue(STORAGE.apiId, DEFAULT_API_ID) || DEFAULT_API_ID).trim() || DEFAULT_API_ID;
    }

    function getApiKey() {
        return String(GM_getValue(STORAGE.apiKey, DEFAULT_API_KEY) || DEFAULT_API_KEY).trim() || DEFAULT_API_KEY;
    }

    function requestRate(cur) {
        return new Promise(function (resolve, reject) {
            const url = API_URL +
                '?id=' + encodeURIComponent(getApiId()) +
                '&key=' + encodeURIComponent(getApiKey()) +
                '&from=' + encodeURIComponent(cur) +
                '&to=' + encodeURIComponent(TARGET_CURRENCY) +
                '&money=1&_=' + Date.now();

            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                timeout: 15000,
                headers: { 'Accept': 'application/json' },
                onload: function (response) {
                    if (response.status < 200 || response.status >= 300) {
                        reject(new Error('HTTP ' + response.status));
                        return;
                    }
                    let data;
                    try {
                        data = JSON.parse(String(response.responseText || '').replace(/^\uFEFF/, '').trim());
                    } catch (e) {
                        reject(new Error('接口返回内容不是合法的 JSON'));
                        return;
                    }
                    if (Number(data.code) !== 200) {
                        reject(new Error(data.msg || ('接口错误码 ' + data.code)));
                        return;
                    }
                    const rate = Number(data.rate != null ? data.rate : data.result);
                    if (!(rate > 0)) {
                        reject(new Error('接口返回的汇率无效'));
                        return;
                    }
                    resolve({
                        currency: cur,
                        rate: rate,
                        uptime: data.uptime || '',
                        fetchedAt: Date.now(),
                        day: todayKey(),
                        stale: false
                    });
                },
                onerror: function () {
                    reject(new Error('网络请求失败'));
                },
                ontimeout: function () {
                    reject(new Error('请求超时'));
                }
            });
        });
    }

    function saveEntry(entry) {
        const cache = readCache();
        cache[entry.currency] = entry;
        writeCache(cache);
    }

    async function loadRate(force) {
        if (!force) {
            const cached = getTodayEntry(currency);
            if (cached) {
                log('使用今日缓存汇率', currency, cached.rate, cached.uptime);
                return Object.assign({}, cached, { stale: false });
            }
        }

        try {
            const entry = await requestRate(currency);
            saveEntry(entry);
            log('已获取今日汇率', currency + '/' + TARGET_CURRENCY, entry.rate, entry.uptime);
            return entry;
        } catch (error) {
            const fallback = getCachedEntry(currency);
            if (fallback) {
                log('接口请求失败，改用上次缓存的汇率', error);
                return Object.assign({}, fallback, { stale: true, error: String(error.message || error) });
            }
            throw error;
        }
    }

    /* ------------------------------------------------------------------ *
     * 价格展示
     * ------------------------------------------------------------------ */

    function buildTitle() {
        if (!state.entry) return '';
        const entry = state.entry;
        const updated = entry.uptime
            ? '接口更新：' + entry.uptime
            : '获取时间：' + formatTime(entry.fetchedAt);
        return '按 1 ' + currency + ' = ' + formatRate(entry.rate) + ' ' + TARGET_CURRENCY + ' 换算\n' +
            updated + '\n数据来源：接口盒子（cn.apihz.cn）' +
            (entry.stale ? '\n注意：本次未取到新汇率，显示的是历史缓存值。' : '');
    }

    function createConversion(amount) {
        const node = document.createElement('span');
        node.className = 'tm-cny-price';
        node.textContent = '≈ ¥' + formatMoney(amount * state.entry.rate);
        node.title = buildTitle();
        node.dataset.amount = String(amount);
        return node;
    }

    /**
     * 春日商事是 WooCommerce，金额和「円」在 DOM 里是分开的
     * （<bdi>9,980<span>円</span></bdi>），所以按价格元素处理。
     */
    function scanJpyElements(root) {
        const list = [];
        if (root.nodeType === Node.ELEMENT_NODE && root.matches('.woocommerce-Price-amount')) {
            list.push(root);
        }
        if (root.querySelectorAll) {
            root.querySelectorAll('.woocommerce-Price-amount').forEach(function (el) {
                list.push(el);
            });
        }

        list.forEach(function (el) {
            if (!el.isConnected || isExcluded(el) || !isVisible(el)) return;

            const amount = parsePrice(el.textContent, 'JPY');
            if (amount == null) return;

            const next = el.nextElementSibling;
            if (next && next.classList.contains('tm-cny-price')) {
                if (Number(next.dataset.amount) === amount) return;
                next.remove();
            }

            el.insertAdjacentElement('afterend', createConversion(amount));
        });
    }

    function processTextNode(node) {
        if (!state.entry || !node || node.nodeType !== Node.TEXT_NODE) return;
        if (!node.isConnected) return;

        const parent = node.parentElement;
        if (!parent || isExcluded(parent)) return;

        // WooCommerce 的金额由 scanJpyElements 统一处理，避免重复插入；
        // 金额文本变化时（例如切换规格）也由它负责更新旧换算值。
        if (currency === 'JPY') {
            const amountEl = parent.closest('.woocommerce-Price-amount');
            if (amountEl) {
                scanJpyElements(amountEl);
                return;
            }
        }

        const amount = parsePrice(node.nodeValue, currency);
        if (amount == null) return;

        // 不可见的重复价格（Shopify 的 .visually-hidden 等）已经排除了，
        // 这里再兜底判断一次，避免给隐藏元素插入内容。
        if (!isVisible(parent)) return;

        // PIPEUNCLE 自带「≈ ¥105」的估算行，交给 syncPipeuncleEstimates
        // 直接改写那一行，避免同一个价格出现两次换算。
        if (state.site.key === 'pipeuncle' && parent.closest('.price-current, .showcase-price')) {
            return;
        }

        // 页面改价（如 Shopify 切换规格）时，旧换算值要跟着更新；
        // 同时也能防止脚本被重复注入时插入多个换算值。
        const next = node.nextSibling;
        if (next && next.nodeType === Node.ELEMENT_NODE && next.classList.contains('tm-cny-price')) {
            if (Number(next.dataset.amount) === amount) return;
            next.remove();
        }

        parent.insertBefore(createConversion(amount), node.nextSibling);
    }

    function scanTextNodes(root) {
        if (!root || !root.isConnected) return;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
        const nodes = [];
        let node;
        while ((node = walker.nextNode())) {
            if (looksLikePrice(node.nodeValue)) nodes.push(node);
        }
        nodes.forEach(processTextNode);
    }

    function scan(root) {
        if (!state.entry || !root) return;
        if (root.nodeType === Node.TEXT_NODE) {
            processTextNode(root);
            return;
        }
        if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
        if (root.nodeType === Node.ELEMENT_NODE && isExcluded(root)) return;

        if (currency === 'JPY') scanJpyElements(root);
        scanTextNodes(root);
    }

    /**
     * PIPEUNCLE 是 Vue 单页应用，商品价格结构和其它站点不同，
     * 并且页面本身已有人民币估算值，直接更新它即可。
     */
    function syncPipeuncleEstimates() {
        if (!state.entry || state.site.key !== 'pipeuncle') return;

        document.querySelectorAll('.price-current, .showcase-price').forEach(function (priceEl) {
            const amount = parsePrice(priceEl.textContent, 'USD');
            if (amount == null) return;

            const block = priceEl.closest('.product-price, .showcase-price-block, .price-section') ||
                priceEl.parentElement;

            let estimate = block.querySelector('.tm-cny-estimate, .price-cny, .estimate-amount, .showcase-price-estimate');

            // 详情页的人民币估算值（.price-cny）是 .price-section 的兄弟节点
            if (!estimate) {
                let sibling = block.nextElementSibling;
                while (sibling && !estimate) {
                    if (sibling.nodeType === Node.ELEMENT_NODE) {
                        if (sibling.matches('.price-cny, .showcase-price-estimate, .tm-cny-estimate')) {
                            estimate = sibling;
                        } else if (sibling.querySelector) {
                            estimate = sibling.querySelector('.price-cny, .showcase-price-estimate, .tm-cny-estimate');
                        }
                    }
                    sibling = sibling.nextElementSibling;
                }
            }

            if (!estimate) {
                estimate = document.createElement('div');
                estimate.className = 'tm-cny-estimate';
                block.appendChild(estimate);
            }

            const text = '≈ ¥' + formatMoney(amount * state.entry.rate);
            if (estimate.textContent.trim() !== text) estimate.textContent = text;
            estimate.title = buildTitle();
            estimate.classList.add('tm-cny-estimate');
        });
    }

    /* ------------------------------------------------------------------ *
     * 状态条
     * ------------------------------------------------------------------ */

    function badgeEnabled() {
        return GM_getValue(STORAGE.badge, true) !== false;
    }

    function ensureBadge() {
        let el = document.getElementById('tm-rate-badge');
        if (!el) {
            el = document.createElement('div');
            el.id = 'tm-rate-badge';
            el.addEventListener('click', function () {
                refresh(true);
            });
            (document.body || document.documentElement).appendChild(el);
        }
        el.style.display = badgeEnabled() ? '' : 'none';
        return el;
    }

    function setBadge(text, extraClass, title) {
        const el = ensureBadge();
        if (!el) return;
        el.textContent = text;
        el.classList.remove('tm-stale', 'tm-error');
        if (extraClass) el.classList.add(extraClass);
        el.title = title || '点击刷新汇率';
    }

    function updateBadge() {
        if (!state.entry) return;
        const entry = state.entry;
        let text = '1 ' + currency + ' = ' + formatRate(entry.rate) + ' ' + TARGET_CURRENCY;

        if (entry.uptime) {
            text += ' · ' + entry.uptime.slice(5, 16);
        } else {
            text += ' · ' + formatTime(entry.fetchedAt).slice(5, 16);
        }

        let extraClass = '';
        if (entry.stale) {
            text += ' · 缓存';
            extraClass = 'tm-stale';
        }

        setBadge(text, extraClass, buildTitle() + '\n\n点击强制刷新');
    }

    function updateBadgeError(error) {
        setBadge('汇率获取失败 · 点击重试', 'tm-error',
            String(error && error.message ? error.message : error) + '\n\n点击重试');
    }

    /* ------------------------------------------------------------------ *
     * 扫描调度
     * ------------------------------------------------------------------ */

    function flushScan() {
        state.timer = null;
        const nodes = Array.from(state.pending);
        state.pending.clear();

        nodes.forEach(function (node) {
            if (!node) return;
            if (node.nodeType === Node.TEXT_NODE) {
                processTextNode(node);
            } else if (node.isConnected) {
                scan(node);
            }
        });

        if (state.site.key === 'pipeuncle') syncPipeuncleEstimates();
        ensureBadge();
    }

    function queueScan(node) {
        if (!node) return;
        state.pending.add(node);
        if (state.timer) return;
        state.timer = setTimeout(flushScan, 250);
    }

    function startObserver() {
        if (state.observer) return;
        state.observer = new MutationObserver(function (mutations) {
            mutations.forEach(function (mutation) {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach(queueScan);
                } else if (mutation.type === 'characterData') {
                    queueScan(mutation.target);
                }
            });
        });
        state.observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }

    /* ------------------------------------------------------------------ *
     * 刷新 / 菜单
     * ------------------------------------------------------------------ */

    async function refresh(force) {
        if (state.refreshing) return;
        state.refreshing = true;

        if (!state.entry) setBadge('汇率获取中…');

        try {
            state.entry = await loadRate(!!force);
            document.querySelectorAll('.tm-cny-price').forEach(function (el) {
                el.remove();
            });
            scan(document.body);
            if (state.site.key === 'pipeuncle') syncPipeuncleEstimates();
            updateBadge();
            startObserver();
        } catch (error) {
            console.warn(LOG_PREFIX, '汇率获取失败', error);
            updateBadgeError(error);
        } finally {
            state.refreshing = false;
        }
    }

    function showCacheInfo() {
        const cache = readCache();
        const keys = Object.keys(cache);
        const lines = ['站点：' + location.hostname + '（' + currency + ' → ' + TARGET_CURRENCY + '）', ''];

        if (!keys.length) {
            lines.push('暂无缓存，首次刷新时会向接口请求汇率。');
        } else {
            keys.forEach(function (key) {
                const entry = cache[key];
                lines.push(key + ' → ' + TARGET_CURRENCY + '：' + entry.rate);
                lines.push('  缓存日期：' + entry.day + '（' + (entry.day === todayKey() ? '今日' : '已过期') + '）');
                lines.push('  接口更新：' + (entry.uptime || '未知'));
                lines.push('  本地获取：' + formatTime(entry.fetchedAt));
            });
        }

        lines.push('');
        lines.push('接口：' + API_URL);
        lines.push('ID：' + getApiId());
        lines.push('缓存规则：每个自然日（' + CACHE_ZONE + '）最多请求一次');
        alert(lines.join('\n'));
    }

    function configureApi() {
        const id = prompt('接口盒子用户 ID（留空使用公共 ID ' + DEFAULT_API_ID + '）：', getApiId());
        if (id === null) return;
        const key = prompt('接口盒子通讯密钥（留空使用公共 KEY ' + DEFAULT_API_KEY + '）：',
            GM_getValue(STORAGE.apiKey, DEFAULT_API_KEY));
        if (key === null) return;

        GM_setValue(STORAGE.apiId, id.trim() || DEFAULT_API_ID);
        GM_setValue(STORAGE.apiKey, key.trim() || DEFAULT_API_KEY);
        alert('已保存。点击右下角状态条即可刷新汇率。');
    }

    function toggleBadge() {
        GM_setValue(STORAGE.badge, !badgeEnabled());
        ensureBadge();
    }

    function registerMenus() {
        GM_registerMenuCommand('刷新汇率（当前站点）', function () {
            refresh(true);
        });
        GM_registerMenuCommand('查看汇率缓存', showCacheInfo);
        GM_registerMenuCommand('设置接口 ID / KEY', configureApi);
        GM_registerMenuCommand('显示 / 隐藏汇率状态条', toggleBadge);
    }

    /* ------------------------------------------------------------------ *
     * 样式
     * ------------------------------------------------------------------ */

    function addStyle() {
        const css = [
            '.tm-cny-price {',
            '  display: inline-block;',
            '  margin-left: .38em;',
            '  padding: 0 .3em;',
            '  border-radius: 4px;',
            '  background: rgba(16, 185, 129, .13);',
            '  color: #0b8a4b;',
            '  font-size: .82em;',
            '  font-weight: 600;',
            '  line-height: 1.4;',
            '  white-space: nowrap;',
            '  vertical-align: baseline;',
            '  cursor: help;',
            '}',
            '.tm-cny-estimate {',
            '  color: #0b8a4b !important;',
            '  font-weight: 600;',
            '  cursor: help;',
            '}',
            '#tm-rate-badge {',
            '  position: fixed;',
            '  right: 12px;',
            '  bottom: 12px;',
            '  z-index: 2147483646;',
            '  padding: 5px 10px;',
            '  border-radius: 999px;',
            '  background: rgba(17, 24, 39, .86);',
            '  color: #f9fafb;',
            '  font: 11px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Microsoft YaHei", sans-serif;',
            '  letter-spacing: .01em;',
            '  box-shadow: 0 2px 10px rgba(0, 0, 0, .18);',
            '  cursor: pointer;',
            '  user-select: none;',
            '  opacity: .88;',
            '  transition: opacity .15s ease;',
            '}',
            '#tm-rate-badge:hover { opacity: 1; }',
            '#tm-rate-badge.tm-stale { color: #fcd34d; }',
            '#tm-rate-badge.tm-error { background: rgba(153, 27, 27, .92); }'
        ].join('\n');

        if (typeof GM_addStyle === 'function') {
            GM_addStyle(css);
            return;
        }

        const style = document.createElement('style');
        style.textContent = css;
        (document.head || document.documentElement).appendChild(style);
    }

    /* ------------------------------------------------------------------ *
     * 启动
     * ------------------------------------------------------------------ */

    async function init() {
        addStyle();
        registerMenus();
        ensureBadge();
        setBadge('汇率获取中…');

        try {
            state.entry = await loadRate(false);
        } catch (error) {
            console.warn(LOG_PREFIX, '汇率获取失败', error);
            updateBadgeError(error);
            // 没有历史缓存时不启动扫描，避免给页面添乱；
            // 状态条可点击重试，成功后会走 refresh 的扫描流程。
            return;
        }

        scan(document.body);
        if (state.site.key === 'pipeuncle') syncPipeuncleEstimates();
        updateBadge();
        startObserver();
    }

    init();
})();
