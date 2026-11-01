import './style.css';
import { createClient } from '@supabase/supabase-js';
import { DEFAULTS, FONTS, applyTheme } from './settings.js';
import { createChart, CrosshairMode } from 'lightweight-charts';

const cfg = window.SWAPFRAME_CONFIG || {};
const configured = !!cfg.SUPABASE_URL && !!cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_URL.startsWith('YOUR_') && !cfg.SUPABASE_ANON_KEY.startsWith('YOUR_');
const sb = configured ? createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
const app = document.getElementById('app');
const $ = (s, r = app) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let session = null, S = { ...DEFAULTS };
applyTheme(S);

function frame(body, tabs = true) {
  const t = (id, label) => `<a href="#/${id}" class="${(location.hash.replace('#/', '') || 'stats') === id ? 'on' : ''}">${label}</a>`;
  app.innerHTML = `<div class="wrap"><nav><span class="logo">SWAP<b>FRAME</b> <span class="pill">ADMIN</span></span>
   <div class="links">${session ? `<span style="color:var(--mute)">${esc(session.user.email)}</span><a href="#" id="lo">Sign out</a>` : ''}</div></nav>
   ${configured ? '' : `<div class="notice"><b>Backend not configured yet.</b> Put the same Supabase URL and anon key as the main site into <code>config.js</code>. See the README.</div>`}
   ${tabs && session ? `<div class="tabs">${t('stats', 'Statistics')}${t('users', 'Users')}${t('jobs', 'Jobs')}${t('settings', 'Site settings')}${t('content', 'Content')}${t('db', 'Database')}</div>` : ''}
   <div id="view">${body}</div><div class="err" id="err"></div></div>`;
  const lo = $('#lo'); if (lo) lo.onclick = async (e) => { e.preventDefault(); await sb.auth.signOut(); session = null; route(); };
}
const err = (m) => { const e = $('#err'); if (e) { e.className = 'err'; e.textContent = m || ''; } };
const ok = (m) => { const e = $('#err'); if (e) { e.className = 'err ok'; e.textContent = m; } };
async function fn(body) {
  const { data, error } = await sb.functions.invoke('admin', { body });
  if (error) { let m = error.message; try { m = (await error.context.json()).error || m; } catch {} throw new Error(m); }
  return data;
}

function signin(msg = '') {
  frame(`<form class="form card" id="f"><h2>Admin sign in</h2><p style="color:var(--mute);font-size:14px">Admin accounts only.</p>
   <label>Username or email</label><input type="text" id="em" required autocomplete="username"/><label>Password</label><input type="password" id="pw" required/>
   <p style="margin-top:18px"><button class="btn" ${configured ? '' : 'disabled'}>Sign in</button></p><div class="err" id="m">${esc(msg)}</div></form>`, false);
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    let email = $('#em').value.trim();
    if (!email.includes('@')) { const r = await sb.rpc('email_for_username', { u: email }); if (!r.data) { $('#m').textContent = r.error?.message || 'No account with that username.'; return; } email = r.data; }
    const { data, error } = await sb.auth.signInWithPassword({ email, password: $('#pw').value });
    if (error) { $('#m').textContent = error.message; return; }
    session = data.session; gate();
  };
}

async function gate() {
  if (!session) return signin();
  const { data } = await sb.from('profiles').select('role,banned').eq('id', session.user.id).maybeSingle();
  if (data?.role !== 'admin' || data?.banned) { await sb.auth.signOut(); session = null; return signin('Access denied: this account is not an admin.'); }
  route();
}

