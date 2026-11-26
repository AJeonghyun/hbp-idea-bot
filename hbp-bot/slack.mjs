import { setTimeout as delay } from 'node:timers/promises';

const labels = { script: '대본', image: '이미지', subtitle: '요약 자막', bgm: 'BGM', voice: '목소리 샘플', draft: '편집 초안' };
const plain = text => ({ type: 'plain_text', text });
const md = text => ({ type: 'mrkdwn', text });
const section = text => ({ type: 'section', text: md(text) });
const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const link = (url, title) => '<' + esc(url).replaceAll('|', '%7C') + '|' + title + '>';
const button = (text, action_id, value) => ({ type: 'button', text: plain(text), action_id, value: JSON.stringify(value) });
const field = (id, label, element, optional = false) => ({
  type: 'input', block_id: id, label: plain(label), element: { ...element, action_id: 'value' }, optional
});
const option = (name, value) => ({ text: plain(name), value });
const editText = properties => ({ type: 'plain_text_input', ...properties });
const modal = (id, title, metadata, blocks, submit) => ({
  type: 'modal', callback_id: id, title: plain(title), close: plain('닫기'),
  private_metadata: JSON.stringify(metadata), blocks, ...(submit && { submit: plain(submit) })
});
const kinds = Object.keys(labels);
const channelVars = {
  script: 'SCRIPT_CHANNEL_ID', image: 'IMAGE_CHANNEL_ID', subtitle: 'SCRIPT_CHANNEL_ID',
  bgm: 'MUSIC_CHANNEL_ID', voice: 'MUSIC_CHANNEL_ID', draft: 'DRAFT_CHANNEL_ID'
};
const dueFormat = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
});
const owners = (ep, kind) => kind === 'draft' ? ep.editor : kind === 'bgm' ? ep.musicOwner : ep.visualOwner;
const mentions = users => users.map(user => '<@' + user + '>').join(' ');
const available = (ep, kind, items) => kind === 'image' ? items.reduce((n, a) => n + a.count, 0) >= ep.target : items.length > 0;

function usageGuide() {
  const channel = (id, fallback) => id ? '<#' + id + '>' : fallback;
  const home = channel(process.env.HOME_CHANNEL_ID, '제작 채널');
  const scripts = channel(process.env.SCRIPT_CHANNEL_ID, '대본 채널');
  const images = channel(process.env.IMAGE_CHANNEL_ID, '이미지 채널');
  const music = channel(process.env.MUSIC_CHANNEL_ID, '음원 채널');
  const drafts = channel(process.env.DRAFT_CHANNEL_ID, '편집 초안 채널');
  return [
    '*HBP 제작봇 사용법*',
    '*1. 회차 카드 만들기*\n' + home + '에서 `/hbp 1화`를 입력하세요. 편집·자료·BGM 담당을 역할마다 한 명 이상 선택한 뒤 *카드 만들기*를 누르세요. 이미지 목표는 기본 35장이고, 자료 마감은 선택입니다. 같은 명령으로 카드를 다시 열 수 있어요.',
    '*2. 내 자료 등록하기*\n대본·요약 자막은 ' + scripts + ', 장면 이미지는 ' + images + ', BGM·목소리 샘플은 ' + music + ', 편집 초안은 ' + drafts + '에 올리세요. 원본 메시지의 *⋯ → 회차 자료로 등록*에서 회차와 자료 종류를 선택하세요. 이미 링크가 있으면 카드의 *자료 등록*을 이용하세요.',
    '*3. 편집자에게 넘기기*\n이미지는 묶음마다 장수를 입력해요. 예를 들어 30장에 새 묶음 5장을 더하면 *35/35장*이 됩니다. 목소리 샘플은 BGM과 따로 등록하세요. 대본·이미지·요약 자막·BGM이 모두 모이면 모든 편집자에게 DM이 갑니다.',
    '*4. 수신 확인하기*\n편집자는 카드의 *전체 자료*에서 링크를 열어 보고 항목별 *수신 확인*을 누르세요. 편집자 한 명이 확인하면 해당 항목의 인계가 완료됩니다. 마감이 지나면 미제출 항목이 있는 담당자에게 한 번 알려드립니다.',
    '팀과 함께 보려면 ' + home + '에 `사용법`을 보내세요. 혼자 확인하려면 `/hbp 사용법`을 입력하세요.'
  ].join('\n\n');
}

