// ==UserScript==
// @name         Yandex Mail 中文化
// @name:en      Yandex Mail Chinese UI
// @namespace    http://tampermonkey.net/
// @version      1.1.0
// @description  把 Yandex Mail 的英文/俄语界面和操作按钮翻译成简体中文，并屏蔽页面广告；词库直接内置在脚本中，不发送任何在线翻译请求；邮件主题与正文保持原文
// @description:en Translate the English/Russian Yandex Mail UI into Simplified Chinese with a built-in dictionary and block ads; no online translation requests; message subjects and bodies stay untouched
// @author       itodouble
// @match        https://mail.yandex.com/*
// @match        https://mail.yandex.ru/*
// @match        https://mail.yandex.com.tr/*
// @match        https://passport.yandex.com/*
// @match        https://passport.yandex.ru/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=mail.yandex.com
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-start
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    /* ================================================================== *
     * 基础判断
     * ================================================================== */

    const HOST = location.hostname.toLowerCase();
    const IS_MAIL_HOST = /(^|\.)mail\.yandex\.(com|ru|com\.tr)$/.test(HOST);
    const IS_PASSPORT_HOST = /(^|\.)passport\.yandex\.(com|ru)$/.test(HOST);

    if (!IS_MAIL_HOST) {
        // 只接管从邮箱跳转过去的 Yandex ID 登录页，避免影响其他服务的登录
        const fromMail = /\/pwl-yandex\//.test(location.pathname) ||
            /from=mail|mail\.yandex/i.test(location.href + ' ' + document.referrer);
        if (!IS_PASSPORT_HOST || !fromMail) return;
    }

    const SCRIPT_NAME = 'Yandex Mail 中文化';
    const LOG_PREFIX = '[' + SCRIPT_NAME + ']';
    const ENABLED_KEY = 'ytm_enabled_v1';
    const CUSTOM_KEY = 'ytm_custom_dict_v1';
    const ADBLOCK_KEY = 'ytm_block_ads_v1';
    const AD_ROOT_CLASS = 'ytm-no-ads';
    const AD_STYLE_ID = 'ytm-adblock-style';

    function readEnabled() {
        try {
            return GM_getValue(ENABLED_KEY, true) !== false;
        } catch (e) {
            return true;
        }
    }

    function registerMenuSafe(label, callback) {
        if (typeof GM_registerMenuCommand !== 'function') return;
        try {
            GM_registerMenuCommand(label, callback);
        } catch (e) {
            // 某些管理器不支持菜单，忽略即可
        }
    }

    /* ================================================================== *
     * 广告屏蔽
     *
     * 只隐藏广告位、广告 iframe 和推广横幅，不动邮件内容。
     * 所有规则都通过 CSS 生效，动态插入的广告也会被自动隐藏。
     * ================================================================== */

    const AD_SELECTORS = [
        // Yandex Direct / RTB 广告位
        '#js-messages-direct', '#js-main-rtb',
        '[id^="js-main-rtb"]', '[id^="js-messages-direct"]',
        '.DirectLine', '.BannersBlock',
        '[class*="DirectLine"]', '[class*="BannersBlock"]',
        '.mail-Ad', '.mail-Ads', '.mail-Adv', '.mail-Advert', '.mail-Advertisement',
        '.b-ad', '.b-adv', '.b-banner', '.b-direct',
        '.ad', '.ads', '.advert', '.advertisement',
        '[class*="Advert"]',
        '[data-ad]', '[data-ad-slot]', '[data-google-query-id]',
        '[data-testid*="ad-banner"]', '[data-testid*="advert"]',

        // Yandex 自己的推广横幅（不包含普通功能按钮）
        '[data-testid="aside_promo_carousel_banner"]',
        '[class*="promozavr-anchor-carousel"]',
        '[data-testid="yagpt-neurofilter-banner-portal"]',

        // 常见第三方广告 iframe
        'iframe[src*="an.yandex"]', 'iframe[src*="yandex.ru/an/"]',
        'iframe[src*="ads.yandex"]', 'iframe[src*="awaps.yandex"]',
        'iframe[src*="adfox"]', 'iframe[src*="doubleclick"]',
        'iframe[src*="googlesyndication"]', 'iframe[src*="adservice.google"]',
        'iframe[id^="google_ads_iframe"]',

        // 由脚本扫描后标记的广告容器
        '[data-ytm-ad]'
    ];

    const AD_CSS = AD_SELECTORS.map(function (selector) {
        return 'html.' + AD_ROOT_CLASS + ' ' + selector;
    }).join(',\n') + ' { display: none !important; visibility: hidden !important; }';

    function readAdBlock() {
        try {
            return GM_getValue(ADBLOCK_KEY, true) !== false;
        } catch (e) {
            return true;
        }
    }

    function applyAdBlock() {
        const root = document.documentElement;
        if (!root) {
            document.addEventListener('DOMContentLoaded', applyAdBlock, { once: true });
            return;
        }
        if (readAdBlock()) {
            root.classList.add(AD_ROOT_CLASS);
        } else {
            root.classList.remove(AD_ROOT_CLASS);
        }
    }

    function installAdBlockStyle() {
        const existing = document.getElementById(AD_STYLE_ID);
        if (existing) {
            if (document.head && existing.parentNode !== document.head) {
                document.head.appendChild(existing);
            }
            return;
        }

        const host = document.head || document.documentElement;
        if (!host) {
            setTimeout(installAdBlockStyle, 10);
            return;
        }

        const style = document.createElement('style');
        style.id = AD_STYLE_ID;
        style.setAttribute('data-ytm-ignore', '');
        style.textContent = AD_CSS;
        host.appendChild(style);
    }

    // 主界面尚未渲染时也可以先下手，避免广告闪一下
    installAdBlockStyle();
    applyAdBlock();

    if (!readEnabled()) {
        registerMenuSafe('开启界面翻译（刷新后生效）', function () {
            GM_setValue(ENABLED_KEY, true);
            location.reload();
        });
        registerMenuSafe('开启 / 关闭广告屏蔽', function () {
            const next = !readAdBlock();
            GM_setValue(ADBLOCK_KEY, next);
            applyAdBlock();
            alert(next ? '已开启广告屏蔽。' : '已关闭广告屏蔽。');
        });
        return;
    }

    /* ================================================================== *
     * 内置词库（全部保存在脚本里，不联网）
     *
     * 想补充词条不用改这里，脚本菜单里有「添加自定义词条」。
     * ================================================================== */

    const BUILTIN = {
        /* ---------- 服务、导航、账户 ---------- */
        'Yandex Mail': 'Yandex 邮箱',
        'Yandex.Mail': 'Yandex 邮箱',
        'Mail': '邮箱',
        'Email': '邮箱',
        'Disk': '云盘',
        'Cloud': '云盘',
        'Documents': '文档',
        'Telemost': '视频会议',
        'Boards': '白板',
        'Calendar': '日历',
        'Notes': '笔记',
        'App': '应用',
        'Application': '应用',
        'Disable ads': '关闭广告',
        'Get more space': '获取更多空间',
        'Add an email account': '添加邮箱账户',
        'Upgrade plan': '升级套餐',
        'Check for new messages': '检查新邮件',
        'Message properties': '邮件属性',
        'Message from Yandex service': '来自 Yandex 服务的邮件',
        'Prev.': '上一封',
        'Prev': '上一封',
        'Emails from Yandex ID': '来自 Yandex ID 的邮件',
        'Download email': '下载邮件',
        'Me': '我',
        'Contacts': '联系人',
        'Contact': '联系人',
        'Todo': '待办',
        'Maps': '地图',
        'Translate': '翻译',
        'Market': '商城',
        'Music': '音乐',
        'Kinopoisk': '电影',
        'Browser': '浏览器',
        'Weather': '天气',
        'Account': '账户',
        'Accounts': '账户',
        'Profile': '个人资料',
        'Personal data': '个人数据',
        'Sign out': '退出登录',
        'Log out': '退出登录',
        'Sign out of all sessions': '退出所有会话',
        'Log out of all devices': '退出所有设备',
        'Log in': '登录',
        'Sign in': '登录',
        'Login': '登录',
        'Switch account': '切换账户',
        'Add account': '添加账户',
        'Manage accounts': '管理账户',
        'Settings': '设置',
        'All settings': '全部设置',
        'Help': '帮助',
        'Help and support': '帮助与支持',
        'Support': '支持',
        'Contact support': '联系支持',
        'Technical support': '技术支持',
        'Support service': '支持服务',
        'Feedback': '反馈',
        'Send feedback': '发送反馈',
        'Report a problem': '报告问题',
        'About': '关于',
        'Version': '版本',
        'What\'s new': '新功能',
        'Tips': '提示',
        'Keyboard shortcuts': '键盘快捷键',
        'Shortcuts': '快捷键',
        'Hotkeys': '快捷键',
        'To display the list of Yandex Mail shortcuts, enter a question mark from your keyboard or go to Help.': '要显示 Yandex 邮箱快捷键列表，请按键盘上的问号键，或前往帮助。',

        /* ---------- 左侧文件夹 ---------- */
        'Compose': '写邮件',
        'New message': '新邮件',
        'New email': '新邮件',
        'Write': '写邮件',
        'Write a message': '写邮件',
        'Write message': '写邮件',
        'Compose message': '写邮件',
        'Inbox': '收件箱',
        'Unread': '未读',
        'Sent': '已发送',
        'Sent messages': '已发送',
        'Drafts': '草稿箱',
        'Draft': '草稿',
        'Spam': '垃圾邮件',
        'Junk': '垃圾邮件',
        'Trash': '已删除',
        'Deleted': '已删除',
        'Deleted items': '已删除',
        'Archive': '归档',
        'Archived': '已归档',
        'Outbox': '发件箱',
        'Templates': '模板',
        'Template': '模板',
        'Scheduled': '已定时',
        'Snoozed': '已延后',
        'All mail': '所有邮件',
        'All messages': '所有邮件',
        'Unread mail': '未读邮件',
        'My folders': '我的文件夹',
        'Folders': '文件夹',
        'Folder': '文件夹',
        'Labels': '标签',
        'Label': '标签',
        'All folders': '所有文件夹',
        'System folders': '系统文件夹',
        'Custom folders': '自定义文件夹',
        'Create folder': '新建文件夹',
        'New folder': '新建文件夹',
        'Add folder': '添加文件夹',
        'Add a label': '添加标签',
        'Create label': '新建标签',
        'New label': '新建标签',
        'Add label': '添加标签',
        'Remove label': '移除标签',
        'Manage folders': '管理文件夹',
        'Edit folders': '编辑文件夹',
        'Folder settings': '文件夹设置',
        'Manage labels': '管理标签',
        'Show more folders': '显示更多文件夹',
        'Show more': '显示更多',
        'Show less': '收起',
        'Collapse': '收起',
        'Expand': '展开',
        'Collapse all': '全部收起',
        'Expand all': '全部展开',

        /* ---------- 工具栏与常用操作 ---------- */
        'Reply': '回复',
        'Reply all': '全部回复',
        'Reply to all': '全部回复',
        'Reply to sender': '回复发件人',
        'Reply later': '稍后回复',
        'Forward': '转发',
        'Forward as attachment': '作为附件转发',
        'Redirect': '重定向',
        'Resend': '重新发送',
        'Send again': '再次发送',
        'Edit as new': '作为新邮件编辑',
        'Delete': '删除',
        'Delete forever': '永久删除',
        'Delete permanently': '永久删除',
        'Delete this message': '删除此邮件',
        'Delete this conversation': '删除此会话',
        'Move': '移动',
        'Move to': '移动到',
        'Move to folder': '移到文件夹',
        'To folder': '移到文件夹',
        'Move to inbox': '移到收件箱',
        'Move to archive': '移到归档',
        'Move to trash': '移到已删除',
        'Move to spam': '移到垃圾邮件',
        'Move to label': '移到标签',
        'Copy to': '复制到',
        'Copy to folder': '复制到文件夹',
        'Unarchive': '取消归档',
        'Mark as read': '标为已读',
        'Mark as unread': '标为未读',
        'Mark all as read': '全部标为已读',
        'Mark all as unread': '全部标为未读',
        'Mark as important': '标为重要',
        'Mark as not important': '取消重要标记',
        'Mark as spam': '标为垃圾邮件',
        'Mark as done': '标为完成',
        'Report spam': '举报垃圾邮件',
        'Report phishing': '举报钓鱼邮件',
        'Report message': '举报邮件',
        'Report': '举报',
        'Not spam': '非垃圾邮件',
        'This is not spam': '这不是垃圾邮件',
        'Block sender': '屏蔽发件人',
        'Unblock sender': '取消屏蔽发件人',
        'Blocked senders': '已屏蔽发件人',
        'Block': '屏蔽',
        'Unblock': '取消屏蔽',
        'Add star': '添加星标',
        'Remove star': '移除星标',
        'Star': '星标',
        'Unstar': '取消星标',
        'Add flag': '添加旗标',
        'Remove flag': '移除旗标',
        'Flag': '旗标',
        'Unflag': '取消旗标',
        'Select all': '全选',
        'Deselect all': '取消全选',
        'Select all messages': '全选邮件',
        'Select all conversations': '全选会话',
        'Clear selection': '清除选择',
        'Select': '选择',
        'Deselect': '取消选择',
        'More': '更多',
        'More actions': '更多操作',
        'Actions': '操作',
        'Action': '操作',
        'Print': '打印',
        'Download': '下载',
        'Download all': '全部下载',
        'Download app': '下载应用',
        'Download the app': '下载应用',
        'Desktop app': '桌面应用',
        'Mobile app': '移动应用',
        'Light version': '轻量版',
        'Full version': '完整版',
        'Download attachments': '下载附件',
        'Save attachments': '保存附件',
        'Save all attachments': '保存全部附件',
        'Save to disk': '保存到磁盘',
        'Refresh': '刷新',
        'Reload': '重新加载',
        'Filters': '筛选器',
        'Filter': '筛选',
        'Filters and rules': '筛选器和规则',
        'Sort': '排序',
        'Sort by': '排序方式',
        'Undo': '撤销',
        'Redo': '重做',
        'Snooze': '稍后提醒',
        'Remind me': '提醒我',
        'Add reminder': '添加提醒',
        'Create event': '创建日程',
        'Add to calendar': '添加到日历',
        'Mute': '静音',
        'Mute thread': '静音会话',
        'Ignore': '忽略',
        'Ignore thread': '忽略会话',
        'Unsubscribe': '取消订阅',
        'Unsubscribe from newsletters': '取消订阅新闻邮件',
        'Spam!': '垃圾邮件！',
        'Not spam!': '不是垃圾邮件！',
        'Pin': '置顶',
        'Unpin': '取消置顶',
        'Pinned': '已置顶',
        'Pin to top': '置顶',
        'Open in new tab': '在新标签页中打开',
        'Open in new window': '在新窗口中打开',
        'Open in separate window': '在单独窗口中打开',
        'Show original': '显示原始邮件',
        'Show source': '显示源码',
        'View source': '查看源码',
        'View headers': '查看邮件头',
        'Message headers': '邮件头',
        'Raw message': '原始邮件',
        'Show in folder': '在文件夹中显示',
        'Go to folder': '转到文件夹',
        'Add to contacts': '添加到联系人',
        'Add contact': '添加联系人',
        'Create contact': '创建联系人',
        'Save to contacts': '保存到联系人',
        'Copy email address': '复制邮箱地址',
        'Copy subject': '复制主题',
        'Copy sender': '复制发件人',
        'Copy recipients': '复制收件人',
        'Copy link': '复制链接',
        'Copy text': '复制文本',
        'Message info': '邮件信息',

        /* ---------- 邮件、会话、正文 ---------- */
        'Message': '邮件',
        'Messages': '邮件',
        'Conversation': '会话',
        'Conversations': '会话',
        'Thread': '会话',
        'Threads': '会话',
        'Conversation view': '会话视图',
        'Message view': '邮件视图',
        'Email address': '邮箱地址',
        'Recipient': '收件人',
        'Recipients': '收件人',
        'Sender': '发件人',
        'From': '发件人',
        'To': '收件人',
        'Cc': '抄送',
        'Bcc': '密送',
        'Copy': '复制',
        'Blind copy': '密送',
        'Reply-To': '回复地址',
        'Reply-to': '回复地址',
        'Subject': '主题',
        'Body': '正文',
        'Message body': '邮件正文',
        'Message text': '邮件正文',
        'Date': '日期',
        'Time': '时间',
        'Size': '大小',
        'Attachment': '附件',
        'Attachments': '附件',
        'File': '文件',
        'Files': '文件',
        'No subject': '无主题',
        'No sender': '未知发件人',
        'No recipients': '无收件人',
        'No name': '未命名',
        'Untitled': '未命名',
        'Unnamed': '未命名',
        'No attachments': '没有附件',
        'Read': '已读',
        'Important': '重要',
        'Flagged': '已标记',
        'Starred': '已加星标',
        'Selected': '已选择',
        'New': '新',
        'Old': '旧',
        'Unread messages': '未读邮件',
        'Draft saved': '草稿已保存',
        'Draft deleted': '草稿已删除',
        'Message sent': '邮件已发送',
        'Message deleted': '邮件已删除',
        'Messages deleted': '邮件已删除',
        'Message moved': '邮件已移动',
        'Messages moved': '邮件已移动',
        'Message archived': '邮件已归档',
        'Messages archived': '邮件已归档',
        'Message marked as read': '邮件已标为已读',
        'Message marked as unread': '邮件已标为未读',
        'Message marked as spam': '邮件已标为垃圾邮件',
        'Message restored': '邮件已恢复',
        'This message was deleted': '此邮件已被删除',
        'Message not found': '未找到邮件',
        'The message has been moved or deleted': '邮件已被移动或删除',
        'Show quoted text': '显示引用内容',
        'Hide quoted text': '隐藏引用内容',
        'Show trimmed content': '显示折叠内容',
        'Forwarded message': '转发的邮件',
        'Original message': '原始邮件',
        'Forwarded': '已转发',
        'Replied': '已回复',
        'You replied': '你已回复',
        'You forwarded': '你已转发',
        'Edited': '已编辑',
        'Edited message': '已编辑的邮件',
        'Back to inbox': '返回收件箱',
        'Go to inbox': '转到收件箱',
        'Next message': '下一封邮件',
        'Previous message': '上一封邮件',
        'Next unread': '下一封未读',
        'Previous unread': '上一封未读',
        'Show details': '显示详情',
        'Hide details': '隐藏详情',
        'Details': '详情',
        'Show images': '显示图片',
        'Display images': '显示图片',
        'Load images': '加载图片',
        'Download images': '下载图片',
        'Images are hidden': '图片已隐藏',
        'Always show images from this sender': '始终显示此发件人的图片',
        'This message is suspicious': '此邮件可疑',
        'Be careful with links and attachments': '请谨慎对待链接和附件',
        'Phishing warning': '钓鱼警告',
        'Scan the QR code to download Yandex Mail to your phone': '扫描二维码，将 Yandex 邮箱下载到手机',
        'Read emails offline and receive new message notifications': '离线阅读邮件，并接收新邮件通知',
        'Phishing': '钓鱼邮件',
        'Suspicious': '可疑',
        'Dangerous': '危险',
        'Safe': '安全',
        'Virus': '病毒',
        'Warning': '警告',

        /* ---------- 写邮件与编辑器 ---------- */
        'Send': '发送',
        'Sending...': '正在发送…',
        'Sending': '发送中',
        'Send later': '稍后发送',
        'Schedule send': '定时发送',
        'Schedule': '定时',
        'Schedule email': '定时发送邮件',
        'Pick date and time': '选择日期和时间',
        'Send and archive': '发送并归档',
        'Send and delete': '发送并删除',
        'Save draft': '保存草稿',
        'Discard': '丢弃',
        'Discard draft': '丢弃草稿',
        'Discard changes': '放弃更改',
        'Save changes': '保存更改',
        'Saving...': '正在保存…',
        'Saved': '已保存',
        'All changes saved': '所有更改已保存',
        'Your message has been sent': '邮件已发送',
        'Message not sent': '邮件未发送',
        'Sending failed': '发送失败',
        'Sending error': '发送错误',
        'Add recipient': '添加收件人',
        'Add recipients': '添加收件人',
        'Enter a name or email address': '输入姓名或邮箱地址',
        'Enter email addresses': '输入邮箱地址',
        'Name or email address': '姓名或邮箱地址',
        'Separate email addresses with commas': '多个邮箱地址请用逗号分隔',
        'Separate addresses with commas': '多个地址请用逗号分隔',
        'Invalid email address': '邮箱地址无效',
        'Email address is invalid': '邮箱地址无效',
        'Recipient not found': '未找到收件人',
        'Add at least one recipient': '请至少添加一位收件人',
        'Enter a subject': '输入主题',
        'Add a subject': '添加主题',
        'Write your message': '输入邮件内容',
        'Type your message': '输入邮件内容',
        'Type a message': '输入邮件内容',
        'Add copy': '添加抄送',
        'Add blind copy': '添加密送',
        'Show copy and blind copy': '显示抄送和密送',
        'Hide copy and blind copy': '隐藏抄送和密送',
        'Insert signature': '插入签名',
        'Delay sending': '定时发送',
        'Turn on notifications': '开启通知',
        'Attach files from your computer': '从电脑添加文件',
        'Attach files from Yandex Disk': '从 Yandex 云盘添加文件',
        'Attach files from Yandex Mail': '从 Yandex 邮箱添加文件',
        'Minimize window': '最小化窗口',
        'Compress window': '收起窗口',
        'Close window': '关闭窗口',
        'Changes are saved automatically': '更改会自动保存',
        'Compose (w, c)': '写邮件（w、c）',
        'Write something': '输入内容',
        'Cc, From': '抄送、发件人',
        'Cс, From': '抄送、发件人',
        'Undo (Ctrl+Z)': '撤销 (Ctrl+Z)',
        'Redo (Ctrl+Y)': '重做 (Ctrl+Y)',
        'Bold (Ctrl+B)': '粗体 (Ctrl+B)',
        'Italic (Ctrl+I)': '斜体 (Ctrl+I)',
        'Underline (Ctrl+U)': '下划线 (Ctrl+U)',
        'Strikethrough (Alt+Shift+S)': '删除线 (Alt+Shift+S)',
        'Font size (Alt+Shift+Q)': '字号 (Alt+Shift+Q)',
        'Select background color (Shift+Ctrl+B)': '选择背景色 (Shift+Ctrl+B)',
        'Select text color (Alt+Shift+F)': '选择文字颜色 (Alt+Shift+F)',
        'Clear formatting (Alt+Shift+C)': '清除格式 (Alt+Shift+C)',
        'Smiles (Shift+Ctrl+E)': '表情 (Shift+Ctrl+E)',
        'Insert/edit link (Ctrl+L)': '插入/编辑链接 (Ctrl+L)',
        'Unlink (Shift+Ctrl+K)': '取消链接 (Shift+Ctrl+K)',
        'Add an image (Shift+Ctrl+I)': '插入图片 (Shift+Ctrl+I)',
        'Citation (Shift+Ctrl+.)': '引用 (Shift+Ctrl+.)',
        'Align (Shift+Ctrl+A)': '对齐 (Shift+Ctrl+A)',
        'Unordered list (Shift+Ctrl+L)': '项目符号列表 (Shift+Ctrl+L)',
        'Ordered list (Shift+Ctrl+M)': '编号列表 (Shift+Ctrl+M)',
        'mailstyles': '样式',
        'removeformat': '清除格式',
        'inlineImage': '图片',
        'blockquote': '引用',
        'align': '对齐',
        'Add attachment': '添加附件',
        'Attach': '添加附件',
        'Attach file': '添加附件',
        'Attach files': '添加附件',
        'Remove attachment': '移除附件',
        'Cancel upload': '取消上传',
        'Choose a file': '选择文件',
        'Choose file': '选择文件',
        'Upload file': '上传文件',
        'Uploading...': '正在上传…',
        'Upload failed': '上传失败',
        'File is too large': '文件过大',
        'Attachment is too large': '附件过大',
        'Drag and drop files here': '将文件拖放到此处',
        'Drop files here': '将文件拖放到此处',
        'Preview file': '预览文件',
        'Open file': '打开文件',
        'Download file': '下载文件',
        'Minimize': '最小化',
        'Maximize': '最大化',
        'Pop out': '弹出',
        'Minimize compose': '最小化写邮件窗口',
        'Expand compose': '展开写邮件窗口',
        'Close compose': '关闭写邮件窗口',
        'Insert': '插入',
        'Insert link': '插入链接',
        'Insert image': '插入图片',
        'Link': '链接',
        'Link text': '链接文字',
        'URL': '网址',
        'Image': '图片',
        'Table': '表格',
        'Emoji': '表情',
        'Emoticons': '表情',
        'Symbols': '符号',
        'Formatting': '格式',
        'Format': '格式',
        'Bold': '粗体',
        'Italic': '斜体',
        'Underline': '下划线',
        'Strikethrough': '删除线',
        'Text color': '文字颜色',
        'Background color': '背景色',
        'Align left': '左对齐',
        'Align center': '居中对齐',
        'Align right': '右对齐',
        'Numbered list': '编号列表',
        'Bulleted list': '项目符号列表',
        'Indent': '增加缩进',
        'Outdent': '减少缩进',
        'Clear formatting': '清除格式',
        'Remove formatting': '清除格式',
        'Plain text': '纯文本',
        'Rich text': '富文本',
        'Spell check': '拼写检查',
        'Check spelling': '检查拼写',
        'Check': '检查',
        'Full screen': '全屏',
        'Exit full screen': '退出全屏',

        /* ---------- 搜索 ---------- */
        'Search': '搜索',
        'Search in mail': '在邮件中搜索',
        'Search mail': '搜索邮件',
        'Search messages': '搜索邮件',
        'Search for messages': '搜索邮件',
        'Search by subject, sender, or recipient': '按主题、发件人或收件人搜索',
        'Search by subject': '按主题搜索',
        'Search by sender': '按发件人搜索',
        'Search by recipient': '按收件人搜索',
        'Search by date': '按日期搜索',
        'Search by size': '按大小搜索',
        'Advanced search': '高级搜索',
        'Search filters': '搜索筛选器',
        'Search results': '搜索结果',
        'Search query': '搜索词',
        'Search suggestions': '搜索建议',
        'Recent searches': '最近搜索',
        'Clear search': '清除搜索',
        'Clear search history': '清除搜索历史',
        'Save search': '保存搜索',
        'Saved searches': '已保存的搜索',
        'Find': '查找',
        'Contains': '包含',
        'Does not contain': '不包含',
        'Starts with': '开头是',
        'Ends with': '结尾是',
        'Equals': '等于',
        'Is': '是',
        'Is not': '不是',
        'And': '并且',
        'Not': '非',
        'Anywhere': '任意位置',
        'Any time': '任何时间',
        'All time': '所有时间',
        'Any size': '任意大小',
        'Has attachment': '有附件',
        'Has attachments': '有附件',
        'Without attachments': '无附件',
        'In folder': '在文件夹中',
        'No results': '无结果',
        'No results found': '未找到结果',
        'Nothing found': '未找到内容',
        'Nothing found for your request': '未找到符合条件的内容',
        'Try changing your search query': '尝试更改搜索条件',
        'Try a different search': '尝试其他搜索',
        'Show more results': '显示更多结果',
        'No more results': '没有更多结果',
        'Load more': '加载更多',
        'Loading more...': '正在加载更多…',

        /* ---------- 规则、筛选、文件夹设置 ---------- */
        'Rules': '规则',
        'Rule': '规则',
        'Create rule': '创建规则',
        'Create filter': '创建筛选器',
        'Edit rule': '编辑规则',
        'Edit filter': '编辑筛选器',
        'Delete rule': '删除规则',
        'Delete filter': '删除筛选器',
        'Rule name': '规则名称',
        'Filter name': '筛选器名称',
        'Conditions': '条件',
        'Condition': '条件',
        'Add condition': '添加条件',
        'Add action': '添加操作',
        'Match all conditions': '满足所有条件',
        'Match any condition': '满足任一条件',
        'Apply to existing messages': '应用于现有邮件',
        'Apply to new messages': '应用于新邮件',
        'Stop processing': '停止处理',
        'Save rule': '保存规则',
        'Enable rule': '启用规则',
        'Disable rule': '禁用规则',
        'Enabled': '已启用',
        'Disabled': '已禁用',
        'Enable': '启用',
        'Disable': '禁用',
        'If': '如果',
        'Then': '那么',
        'When': '当',
        'Do': '执行',
        'Folder name': '文件夹名称',
        'Label name': '标签名称',
        'Label color': '标签颜色',
        'Choose color': '选择颜色',
        'No label': '无标签',
        'Parent folder': '上级文件夹',
        'Subfolder': '子文件夹',
        'Create subfolder': '新建子文件夹',
        'Nested folder': '子文件夹',
        'Rename folder': '重命名文件夹',
        'Delete folder': '删除文件夹',
        'Empty folder': '清空文件夹',
        'Empty trash': '清空回收站',
        'Move folder': '移动文件夹',
        'Folder order': '文件夹顺序',
        'Folder visibility': '文件夹可见性',
        'Show folder': '显示文件夹',
        'Hide folder': '隐藏文件夹',
        'Show in sidebar': '在侧边栏显示',
        'Hide from sidebar': '从侧边栏隐藏',
        'Show in message list': '在邮件列表中显示',
        'Show labels': '显示标签',
        'Hide labels': '隐藏标签',
        'Show unread count': '显示未读数',
        'Show unread counter': '显示未读计数',
        'Drag to reorder': '拖动排序',
        'Move up': '上移',
        'Move down': '下移',
        'Duplicate': '复制',
        'Rename': '重命名',
        'Create': '创建',
        'Add': '添加',
        'Remove': '移除',
        'Clear': '清除',
        'Clear all': '全部清除',

        /* ---------- 设置 ---------- */
        'General': '常规',
        'General settings': '常规设置',
        'Mail settings': '邮件设置',
        'Account settings': '账户设置',
        'Account information': '账户信息',
        'Personal information': '个人信息',
        'Interface': '界面',
        'Interface settings': '界面设置',
        'Interface language': '界面语言',
        'Appearance': '外观',
        'Theme': '主题',
        'Themes': '主题',
        'Light': '浅色',
        'Dark': '深色',
        'Light theme': '浅色主题',
        'Dark theme': '深色主题',
        'System': '跟随系统',
        'System theme': '跟随系统',
        'Use system theme': '跟随系统主题',
        'Accent color': '强调色',
        'Color scheme': '配色方案',
        'Layout': '布局',
        'Message list': '邮件列表',
        'Reading pane': '阅读窗格',
        'Preview pane': '预览窗格',
        'Show reading pane': '显示阅读窗格',
        'Hide reading pane': '隐藏阅读窗格',
        'Reading pane position': '阅读窗格位置',
        'Show preview': '显示预览',
        'Hide preview': '隐藏预览',
        'Show message preview': '显示邮件预览',
        'Show avatars': '显示头像',
        'Show sender avatars': '显示发件人头像',
        'Compact': '紧凑',
        'Comfortable': '舒适',
        'Density': '密度',
        'Right': '右侧',
        'Bottom': '底部',
        'Off': '关闭',
        'On': '开启',
        'Font': '字体',
        'Font size': '字体大小',
        'Text size': '文字大小',
        'Small': '小',
        'Medium': '中',
        'Large': '大',
        'Threading': '会话模式',
        'Group messages by thread': '按会话分组邮件',
        'Always show images': '始终显示图片',
        'Ask before showing images': '显示图片前询问',
        'Block external images': '阻止外部图片',
        'Notifications': '通知',
        'Email notifications': '邮件通知',
        'Push notifications': '推送通知',
        'Desktop notifications': '桌面通知',
        'Browser notifications': '浏览器通知',
        'Enable notifications': '启用通知',
        'Disable notifications': '关闭通知',
        'Notification sound': '通知声音',
        'Sound': '声音',
        'Sound notifications': '声音提醒',
        'Vibration': '振动',
        'Show notifications': '显示通知',
        'Show in title': '在标题中显示',
        'Signature': '签名',
        'Signatures': '签名',
        'Add signature': '添加签名',
        'Edit signature': '编辑签名',
        'Delete signature': '删除签名',
        'Automatically add signature': '自动添加签名',
        'Sender address': '发件人地址',
        'Sender name': '发件人姓名',
        'Display name': '显示名称',
        'Default sender': '默认发件人',
        'Default sender address': '默认发件人地址',
        'Auto-reply': '自动回复',
        'Vacation reply': '假期自动回复',
        'Out of office reply': '外出自动回复',
        'Out of office': '外出',
        'Enable auto-reply': '启用自动回复',
        'Auto-reply period': '自动回复时间段',
        'Start date': '开始日期',
        'End date': '结束日期',
        'Collectors': '邮件收集',
        'Collector': '收集器',
        'Collect mail from other accounts': '从其他账户收取邮件',
        'Add mailbox': '添加邮箱',
        'Add a mailbox': '添加邮箱',
        'Mailbox': '邮箱',
        'Mailboxes': '邮箱',
        'Mailbox address': '邮箱地址',
        'Mailbox name': '邮箱名称',
        'Check mail from this mailbox': '收取此邮箱的邮件',
        'Security': '安全',
        'Privacy': '隐私',
        'Two-factor authentication': '双重认证',
        'Two-step verification': '两步验证',
        'App passwords': '应用密码',
        'App password': '应用密码',
        'Create app password': '创建应用密码',
        'App password name': '应用密码名称',
        'Sessions': '会话',
        'Active sessions': '活动会话',
        'Current session': '当前会话',
        'This device': '此设备',
        'Devices': '设备',
        'Change password': '修改密码',
        'Current password': '当前密码',
        'New password': '新密码',
        'Confirm password': '确认密码',
        'Repeat password': '重复密码',
        'Repeat new password': '重复新密码',
        'Password changed': '密码已更改',
        'Password': '密码',
        'Username': '用户名',
        'Name': '姓名',
        'First name': '名',
        'Last name': '姓',
        'Middle name': '中间名',
        'Phone': '电话',
        'Phone number': '手机号',
        'Recovery email': '备用邮箱',
        'Security question': '安全问题',
        'Connected accounts': '关联账户',
        'Delete account': '删除账户',
        'Storage': '存储',
        'Storage space': '存储空间',
        'Used space': '已用空间',
        'Free space': '可用空间',
        'Used': '已用',
        'Free': '可用',
        'Total': '总计',
        'Upgrade': '升级',
        'Plan': '套餐',
        'Subscription': '订阅',
        'Payment': '付款',
        'Payment method': '付款方式',
        'Invoices': '账单',
        'Language': '语言',
        'Language and region': '语言和地区',
        'Region': '地区',
        'Country': '国家',
        'Time zone': '时区',
        'Time format': '时间格式',
        'Date format': '日期格式',
        '24-hour time': '24 小时制',
        'First day of week': '每周第一天',
        'Week starts on': '每周开始于',
        'Terms of service': '服务条款',
        'Terms of Use': '使用条款',
        'Privacy Policy': '隐私政策',
        'User Agreement': '用户协议',
        'Cookie Policy': 'Cookie 政策',
        'Cookies': 'Cookie',
        'Cookie': 'Cookie',
        'Cookie settings': 'Cookie 设置',
        'Manage cookies': '管理 Cookie',
        'This site uses cookies': '本站使用 Cookie',
        'We use cookies': '我们使用 Cookie',
        'Advertising': '广告',
        'Spam protection': '垃圾邮件防护',
        'Antivirus': '病毒防护',

        /* ---------- 状态、提示、错误 ---------- */
        'Loading...': '加载中…',
        'Loading': '加载中',
        'Please wait': '请稍候',
        'Please wait...': '请稍候…',
        'The page is taking a long time to load.': '页面加载时间较长。',
        'Try refreshing the page or use the': '请尝试刷新页面，或使用',
        'Try refreshing the page': '请尝试刷新页面',
        'Page not found': '页面未找到',
        'Reload page': '重新加载页面',
        'If the problem persists, contact support': '如果问题仍然存在，请联系支持',
        'Processing...': '处理中…',
        'Downloading...': '正在下载…',
        'Saving': '正在保存',
        'Failed': '失败',
        'Completed': '已完成',
        'Something went wrong': '出了点问题',
        'An error occurred': '发生错误',
        'Unexpected error': '意外错误',
        'Try again': '重试',
        'Retry': '重试',
        'Try again later': '请稍后重试',
        'Connection error': '连接错误',
        'Network error': '网络错误',
        'No internet connection': '无网络连接',
        'Check your connection': '请检查网络连接',
        'Session expired': '会话已过期',
        'Please log in again': '请重新登录',
        'Access denied': '拒绝访问',
        'Too many attempts': '尝试次数过多',
        'Temporarily blocked': '暂时被封锁',
        'Copied to clipboard': '已复制到剪贴板',
        'Link copied': '链接已复制',
        'Address copied': '地址已复制',
        'Changes saved': '更改已保存',
        'Settings saved': '设置已保存',
        'Not now': '暂不',
        'Later': '稍后',
        'Never': '从不',
        'Always': '始终',
        'Ask': '询问',
        'Automatic': '自动',
        'Manual': '手动',
        'Custom': '自定义',
        'Default': '默认',
        'Preset': '预设',
        'Recommended': '推荐',
        'Optional': '可选',
        'Required': '必填',
        'Unknown': '未知',
        'Other': '其他',
        'All': '全部',
        'None': '无',
        'Yes': '是',
        'No': '否',
        'OK': '确定',
        'Cancel': '取消',
        'Close': '关闭',
        'Save': '保存',
        'Apply': '应用',
        'Reset': '重置',
        'Restore': '恢复',
        'Back': '返回',
        'Next': '下一步',
        'Previous': '上一步',
        'Continue': '继续',
        'Finish': '完成',
        'Done': '完成',
        'Edit': '编辑',
        'Show': '显示',
        'Hide': '隐藏',
        'Open': '打开',
        'View': '查看',
        'Preview': '预览',
        'Upload': '上传',
        'Share': '分享',
        'Information': '信息',
        'Error': '错误',
        'Success': '成功',
        'Are you sure?': '确定吗？',
        'Are you sure you want to delete this?': '确定要删除吗？',
        'Are you sure you want to delete this message?': '确定要删除此邮件吗？',
        'Are you sure you want to delete this conversation?': '确定要删除此会话吗？',
        'Are you sure you want to delete these messages?': '确定要删除这些邮件吗？',
        'Are you sure you want to delete these conversations?': '确定要删除这些会话吗？',
        'Are you sure you want to delete this folder?': '确定要删除此文件夹吗？',
        'Are you sure you want to delete this label?': '确定要删除此标签吗？',
        'Are you sure you want to delete this contact?': '确定要删除此联系人吗？',
        'Are you sure you want to discard this draft?': '确定要丢弃此草稿吗？',
        'Are you sure you want to empty the trash?': '确定要清空回收站吗？',
        'Are you sure you want to log out?': '确定要退出登录吗？',
        'Are you sure you want to leave this page?': '确定要离开此页面吗？',
        'Unsaved changes': '未保存的更改',
        'You have unsaved changes': '你有未保存的更改',
        'No messages': '没有邮件',
        'No messages found': '未找到邮件',
        'No unread messages': '没有未读邮件',
        'No new messages': '没有新邮件',
        'Your inbox is empty': '收件箱为空',
        'You\'re all caught up': '全部处理完了',
        'All caught up': '全部处理完了',
        'Nothing here yet': '这里还没有内容',
        'No drafts': '没有草稿',
        'No sent messages': '没有已发送邮件',
        'No spam messages': '没有垃圾邮件',
        'Trash is empty': '回收站为空',
        'No archived messages': '没有已归档邮件',
        'No more messages': '没有更多邮件',
        'End of list': '列表结束',
        'New mail': '新邮件',
        'No new mail': '没有新邮件',
        'You have a new message': '你有一封新邮件',
        'You have new mail': '你有新邮件',
        'You have unread messages': '你有未读邮件',
        'Notification': '通知',
        'New notification': '新通知',

        /* ---------- 登录 / Yandex ID ---------- */
        'Log in to Yandex': '登录 Yandex',
        'Log in with Yandex ID': '使用 Yandex ID 登录',
        'Log in with ID': '使用 Yandex ID 登录',
        'Log in or sign up': '登录或注册',
        'Continue with Yandex ID': '使用 Yandex ID 继续',
        'Log in with Google': '使用 Google 登录',
        'Log in with X (Twitter)': '使用 X (Twitter) 登录',
        'Face or fingerprint login': '面容或指纹登录',
        'QR code': '二维码',
        'Log in with QR code': '使用二维码登录',
        'Send email for log in': '发送登录邮件',
        'Create an ID': '创建账号',
        'Create ID': '创建账号',
        'Create a Yandex ID': '创建 Yandex ID',
        'Create an account': '创建账户',
        'Create account': '创建账户',
        'Sign up': '注册',
        'Register': '注册',
        'Don\'t have an account?': '还没有账户？',
        'Already have an account?': '已有账户？',
        'Remember me': '记住我',
        'Forgot password?': '忘记密码？',
        'Forgot your password?': '忘记密码？',
        'Restore access': '恢复访问',
        'Password recovery': '找回密码',
        'Reset password': '重置密码',
        'Create a password': '创建密码',
        'Create password': '创建密码',
        'Show password': '显示密码',
        'Hide password': '隐藏密码',
        'Caps Lock is on': '大写锁定已开启',
        'Incorrect password': '密码错误',
        'Invalid password': '密码无效',
        'Wrong password': '密码错误',
        'Password is too short': '密码太短',
        'Passwords do not match': '两次输入的密码不一致',
        'Email or phone': '邮箱或手机号',
        'Email or username': '邮箱或用户名',
        'Login or email': '登录名或邮箱',
        'Enter your login': '输入登录名',
        'Enter your password': '输入密码',
        'Enter password': '输入密码',
        'Enter your email': '输入邮箱',
        'Enter your phone number': '输入手机号',
        'Enter your first and last name': '输入你的名和姓',
        'Enter your name': '输入你的姓名',
        'First and last name': '名和姓',
        'Verification code': '验证码',
        'Confirmation code': '确认码',
        'Security code': '安全码',
        'Enter the code': '输入验证码',
        'SMS code': '短信验证码',
        'SMS': '短信',
        'Text message': '短信',
        'We sent a code to': '我们已发送验证码至',
        'We sent it to': '我们已发送至',
        'Resend code': '重新发送验证码',
        'Get code': '获取验证码',
        'Send code': '发送验证码',
        'Call me': '给我打电话',
        'Authenticator app': '身份验证器',
        'Try another way': '尝试其他方式',
        'Other ways to sign in': '其他登录方式',
        'Other sign-in options': '其他登录选项',
        'Sign in with password': '使用密码登录',
        'Sign in with a code': '使用验证码登录',
        'Sign in with a key': '使用密钥登录',
        'Sign in with QR code': '使用二维码登录',
        'Show QR code': '显示二维码',
        'Scan the QR code': '扫描二维码',
        'Use a different account': '使用其他账户',
        'Choose an account': '选择账户',
        'Can\'t sign in?': '无法登录？',
        'Need help?': '需要帮助？',
        'I agree': '我同意',
        'I accept': '我接受',
        'By continuing, you agree to the Terms of Use and Privacy Policy': '继续即表示你同意使用条款和隐私政策',
        'By logging in, you agree to the Terms of Use and Privacy Policy': '登录即表示你同意使用条款和隐私政策',
        'Skip': '跳过',
        'Start using Yandex': '开始使用 Yandex',
        'Go to Mail': '前往邮箱',
        'Open Mail': '打开邮箱',
        'Your account is ready': '你的账户已就绪',
        'Welcome': '欢迎',
        'Welcome to Yandex': '欢迎使用 Yandex',
        'Welcome to Yandex Mail': '欢迎使用 Yandex 邮箱',
        'Date of birth': '出生日期',
        'Gender': '性别',
        'Male': '男',
        'Female': '女',
        'Add phone number': '添加手机号',
        'Confirm phone number': '确认手机号',
        'Making sign-in easier': '让登录更简单',
        'Just follow the device\'s prompts': '按照设备上的提示操作',
        'Let\'s do it!': '开始吧！',
        'Remind me later': '稍后提醒我',
        'Learn more': '了解更多',
        'Open it on any device.': '在任意设备上打开。',
        'Yandex ID. The key for all your services': 'Yandex ID，一把开启所有服务的钥匙',
        'The key for all your services': '开启所有服务的钥匙',
        'Use Incognito mode on a shared computer': '在共用电脑上使用无痕模式',
        'Update your browser': '更新浏览器',
        'Your browser is outdated and no longer supported. To continue, please update to the latest version or install one of the modern alternatives': '你的浏览器已过时且不再受支持。请更新到最新版本或安装其他现代浏览器以继续。',
        'Which you indicated during registration': '注册时填写的',
        'You will need it to log into your account': '登录账户时需要用到',

        /* ---------- 时间与日期 ---------- */
        'Just now': '刚刚',
        'Today': '今天',
        'Yesterday': '昨天',
        'Tomorrow': '明天',
        'This week': '本周',
        'Last week': '上周',
        'Next week': '下周',
        'This month': '本月',
        'Last month': '上月',
        'Next month': '下个月',
        'This year': '今年',
        'Last year': '去年',
        'Older': '更早',
        'Earlier': '更早',
        'Newer': '更新',
        'AM': '上午',
        'PM': '下午',
        'Monday': '星期一',
        'Tuesday': '星期二',
        'Wednesday': '星期三',
        'Thursday': '星期四',
        'Friday': '星期五',
        'Saturday': '星期六',
        'Sunday': '星期日',
        'Mon': '周一',
        'Tue': '周二',
        'Wed': '周三',
        'Thu': '周四',
        'Fri': '周五',
        'Sat': '周六',
        'Sun': '周日',
        'January': '一月',
        'February': '二月',
        'March': '三月',
        'April': '四月',
        'May': '五月',
        'June': '六月',
        'July': '七月',
        'August': '八月',
        'September': '九月',
        'October': '十月',
        'November': '十一月',
        'December': '十二月',
        'Jan': '1月',
        'Feb': '2月',
        'Mar': '3月',
        'Apr': '4月',
        'Jun': '6月',
        'Jul': '7月',
        'Aug': '8月',
        'Sep': '9月',
        'Sept': '9月',
        'Oct': '10月',
        'Nov': '11月',
        'Dec': '12月',

        /* ---------- Русский интерфейс（俄语界面） ---------- */
        'Яндекс 360': 'Yandex 360',
        'Яндекс Почта': 'Yandex 邮箱',
        'Почта': '邮箱',
        'Диск': '云盘',
        'Документы': '文档',
        'Календарь': '日历',
        'Телемост': '视频会议',
        'Доски': '白板',
        'Заметки': '笔记',
        'Ещё': '更多',
        'Улучшить тариф': '升级套餐',
        'Настройки': '设置',
        'Все настройки': '全部设置',
        'Настройки почты': '邮件设置',
        'Аккаунт': '账户',
        'Профиль': '个人资料',
        'Главное меню': '主菜单',
        'Поиск': '搜索',
        'Написать': '写邮件',
        'Написать письмо': '写邮件',
        'Новое письмо': '新邮件',
        'Проверить, есть ли новые письма': '检查新邮件',
        'Папки': '文件夹',
        'Мои папки': '我的文件夹',
        'Создать папку': '新建文件夹',
        'Создать метку': '新建标签',
        'Входящие': '收件箱',
        'Отправленные': '已发送',
        'Удалённые': '已删除',
        'Спам': '垃圾邮件',
        'Черновики': '草稿箱',
        'Фильтры': '筛选器',
        'Важные': '重要',
        'Все непрочитанные': '所有未读',
        'С вложениями': '有附件',
        'Добавить метку': '添加标签',
        'Добавить ящик': '添加邮箱',
        'Русский': '俄语',
        'Английский': '英语',
        'Лёгкая версия': '轻量版',
        'Увеличить место': '获取更多空间',
        'Приложение': '应用',
        'Выделить все письма': '全选邮件',
        'Переслать': '转发',
        'Удалить': '删除',
        'Архивировать': '归档',
        'Не прочитано': '未读',
        'В папку': '移到文件夹',
        'Настройка меню': '菜单设置',
        'Справка': '帮助',
        'Горячие клавиши': '快捷键',
        'Чтобы отобразить список горячих клавиш для работы с Почтой, введите с клавиатуры вопросительный знак или перейдите к Справке.': '要显示 Yandex 邮箱快捷键列表，请按键盘上的问号键，或前往帮助。',
        'Ответить': '回复',
        'Ответить всем': '全部回复',
        'Пометить как важное': '标为重要',
        'Пометить как непрочитанное': '标为未读',
        'Пометить как прочитанное': '标为已读',
        'Метка': '标签',
        'Напомнить позже': '稍后提醒我',
        'Это спам!': '垃圾邮件！',
        'Отключить рассылку': '取消订阅',
        'Закрепить': '置顶',
        'Перевести': '翻译',
        'Распечатать': '打印',
        'Создать правило': '创建规则',
        'Свойства письма': '邮件属性',
        'Скачать письмо': '下载邮件',
        'Скачать': '下载',
        'Скачать все': '全部下载',
        'Сегодня': '今天',
        'Вчера': '昨天',
        'Я': '我',
        'Отсканируйте куар-код, чтобы скачать Яндекс Почту на телефон': '扫描二维码，将 Yandex 邮箱下载到手机',
        'Чтение писем без интернета и уведомления о новых сообщениях': '离线阅读邮件，并接收新邮件通知',
        'Отключить рекламу': '关闭广告',
        'Реклама': '广告',
        'Уведомление': '通知',
        'Уведомления': '通知',
        'Внешний вид': '外观',
        'Тема': '主题',
        'Безопасность': '安全',
        'Подпись': '签名',
        'Автоответчик': '自动回复',
        'Правила': '规则',
        'Папки и метки': '文件夹和标签',
        'Сборщики': '邮件收集',
        'Язык': '语言',
        'Часовой пояс': '时区',
        'Выйти': '退出登录',
        'Выйти из аккаунта': '退出登录',
        'Сменить аккаунт': '切换账户',
        'Добавить аккаунт': '添加账户',
        'Помощь': '帮助',
        'Поддержка': '支持',
        'Получатели': '收件人',
        'Добавить получателя': '添加收件人',
        'Добавить копию': '添加抄送',
        'Добавить скрытую копию': '添加密送',
        'Копия': '抄送',
        'Скрытая копия': '密送',
        'Тема письма': '邮件主题',
        'Текст письма': '邮件正文',
        'Напишите что-нибудь': '输入内容',
        'Отправить': '发送',
        'Отправить позже': '稍后发送',
        'Запланировать отправку': '定时发送',
        'Сохранить черновик': '保存草稿',
        'Прикрепить файл': '添加附件',
        'Прикрепить файлы': '添加附件',
        'Прикрепить': '添加附件',
        'Вставить ссылку': '插入链接',
        'Вставить изображение': '插入图片',
        'Эмодзи': '表情',
        'Форматирование': '格式',
        'Жирный': '粗体',
        'Курсив': '斜体',
        'Подчёркнутый': '下划线',
        'Зачёркнутый': '删除线',
        'Маркированный список': '项目符号列表',
        'Нумерованный список': '编号列表',
        'Очистить форматирование': '清除格式',
        'Проверка орфографии': '拼写检查',
        'Полноэкранный режим': '全屏',
        'Свернуть': '最小化',
        'Развернуть': '最大化',
        'Закрыть': '关闭',
        'Закрыть окно': '关闭窗口',
        'Отправка...': '正在发送…',
        'Отправлено': '已发送',
        'Сохранено': '已保存',
        'Загрузка...': '加载中…',
        'Ошибка': '错误',
        'Предупреждение': '警告',
        'Успешно': '成功',
        'Повторить попытку': '重试',
        'Обновить': '刷新',
        'Назад': '返回',
        'Далее': '下一步',
        'Продолжить': '继续',
        'Готово': '完成',
        'Применить': '应用',
        'Сбросить': '重置',
        'Отмена': '取消',
        'Поиск в почте': '在邮件中搜索',
        'Расширенный поиск': '高级搜索',
        'Результаты поиска': '搜索结果',
        'Ничего не найдено': '未找到结果',
        'Все письма': '所有邮件',
        'Непрочитанные': '未读',
        'С флагами': '已标记',
        'Вложения': '附件',
        'Вложение': '附件',
        'Файл': '文件',
        'Файлы': '文件',
        'Размер': '大小',
        'Дата': '日期',
        'Кому': '收件人',
        'От': '发件人',
        'Вырезать': '剪切',
        'Копировать': '复制',
        'Вставить': '粘贴',
        'Отменить': '撤销',
        'Повторить': '重做',
        'Выделить все': '全选',
        'Войти': '登录',
        'Вход': '登录',
        'Войти с Yandex ID': '使用 Yandex ID 登录',
        'Почта или телефон': '邮箱或手机号',
        'Телефон': '手机号',
        'Пароль': '密码',
        'Введите пароль': '输入密码',
        'Введите почту': '输入邮箱',
        'Забыли пароль?': '忘记密码？',
        'Запомнить меня': '记住我',
        'Создать ID': '创建账号',
        'Создать аккаунт': '创建账户',
        'Неверный пароль': '密码错误',
        'Неверный код': '验证码错误',
        'Код': '验证码',
        'Код из SMS': '短信验证码',
        'Отправить код': '发送验证码',
        'Получить код': '获取验证码',
        'Отправить ещё раз': '重新发送',
        'Позвонить мне': '给我打电话',
        'Другой способ': '其他方式',
        'Другие способы входа': '其他登录方式',
        'Использовать другой аккаунт': '使用其他账户',
        'Выбрать аккаунт': '选择账户',
        'Войти по QR-коду': '使用二维码登录',
        'Показать QR-код': '显示二维码',
        'Сканировать QR-код': '扫描二维码',
        'Двухфакторная аутентификация': '双重认证',
        'Приложение-аутентификатор': '身份验证器',
        'Введите код': '输入验证码',
        'Мы отправили код на': '我们已发送验证码至',
        'Имя': '名',
        'Фамилия': '姓',
        'Дата рождения': '出生日期',
        'Пол': '性别',
        'Мужской': '男',
        'Женский': '女',
        'Сменить пароль': '修改密码',
        'Текущий пароль': '当前密码',
        'Новый пароль': '新密码',
        'Повторите пароль': '重复密码',
        'Пароли приложений': '应用密码',
        'Сеансы': '会话',
        'Устройства': '设备',
        'Хранилище': '存储',
        'Тариф': '套餐',
        'Подписка': '订阅',
        'Оплата': '付款'
    };

    /* ================================================================== *
     * 词库索引与自定义词条
     * ================================================================== */

    let builtinExact = new Map();
    let builtinLower = new Map();
    let customExact = new Map();
    let customLower = new Map();

    function normalize(value) {
        return String(value == null ? '' : value)
            .replace(/\u00a0/g, ' ')
            .replace(/[\u2018\u2019]/g, '\'')
            .replace(/[\u201c\u201d]/g, '"')
            .replace(/\u2026/g, '...')
            .replace(/\s+/g, ' ')
            .trim();
    }

    // 英文和俄文界面都支持
    const LETTER_RE = /[A-Za-z\u0400-\u04FF]/;

    function parseCustom(text) {
        const map = new Map();
        String(text == null ? '' : text).split(/\r?\n/).forEach(function (line) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.charAt(0) === '#') return;
            const index = trimmed.indexOf('=');
            if (index <= 0) return;
            const source = normalize(trimmed.slice(0, index));
            const target = trimmed.slice(index + 1).trim();
            if (source && target) map.set(source, target);
        });
        return map;
    }

    function rebuildDictionaries() {
        builtinExact = new Map();
        builtinLower = new Map();

        Object.keys(BUILTIN).forEach(function (key) {
            const source = normalize(key);
            const target = BUILTIN[key];
            if (!source || !target) return;
            if (!builtinExact.has(source)) builtinExact.set(source, target);
            const lowerKey = source.toLowerCase();
            if (!builtinLower.has(lowerKey)) builtinLower.set(lowerKey, target);
        });

        let stored = '';
        try {
            stored = GM_getValue(CUSTOM_KEY, '');
        } catch (e) {
            stored = '';
        }

        customExact = new Map();
        customLower = new Map();
        parseCustom(stored).forEach(function (target, source) {
            customExact.set(source, target);
            customLower.set(source.toLowerCase(), target);
        });
    }

    function lookup(text) {
        if (!text) return null;
        const key = normalize(text);
        if (!key) return null;
        const lowerKey = key.toLowerCase();
        return customExact.get(key) ||
            customLower.get(lowerKey) ||
            builtinExact.get(key) ||
            builtinLower.get(lowerKey) ||
            null;
    }

    /* ================================================================== *
     * 动态文本规则
     * ================================================================== */

    const MONTHS = {
        jan: 1, january: 1,
        feb: 2, february: 2,
        mar: 3, march: 3,
        apr: 4, april: 4,
        may: 5,
        jun: 6, june: 6,
        jul: 7, july: 7,
        aug: 8, august: 8,
        sep: 9, sept: 9, september: 9,
        oct: 10, october: 10,
        nov: 11, november: 11,
        dec: 12, december: 12
    };

    const MONTH_RE = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';

    const RU_MONTHS = {
        'января': 1, 'январь': 1,
        'февраля': 2, 'февраль': 2,
        'марта': 3, 'март': 3,
        'апреля': 4, 'апрель': 4,
        'мая': 5, 'май': 5,
        'июня': 6, 'июнь': 6,
        'июля': 7, 'июль': 7,
        'августа': 8, 'август': 8,
        'сентября': 9, 'сентябрь': 9,
        'октября': 10, 'октябрь': 10,
        'ноября': 11, 'ноябрь': 11,
        'декабря': 12, 'декабрь': 12
    };

    const RU_MONTH_RE = 'январ[ья]|феврал[ья]|марта|апрел[ья]|ма[йя]|июн[ья]|июл[ья]|августа|сентябр[ья]|октябр[ья]|ноябр[ья]|декабр[ья]';

    function formatChineseDate(month, day, year) {
        const suffix = (year ? year + '年' : '') + Number(month) + '月' + Number(day) + '日';
        return suffix;
    }

    function formatClock(hour, minute, ampm) {
        const prefix = ampm ? (String(ampm).toUpperCase() === 'AM' ? '上午 ' : '下午 ') : '';
        return prefix + Number(hour) + ':' + String(minute).padStart(2, '0');
    }

    function translatePart(text) {
        const translated = lookup(text);
        return translated || text;
    }

    const PATTERNS = [
        /* 数量 */
        [/^(\d+)\s+new\s+messages?$/i, function (m) { return m[1] + ' 封新邮件'; }],
        [/^(\d+)\s+unread\s+messages?$/i, function (m) { return m[1] + ' 封未读邮件'; }],
        [/^(\d+)\s+unread$/i, function (m) { return m[1] + ' 封未读'; }],
        [/^(\d+)\s+new$/i, function (m) { return m[1] + ' 封新邮件'; }],
        [/^(\d+)\s+selected$/i, function (m) { return '已选 ' + m[1] + ' 项'; }],
        [/^(\d+)\s+of\s+(\d+)\s+selected$/i, function (m) { return '已选 ' + m[1] + ' / ' + m[2] + ' 项'; }],
        [/^select all\s+(\d+)$/i, function (m) { return '全选 ' + m[1] + ' 封'; }],
        [/^(\d+)\s+conversations?$/i, function (m) { return m[1] + ' 个会话'; }],
        [/^(\d+)\s+attachments?$/i, function (m) { return m[1] + ' 个附件'; }],
        [/^(\d+)\s+files?$/i, function (m) { return m[1] + ' 个文件'; }],
        [/^(\d+)\s+recipients?$/i, function (m) { return m[1] + ' 位收件人'; }],
        [/^(\d+)\s+results?$/i, function (m) { return m[1] + ' 个结果'; }],
        [/^(\d+)\s+folders?$/i, function (m) { return m[1] + ' 个文件夹'; }],
        [/^(\d+)\s+labels?$/i, function (m) { return m[1] + ' 个标签'; }],
        [/^(\d+)\s+messages?$/i, function (m) { return m[1] + ' 封邮件'; }],
        [/^(\d+)\s+days?$/i, function (m) { return m[1] + ' 天'; }],
        [/^(\d+)\s+hours?$/i, function (m) { return m[1] + ' 小时'; }],
        [/^(\d+)\s+minutes?$/i, function (m) { return m[1] + ' 分钟'; }],
        [/^(\d+)\s+seconds?$/i, function (m) { return m[1] + ' 秒'; }],
        [/^show\s+(\d+)\s+more$/i, function (m) { return '再显示 ' + m[1] + ' 项'; }],
        [/^and\s+(\d+)\s+more$/i, function (m) { return '以及另外 ' + m[1] + ' 项'; }],
        [/^\+?\s*(\d+)\s+more$/i, function (m) { return '还有 ' + m[1] + ' 项'; }],

        /* 分页 */
        [/^([\d,]+)\s*[\u2013\u2014-]\s*([\d,]+)\s+of\s+([\d,]+)$/i, function (m) {
            return m[1] + '\u2013' + m[2] + '，共 ' + m[3];
        }],
        [/^page\s+(\d+)\s+of\s+(\d+)$/i, function (m) { return '第 ' + m[1] + ' 页，共 ' + m[2] + ' 页'; }],
        [/^(\d+)\s+of\s+(\d+)$/i, function (m) { return m[1] + ' / ' + m[2]; }],

        /* 相对时间 */
        [/^a\s+few\s+seconds\s+ago$/i, function () { return '几秒前'; }],
        [/^(\d+)\s+seconds?\s+ago$/i, function (m) { return m[1] + ' 秒前'; }],
        [/^an?\s+minute\s+ago$/i, function () { return '1 分钟前'; }],
        [/^(\d+)\s+minutes?\s+ago$/i, function (m) { return m[1] + ' 分钟前'; }],
        [/^an?\s+hour\s+ago$/i, function () { return '1 小时前'; }],
        [/^(\d+)\s+hours?\s+ago$/i, function (m) { return m[1] + ' 小时前'; }],
        [/^an?\s+day\s+ago$/i, function () { return '1 天前'; }],
        [/^(\d+)\s+days?\s+ago$/i, function (m) { return m[1] + ' 天前'; }],
        [/^(\d+)\s+weeks?\s+ago$/i, function (m) { return m[1] + ' 周前'; }],
        [/^(\d+)\s+months?\s+ago$/i, function (m) { return m[1] + ' 个月前'; }],
        [/^(\d+)\s+years?\s+ago$/i, function (m) { return m[1] + ' 年前'; }],
        [/^in\s+an?\s+minute$/i, function () { return '1 分钟后'; }],
        [/^in\s+a\s+few\s+minutes$/i, function () { return '几分钟后'; }],
        [/^in\s+(\d+)\s+minutes?$/i, function (m) { return m[1] + ' 分钟后'; }],
        [/^in\s+an?\s+hour$/i, function () { return '1 小时后'; }],
        [/^in\s+(\d+)\s+hours?$/i, function (m) { return m[1] + ' 小时后'; }],
        [/^in\s+(\d+)\s+days?$/i, function (m) { return m[1] + ' 天后'; }],
        [/^expires?\s+in\s+(\d+)\s+days?$/i, function (m) { return m[1] + ' 天后过期'; }],
        [/^(\d+)\s+days?\s+left$/i, function (m) { return '剩余 ' + m[1] + ' 天'; }],
        [/^(\d+)\s+hours?\s+left$/i, function (m) { return '剩余 ' + m[1] + ' 小时'; }],
        [/^(\d+)\s+minutes?\s+left$/i, function (m) { return '剩余 ' + m[1] + ' 分钟'; }],

        /* 时间与日期 */
        [/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i, function (m) {
            return formatClock(m[1], m[2], m[3]);
        }],
        [/^(today|yesterday|tomorrow)(?:,|\s+at)?\s+(\d{1,2}:\d{2}(?:\s*(?:AM|PM))?)$/i, function (m) {
            return translatePart(m[1].toLowerCase() === 'today' ? 'Today' :
                m[1].toLowerCase() === 'yesterday' ? 'Yesterday' : 'Tomorrow') +
                ' ' + translateTimeToken(m[2]);
        }],
        [/^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:,?\s*(\d{4}))?$/i, function (m) {
            return formatChineseDate(MONTHS[m[1].toLowerCase()], m[2], m[3]);
        }],
        [/^(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+(\d{4}))?$/i, function (m) {
            return formatChineseDate(MONTHS[m[2].toLowerCase()], m[1], m[3]);
        }],
        [/^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i, function (m) {
            return formatChineseDate(MONTHS[m[1].toLowerCase()], m[2]) + ' ' + formatClock(m[3], m[4], m[5]);
        }],
        [/^(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{4})(?:\s+at\s+(\d{1,2}):(\d{2})(?:\s*(AM|PM))?)?$/i, function (m) {
            const date = formatChineseDate(MONTHS[m[2].toLowerCase()], m[1], m[3]);
            return m[4] ? date + ' ' + formatClock(m[4], m[5], m[6]) : date;
        }],

        /* 未读/文件夹 */
        [/^(\d+)\s+unread\s+in\s+(.+)$/i, function (m) {
            return translatePart(m[2]) + '中有 ' + m[1] + ' 封未读';
        }],
        [/^unread\s+in\s+(.+)$/i, function (m) {
            return translatePart(m[1]) + '中有未读邮件';
        }],

        /* 存储空间 */
        [/^([\d.,]+)\s*(KB|MB|GB|TB)\s+of\s+([\d.,]+)\s*(KB|MB|GB|TB)$/i, function (m) {
            return '已用 ' + m[1] + ' ' + m[2] + ' / 共 ' + m[3] + ' ' + m[4];
        }],
        [/^([\d.,]+)\s*(KB|MB|GB|TB)\s+of\s+([\d.,]+)\s*(KB|MB|GB|TB)\s+used$/i, function (m) {
            return '已用 ' + m[1] + ' ' + m[2] + ' / 共 ' + m[3] + ' ' + m[4];
        }],
        [/^([\d.,]+)\s*(KB|MB|GB|TB)\s+used$/i, function (m) { return '已用 ' + m[1] + ' ' + m[2]; }],
        [/^([\d.,]+)\s*(KB|MB|GB|TB)\s+free$/i, function (m) { return '可用 ' + m[1] + ' ' + m[2]; }],
        [/^([\d.,]+)\s*%\s+used$/i, function (m) { return '已用 ' + m[1] + '%'; }],

        /* 无障碍标签：文件夹 / 筛选器 */
        [/^(?:(selected),\s*)?(.+?),\s*folder(?:,\s*(\d+)\s+messages?)?$/i, function (m) {
            const prefix = m[1] ? '已选择，' : '';
            const name = translatePart(m[2]);
            return prefix + name + '，文件夹' + (m[3] ? '，' + m[3] + ' 封邮件' : '');
        }],
        [/^(?:(selected),\s*)?(.+?),\s*filter(?:,\s*(\d+)\s+messages?)?$/i, function (m) {
            const prefix = m[1] ? '已选择，' : '';
            const name = translatePart(m[2]);
            return prefix + name + '，筛选器' + (m[3] ? '，' + m[3] + ' 封邮件' : '');
        }],
        [/^upgrade plan(?:,\s*(.+))?$/i, function (m) {
            return '升级套餐' + (m[1] ? '，' + m[1] : '');
        }],

        /* 确认框 */
        [/^are you sure you want to delete (.+)\?$/i, function (m) { return '确定要删除' + m[1] + '吗？'; }],
        [/^delete\s+"(.+)"\?$/i, function (m) { return '删除“' + m[1] + '”？'; }],
        [/^delete\s+(.+)\?$/i, function (m) { return '删除' + m[1] + '？'; }],
        [/^delete\s+(\d+)\s+messages?\?$/i, function (m) { return '删除 ' + m[1] + ' 封邮件？'; }],
        [/^move\s+"(.+)"\s+to\s+trash\?$/i, function (m) { return '将“' + m[1] + '”移到已删除？'; }],
        [/^mark\s+(\d+)\s+messages?\s+as\s+read\?$/i, function (m) { return '将 ' + m[1] + ' 封邮件标为已读？'; }],
        [/^mark\s+(\d+)\s+messages?\s+as\s+unread\?$/i, function (m) { return '将 ' + m[1] + ' 封邮件标为未读？'; }],
        [/^empty\s+(.+)\?$/i, function (m) { return '清空' + translatePart(m[1]) + '？'; }],

        /* 标题与发件人入口 */
        [/^message\s+[\u201c"](.+)[\u201d"]$/i, function (m) { return '邮件“' + m[1] + '”'; }],
        [/^(?:сообщение|письмо)\s+[\u00ab"](.+)[\u00bb"]$/i, function (m) { return '邮件“' + m[1] + '”'; }],
        [/^emails from (.+)$/i, function (m) { return '来自 ' + translatePart(m[1]) + ' 的邮件'; }],

        /* 登录页动态文案 */
        [/^to log in to (.+) account$/i, function (m) { return '登录 ' + m[1] + ' 账户'; }],
        [/^to log in to your account$/i, function () { return '登录你的账户'; }],
        [/^a message with a link will be sent to (.+)\.$/i, function (m) {
            return '将向 ' + m[1] + ' 发送一封包含登录链接的邮件。';
        }],
        [/^we sent a link to (.+)\.$/i, function (m) { return '我们已向 ' + m[1] + ' 发送登录链接。'; }],
        [/^open it on any device\.?$/i, function () { return '在任意设备上打开。'; }],
        [/^the link will expire in (\d+) minutes?\.?$/i, function (m) { return '链接将在 ' + m[1] + ' 分钟后失效。'; }],

        /* 俄语界面 */
        [/^(\d{1,2})\s+(январ[ья]|феврал[ья]|марта|апрел[ья]|ма[йя]|июн[ья]|июл[ья]|августа|сентябр[ья]|октябр[ья]|ноябр[ья]|декабр[ья])(?:\s+(\d{4})(?:\s*г\.)?)?(?:\s+в\s+(\d{1,2}):(\d{2}))?$/i, function (m) {
            const date = formatChineseDate(RU_MONTHS[m[2].toLowerCase()], m[1], m[3]);
            return m[4] ? date + ' ' + formatClock(m[4], m[5]) : date;
        }],
        [/^(сегодня|вчера)(?:,?\s*в\s+)?(\d{1,2}:\d{2})$/i, function (m) {
            return (m[1].toLowerCase() === 'сегодня' ? '今天' : '昨天') + ' ' + m[2];
        }],
        [/^занято\s+([\d.,]+)\s*(КБ|МБ|ГБ|ТБ)\s+из\s+([\d.,]+)\s*(КБ|МБ|ГБ|ТБ)$/i, function (m) {
            return '已用 ' + m[1] + ' ' + m[2] + ' / 共 ' + m[3] + ' ' + m[4];
        }],
        [/^(?:Выбрано,\s*)?(.+?),\s*папка(?:,\s*(\d+)\s+пис[а-я]*)?$/i, function (m) {
            return (m[0].toLowerCase().indexOf('выбрано') === 0 ? '已选择，' : '') +
                translatePart(m[1]) + '，文件夹' + (m[2] ? '，' + m[2] + ' 封邮件' : '');
        }],
        [/^(\d+)\s+пис[а-я]*$/i, function (m) { return m[1] + ' 封邮件'; }],
        [/^(\d+)\s+непрочитанн[а-я]*$/i, function (m) { return m[1] + ' 封未读'; }],
        [/^(\d+)\s+нов[а-я]*$/i, function (m) { return m[1] + ' 封新邮件'; }],
        [/^(\d+)\s+вложени[а-я]*$/i, function (m) { return m[1] + ' 个附件'; }]
    ];

    function translateTimeToken(text) {
        const value = normalize(text);
        const match = value.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
        if (!match) return value;
        return formatClock(match[1], match[2], match[3]);
    }

    /* ================================================================== *
     * 文本翻译
     * ================================================================== */

    const untranslated = new Map();

    function collectUntranslated(text) {
        if (untranslated.size >= 400) return;
        if (text.length < 2 || text.length > 90) return;
        if (!/^[A-Za-z]/.test(text)) return;
        if (!/^[A-Za-z0-9 .,'&/()\u2013\u2014:!?%+\-]+$/.test(text)) return;
        untranslated.set(text, (untranslated.get(text) || 0) + 1);
    }

    function isLikelyUserData(text) {
        if (/https?:\/\//i.test(text)) return true;
        if (text.length > 400) return true;
        return false;
    }

    function translateCore(raw) {
        const text = normalize(raw);
        if (!text || !LETTER_RE.test(text)) return raw;
        if (isLikelyUserData(text)) return raw;

        let hit = lookup(text);
        if (hit) return hit;

        // "From:" / "Subject:" 这类带冒号的标签
        if (/[:：]$/.test(text)) {
            const base = text.slice(0, -1).trim();
            hit = lookup(base);
            if (hit) return hit + '：';
        }

        // "Inbox (5)" 这类带数量的文案
        const paren = text.match(/^(.+?)\s*\((\d+)\)$/);
        if (paren) {
            hit = lookup(paren[1]);
            if (hit) return hit + '（' + paren[2] + '）';
        }

        for (let i = 0; i < PATTERNS.length; i++) {
            const match = text.match(PATTERNS[i][0]);
            if (match) {
                try {
                    return PATTERNS[i][1](match, text);
                } catch (e) {
                    return raw;
                }
            }
        }

        collectUntranslated(text);
        return raw;
    }

    function translateText(raw) {
        if (!raw || !LETTER_RE.test(raw)) return raw;

        const leading = raw.match(/^\s*/)[0];
        const trailing = raw.match(/\s*$/)[0];
        const end = raw.length - trailing.length;
        if (end <= leading.length) return raw;

        const core = raw.slice(leading.length, end);
        const translated = translateCore(core);
        if (translated === core) return raw;
        return leading + translated + trailing;
    }

    function translateAttributeValue(value) {
        if (!value || !LETTER_RE.test(value)) return value;
        return String(value).split('\n').map(function (line) {
            return translateText(line);
        }).join('\n');
    }

    /* ================================================================== *
     * DOM 处理
     * ================================================================== */

    // 邮件主题、正文和用户输入区不翻译，避免改动用户内容。
    const EXCLUDE_SELECTOR = [
        'script', 'style', 'noscript', 'template', 'link', 'meta',
        'code', 'pre', 'kbd', 'samp',
        'iframe', 'object', 'embed', 'canvas', 'audio', 'video', 'svg',
        '[contenteditable="true"]', '[contenteditable=""]', '[role="textbox"]',
        '[role="article"]',
        '[data-ytm-ignore]',

        // 邮件正文与阅读窗格正文
        '[class*="MessageBody" i]', '[class*="message-body" i]', '[class*="messageBody" i]',
        '[class*="MessageText" i]', '[class*="message-text" i]',
        '[class*="MessageViewerLayout__body" i]', '[class*="MessageViewerLayoutAdapter__body" i]',
        '[class*="js-message-body" i]', '[class*="react-message-wrapper__body" i]',

        // 邮件列表中的用户内容
        '[class*="MessageSnippet" i]', '[class*="message-snippet" i]',
        '[class*="MessagesList-Item" i]', '[class*="MessageList-Item" i]',
        '[class*="message-list-item" i]',
        '[class*="MessageListItem__subject" i]', '[class*="MessageListItem__name" i]',
        '[class*="MessageListItem__firstline" i]', '[class*="MessageListItem__textWrap" i]',

        // 发件人、收件人与主题
        '[class*="SenderName" i]', '[class*="Sender__" i]',
        '[class*="Firstline" i]', '[class*="ContactBadge_name" i]',
        '[class*="RecipientGroup" i]', '[class*="Recipient__wrapper" i]',
        '[class*="Subject__subject" i]', '[class*="Title__subject" i]',
        '[class*="MessageSubject" i]', '[class*="message-subject" i]', '[class*="messageSubject" i]',
        '[data-testid*="subject" i]', '[data-qa*="subject" i]', '.b-message-subject',

        // 测试属性与旧版 Yandex Mail
        '[data-testid*="message-body" i]', '[data-testid*="message-snippet" i]',
        '[data-qa*="message-body" i]', '[data-qa*="message-snippet" i]',
        '.mail-MessageBody', '.mail-MessageBody-html', '.b-message-body', '.b-message-head',
        '.mail-MessageSnippet', '.ns-view-messages-item', '.b-messages__message', '.js-message-snippet',
        '.mail-MessageViewer', '.mail-MessageViewer-Header', '.mail-MessageViewer-Body'
    ].join(',');

    // 这些元素的文字属于用户输入，但 placeholder / aria-label 等属性可以翻译
    const ATTR_ONLY_SELECTOR = 'input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"]';

    const TEXT_STATE = new WeakMap();
    const ATTR_STATE = new WeakMap();
    const OBSERVED_ROOTS = new WeakSet();

    function isExcludedElement(element) {
        if (!element || !element.matches) return false;
        try {
            return element.matches(EXCLUDE_SELECTOR);
        } catch (e) {
            return false;
        }
    }

    function isInExcluded(element) {
        if (!element || !element.closest) return false;
        try {
            return !!element.closest(EXCLUDE_SELECTOR);
        } catch (e) {
            return false;
        }
    }

    function translateTextNode(node) {
        if (!node || node.nodeType !== Node.TEXT_NODE || !node.isConnected) return;

        const parent = node.parentElement;
        if (!parent || isInExcluded(parent)) return;

        const current = node.nodeValue;
        if (!current || !LETTER_RE.test(current)) return;
        if (TEXT_STATE.get(node) === current) return;

        const next = translateText(current);
        if (next === current) {
            TEXT_STATE.set(node, current);
            return;
        }

        TEXT_STATE.set(node, next);
        node.nodeValue = next;
    }

    const ATTRIBUTE_NAMES = ['title', 'placeholder', 'aria-label', 'alt', 'value'];

    function translateElementAttributes(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE) return;

        for (let i = 0; i < ATTRIBUTE_NAMES.length; i++) {
            const name = ATTRIBUTE_NAMES[i];
            if (!element.hasAttribute(name)) continue;

            if (name === 'value') {
                const tag = element.tagName;
                const type = (element.getAttribute('type') || '').toLowerCase();
                if (tag !== 'INPUT' || !/^(button|submit|reset)$/.test(type)) continue;
            }

            const current = element.getAttribute(name);
            if (!current || !LETTER_RE.test(current)) continue;

            let state = ATTR_STATE.get(element);
            if (!state) {
                state = Object.create(null);
                ATTR_STATE.set(element, state);
            }
            if (state[name] === current) continue;

            const next = translateAttributeValue(current);
            if (next === current) {
                state[name] = current;
                continue;
            }

            state[name] = next;
            element.setAttribute(name, next);
        }
    }

    function processShadowRoot(shadowRoot) {
        if (!shadowRoot) return;
        observeRoot(shadowRoot);
        processSubtree(shadowRoot);
    }

    const TREE_FILTER = {
        acceptNode: function (node) {
            if (node.nodeType === Node.ELEMENT_NODE) {
                if (isExcludedElement(node)) {
                    // 输入框的 placeholder 不属于邮件内容，可以安全翻译
                    if (node.matches && node.matches(ATTR_ONLY_SELECTOR)) {
                        translateElementAttributes(node);
                    }
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
            if (node.nodeType === Node.TEXT_NODE) {
                return LETTER_RE.test(node.nodeValue || '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_REJECT;
        }
    };

    function processSubtree(root) {
        if (!root) return;

        if (root.nodeType === Node.TEXT_NODE) {
            translateTextNode(root);
            return;
        }

        if (root.nodeType !== Node.ELEMENT_NODE &&
            root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE &&
            root.nodeType !== Node.DOCUMENT_NODE) {
            return;
        }

        if (root.nodeType === Node.ELEMENT_NODE) {
            if (!root.isConnected) return;
            if (isInExcluded(root)) {
                if (root.matches && root.matches(ATTR_ONLY_SELECTOR)) {
                    translateElementAttributes(root);
                }
                return;
            }
            translateElementAttributes(root);
            if (root.shadowRoot) processShadowRoot(root.shadowRoot);
        }

        if (!root.querySelectorAll) return;

        const walker = document.createTreeWalker(
            root,
            NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
            TREE_FILTER
        );

        let node = walker.nextNode();
        while (node) {
            if (node.nodeType === Node.TEXT_NODE) {
                translateTextNode(node);
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                translateElementAttributes(node);
                if (node.shadowRoot) processShadowRoot(node.shadowRoot);
            }
            node = walker.nextNode();
        }
    }

    /* ================================================================== *
     * 标题
     * ================================================================== */

    function translateTitle() {
        const original = document.title;
        if (!original) return;

        let next = lookup(normalize(original));

        if (!next) {
            const parts = original.split(/(\s+[\u2014\u2013|]\s+)/);
            next = parts.map(function (part) {
                if (!part.trim()) return part;
                if (/^[\u2014\u2013|]$/.test(part.trim())) return part;

                const leading = part.match(/^\s*/)[0];
                const trailing = part.match(/\s*$/)[0];
                const core = part.slice(leading.length, part.length - trailing.length);
                const translated = translateCore(core);
                return leading + translated + trailing;
            }).join('');
        }

        if (next && next !== original) document.title = next;
    }

    /* ================================================================== *
     * 观察动态内容
     * ================================================================== */

    const observer = new MutationObserver(function (mutations) {
        let hasWork = false;

        for (let i = 0; i < mutations.length; i++) {
            const mutation = mutations[i];

            if (mutation.type === 'attributes') {
                if (mutation.target && mutation.target.isConnected) {
                    queue(mutation.target);
                    hasWork = true;
                }
                continue;
            }

            if (mutation.type === 'characterData') {
                if (mutation.target && mutation.target.isConnected) {
                    queue(mutation.target);
                    hasWork = true;
                }
                continue;
            }

            if (mutation.type === 'childList') {
                for (let j = 0; j < mutation.addedNodes.length; j++) {
                    const added = mutation.addedNodes[j];
                    if (!added) continue;
                    if (added.nodeType === Node.TEXT_NODE || added.nodeType === Node.ELEMENT_NODE) {
                        queue(added);
                        hasWork = true;
                    }
                }
            }
        }

        if (hasWork) scheduleFlush();
    });

    const pending = new Set();
    let scheduled = false;

    function queue(node) {
        if (!node) return;
        pending.add(node);
        scheduleFlush();
    }

    function scheduleFlush() {
        if (scheduled) return;
        scheduled = true;
        setTimeout(flush, 60);
    }

    function flush() {
        scheduled = false;
        const nodes = Array.from(pending);
        pending.clear();

        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            if (!node || !node.isConnected) continue;
            processSubtree(node);
        }

        translateTitle();
        scanAds();
    }

    const AD_IFRAME_RE = /(?:an\.yandex|ads\.yandex|awaps\.yandex|adfox|doubleclick|googlesyndication|adservice\.google|yandex\.ru\/an\/)/i;
    let lastAdScan = 0;

    function scanAds() {
        if (!readAdBlock()) return;

        const root = document.documentElement;
        if (root && !root.classList.contains(AD_ROOT_CLASS)) {
            root.classList.add(AD_ROOT_CLASS);
        }

        const now = Date.now();
        if (now - lastAdScan < 1200) return;
        lastAdScan = now;

        // 已知广告容器直接打标记，交给 CSS 隐藏
        document.querySelectorAll(
            '.DirectLine, .BannersBlock, #js-main-rtb, #js-messages-direct, ' +
            '[id^="js-main-rtb"], [id^="js-messages-direct"]'
        ).forEach(function (element) {
            element.setAttribute('data-ytm-ad', '');
        });

        // 处理 src 不固定、但来自广告网络的 iframe
        document.querySelectorAll('iframe').forEach(function (frame) {
            const src = frame.getAttribute('src') || '';
            if (!src || !AD_IFRAME_RE.test(src)) return;

            const box = frame.closest && frame.closest(
                '.DirectLine, .BannersBlock, [id^="js-main-rtb"], [id^="js-messages-direct"]'
            );

            // 没有已知广告容器时只隐藏 iframe 自己，避免误伤 body / #app
            const target = box || frame;
            if (target && target.setAttribute) target.setAttribute('data-ytm-ad', '');
        });
    }

    const OBSERVER_OPTIONS = {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['title', 'placeholder', 'aria-label', 'alt', 'value']
    };

    function observeRoot(root) {
        if (!root || OBSERVED_ROOTS.has(root)) return;
        OBSERVED_ROOTS.add(root);
        observer.observe(root, OBSERVER_OPTIONS);
    }

    /* ================================================================== *
     * 菜单
     * ================================================================== */

    function toggleTranslation() {
        const enabled = readEnabled();
        try {
            GM_setValue(ENABLED_KEY, !enabled);
        } catch (e) {
            alert('保存设置失败：' + e);
            return;
        }
        alert(enabled ? '已关闭界面翻译，页面将刷新。' : '已开启界面翻译，页面将刷新。');
        location.reload();
    }

    function addCustomEntry() {
        const source = prompt('要翻译的英文原文（需要和页面显示完全一致）：', '');
        if (source === null) return;
        const target = prompt('对应的中文译文：', '');
        if (target === null) return;

        const src = source.trim();
        const dst = target.trim();
        if (!src || !dst) {
            alert('原文和译文都不能为空。');
            return;
        }

        let current = '';
        try {
            current = String(GM_getValue(CUSTOM_KEY, '') || '').trim();
        } catch (e) {
            current = '';
        }

        const line = src + '=' + dst;
        try {
            GM_setValue(CUSTOM_KEY, current ? current + '\n' + line : line);
        } catch (e) {
            alert('保存失败：' + e);
            return;
        }

        alert('已保存。刷新页面后生效。');
    }

    function showCustomEntries() {
        let current = '';
        try {
            current = String(GM_getValue(CUSTOM_KEY, '') || '').trim();
        } catch (e) {
            current = '';
        }
        alert(current ? '当前自定义词条：\n\n' + current : '暂无自定义词条。');
    }

    function clearCustomEntries() {
        if (!confirm('确定要清空所有自定义词条吗？')) return;
        try {
            GM_setValue(CUSTOM_KEY, '');
        } catch (e) {
            alert('清空失败：' + e);
            return;
        }
        alert('已清空。刷新页面后生效。');
    }

    function showUntranslated() {
        if (untranslated.size === 0) {
            alert('暂时没有收集到未翻译的英文文本。');
            return;
        }

        const list = Array.from(untranslated.entries())
            .sort(function (a, b) { return b[1] - a[1]; })
            .map(function (entry) { return entry[0] + '  ×' + entry[1]; });

        console.log(LOG_PREFIX + ' 未翻译文本（' + list.length + ' 条）：\n' + list.join('\n'));
        alert('已在控制台输出 ' + list.length + ' 条未翻译文本。\n可以点击油猴图标 →「添加自定义词条」逐条补充。');
    }

    let started = false;

    function retranslate() {
        if (!started) return;
        processSubtree(document.body || document.documentElement);
        translateTitle();
        scanAds();
    }

    function toggleAdBlock() {
        const next = !readAdBlock();
        try {
            GM_setValue(ADBLOCK_KEY, next);
        } catch (e) {
            alert('保存广告屏蔽设置失败：' + e);
            return;
        }
        applyAdBlock();
        if (next) scanAds();
        alert(next ? '已开启广告屏蔽。' : '已关闭广告屏蔽。');
    }

    registerMenuSafe('开启 / 关闭界面翻译', toggleTranslation);
    registerMenuSafe('添加自定义词条', addCustomEntry);
    registerMenuSafe('查看自定义词条', showCustomEntries);
    registerMenuSafe('清空自定义词条', clearCustomEntries);
    registerMenuSafe('查看未翻译文本（控制台）', showUntranslated);
    registerMenuSafe('立即重新翻译页面', retranslate);
    registerMenuSafe('开启 / 关闭广告屏蔽', toggleAdBlock);

    /* ================================================================== *
     * 启动
     * ================================================================== */

    rebuildDictionaries();

    // Yandex Mail 是客户端渲染的 React 应用。等主界面渲染完成后再改 DOM，
    // 避免在 hydration 期间修改文本导致页面一直停在加载状态。
    function isAppReady() {
        if (!IS_MAIL_HOST) {
            return !!document.querySelector('form input, [class*="auth-layout"]');
        }
        return !!document.querySelector(
            '[class*="ComposeButton"], [class*="qa-ComposeButton"], ' +
            '[class*="qa-LeftColumn-MainButtons"], [class*="qa-MessagesList"], ' +
            '[class*="qa-MessageViewer"]'
        );
    }

    function startTranslation() {
        if (started) return;
        started = true;

        installAdBlockStyle();
        applyAdBlock();
        observeRoot(document.documentElement);
        processSubtree(document.body || document.documentElement);
        translateTitle();
        scanAds();

        // 首屏异步渲染的内容再补一遍
        setTimeout(function () {
            processSubtree(document.body || document.documentElement);
            translateTitle();
            scanAds();
        }, 600);

        console.log(LOG_PREFIX + ' 已启用（内置词条 ' + builtinExact.size + ' 条）');
    }

    function waitForApp() {
        let attempts = 0;
        const timer = setInterval(function () {
            attempts++;

            if (isAppReady()) {
                clearInterval(timer);
                // 再给 React 一点时间完成首屏渲染
                setTimeout(startTranslation, 800);
                return;
            }

            // 30 秒仍未识别到主界面时兜底启动，避免脚本完全不工作
            if (attempts >= 120) {
                clearInterval(timer);
                setTimeout(startTranslation, 300);
            }
        }, 250);
    }

    waitForApp();
})();