const TF = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1H': 3600, '4H': 14400, '1D': 86400, '1W': 604800, '1M': 2592000, 'All': 0 };
const TF_RANGE = { '1m': 1, '5m': 3, '15m': 7, '30m': 14, '1H': 30, '4H': 90, '1D': 365, '1W': 0, '1M': 0, 'All': 0 }; // days of history (0 = all)
const METRICS = [
  ['users', 'Total users', 'signups'], ['signups', 'Sign-ups', 'signups'], ['swaps', 'Swaps', 'swaps'],
  ['views', 'Page views', 'views'], ['active_users', 'Active users', 'active_users'], ['success', 'Success rate %', 'swaps'],
];
let chartState = { tf: '1D' };
async function stats() {
  frame(`<div class="stats" id="kpi">Loading…</div>
   <div class="card" style="margin-top:14px"><div class="row" style="align-items:center;flex-wrap:wrap;gap:8px">
    <select id="metric" style="max-width:220px">${METRICS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
    <div class="tfs">${Object.keys(TF).map((t) => `<button class="btn ghost sm tf" data-tf="${t}">${t}</button>`).join(' ')}</div></div>
    <div id="chart" style="height:420px;margin-top:12px"></div>
    <p style="color:var(--mute);font-size:12px">Candles: Total users = cumulative count (open at bucket start, close at end). Other metrics = count per bucket; open = previous bucket, close = this bucket, high/low = max/min. Volume bars = events in the bucket. Page views are self-hosted (page_views table), no third-party tracker.</p></div>`);
  // KPIs: totals + today / 7d / 30d with % change vs previous period
  const { data: day, error } = await sb.rpc('admin_bucket_stats', { bucket_seconds: 86400, since: new Date(Date.now() - 60 * 864e5).toISOString() });
  if (error) return err(error.message);
  const { data: tot } = await sb.rpc('admin_tables');
  const cnt = Object.fromEntries((tot || []).map((t) => [t.table_name, t.row_count]));
  const banned = (await sb.from('profiles').select('id', { count: 'exact', head: true }).eq('banned', true)).count ?? 0;
  const sumN = (k, from, to) => (day || []).filter((r) => { const a = (Date.now() - new Date(r.bucket)) / 864e5; return a >= from && a < to; })
    .reduce((x, r) => x + (k === 'swaps' ? r.swaps_ok + r.swaps_failed : r[k]), 0);
  const pct = (c, p) => p ? Math.round(((c - p) / p) * 100) : (c ? 100 : 0);
  const chg = (c, p) => { const v = pct(c, p); return `<span style="color:${v >= 0 ? '#26a69a' : '#ef5350'};font-size:12px">${v >= 0 ? '▲' : '▼'} ${Math.abs(v)}%</span>`; };
  const kp = (l, k, total) => `<div class="card"><b>${total ?? sumN(k, 0, 30)}</b>${l}<div style="font-size:12px;color:var(--mute);margin-top:6px">
    24h ${sumN(k, 0, 1)} ${chg(sumN(k, 0, 1), sumN(k, 1, 2))}<br/>7d ${sumN(k, 0, 7)} ${chg(sumN(k, 0, 7), sumN(k, 7, 14))}<br/>30d ${sumN(k, 0, 30)} ${chg(sumN(k, 0, 30), sumN(k, 30, 60))}</div></div>`;
  const ok30 = sumN('swaps_ok', 0, 30), all30 = sumN('swaps', 0, 30);
  $('#kpi').innerHTML = kp('Users (sign-ups)', 'signups', cnt.profiles) + kp('Swaps', 'swaps', cnt.jobs) + kp('Page views', 'views', cnt.page_views)
    + kp('Active users', 'active_users') + `<div class="card"><b>${all30 ? Math.round(100 * ok30 / all30) : 0}%</b>Success rate (30d)</div><div class="card"><b>${banned}</b>Banned users</div>`;
  const draw = async () => {
    const tf = chartState.tf, metric = $('#metric').value;
    app.querySelectorAll('.tf').forEach((b) => b.classList.toggle('on', b.dataset.tf === tf));
    const days = TF_RANGE[tf], sec = TF[tf] || 86400 * 7;
    const { data, error } = await sb.rpc('admin_bucket_stats', { bucket_seconds: sec, since: days ? new Date(Date.now() - days * 864e5).toISOString() : null });
    if (error) return err(error.message);
    const el = $('#chart'); el.innerHTML = '';
    // fill empty buckets between first event and now
    const map = new Map((data || []).map((r) => [Math.floor(new Date(r.bucket) / 1000), r]));
    const start = data?.length ? Math.floor(new Date(data[0].bucket) / 1000) : Math.floor(Date.now() / 1000 / sec) * sec;
    const end = Math.floor(Date.now() / 1000 / sec) * sec, rows = [];
    const step = Math.max(sec, Math.ceil((end - start) / 2000 / sec) * sec);
    for (let t = start; t <= end; t += step) { const r = map.get(t) || {}; rows.push({ t, signups: r.signups || 0, ok: r.swaps_ok || 0, fail: r.swaps_failed || 0, views: r.views || 0, active_users: r.active_users || 0 }); }
    const base = data?.[0]?.users_before ?? 0; let cum = base, prev = 0;
    const candles = [], vol = [];
    for (const r of rows) {
      let o, c, v;
      if (metric === 'users') { o = cum; cum += r.signups; c = cum; v = r.signups; }
      else {
        c = metric === 'swaps' ? r.ok + r.fail : metric === 'success' ? (r.ok + r.fail ? Math.round(100 * r.ok / (r.ok + r.fail)) : prev) : r[metric];
        o = prev; prev = c; v = metric === 'swaps' || metric === 'success' ? r.ok + r.fail : r[metric];
      }
      candles.push({ time: r.t, open: o, close: c, high: Math.max(o, c), low: Math.min(o, c) });
      vol.push({ time: r.t, value: v, color: c >= o ? 'rgba(38,166,154,.5)' : 'rgba(239,83,80,.5)' });
    }
    const ch = createChart(el, { autoSize: true, layout: { background: { color: 'transparent' }, textColor: '#a6a6a6' },
      grid: { vertLines: { color: 'rgba(255,255,255,.06)' }, horzLines: { color: 'rgba(255,255,255,.06)' } },
      crosshair: { mode: CrosshairMode.Normal }, rightPriceScale: { borderColor: 'rgba(255,255,255,.16)' },
      timeScale: { borderColor: 'rgba(255,255,255,.16)', timeVisible: sec < 86400, secondsVisible: false } });
    const cs = ch.addCandlestickSeries({ upColor: '#26a69a', downColor: '#ef5350', borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350' });
    cs.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.3 } });
    const vs = ch.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: '' });
    vs.priceScale().applyOptions({ scaleMargins: { top: 0.75, bottom: 0 } });
    cs.setData(candles); vs.setData(vol); ch.timeScale().fitContent();
  };
  app.querySelectorAll('.tf').forEach((b) => b.onclick = () => { chartState.tf = b.dataset.tf; draw(); });
  $('#metric').onchange = draw; draw();
}