export function card(ep) {
  const blocks = [
    { type: 'header', text: plain(ep.name + ' 제작 카드') },
    section('편집 ' + mentions(ep.editor) + (ep.due ? '   ·   자료 마감 ' + dueFormat.format(ep.due) + ' KST' : '')),
    { type: 'divider' }
  ];
  for (const kind of kinds) {
    const items = ep.assets.filter(a => a.kind === kind);
    const revision = items.length;
    const ready = available(ep, kind, items);
    const confirmed = revision > 0 && ep.confirmed[kind] === revision;
    const status = confirmed ? '✅ *확인됨*' : ready ? '🟢 *제출됨*' : revision ? '🟡 *일부 제출*' : '🔴 *미제출*';
    let heading = status + '  ·  ' + labels[kind];
    if (kind === 'image') heading += ' ' + items.reduce((n, a) => n + a.count, 0) + '/' + ep.target + '장';
    if (kind === 'voice') heading += ' (선택)';
    const destination = process.env[channelVars[kind]];
    const details = ['담당 ' + mentions(owners(ep, kind))];
    if (destination) details.push('<#' + destination + '>');
    if (revision) details.push(link(items.at(-1).url, '최근 자료'));
    const row = section(heading + '\n' + details.join('  ·  '));
    if (ready && !confirmed) row.accessory = button('수신 확인', 'confirm_' + kind, { name: ep.name, kind, revision });
    blocks.push(row);
  }
  blocks.push({ type: 'actions', elements: [
    { ...button('자료 등록', 'register', {name: ep.name}), style: 'primary' },
    button('전체 자료', 'browse', {name: ep.name})
  ] });
  return { text: ep.name + ' 제작 카드', blocks, unfurl_links: false, unfurl_media: false };
}

function setupView(name, channel, user) {
  return modal('setup', '회차 카드 만들기', { name, channel }, [
    section('*' + esc(name) + '* 자료를 모을 카드가 <#' + channel + '>에 게시됩니다. 역할마다 한 명 이상 선택하세요.'),
    field('editor', '편집 · 수신 확인', { type: 'multi_users_select', initial_users: [user] }),
    field('visual', '대본 · 이미지 · 자막 · 목소리 담당', { type: 'multi_users_select' }),
    field('music', 'BGM 담당', { type: 'multi_users_select' }),
    field('target', '목표 이미지 수', editText({ initial_value: '35', max_length: 4 })),
    field('due', '자료 마감 (한국시간)', editText({ placeholder: plain('2026-11-25 19:00'), max_length: 16 }), true)
  ], '카드 만들기');
}

function assetView(eps, meta) {
  const blocks = [];
  if (meta.name) blocks.push(section('*' + esc(meta.name) + '*에 자료를 등록합니다.'));
  else blocks.push(field('episode', '자료를 받을 회차 · 카드 채널', { type: 'static_select', options: eps.map(ep => option(ep.name, ep.name)) }));
  if (meta.source) blocks.push(section('선택한 메시지 링크가 회차 카드에 공유됩니다. 다른 링크를 등록하려면 아래에 입력하세요.'));
  blocks.push(field('kind', '자료 종류', { type: 'static_select', options: kinds.map(k => option(labels[k], k)) }));
  blocks.push(field('url', '자료 링크', editText({ max_length: 2000, placeholder: plain('https://…') }), Boolean(meta.source)));
  blocks.push(field('count', '이미지 묶음 장수 (이미지 등록 시 필수)', editText({ max_length: 4 }), true));
  return modal('asset', '자료 등록', meta, blocks, '등록');
}

function browseView(ep, page) {
  const items = [...ep.assets].reverse(), pages = Math.max(1, Math.ceil(items.length / 8));
  page = Math.max(0, Math.min(page, pages - 1));
  const blocks = [section('*' + esc(ep.name) + '*   ·   ' + (page + 1) + ' / ' + pages)];
  for (const a of items.slice(page * 8, page * 8 + 8)) {
    blocks.push(section(link(a.url, labels[a.kind] + (a.kind === 'image' ? ' ' + a.count + '장' : '')) + '   <@' + a.user + '>'));
  }
  if (!items.length) blocks.push(section('등록된 자료가 없습니다.'));
  const metadata = { name: ep.name, channel: ep.channel };
  const nav = [];
  if (page > 0) nav.push(button('이전', 'browse_prev', {page: page - 1}));
  if (page + 1 < pages) nav.push(button('다음', 'browse_next', {page: page + 1}));
  if (nav.length) blocks.push({type: 'actions', elements: nav});
  return modal('browse_assets', '전체 자료', metadata, blocks);
}

