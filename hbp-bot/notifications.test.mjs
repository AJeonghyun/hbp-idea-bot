import test from 'node:test';
import assert from 'node:assert/strict';
import { deliverNotifications } from './notifications.mjs';

test('실패한 DM만 같은 식별자로 재시도하고 다른 팀의 알림은 건드리지 않는다', async () => {
  const pending = [
    { team: 'T1', name: '1화', key: 'ready', user: 'U1', text: '자료 준비 완료' },
    { team: 'T2', name: '1화', key: 'ready', user: 'U2', text: '자료 준비 완료' }
  ];
  const store = {
    pendingNotifications: () => pending,
    markNotified(team, name, key) {
      assert.deepEqual([team, name, key], ['T1', '1화', 'ready']);
      pending.shift();
    }
  };
  const sent = [];
  async function api(method, payload) {
    assert.equal(method, 'chat.postMessage');
    assert.equal(payload.channel, 'U1');
    sent.push(payload.client_msg_id);
    if (sent.length === 1) throw new Error('timeout');
  }
  for (let i = 0; i < 3; i++) await deliverNotifications(store, api, 'T1', () => {});
  assert.equal(pending.length, 1);
  assert.equal(sent.length, 2);
  assert.equal(sent[0], sent[1]);
});