async function db() {
  frame(`<div class="card"><h3>Database (read-only)</h3><div id="tl">Loading…</div></div><div class="card" style="margin-top:14px"><h3 id="tn">Select a table</h3><div id="rows" style="overflow:auto"></div></div>`);
  const { data, error } = await sb.rpc('admin_tables'); if (error) return err(error.message);
  $('#tl').innerHTML = `<table><tr><th>Table</th><th>Rows</th><th></th></tr>${data.map((t) => `<tr><td>${esc(t.table_name)}</td><td>${t.row_count}</td><td><a href="#" data-t="${esc(t.table_name)}">View</a></td></tr>`).join('')}</table>`;
  const show = async (t, off = 0) => {
    const { data: r, error } = await sb.rpc('admin_table_rows', { t, lim: 50, off }); if (error) return err(error.message);
    const cols = [...new Set(r.flatMap((x) => Object.keys(x)))];
    const cell = (v) => esc(typeof v === 'object' && v !== null ? JSON.stringify(v) : v).slice(0, 300);
    $('#tn').textContent = `${t} — rows ${off + 1}–${off + r.length}`;
    $('#rows').innerHTML = (r.length ? `<table><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>${r.map((x) => `<tr>${cols.map((c) => `<td style="font-size:12px">${cell(x[c])}</td>`).join('')}</tr>`).join('')}</table>` : 'No rows.')
      + `<p>${off ? '<button class="btn ghost sm" id="pv">← Prev</button>' : ''} ${r.length === 50 ? '<button class="btn ghost sm" id="nx">Next →</button>' : ''}</p>`;
    const pv = $('#pv'), nx = $('#nx'); if (pv) pv.onclick = () => show(t, Math.max(0, off - 50)); if (nx) nx.onclick = () => show(t, off + 50);
  };
  $('#tl').querySelectorAll('[data-t]').forEach((a) => a.onclick = (e) => { e.preventDefault(); show(a.dataset.t); });
}