function deadline(text) {
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(text)) return NaN;
  const time = Date.parse(text.replace(' ', 'T') + ':00+09:00');
  return Number.isFinite(time) && dueFormat.format(time) === text ? time : NaN;
}

function allowedSource(ep, sourceChannel) {
  if (ep.channel === sourceChannel) return true;
  const sources = [...(process.env.SOURCE_CHANNEL_IDS || '').split(',').map(x => x.trim()),
    ...Object.values(channelVars).map(key => process.env[key])];
  return Boolean(sourceChannel && ep.channel === process.env.HOME_CHANNEL_ID && sources.includes(sourceChannel));
}

export function createHandler(store, api, expectedTeam) {
  const updates = new Map();
  const open = (trigger_id, view) => api('views.open', {trigger_id, view});
  async function whisper(channel, user, text) {
    try { await api('chat.postEphemeral', { channel, user, text }); }
    catch (e) {
      if (!['not_in_channel', 'channel_not_found', 'user_not_in_channel'].includes(e.message)) throw e;
      await api('chat.postMessage', { channel: user, text, unfurl_links: false, unfurl_media: false });
    }
  }
  async function sendCard(method, params) {
    try { return await api(method, params); }
    catch (e) {
      if (e.message !== 'ratelimited') throw e;
      await delay(1000 * Math.max(1, e.retryAfter || 1));
      return api(method, params);
    }
  }
  function sync(team, name) {
    const key = JSON.stringify([team, name]);
    const update = (updates.get(key) || Promise.resolve()).catch(() => {}).then(async () => {
      const ep = store.get(team, name);
      if (!ep) return;
      const message = { channel: ep.channel, ...card(ep) };
      if (ep.ts) {
        try { await sendCard('chat.update', { ...message, ts: ep.ts }); return; }
        catch (e) { if (e.message !== 'message_not_found') throw e; }
      }
      const result = await sendCard('chat.postMessage', message);
      store.setCard(team, name, result.ts);
    });
    updates.set(key, update);
    return update.finally(() => { if (updates.get(key) === update) updates.delete(key); });
  }

  async function handle(type, p, ack) {
    const team = p.team_id || p.team?.id || p.user?.team_id;
    const user = p.user_id || p.user?.id;
    const channel = p.channel_id || p.channel?.id;
    if (!team || (expectedTeam && team !== expectedTeam)) { ack(); return; }
    if (type === 'events_api') {
      ack();
      const event = p.event;
      if (p.type === 'event_callback' && event?.type === 'message' && event.user &&
          !event.bot_id && !event.app_id && !event.subtype && event.channel &&
          event.channel === process.env.HOME_CHANNEL_ID && event.text?.trim() === '사용법') {
        await sendCard('chat.postMessage', {
          channel: event.channel, text: usageGuide(),
          ...(event.thread_ts && { thread_ts: event.thread_ts })
        });
      }
      return;
    }
    if (!user) { ack(); return; }
    if (type === 'slash_commands') {
      const name = (p.text || '').trim();
      if (name === '사용법') {
        ack({ response_type: 'ephemeral', text: usageGuide() });
        return;
      }
      if (!name || name.length > 60 || /[<>|\n\r]/.test(name)) {
        ack({ response_type: 'ephemeral', text: '예: /hbp 1화 · 회차 이름은 60자 이내로 입력하세요.' }); return;
      }
      if (process.env.HOME_CHANNEL_ID && channel !== process.env.HOME_CHANNEL_ID) {
        ack({ response_type: 'ephemeral', text: '지정된 제작 채널에서 /hbp를 사용하세요.' }); return;
      }
      const ep = store.get(team, name);
      if (ep && ep.channel !== channel) {
        ack({ response_type: 'ephemeral', text: '이 이름을 사용할 수 없습니다. 다른 회차 이름을 입력하세요.' }); return;
      }
      ack();
      if (!ep) { await open(p.trigger_id, setupView(name, channel, user)); return; }
      await sync(team, name);
      const current = store.get(team, name);
      const {permalink} = await api('chat.getPermalink', { channel, message_ts: current.ts });
      await whisper(channel, user, link(permalink, esc(name) + ' 제작 카드 열기'));
      return;
    }
    if (p.type === 'message_action' && p.callback_id === 'register_asset') {
      ack();
      const eps = store.list(team).filter(ep => allowedSource(ep, channel) && [ep.visualOwner, ep.musicOwner, ep.editor].some(users => users.includes(user)));
      if (!eps.length) {
        await open(p.trigger_id, modal('info', '자료 등록', {}, [section('이 채널에서 등록할 수 있는 담당 회차가 없습니다. 제작 카드의 자료 등록 버튼을 이용하세요.')])); return;
      }
      const domain = p.team.domain;
      let source;
      if (/^[a-z0-9-]+$/.test(domain || '') && /^[A-Z0-9]+$/.test(channel) && /^\d+\.\d+$/.test(p.message_ts)) {
        source = 'https://' + domain + '.slack.com/archives/' + channel + '/p' + p.message_ts.replace('.', '');
      } else source = (await api('chat.getPermalink', { channel, message_ts: p.message_ts })).permalink;
      // Slack limits static selects to 100 options. The card's button always addresses its own episode.
      await open(p.trigger_id, assetView(eps.slice(0, 100), { ...(eps.length === 1 && { name: eps[0].name }), channel, source }));
      return;
    }
    if (p.type === 'block_actions') {
      ack();
      const action = p.actions[0], value = JSON.parse(action.value);
      if (action.action_id === 'browse_prev' || action.action_id === 'browse_next') {
        const meta = JSON.parse(p.view.private_metadata), ep = store.get(team, meta.name);
        if (ep?.channel === meta.channel) await api('views.update', { view_id: p.view.id, hash: p.view.hash, view: browseView(ep, value.page) });
        return;
      }
      const ep = store.get(team, value.name);
      if (!ep || ep.channel !== channel) return;
      if (action.action_id === 'register') {
        await open(p.trigger_id, assetView([ep], { name: ep.name, channel })); return;
      }
      if (action.action_id === 'browse') { await open(p.trigger_id, browseView(ep, 0)); return; }
      if (action.action_id.startsWith('confirm_')) {
        try { store.confirm(team, ep.name, value.kind, value.revision, user); }
        catch (e) { await whisper(channel, user, e.message); return; }
        await sync(team, ep.name);
      }
      return;
    }
    if (p.type !== 'view_submission') { ack(); return; }
    const view = p.view, meta = JSON.parse(view.private_metadata), values = view.state.values;
    const input = id => values[id]?.value || {};
    const error = (field, text) => ack({ response_action: 'errors', errors: { [field]: text } });
    let name = meta.name;
    if (view.callback_id === 'setup') {
      const selections = {};
      for (const role of ['editor', 'visual', 'music']) {
        const { selected_users, selected_user } = input(role);
        // A modal opened before the upgrade can still submit a single user.
        selections[role] = selected_users ?? (selected_user ? [selected_user] : []);
        if (!selections[role].length) return error(role, '담당자를 한 명 이상 선택하세요.');
      }
      const target = Number(input('target').value);
      if (!Number.isInteger(target) || target < 1 || target > 9999) return error('target', '1~9999 사이 정수를 입력하세요.');
      const due = deadline(input('due').value);
      if (Number.isNaN(due)) return error('due', '한국시간으로 YYYY-MM-DD HH:mm 형식의 날짜를 입력하세요.');
      const existing = store.get(team, name);
      if (existing && existing.channel !== meta.channel) return error('target', '이 회차 이름을 사용할 수 없습니다.');
      try {
        if (!existing) store.create({ team, name, channel: meta.channel, editor: selections.editor,
          visualOwner: selections.visual, musicOwner: selections.music, target, due });
      } catch (e) { return error('target', e.message); }
    } else if (view.callback_id === 'asset') {
      name ||= input('episode').selected_option?.value;
      const ep = store.get(team, name), kind = input('kind').selected_option?.value;
      if (!ep || !allowedSource(ep, meta.channel)) return error('kind', '이 채널에서 등록할 수 없는 회차입니다.');
      if (!owners(ep, kind).includes(user)) return error('kind', '선택한 자료의 담당자만 등록할 수 있습니다.');
      const count = kind === 'image' ? Number(input('count').value) : 1;
      if (!Number.isInteger(count) || count < 1 || count > 9999) return error('count', '이 묶음에 포함된 이미지 장수를 입력하세요.');
      const url = (input('url').value || meta.source || '').trim();
      try { store.attach(team, name, { kind, url, count, user }); }
      catch (e) { return error('url', e.message); }
    } else { ack(); return; }
    ack();
    try { await sync(team, name); }
    catch (e) {
      const ep = store.get(team, name);
      const hint = e.message === 'not_in_channel' ? '이 채널에 봇을 초대한 뒤 ' : '';
      await whisper(meta.channel, user, '자료 상태는 저장됐습니다. 카드 갱신을 위해 ' + hint + '<#' + ep.channel + '>에서 /hbp ' + esc(name) + '를 다시 실행하세요.');
    }
  }
  return async (type, p, ack) => {
    try { await handle(type, p, ack); }
    catch (e) {
      const user = p.user_id || p.user?.id, channel = p.channel_id || p.channel?.id;
      if (user && channel) {
        const hint = e.message === 'not_in_channel' ? '먼저 제작 채널에 봇을 초대하세요. ' : '';
        await whisper(channel, user, hint + '요청 처리 중 오류가 발생했습니다. 제작 채널에서 /hbp와 회차 이름을 입력해 다시 열어 주세요.');
      }
      throw e;
    }
  };
}

