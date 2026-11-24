import assert from 'node:assert/strict';
import test from 'node:test';
import { tally, winningTopic } from './votes.mjs';

const now = new Date('2026-11-25T00:10:00Z');
const env = { SLACK_CHANNEL_ID: 'C123', SLACK_BOT_TOKEN: 'test-token' };
const text = '영상 아이디어 · 2026-11-24 저녁판\n\n1. 얼음은 왜 뜰까?\n   얼음을 물에 띄운다.\n\n2. 바퀴가 거꾸로 도는 걸까?\n카메라로 바퀴를 찍는다.';

function edition(hours, reactions) {
  return { ts: ((now.getTime() / 1000) - hours * 3600).toFixed(6), text, bot_id: 'BOT', reactions };
}
const popular = [{ name: 'two', count: 3, users: ['U1'] }, { name: 'one', count: 2, users: ['U3'] }];

test('현재 반응 총수를 집계하고 번호 이외의 이모지는 제외한다', () => {
  const row = edition(12, [...popular, { name: '+1', count: 9 }]);
  assert.deepEqual(winningTopic(row), { number: 2, count: 3, question: '바퀴가 거꾸로 도는 걸까?', scene: '카메라로 바퀴를 찍는다.' });
  assert.equal(winningTopic(edition(12, [{ name: 'one', count: 2 }, { name: 'two', count: 2 }])), undefined);
  assert.equal(winningTopic(edition(12, [{ name: 'one', count: 1 }])), undefined);
  assert.equal(winningTopic(edition(12, [])), undefined);
});

test('수집 창, 제작봇 신원, 부분 응답 손실 후 재실행을 모두 처리한다', async () => {
  const first = edition(24, popular);
  const second = edition(12, popular);
  const tie = edition(13, [{ name: 'one', count: 2 }, { name: 'two', count: 2 }]);
  const messages = [edition(10, popular), edition(169, popular), first, second, tie, { ...edition(14, popular), bot_id: 'OTHER' }];
  const writes = [];
  let loseFirstResponse = true;
  const request = async (input, options) => {
    const url = new URL(input);
    switch (url.pathname) {
      case '/api/auth.test': return Response.json({ ok: true, bot_id: 'BOT', user_id: 'UBOT' });
      case '/api/conversations.history': return Response.json({ ok: true, messages });
      case '/api/chat.getPermalink': {
        assert.equal(options.method, 'GET');
        const ts = url.searchParams.get('message_ts');
        return Response.json({ ok: true, permalink: 'https://team.slack.com/archives/C123/p' + ts.replace('.', '') });
      }
      case '/api/chat.postMessage': {
        const fields = JSON.parse(options.body);
        const ts = (now.getTime() / 1000 + writes.length).toFixed(6);
        writes.push(fields);
        messages.unshift({ ts, bot_id: 'BOT', text: fields.text });
        if (loseFirstResponse) {
          loseFirstResponse = false;
          throw new Error('response lost after post');
        }
        return Response.json({ ok: true, ts });
      }
      default: throw Error(url.pathname);
    }
  };
  const run = () => tally({ env, now, request });
  await assert.rejects(run(), /response lost/);
  assert.equal((await run()).announced, 1);
  assert.equal((await run()).announced, 0);
  assert.equal(writes.length, 2);
  assert.match(writes[0].text, /3표로 단독 1위/);
  assert.match(writes[0].text, /첫 장면 · 카메라로 바퀴를 찍는다/);
  tie.reactions[0].count++;
  assert.equal((await run()).announced, 1);
});