async function users() {
  frame(`<div class="card"><div class="row"><input type="text" id="q" placeholder="Search username or email…"/><span></span></div><div id="ul" style="margin-top:12px">Loading…</div></div>`);
  const load = async () => {
    const q = $('#q').value.trim();
    const res = await sb.rpc('admin_users'); if (res.error) return err(res.error.message);
    const ql = q.toLowerCase(); const data = res.data.filter((u) => !ql || [u.username, u.email, u.full_name].some((x) => (x || '').toLowerCase().includes(ql)));
    const dt = (d) => d ? esc(new Date(d).toLocaleString()) : '—';
    $('#ul').innerHTML = data.length ? `<table><tr><th>Username</th><th>Email</th><th>Name</th><th>Role</th><th>Used</th><th>Confirmed</th><th>Created</th><th>Last sign-in</th><th>Banned</th><th></th></tr>${data.map((u) => `<tr data-id="${u.id}">
      <td><input type="text" data-f="username" value="${esc(u.username)}" style="min-width:110px"/></td><td><input type="text" data-f="email" value="${esc(u.email)}"/></td><td><input type="text" data-f="full_name" value="${esc(u.full_name)}"/></td>
      <td><select data-f="role"><option ${u.role === 'user' ? 'selected' : ''}>user</option><option ${u.role === 'admin' ? 'selected' : ''}>admin</option></select></td>
      <td>${u.usage_count}</td><td>${u.confirmed_at ? '✓' : '✗'}</td><td style="font-size:12px">${dt(u.created_at)}</td><td style="font-size:12px">${dt(u.last_sign_in_at)}</td>
      <td><input type="checkbox" data-f="banned" ${u.banned ? 'checked' : ''}/></td>
      <td style="white-space:nowrap"><button class="btn sm" data-a="save">Save</button> <a class="btn ghost sm" href="#/jobs?u=${u.id}">Jobs</a>
      <button class="btn ghost sm" data-a="purge">Delete jobs</button> <button class="btn sm danger" data-a="del">Delete user</button></td></tr>`).join('')}</table>
      <p style="color:var(--mute);font-size:12px">Email here is the display copy in profiles; the login email is managed by Supabase Auth.</p>` : 'No users.';
    $('#ul').querySelectorAll('[data-a]').forEach((b) => b.onclick = async () => {
      const tr = b.closest('tr'), id = tr.dataset.id; err('');
      try {
        if (b.dataset.a === 'save') {
          const v = (f) => tr.querySelector(`[data-f=${f}]`);
          const { error } = await sb.from('profiles').update({ username: v('username').value.trim() || null, email: v('email').value, full_name: v('full_name').value || null, role: v('role').value, banned: v('banned').checked }).eq('id', id);
          if (error) throw error; ok('Saved.');
        } else if (b.dataset.a === 'purge') {
          if (!confirm('Delete ALL jobs and files for this user?')) return;
          const r = await fn({ action: 'delete_jobs', user_id: id }); ok(`Deleted ${r.deleted} jobs.`);
        } else if (b.dataset.a === 'del') {
          if (!confirm('Permanently delete this user, their jobs and files?')) return;
          await fn({ action: 'delete_user', user_id: id }); ok('User deleted.'); load();
        }
      } catch (e) { err(e.message); }
    });
  };
  let t; $('#q').oninput = () => { clearTimeout(t); t = setTimeout(load, 300); };
  load();
}