export function slackApi(token) {
  return async function api(method, body = {}) {
    const url = new URL('https://slack.com/api/' + method);
    const headers = { authorization: 'Bearer ' + token };
    const options = { headers, signal: AbortSignal.timeout(12000) };
    if (method === 'chat.getPermalink') {
      url.search = new URLSearchParams(body).toString();
    } else {
      options.method = 'POST';
      headers['content-type'] = 'application/json; charset=utf-8';
      options.body = JSON.stringify(body);
    }
    const response = await fetch(url, options);
    if (response.status === 429) {
      const e = new Error('ratelimited'); e.retryAfter = Number(response.headers.get('retry-after')) || 5; throw e;
    }
    if (!response.ok) throw new Error('slack_http_' + response.status);
    const result = await response.json();
    if (!result.ok) throw new Error(result.error || 'slack_api_error');
    return result;
  };
}

export async function runSocket(store, appToken, botToken, expectedTeam) {
  const api = slackApi(botToken), app = slackApi(appToken);
  expectedTeam ||= (await api('auth.test')).team_id;
  if (!expectedTeam) throw new Error('Slack 워크스페이스를 확인할 수 없습니다.');
  const handle = createHandler(store, api, expectedTeam);
  const seen = new Map();
  let wait = 1000;
  for (;;) {
    try {
      const { url } = await app('apps.connections.open');
      const ws = new WebSocket(url);
      await new Promise((resolve, reject) => {
        const watchdog = setTimeout(() => ws.close(), 20000);
        ws.onopen = () => { clearTimeout(watchdog); wait = 1000; console.log('Slack Socket Mode 연결됨'); };
        ws.onerror = () => { clearTimeout(watchdog); reject(new Error('socket_error')); };
        ws.onclose = () => { clearTimeout(watchdog); resolve(); };
        ws.onmessage = async event => {
          let ack = () => {};
          try {
            const env = JSON.parse(event.data);
            if (env.type === 'disconnect') { ws.close(); return; }
            if (!env.envelope_id) return;
            const send = reply => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(reply)); };
            if (seen.has(env.envelope_id)) { send(seen.get(env.envelope_id)); return; }
            ack = payload => {
              if (seen.has(env.envelope_id)) return;
              const reply = { envelope_id: env.envelope_id, ...(payload && {payload}) };
              seen.set(env.envelope_id, reply);
              if (seen.size > 5000) seen.delete(seen.keys().next().value);
              send(reply);
            };
            await handle(env.type, env.payload || {}, ack);
          } catch (e) {
            ack(); console.error('Slack 요청 처리 실패:', e.message);
          }
        };
      });
    } catch (e) {
      console.error('Slack 연결 실패:', e.message);
      if (['invalid_auth', 'not_authed', 'token_revoked', 'missing_scope'].includes(e.message)) throw e;
      wait = Math.max(wait, (e.retryAfter || 0) * 1000);
    }
    await delay(wait);
    wait = Math.min(wait * 2, 30000);
  }
}
