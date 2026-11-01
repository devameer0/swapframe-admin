import './style.css';
import { createClient } from '@supabase/supabase-js';
import { DEFAULTS, FONTS, applyTheme } from './settings.js';

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
   ${tabs && session ? `<div class="tabs">${t('stats', 'Stats')}${t('users', 'Users')}${t('jobs', 'Jobs')}${t('settings', 'Site settings')}${t('content', 'Content')}</div>` : ''}
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
   <label>Email</label><input type="email" id="em" required/><label>Password</label><input type="password" id="pw" required/>
   <p style="margin-top:18px"><button class="btn" ${configured ? '' : 'disabled'}>Sign in</button></p><div class="err" id="m">${esc(msg)}</div></form>`, false);
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const { data, error } = await sb.auth.signInWithPassword({ email: $('#em').value.trim(), password: $('#pw').value });
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

async function stats() {
  frame('Loading…');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const c = (q) => q.then((r) => r.count ?? 0);
  const [users, banned, jobs, jt, succ, fail, run] = await Promise.all([
    c(sb.from('profiles').select('id', { count: 'exact', head: true })),
    c(sb.from('profiles').select('id', { count: 'exact', head: true }).eq('banned', true)),
    c(sb.from('jobs').select('id', { count: 'exact', head: true })),
    c(sb.from('jobs').select('id', { count: 'exact', head: true }).gte('created_at', today.toISOString())),
    c(sb.from('jobs').select('id', { count: 'exact', head: true }).eq('status', 'succeeded')),
    c(sb.from('jobs').select('id', { count: 'exact', head: true }).eq('status', 'failed')),
    c(sb.from('jobs').select('id', { count: 'exact', head: true }).in('status', ['queued', 'starting', 'processing'])),
  ]);
  const box = (l, v) => `<div class="card"><b>${v}</b>${l}</div>`;
  $('#view').innerHTML = `<div class="stats">${box('Total users', users)}${box('Banned', banned)}${box('Total jobs', jobs)}${box('Jobs today', jt)}${box('Succeeded', succ)}${box('Failed', fail)}${box('In progress', run)}</div>`;
}

async function users() {
  frame(`<div class="card"><div class="row"><input type="text" id="q" placeholder="Search email or name…"/><span></span></div><div id="ul" style="margin-top:12px">Loading…</div></div>`);
  const load = async () => {
    const q = $('#q').value.trim();
    let r = sb.from('profiles').select('*').order('created_at', { ascending: false }).limit(200);
    if (q) r = r.or(`email.ilike.%${q.replace(/[%,()]/g, '')}%,full_name.ilike.%${q.replace(/[%,()]/g, '')}%`);
    const { data, error } = await r; if (error) return err(error.message);
    $('#ul').innerHTML = data.length ? `<table><tr><th>Email</th><th>Name</th><th>Role</th><th>Used</th><th>Banned</th><th></th></tr>${data.map((u) => `<tr data-id="${u.id}">
      <td><input type="text" data-f="email" value="${esc(u.email)}"/></td><td><input type="text" data-f="full_name" value="${esc(u.full_name)}"/></td>
      <td><select data-f="role"><option ${u.role === 'user' ? 'selected' : ''}>user</option><option ${u.role === 'admin' ? 'selected' : ''}>admin</option></select></td>
      <td>${u.usage_count}</td>
      <td><input type="checkbox" data-f="banned" ${u.banned ? 'checked' : ''}/></td>
      <td style="white-space:nowrap"><button class="btn sm" data-a="save">Save</button> <a class="btn ghost sm" href="#/jobs?u=${u.id}">Jobs</a>
      <button class="btn ghost sm" data-a="purge">Delete jobs</button> <button class="btn sm danger" data-a="del">Delete user</button></td></tr>`).join('')}</table>
      <p style="color:var(--mute);font-size:12px">Email here is the display copy in profiles; the login email is managed by Supabase Auth.</p>` : 'No users.';
    $('#ul').querySelectorAll('[data-a]').forEach((b) => b.onclick = async () => {
      const tr = b.closest('tr'), id = tr.dataset.id; err('');
      try {
        if (b.dataset.a === 'save') {
          const v = (f) => tr.querySelector(`[data-f=${f}]`);
          const { error } = await sb.from('profiles').update({ email: v('email').value, full_name: v('full_name').value || null, role: v('role').value, banned: v('banned').checked }).eq('id', id);
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
    const l = (u, t) => u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${t}</a>` : '—';
    return `<tr data-id="${j.id}" data-u="${j.user_id}"><td>${esc(new Date(j.created_at).toLocaleString())}</td><td>${esc(em[j.user_id] || j.user_id)}</td>
     <td><span class="pill ${esc(j.status)}">${esc(j.status)}</span> ${esc(j.error || '')}</td><td>${l(v, 'video')} · ${l(i, 'image')} · ${l(o, 'output')}</td>
     <td><button class="btn sm danger">Delete</button></td></tr>`;
  }));
  $('#jl').innerHTML = data.length ? `<table><tr><th>Created</th><th>User</th><th>Status</th><th>Files</th><th></th></tr>${rows.join('')}</table>` : 'No jobs.';
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
   <div class="row"><div>${txt('min_seconds', 'Min video length (s)', 'number')}</div><div>${txt('max_seconds', 'Max video length (s)', 'number')}</div></div>
   ${chk('signups_open', 'Sign-ups open')}${chk('maintenance_mode', 'Maintenance mode (pauses generation for non-admins)')}
   ${txt('announcement', 'Announcement banner (blank = hidden)')}
   <p style="color:var(--mute);font-size:12px">The uploads bucket's own size cap is 100 MB (set in SQL); raise it in Supabase Storage if you go higher.</p></div></div>
   <p><button class="btn" id="save">Save settings</button></p>`;
  const g = (k) => $('#s_' + k);
  ['theme', 'primary', 'accent', 'font', 'background'].forEach((k) => g(k).addEventListener('input', () => applyTheme({ ...S, theme: g('theme').value, primary: g('primary').value, accent: g('accent').value, font: g('font').value, background: g('background').value })));
  $('#save').onclick = () => saveS({
    site_name: g('site_name').value || 'SwapFrame', logo_url: g('logo_url').value, theme: g('theme').value, primary: g('primary').value, accent: g('accent').value,
    font: g('font').value, background: g('background').value, max_upload_mb: +g('max_upload_mb').value || 100, daily_limit: Math.max(0, +g('daily_limit').value || 0),
    min_seconds: +g('min_seconds').value || 10, max_seconds: +g('max_seconds').value || 30, signups_open: g('signups_open').checked,
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
  ({ users, jobs, settings, content }[r] || stats)().catch((e) => err(e.message));
}
window.addEventListener('hashchange', () => session && route());
(async () => {
  if (!sb) return signin();
  session = (await sb.auth.getSession()).data.session;
  gate();
})();