async function jobs() {
  const uid = new URLSearchParams(location.hash.split('?')[1] || '').get('u');
  frame(`<div class="card"><h3>${uid ? 'Jobs for user' : 'All jobs'} ${uid ? '<a href="#/jobs" class="sm">(show all)</a>' : ''}</h3><div id="jl">Loading…</div></div>`);
  let q = sb.from('jobs').select('*').order('created_at', { ascending: false }).limit(200);
  if (uid) q = q.eq('user_id', uid);
  const [{ data, error }, { data: profs }] = await Promise.all([q, sb.from('profiles').select('id,email')]);
  if (error) return err(error.message);
  const em = Object.fromEntries((profs || []).map((p) => [p.id, p.email]));
  const sign = async (b, p) => p ? (await sb.storage.from(b).createSignedUrl(p, 3600)).data?.signedUrl : null;
  const rows = await Promise.all(data.map(async (j) => {
    const [v, i, o] = await Promise.all([sign('uploads', j.video_path), sign('uploads', j.image_path), sign('results', j.output_path)]);
    const l = (u, t) => u ? (/\.mp4|video/.test(t) ? `<a href="${esc(u)}" target="_blank" rel="noopener">${t}</a>` : `<a href="${esc(u)}" target="_blank" rel="noopener" title="${t}"><img src="${esc(u)}" alt="${t}" style="width:64px;height:64px;object-fit:cover;border-radius:6px;vertical-align:middle"/></a>`) : '—';
    return `<tr data-id="${j.id}" data-u="${j.user_id}"><td>${esc(new Date(j.created_at).toLocaleString())}</td><td>${esc(em[j.user_id] || j.user_id)}</td>
     <td><span class="pill ${esc(j.status)}">${esc(j.status)}</span> ${esc(j.error || '')}</td><td>${l(v, /\.(mp4|mov|webm)$/i.test(j.video_path || '') ? 'video' : 'photo')} ${l(i, 'character')} → ${l(o, /\.mp4$/.test(j.output_path || '') ? 'video' : 'result')}</td>
     <td><button class="btn sm danger">Delete</button></td></tr>`;
  }));
  $('#jl').innerHTML = data.length ? `<table><tr><th>Created</th><th>User</th><th>Status</th><th>Photo · Character → Result</th><th></th></tr>${rows.join('')}</table>` : 'No jobs.';
  $('#jl').querySelectorAll('button').forEach((b) => b.onclick = async () => {
    const tr = b.closest('tr'); if (!confirm('Delete this job and its files?')) return;
    try { await fn({ action: 'delete_jobs', user_id: tr.dataset.u, job_ids: [tr.dataset.id] }); tr.remove(); ok('Job deleted.'); } catch (e) { err(e.message); }
  });
}

async function loadS() {
  const { data } = await sb.from('site_settings').select('data').eq('id', 1).maybeSingle();
  S = { ...DEFAULTS, ...(data?.data || {}) }; return S;
}
async function saveS(patch) {
  const next = { ...S, ...patch };
  const { error } = await sb.from('site_settings').update({ data: next, updated_at: new Date().toISOString() }).eq('id', 1);
  if (error) throw error; S = next; ok('Saved — live on the main site now.');
}

