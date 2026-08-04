// ==UserScript==
// @name         github-datetime-format
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Format GitHub relative times to absolute datetime, supports commits page and Packages versions page via API
// @author       itodouble
// @match        https://github.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=github.com
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      api.github.com
// @require      https://cdn.bootcdn.net/ajax/libs/jquery/3.6.4/jquery.min.js
// @require      http://momentjs.cn/downloads/moment.min.js
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    var GITHUB_TOKEN = GM_getValue('github_token', '');

    // 注册油猴菜单设置 Token
    GM_registerMenuCommand('设置 GitHub Token', function() {
        var token = prompt('请输入 GitHub Personal Access Token（需要 read:packages 权限）:\n\n获取方式: https://github.com/settings/tokens/new', GITHUB_TOKEN);
        if(token !== null){
            GM_setValue('github_token', token.trim());
            alert('Token 已保存，请刷新页面生效');
        }
    });

    var API_CACHE = {};

    function formatDateTime(dateTime){
        return moment(dateTime).format('YYYY-MM-DD HH:mm:ss');
    }

    function parsePackageFromUrl(){
        var m = location.pathname.match(/\/users\/([^\/]+)\/packages\/container\/([^\/]+)\/versions/);
        if(m) return {owner: m[1], package: m[2]};
        m = location.pathname.match(/\/([^\/]+)\/([^\/]+)\/pkgs\/container\/([^\/]+)/);
        if(m) return {owner: m[1], package: m[3]};
        return null;
    }

    function fetchPackageVersions(owner, packageName, callback){
        if(!GITHUB_TOKEN){
            console.log('未配置 GitHub Token，跳过 API 请求');
            callback(null);
            return;
        }

        var cacheKey = owner + '/' + packageName;
        if(API_CACHE[cacheKey]){
            callback(API_CACHE[cacheKey]);
            return;
        }

        var url = 'https://api.github.com/users/' + owner + '/packages/container/' + packageName + '/versions?per_page=100';

        GM_xmlhttpRequest({
            method: 'GET',
            url: url,
            headers: {
                'Accept': 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'Authorization': 'Bearer ' + GITHUB_TOKEN
            },
            onload: function(response){
                if(response.status !== 200){
                    console.error('API error:', response.status, response.responseText);
                    callback(null);
                    return;
                }
                try{
                    var data = JSON.parse(response.responseText);
                    var digestMap = {};
                    data.forEach(function(v){
                        var created = v.created_at;
                        if(v.metadata && v.metadata.container){
                            var manifest = v.metadata.container.manifest || {};
                            for(var key in manifest){
                                if(key.startsWith('sha256:')){
                                    digestMap[key.replace('sha256:', '')] = created;
                                }
                            }
                        }
                        if(v.metadata && v.metadata.container && v.metadata.container.tags){
                            v.metadata.container.tags.forEach(function(tag){
                                digestMap['tag:' + tag] = created;
                            });
                        }
                        digestMap['id:' + v.id] = created;
                    });
                    API_CACHE[cacheKey] = {digestMap: digestMap};
                    callback(API_CACHE[cacheKey]);
                }catch(e){
                    console.error('Parse error:', e);
                    callback(null);
                }
            },
            onerror: function(err){
                console.error('Request error:', err);
                callback(null);
            }
        });
    }

    function extractItemInfo($li){
        var tag = $li.find('a.Label').first().text().trim() || null;
        var digestLink = $li.find('a.css-truncate-target[href*="sha256"]').first().text().trim() || null;
        if(digestLink && digestLink.startsWith('sha256:')){
            digestLink = digestLink.replace('sha256:', '');
        }
        var href = $li.find('a.css-truncate-target').first().attr('href') || '';
        var idMatch = href.match(/\/(\d+)\?/);
        var versionId = idMatch ? idMatch[1] : null;
        return {tag: tag, digest: digestLink, versionId: versionId};
    }

    function findExactDate(apiData, info){
        if(!apiData || !apiData.digestMap) return null;
        if(info.tag && apiData.digestMap['tag:' + info.tag]){
            return apiData.digestMap['tag:' + info.tag];
        }
        if(info.digest && apiData.digestMap[info.digest]){
            return apiData.digestMap[info.digest];
        }
        if(info.versionId && apiData.digestMap['id:' + info.versionId]){
            return apiData.digestMap['id:' + info.versionId];
        }
        return null;
    }

    // ---------- 优化后的通用时间格式化函数 ----------
    function formatTimeElements() {
        // 选择所有 relative-time 以及带有 datetime 属性的 time 元素
        $('relative-time, time[datetime]').each(function() {
            var $this = $(this);
            // 避免重复处理
            if ($this.data('github-dt-formatted')) return;
            $this.data('github-dt-formatted', true);

            var datetime = $this.attr('datetime');
            if (!datetime) return;

            var formatted = formatDateTime(datetime);
            var fromNow = moment(datetime).fromNow();

            // 创建一个新的 time 元素，保留原有属性（除了可能被替换的文本）
            var $newTime = $('<time>', {
                datetime: datetime,
                title: fromNow,
                class: $this.attr('class'),
                style: $this.attr('style'),
                // 可添加其他属性
            }).text(formatted);

            // 如果原元素有 id，也保留（避免冲突）
            var id = $this.attr('id');
            if (id) $newTime.attr('id', id);

            // 替换原元素
            $this.replaceWith($newTime);
        });
    }

    // ---------- Packages 专用处理（保持不变） ----------
    function formatPackagesPublishedDate(){
        var pkg = parsePackageFromUrl();
        if(!pkg) return;

        var items = [];
        $('li.Box-row').each(function(){
            var $li = $(this);
            if($li.data('pkg-processed')) return;
            var $small = $li.find('small.color-fg-muted').filter(function(){
                return /Published\s+(about\s+|over\s+)?[\w\s]+ago/i.test($(this).text());
            }).first();
            if($small.length){
                items.push({$li: $li, $small: $small, info: extractItemInfo($li)});
            }
        });

        if(items.length === 0) return;
        items.forEach(function(item){ item.$li.data('pkg-processed', true); });

        fetchPackageVersions(pkg.owner, pkg.package, function(apiData){
            items.forEach(function(item){
                var text = item.$small.text();
                var exactDate = apiData ? findExactDate(apiData, item.info) : null;

                if(exactDate){
                    var formatted = formatDateTime(exactDate);
                    var fromNow = moment(exactDate).fromNow();
                    item.$small.text(text.replace(/Published\s+(about\s+|over\s+)?[\w\s]+ago/i, 'Published ' + formatted + ' (' + fromNow + ')'));
                } else {
                    var parsed = parseRelativeTime(text);
                    if(parsed){
                        var prefix = GITHUB_TOKEN ? '' : '~';
                        item.$small.text(text.replace(/Published\s+(about\s+|over\s+)?[\w\s]+ago/i, 'Published ' + prefix + formatDateTime(parsed)));
                    }
                }
            });
        });
    }

    function parseRelativeTime(text) {
        var now = moment();
        var match = text.match(/(about\s+|over\s+)?(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i);
        if(!match) return null;
        return now.subtract(parseInt(match[2]), match[3] + 's');
    }

    // ---------- 观察者（优化延迟） ----------
    function observeChanges(){
        var observer = new MutationObserver(function(mutations) {
            var hasNewNodes = false;
            mutations.forEach(function(mutation){
                if(mutation.addedNodes.length > 0) hasNewNodes = true;
            });
            if(hasNewNodes){
                // 减少延迟，快速响应动态内容
                setTimeout(function(){
                    formatTimeElements();
                    formatPackagesPublishedDate();
                }, 150);
            }
        });
        observer.observe(document.body, {childList: true, subtree: true});
    }

    // 首次运行提示
    if(!GITHUB_TOKEN && parsePackageFromUrl()){
        console.log('【github-datetime-format】首次使用 Packages 格式化，请配置 GitHub Token');
        console.log('1. 访问 https://github.com/settings/tokens/new');
        console.log('2. 勾选 read:packages 权限');
        console.log('3. 点击油猴图标 → 本脚本 → 设置 GitHub Token');
    }

    // 初始执行
    formatTimeElements();
    formatPackagesPublishedDate();
    observeChanges();

})();
