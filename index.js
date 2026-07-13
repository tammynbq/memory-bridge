// Char Memory Bridge — SillyTavern <-> 你的角色 bot 共用一份记忆库。
//   1) 自动把远端共享记忆注入当前角色的上下文；
//   2) 一键从 Horae 导入剧情事件到共享库；
//   3) 面板里看/加/改/删记忆，全部同步同一个后端数据库。
// 通用工具：填上你的 bot 记忆 API 网址 + 密码即可，不绑定任何特定角色。

const MODULE = 'char_memory_bridge';

function ctx() {
    return (typeof SillyTavern !== 'undefined' && SillyTavern.getContext)
        ? SillyTavern.getContext() : null;
}

const DEFAULTS = { apiBase: '', token: '', autoInject: true, injectDepth: 4, header: '【跨平台共享记忆】' };

function settings() {
    const c = ctx();
    if (!c) return { ...DEFAULTS };
    c.extensionSettings[MODULE] = Object.assign({}, DEFAULTS, c.extensionSettings[MODULE] || {});
    return c.extensionSettings[MODULE];
}
function saveSettings() { try { ctx()?.saveSettingsDebounced?.(); } catch (e) {} }
function notify(msg, type = 'info') {
    try { window.toastr && window.toastr[type] ? window.toastr[type](msg) : console.log('[MemBridge]', msg); }
    catch (e) { console.log('[MemBridge]', msg); }
}

function apiUrl(path) {
    const b = (settings().apiBase || '').replace(/\/+$/, '');
    return b + path;
}
function tokenQS() { return 'token=' + encodeURIComponent(settings().token || ''); }

async function apiGetText() {
    const r = await fetch(apiUrl('/memories?' + tokenQS()));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
}
async function apiList() {
    const r = await fetch(apiUrl('/memories?json=1&' + tokenQS()));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    return j.memories || [];
}
async function apiAdd(content) {
    const r = await fetch(apiUrl('/memories?' + tokenQS()), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
    });
    return r.ok;
}
async function apiDelete(id) {
    const r = await fetch(apiUrl('/memories/' + id + '?' + tokenQS()), { method: 'DELETE' });
    return r.ok;
}
async function apiEdit(id, content) {
    const r = await fetch(apiUrl('/memories/' + id + '?' + tokenQS()), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
    });
    return r.ok;
}

// ===== 注入共享记忆到当前角色上下文 =====
async function refreshInjection() {
    const s = settings();
    const c = ctx();
    if (!c || !s.autoInject || !s.apiBase || !s.token) return;
    try {
        const text = await apiGetText();
        if (!text || text.indexOf('暂无记忆') >= 0) return;
        const block = (s.header || DEFAULTS.header) + '\n' + text;
        const posInChat = (c.extensionPromptTypes && c.extensionPromptTypes.IN_CHAT != null)
            ? c.extensionPromptTypes.IN_CHAT : 1;
        c.setExtensionPrompt(MODULE, block, posInChat, Number(s.injectDepth) || 4);
    } catch (e) {
        console.warn('[MemBridge] 注入失败：', e);
    }
}

// ===== 从 Horae 导入 =====
function formatHoraeEvent(ev) {
    if (ev == null) return '';
    if (typeof ev === 'string') return ev.trim();
    const t = ev.time || ev.timestamp || ev.date || ev.when || '';
    const c = ev.content || ev.text || ev.summary || ev.description || ev.title || ev.event || '';
    if (c) return (t ? '[' + t + '] ' : '') + c;
    try { return JSON.stringify(ev); } catch (e) { return ''; }
}
async function importFromHorae() {
    if (!window.Horae || typeof window.Horae.getEvents !== 'function') {
        notify('没检测到 Horae（确认 Horae 已启用）', 'warning');
        return;
    }
    let events = [];
    try { events = window.Horae.getEvents(30) || []; } catch (e) { console.warn(e); }
    if (!events.length) { notify('Horae 里暂时没有可导入的事件', 'info'); return; }
    let ok = 0;
    for (const ev of events) {
        const text = formatHoraeEvent(ev);
        if (text && text.length > 1) { if (await apiAdd(text)) ok++; }
    }
    notify('已从 Horae 导入 ' + ok + ' 条到共享库', 'success');
    renderList();
}