async function settings() {
  frame('Loading…'); await loadS();
  const txt = (k, l, type = 'text') => `<label>${l}</label><input type="${type}" id="s_${k}" value="${esc(S[k])}"/>`;
  const chk = (k, l) => `<label class="check" style="margin-top:14px"><input type="checkbox" id="s_${k}" ${S[k] ? 'checked' : ''}/><span>${l}</span></label>`;
  $('#view').innerHTML = `<div class="dash"><div class="card"><h3>Brand & theme</h3>${txt('site_name', 'Site name')}${txt('logo_url', 'Logo URL', 'url')}
   <label>Theme</label><select id="s_theme"><option ${S.theme === 'dark' ? 'selected' : ''}>dark</option><option ${S.theme === 'light' ? 'selected' : ''}>light</option></select>
   <div class="row"><div><label>Primary</label><input type="color" id="s_primary" value="${esc(S.primary)}"/></div><div><label>Accent</label><input type="color" id="s_accent" value="${esc(S.accent)}"/></div></div>
   <label>Font</label><select id="s_font">${Object.keys(FONTS).map((f) => `<option ${S.font === f ? 'selected' : ''}>${f}</option>`).join('')}</select>
   ${txt('background', 'Background (image URL or CSS background, blank = default)')}</div>
   <div class="card"><h3>Limits & toggles</h3><div class="row"><div>${txt('max_upload_mb', 'Max upload (MB)', 'number')}</div><div>${txt('daily_limit', 'Optional daily cap per user (0 = unlimited, default)', 'number')}</div></div>
   ${chk('signups_open', 'Sign-ups open')}${chk('maintenance_mode', 'Maintenance mode (pauses generation for non-admins)')}
   ${txt('announcement', 'Announcement banner (blank = hidden)')}
   <p style="color:var(--mute);font-size:12px">Photo uploads are capped at 15 MB by the uploads bucket (set in SQL); raise it in Supabase Storage if you go higher.</p></div></div>
   <p><button class="btn" id="save">Save settings</button></p>`;
  const g = (k) => $('#s_' + k);
  ['theme', 'primary', 'accent', 'font', 'background'].forEach((k) => g(k).addEventListener('input', () => applyTheme({ ...S, theme: g('theme').value, primary: g('primary').value, accent: g('accent').value, font: g('font').value, background: g('background').value })));
  $('#save').onclick = () => saveS({
    site_name: g('site_name').value || 'SwapFrame', logo_url: g('logo_url').value, theme: g('theme').value, primary: g('primary').value, accent: g('accent').value,
    font: g('font').value, background: g('background').value, max_upload_mb: Math.min(15, +g('max_upload_mb').value || 15), daily_limit: Math.max(0, +g('daily_limit').value || 0),
    signups_open: g('signups_open').checked,
    maintenance_mode: g('maintenance_mode').checked, announcement: g('announcement').value,
  }).catch((e) => err(e.message));
}

async function content() {
  frame('Loading…'); await loadS();
  const txt = (k, l) => `<label>${l}</label><input type="text" id="c_${k}" value="${esc(S[k])}"/>`;
  $('#view').innerHTML = `<div class="card"><h3>Landing page</h3>${txt('tagline', 'Tagline')}<div class="row"><div>${txt('hero_title', 'Hero title')}</div><div>${txt('hero_highlight', 'Hero highlight line')}</div></div>
   <label>Hero text</label><textarea id="c_hero_text">${esc(S.hero_text)}</textarea>${txt('cta_text', 'Button text')}
   <label>Sections — one per line: <code>Title | Text</code></label><textarea id="c_sections" style="min-height:110px">${esc((S.sections || []).map((s) => `${s.title} | ${s.text}`).join('\n'))}</textarea>
   <h3 style="margin-top:22px">Footer</h3>${txt('footer_text', 'Footer text')}
   <label>Footer links — one per line: <code>Label | https://url</code></label><textarea id="c_links">${esc((S.footer_links || []).map((l) => `${l.label} | ${l.url}`).join('\n'))}</textarea>
   <p><button class="btn" id="save">Save content</button></p></div>`;
  const pairs = (v, a, b) => v.split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((p) => p[0]).map(([x, ...y]) => ({ [a]: x, [b]: y.join('|') }));
  $('#save').onclick = () => saveS({
    tagline: $('#c_tagline').value, hero_title: $('#c_hero_title').value, hero_highlight: $('#c_hero_highlight').value, hero_text: $('#c_hero_text').value,
    cta_text: $('#c_cta_text').value, sections: pairs($('#c_sections').value, 'title', 'text'), footer_text: $('#c_footer_text').value,
    footer_links: pairs($('#c_links').value, 'label', 'url').filter((l) => /^https?:\/\//.test(l.url)),
  }).catch((e) => err(e.message));
}

function route() {
  if (!configured) return signin();
  if (!session) return signin();
  const r = location.hash.replace(/^#\/?/, '').split('?')[0];
  ({ users, jobs, settings, content, db }[r] || stats)().catch((e) => err(e.message));
}
window.addEventListener('hashchange', () => session && route());
(async () => {
  if (!sb) return signin();
  session = (await sb.auth.getSession()).data.session;
  gate();
})();
