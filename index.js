// Char Memory Bridge — SillyTavern <-> 你的角色 bot 共用一份记忆库。
//   1) 自动把远端共享记忆注入当前角色的上下文；
//   2) 角色自己写记忆：他在回复里写 [[MEM:一句话]]，自动存进共享库并隐藏；
//   3) （可选）从 Horae 导入剧情事件；
//   4) 面板里看/加/改/删记忆，全部同步同一个后端数据库。
// 通用工具：填上你的 bot 记忆 API 网址 + 密码即可，不绑定任何特定角色。

const MODULE = 'char_memory_bridge';

function ctx() {
    return (typeof SillyTavern !== 'undefined' && SillyTavern.getContext)
        ? SillyTavern.getContext() : null;
}

const DEFAULTS = {
    apiBase: '', token: '', autoInject: true, autoWrite: true,
    injectDepth: 4, header: '【跨平台共享记忆】',
};

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

// ===== 注入：共享记忆 + 记忆写入规则 =====
async function refreshInjection() {
    const s = settings();
    const c = ctx();
    if (!c || !s.apiBase) return;
    let block = '';
    if (s.autoInject && s.token) {
        try {
            const text = await apiGetText();
            if (text && text.indexOf('暂无记忆') < 0) block += (s.header || DEFAULTS.header) + '\n' + text + '\n\n';
        } catch (e) { console.warn('[MemBridge] 读取记忆失败：', e); }
    }
    if (s.autoWrite) {
        block += '【记忆写入】当你想长期记住某件事（你的经历、心情、你俩的约定、重要事实），'
            + '就在回复的最后另起一行写：[[MEM:一句话]]。它会被自动存进你俩的共享记忆库、不会显示给她。'
            + '用名字第三人称写、别用你我她。只记真正值得的，别滥用。';
    }
    try {
        const pos = (c.extensionPromptTypes && c.extensionPromptTypes.IN_CHAT != null) ? c.extensionPromptTypes.IN_CHAT : 1;
        c.setExtensionPrompt(MODULE, block, pos, Number(s.injectDepth) || 4);
    } catch (e) { console.warn('[MemBridge] 注入失败：', e); }
}

// ===== 角色自己写记忆：扫描 [[MEM:...]] =====
const MEM_RE = /\[\[MEM:([^\]]+?)\]\]/g;
async function onAiMessage(id) {
    try {
        const s = settings();
        if (!s.autoWrite || !s.apiBase || !s.token) return;
        const c = ctx();
        if (!c || !Array.isArray(c.chat)) return;
        const idx = (id != null && c.chat[id]) ? id : c.chat.length - 1;
        const msg = c.chat[idx];
        if (!msg || msg.is_user) return;
        const text = String(msg.mes || '');
        const found = [];
        let m;
        MEM_RE.lastIndex = 0;
        while ((m = MEM_RE.exec(text)) !== null) { const t = m[1].trim(); if (t) found.push(t); }
        if (!found.length) return;
        let ok = 0;
        for (const mem of found) { if (await apiAdd(mem)) ok++; }
        // 从显示里抹掉标记
        const cleaned = text.replace(/\n?\s*\[\[MEM:[^\]]+?\]\]/g, '').trim();
        if (cleaned !== text) {
            msg.mes = cleaned;
            try { if (typeof c.updateMessageBlock === 'function') c.updateMessageBlock(idx, msg); } catch (e) {}
            try { if (typeof c.saveChat === 'function') await c.saveChat(); } catch (e) {}
        }
        if (ok) notify('白起记下了 ' + ok + ' 条记忆 🩷', 'success');
    } catch (e) { console.warn('[MemBridge] 记忆写入失败：', e); }
}