// ===== 列表面板 =====
async function renderList() {
    const box = document.getElementById('cmb_list');
    if (!box) return;
    box.innerHTML = '加载中…';
    try {
        const items = await apiList();
        if (!items.length) { box.innerHTML = '<i>（共享库暂无记忆）</i>'; return; }
        box.innerHTML = '';
        for (const it of items) {
            const row = document.createElement('div');
            row.className = 'cmb-row';
            const meta = (it.subject ? '[' + it.subject + '] ' : '') + (it.category ? '[' + it.category + '] ' : '');
            row.innerHTML =
                '<span class="cmb-date">' + escapeHtml(it.date || '') + '</span> ' +
                '<span class="cmb-text">' + meta + escapeHtml(it.note) + '</span>';
            const edit = document.createElement('button');
            edit.textContent = '改';
            edit.className = 'cmb-edit menu_button';
            edit.onclick = async () => {
                const nv = prompt('修改这条记忆：', it.note);
                if (nv && nv.trim()) {
                    if (await apiEdit(it.id, nv.trim())) { notify('已修改', 'success'); renderList(); }
                    else notify('修改失败', 'error');
                }
            };
            const del = document.createElement('button');
            del.textContent = '删';
            del.className = 'cmb-del menu_button';
            del.onclick = async () => {
                if (await apiDelete(it.id)) { notify('已删除', 'success'); renderList(); }
                else notify('删除失败', 'error');
            };
            row.appendChild(edit);
            row.appendChild(del);
            box.appendChild(row);
        }
    } catch (e) {
        box.innerHTML = '<span style="color:#e88">读取失败：' + escapeHtml(String(e)) + '</span>';
    }
}
function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ===== 设置面板 =====
function buildPanel() {
    const s = settings();
    const html = `
    <div class="cmb-settings">
      <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
          <b>Char Memory Bridge · 角色记忆桥接</b>
          <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
          <label>Bot 记忆 API 网址</label>
          <input id="cmb_api_base" class="text_pole" type="text" placeholder="https://your-bot.example.com" value="${escapeHtml(s.apiBase)}">
          <label>密码（token）</label>
          <input id="cmb_token" class="text_pole" type="password" value="${escapeHtml(s.token)}">
          <label style="display:flex;align-items:center;gap:6px;margin-top:6px">
            <input id="cmb_auto" type="checkbox" ${s.autoInject ? 'checked' : ''}> 自动把共享记忆注入角色上下文
          </label>
          <label>注入深度 depth</label>
          <input id="cmb_depth" class="text_pole" type="number" min="0" max="20" value="${Number(s.injectDepth) || 4}">
          <label>注入标题</label>
          <input id="cmb_header" class="text_pole" type="text" value="${escapeHtml(s.header || '')}">
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
            <button id="cmb_test" class="menu_button">测试连接</button>
            <button id="cmb_import" class="menu_button">从 Horae 导入</button>
            <button id="cmb_refresh" class="menu_button">刷新列表</button>
          </div>
          <div id="cmb_list" class="cmb-list"></div>
        </div>
      </div>
    </div>`;
    const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!host) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    host.appendChild(wrap);

    document.getElementById('cmb_api_base').addEventListener('input', (e) => { settings().apiBase = e.target.value.trim(); saveSettings(); });
    document.getElementById('cmb_token').addEventListener('input', (e) => { settings().token = e.target.value.trim(); saveSettings(); });
    document.getElementById('cmb_auto').addEventListener('change', (e) => { settings().autoInject = e.target.checked; saveSettings(); });
    document.getElementById('cmb_depth').addEventListener('input', (e) => { settings().injectDepth = Number(e.target.value) || 4; saveSettings(); });
    document.getElementById('cmb_header').addEventListener('input', (e) => { settings().header = e.target.value; saveSettings(); });
    document.getElementById('cmb_test').addEventListener('click', async () => {
        try { const t = await apiGetText(); notify('连接成功，读到 ' + t.split('\n').filter(Boolean).length + ' 行', 'success'); }
        catch (e) { notify('连接失败：' + e, 'error'); }
    });
    document.getElementById('cmb_import').addEventListener('click', importFromHorae);
    document.getElementById('cmb_refresh').addEventListener('click', renderList);
}

// ===== 启动 =====
jQuery(async () => {
    try {
        buildPanel();
        const c = ctx();
        if (c && c.eventSource && c.eventTypes) {
            const evt = c.eventTypes.GENERATION_STARTED || 'generation_started';
            c.eventSource.on(evt, refreshInjection);
        }
        await refreshInjection();
        console.log('[MemBridge] Char Memory Bridge 已加载');
    } catch (e) {
        console.error('[MemBridge] 加载失败：', e);
    }
});
