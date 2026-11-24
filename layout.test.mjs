import test from 'node:test';
import assert from 'node:assert/strict';
import { composeMessage, run } from './ideas.mjs';

const stories = ['원작 & <이름>', '월드투어 [공연]'].map((headline, i) => ({
  headline, question: `기사 질문 ${i + 1}?`, scene: `촬영 장면 ${i + 1}`,
  link: `https://www.yna.co.kr/view/AKR1234${i}`, published: Date.UTC(2026, 10, 24, 1, i),
}));

test('0~2개 연예 기사가 있는 판을 하나의 메시지로 읽고 같은 번호로 투표할 수 있다', () => {
  for (let count = 0; count <= 2; count++) {
    const selected = stories.slice(0, count);
    const title = '영상 아이디어 · 2026-11-24 저녁판';
    const { blocks, text } = composeMessage(title, [], selected);
    assert.equal(blocks[0].type, 'header');
    assert.match(blocks[0].text.text, /저녁/);
    assert.match(blocks[1].elements[0].text, /11월 24일/);
    assert.equal(text.split('\n')[0], title);
    assert.ok(blocks.length <= 50);
    const rows = blocks.filter(b => b.type === 'rich_text');
    assert.equal(rows.length, 7);
    rows.forEach((row, index) => {
      const parts = row.elements[0].elements;
      assert.ok(parts[0].text.startsWith(`${index + 1}. `));
      assert.equal(parts[0].style.bold, true);
      assert.match(parts.at(-1).text, /첫 장면/);
      assert.ok(text.includes(parts.at(-1).text.split('  ·  ')[1]));
    });
    assert.equal(blocks.some(b => b.elements?.[0]?.text === '*연예 뉴스에서*'), count > 0);
    assert.match(blocks.at(-1).elements[0].text, /득표수/);
    const links = rows.flatMap(row => row.elements[0].elements.filter(p => p.type === 'link'));
    assert.equal(links.length, count);
    for (const story of selected) {
      assert.ok(links.some(link => link.url === story.link && link.text === story.headline));
      assert.ok(text.includes(story.link));
    }
  }
});

test('실제 예약·즉시 게시 요청 모두 일곱 주제의 Block Kit와 대체 본문을 포함한다', async () => {
  for (const hour of [23, 0]) {
    const now = hour === 23 ? new Date('2026-11-23T23:00:00Z') : new Date('2026-11-24T00:00:10Z');
    const writes = [];
    const request = async (url, options) => {
      if (new URL(url).hostname === 'www.yna.co.kr') return new Response('<rss/>');
      const method = new URL(url).pathname.split('/').pop();
      if (method === 'auth.test') return Response.json({ ok: true, bot_id: 'B' });
      if (method === 'chat.scheduledMessages.list') return Response.json({ ok: true, scheduled_messages: [] });
      if (method === 'conversations.history') return Response.json({ ok: true, messages: [] });
      writes.push({ method, message: JSON.parse(options.body) });
      return Response.json({ ok: true, scheduled_message_id: 'Q', ts: '123' });
    };
    await run({ request, env: { IDEA_SLOT: '09', SLACK_CHANNEL_ID: 'C', SLACK_BOT_TOKEN: 'test' }, now: () => now });
    assert.equal(writes.length, 1);
    assert.equal(writes[0].method, hour === 23 ? 'chat.scheduleMessage' : 'chat.postMessage');
    assert.equal(writes[0].message.blocks.filter(b => b.type === 'rich_text').length, 7);
    assert.match(writes[0].message.text, /^영상 아이디어 · 2026-11-24 오전판/);
  }
});
