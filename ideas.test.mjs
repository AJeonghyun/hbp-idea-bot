import assert from 'node:assert/strict';
import test from 'node:test';
import { compose, edition, parseFeed, run } from './ideas.mjs';

const before = new Date('2026-11-23T23:00:00Z');
const due = new Date('2026-11-24T00:00:10Z');
const slot = edition(before, '09');
const env = { SLACK_BOT_TOKEN: 'test', SLACK_CHANNEL_ID: 'C_TEST', IDEA_SLOT: '09' };
const link = 'https://www.yna.co.kr/view/AKR1234';
const xml = `<rss><item><title><![CDATA[박물관 옛 그림 특별전]]></title><link>${link}</link><pubDate>Mon, 23 Nov 2026 19:00:00 +0900</pubDate></item></rss>`;

function fakeNetwork({ pending = [], pages = [{}], writeError } = {}) {
  const calls = [];
  let i = 0;
  async function request(input, options) {
    const url = new URL(input);
    if (url.hostname === 'www.yna.co.kr') return new Response(xml);
    const method = url.pathname.split('/').pop();
    const fields = options.body ? JSON.parse(options.body) : Object.fromEntries(url.searchParams);
    calls.push({ method, fields });
    let body;
    switch (method) {
      case 'auth.test': body = { bot_id: 'BOT', user_id: 'USER' }; break;
      case 'conversations.history': body = { messages: [], ...pages[i++] }; break;
      case 'chat.scheduledMessages.list': body = { scheduled_messages: pending }; break;
      case 'chat.scheduleMessage': body = { scheduled_message_id: 'QID' }; break;
      case 'chat.postMessage': body = { ts: '123' }; break;
      default: throw new Error(method);
    }
    if (writeError && ['chat.scheduleMessage', 'chat.postMessage'].includes(method)) {
      return Response.json({ ok: false, error: writeError });
    }
    return Response.json({ ok: true, ...body });
  }
  return { calls, request };
}

test('오전·저녁 KST 고정 시각을 계산한다', () => {
  assert.match(slot.title, /2026-11-24 오전판/);
  assert.equal(new Date(slot.postAt * 1000).toISOString(), '2026-11-24T00:00:00.000Z');
  assert.equal(new Date(edition(before, '21').postAt * 1000).toISOString(), '2026-11-24T12:00:00.000Z');
  assert.throws(() => edition(before, '12'));
});

test('기사는 최근 연합뉴스 원문에서만 고른다', () => {
  assert.equal(parseFeed(xml, before)[0].link, link);
  assert.deepEqual(parseFeed(xml.replace('www.yna.co.kr/view', 'evil.test/view'), before), []);
  assert.deepEqual(parseFeed(xml.replace('23 Nov', '10 Nov'), before), []);
  assert.deepEqual(parseFeed(xml.replace('23 Nov', '28 Nov'), before), []);
  assert.deepEqual(parseFeed(xml.replace('박물관 옛 그림 특별전', '열애설'), before), []);
});

test('각 판에 7개, 최근 판의 링크·질문과 같은 실험 장면 반복을 피한다', () => {
  const history = [];
  const stories = parseFeed(xml, before);
  const seen = new Set();
  for (let i = 0; i < 18; i++) {
    const text = compose(`회차 ${i}`, history, stories);
    const questions = text.split('\n').filter(row => /^\d+\. /.test(row)).map(row => row.slice(3));
    assert.equal(questions.length, 7);
    for (const question of questions) {
      assert(!seen.has(question), question);
      seen.add(question);
    }
    assert.equal(text.includes(link), i === 0);
    history.push({ ts: String(i + 1), text });
  }
});

test('예약 시각, 본문, 채널을 확인하고 회차당 한 건만 쓴다', async () => {
  const api = fakeNetwork();
  const result = await run({ env, now: () => before, request: api.request });
  assert.equal(result.status, 'scheduled');
  const last = api.calls.at(-1);
  assert.equal(last.method, 'chat.scheduleMessage');
  assert.equal(last.fields.post_at, slot.postAt);
  assert.equal(last.fields.channel, env.SLACK_CHANNEL_ID);
  assert.match(last.fields.text, /7\. /);
});

test('예약 및 이미 게시된 회차를 재전송하지 않는다', async () => {
  const pending = fakeNetwork({ pending: [{ post_at: slot.postAt }] });
  assert.equal((await run({ env, now: () => before, request: pending.request })).status, 'already-scheduled');
  assert.equal(pending.calls.length, 1);
  const posted = fakeNetwork({ pages: [
    { response_metadata: { next_cursor: 'next' } },
    { messages: [{ text: slot.title, bot_id: 'BOT' }] },
  ] });
  assert.equal((await run({ env, now: () => due, request: posted.request })).status, 'already-sent');
  assert.equal(posted.calls.at(-1).fields.cursor, 'next');
});

test('사용자가 제목을 복사한 경우에도 봇은 게시한다. 지연 실행은 한도 내에서만 게시한다', async () => {
  const api = fakeNetwork({ pages: [{ messages: [{ text: slot.title, user: 'OTHER' }] }] });
  assert.equal((await run({ env, now: () => due, request: api.request })).status, 'sent');
  assert.equal(api.calls.at(-1).method, 'chat.postMessage');
  assert.equal((await run({ env, now: () => new Date('2026-11-24T03:00:00Z'), request: assert.fail })).status, 'stale');
});

test('미리보기는 Slack을 호출하지 않고, 피드 장애 시에도 일곱 주제를 반환한다', async () => {
  const preview = await run({ env: { IDEA_SLOT: '21' }, dryRun: true, now: () => due, request: async input => {
    assert.equal(new URL(input).hostname, 'www.yna.co.kr');
    return new Response('', { status: 503 });
  } });
  assert.equal(preview.status, 'preview');
  assert.equal(preview.text.match(/^\d+\. /gm).length, 7);
});

test('Slack 전송 실패 시 작업 실패로 기록한다', async () => {
  const api = fakeNetwork({ writeError: 'not_in_channel' });
  await assert.rejects(run({ env, now: () => before, request: api.request }), /not_in_channel/);
});