// ===== 从 Horae 导入（保底：绝不产出 [object Object]）=====
function asText(v) { return typeof v === 'string' ? v : (v == null ? '' : (() => { try { return JSON.stringify(v); } catch (e) { return ''; } })()); }
function formatHoraeEvent(ev) {
    if (ev == null) return '';
    if (typeof ev === 'string') return ev.trim();
    const ts = asText(ev.time || ev.timestamp || ev.date || ev.when || '');
    const cs = asText(ev.content || ev.text || ev.summary || ev.description || ev.title || ev.event || '');
    if (cs) return (ts ? '[' + ts + '] ' : '') + cs;
    return asText(ev);
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
                '<span class="cmb-text">' + escapeHtml(meta) + escapeHtml(it.note) + '</span>';
            const chk = document.createElement('input');
            chk.type = 'checkbox';
            chk.className = 'cmb-chk';
            chk.dataset.id = String(it.id);
            row.insertAdjacentElement('afterbegin', chk);
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
          <label style="display:flex;align-items:center;gap:6px">
            <input id="cmb_write" type="checkbox" ${s.autoWrite ? 'checked' : ''}> 允许角色自己写记忆（[[MEM:…]]）
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
          <div style="display:flex;gap:6px;margin-top:8px">
            <input id="cmb_new" class="text_pole" type="text" placeholder="手动新增一条记忆…" style="flex:1">
            <button id="cmb_add" class="menu_button">新增</button>
          </div>
          <div style="display:flex;gap:6px;margin-top:6px">
            <button id="cmb_selall" class="menu_button">全选</button>
            <button id="cmb_selnone" class="menu_button">取消全选</button>
            <button id="cmb_delsel" class="menu_button">删除选中</button>
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
    document.getElementById('cmb_auto').addEventListener('change', (e) => { settings().autoInject = e.target.checked; saveSettings(); refreshInjection(); });
    document.getElementById('cmb_write').addEventListener('change', (e) => { settings().autoWrite = e.target.checked; saveSettings(); refreshInjection(); });
    document.getElementById('cmb_depth').addEventListener('input', (e) => { settings().injectDepth = Number(e.target.value) || 4; saveSettings(); });
    document.getElementById('cmb_header').addEventListener('input', (e) => { settings().header = e.target.value; saveSettings(); });
    document.getElementById('cmb_test').addEventListener('click', async () => {
        try { const t = await apiGetText(); notify('连接成功，读到 ' + t.split('\n').filter(Boolean).length + ' 行', 'success'); }
        catch (e) { notify('连接失败：' + e, 'error'); }
    });
    document.getElementById('cmb_import').addEventListener('click', importFromHorae);
    document.getElementById('cmb_refresh').addEventListener('click', renderList);
    document.getElementById('cmb_add').addEventListener('click', addNew);
    document.getElementById('cmb_new').addEventListener('keydown', (e) => { if (e.key === 'Enter') addNew(); });
    document.getElementById('cmb_selall').addEventListener('click', () => {
        document.querySelectorAll('#cmb_list .cmb-chk').forEach((c) => { c.checked = true; });
    });
    document.getElementById('cmb_selnone').addEventListener('click', () => {
        document.querySelectorAll('#cmb_list .cmb-chk').forEach((c) => { c.checked = false; });
    });
    document.getElementById('cmb_delsel').addEventListener('click', deleteSelected);
}

async function addNew() {
    const inp = document.getElementById('cmb_new');
    if (!inp) return;
    const v = inp.value.trim();
    if (!v) { notify('先输入要记的内容', 'warning'); return; }
    if (await apiAdd(v)) { notify('已新增', 'success'); inp.value = ''; renderList(); }
    else notify('新增失败', 'error');
}

async function deleteSelected() {
    const ids = Array.from(document.querySelectorAll('#cmb_list .cmb-chk:checked'))
        .map((c) => Number(c.dataset.id)).filter(Boolean);
    if (!ids.length) { notify('没勾选任何一条', 'info'); return; }
    if (!window.confirm('确定删除选中的 ' + ids.length + ' 条记忆？')) return;
    let ok = 0;
    for (const id of ids) { if (await apiDelete(id)) ok++; }
    notify('已删除 ' + ok + ' 条', 'success');
    renderList();
}

// ===== 启动 =====
jQuery(async () => {
    try {
        buildPanel();
        const c = ctx();
        if (c && c.eventSource && c.eventTypes) {
            c.eventSource.on(c.eventTypes.GENERATION_STARTED || 'generation_started', refreshInjection);
            c.eventSource.on(c.eventTypes.MESSAGE_RECEIVED || 'message_received', onAiMessage);
        }
        await refreshInjection();
        console.log('[MemBridge] Char Memory Bridge 已加载');
    } catch (e) {
        console.error('[MemBridge] 加载失败：', e);
    }
});
