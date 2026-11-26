import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from './store.mjs';

const setup = { team: 'T1', name: '1화', channel: 'C1', editor: 'UE', visualOwner: 'UV',
  musicOwner: 'UM', target: 35, due: 100000 };
const team = setup.team;
const name = setup.name;
const image = { kind: 'image', url: 'https://example.com/images/1', count: 30, user: 'UV' };
const lastImage = { ...image, url: 'https://example.com/images/2', count: 5 };

function fresh(t) {
  const store = openStore(':memory:');
  t.after(() => store.close());
  store.create(setup);
  return store;
}

test('중복 생성과 제출, 낡은 수신 확인, 담당자 권한을 구분한다', t => {
  const store = fresh(t);
  assert.deepEqual(store.create({ ...setup, editor: 'UX' }).editor, ['UE']);
  assert.throws(() => store.attach(team, name, { ...image, user: 'UE' }));
  store.attach(team, name, image);
  assert.equal(store.attach(team, name, image).assets.length, 1);
  assert.throws(() => store.attach(team, name, { ...image, count: 31 }));
  assert.throws(() => store.confirm(team, name, 'image', 1, 'UE'), /모두 제출/);
  store.attach(team, name, lastImage);
  assert.throws(() => store.confirm(team, name, 'image', 1, 'UE'), /새 자료/);
  assert.throws(() => store.confirm(team, name, 'image', 2, 'UV'), /편집자/);
  assert.equal(store.confirm(team, name, 'image', 2, 'UE').confirmed.image, 2);
  assert.equal(store.attach(team, name, lastImage).confirmed.image, 2);
  const extra = store.attach(team, name, { ...image, url: 'https://example.com/extra', count: 1 });
  assert.equal(extra.confirmed.image, undefined);
  assert.equal(store.get('T2', name), undefined);
  assert.deepEqual(store.list('T2'), []);
  assert.equal(store.list(team).length, 1);
});

test('입력 검증 실패가 카드 상태를 바꾸지 않는다', t => {
  const store = fresh(t);
  for (const invalid of [[], ['UV', null], [''], null]) {
    assert.throws(() => store.create({ ...setup, name: '2화', visualOwner: invalid }), /담당자/);
  }
  for (const url of ['file:///tmp/notes', 'https:missing-slashes', 'https://a:b@example.com/path', 'https://example.com/<@U>', '']) {
    assert.throws(() => store.attach(team, name, { ...image, url }), /HTTPS/);
  }
  for (const count of [0, -1, 0.5, '1', 20000]) {
    assert.throws(() => store.attach(team, name, { ...image, count }));
  }
  assert.throws(() => store.attach(team, name, { ...image, kind: '__proto__' }));
  assert.deepEqual(store.get(team, name).assets, []);
});

test('공동 담당자들이 자료를 나눠 올리고 수신 상태를 공유하며 각자 알림을 받는다', t => {
  const store = openStore(':memory:');
  t.after(() => store.close());
  const episode = store.create({ ...setup, editor: ['UE', 'UE2', 'UE2'],
    visualOwner: ['UV', 'UB'], musicOwner: ['UB', 'UM'] });
  assert.deepEqual(episode.editor, ['UE', 'UE2']);
  const overdue = store.pendingNotifications(setup.due);
  assert.deepEqual(overdue.map(n => n.user).sort(), ['UB', 'UM', 'UV']);
  assert.match(overdue.find(n => n.user === 'UB').text, /대본, 이미지, 요약 자막, BGM/);
  store.attach(team, name, image);
  store.attach(team, name, { ...lastImage, user: 'UB' });
  for (const kind of ['script', 'subtitle', 'bgm']) {
    store.attach(team, name, { kind, user: 'UB', url: 'https://example.com/' + kind });
  }
  store.attach(team, name, { kind: 'draft', user: 'UE2', url: 'https://example.com/draft' });
  for (const editor of episode.editor) {
    assert.equal(store.confirm(team, name, 'image', 2, editor).confirmed.image, 2);
  }
  const ready = store.pendingNotifications(setup.due);
  assert.deepEqual(ready.map(n => n.user), episode.editor);
  store.markNotified(team, name, ready[0].key);
  assert.deepEqual(store.pendingNotifications(setup.due), [ready[1]]);
});

test('기존 단일 담당자 회차를 열고 수정해도 발송한 인계 알림은 반복되지 않는다', t => {
  const dir = mkdtempSync(join(tmpdir(), 'hbp-legacy-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'episodes.sqlite');
  openStore(file).close();
  const legacy = { ...setup, ts: null, assets: [image, lastImage, ...['script', 'subtitle', 'bgm'].map(kind => ({
    kind, url: 'https://example.com/' + kind, count: 1, user: kind === 'bgm' ? 'UM' : 'UV'
  }))], confirmed: { bgm: 1 } };
  const raw = new DatabaseSync(file);
  raw.prepare('INSERT INTO episodes VALUES (?, ?, ?)').run(team, name, JSON.stringify(legacy));
  raw.prepare('INSERT INTO sent_notifications VALUES (?, ?, ?)').run(team, name, 'ready');
  raw.close();
  const store = openStore(file);
  t.after(() => store.close());
  const [episode] = store.list(team);
  assert.deepEqual(episode.visualOwner, ['UV']);
  assert.deepEqual(episode.musicOwner, ['UM']);
  assert.deepEqual(store.get(team, name).editor, ['UE']);
  assert.deepEqual(store.pendingNotifications(), []);
  assert.equal(store.confirm(team, name, 'image', 2, 'UE').confirmed.image, 2);
  assert.deepEqual(store.pendingNotifications(), []);
});

test('마감 알림, 필수 자료 인계 알림, 링크와 확인 상태가 재시작 후에도 보존된다', t => {
  const dir = mkdtempSync(join(tmpdir(), 'hbp-store-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'episodes.sqlite');
  let store = openStore(file);
  t.after(() => store.close());
  store.create(setup);
  store.setCard(team, name, '100.000001');
  assert.deepEqual(store.pendingNotifications(setup.due - 1), []);
  const overdue = store.pendingNotifications(setup.due);
  assert.deepEqual(overdue.map(item => item.user).sort(), ['UM', 'UV']);
  assert.match(overdue.find(item => item.user === 'UV').text, /대본, 이미지, 요약 자막/);
  for (const item of overdue) store.markNotified(team, name, item.key);
  store.close();
  store = openStore(file);
  assert.deepEqual(store.pendingNotifications(setup.due), []);
  store.attach(team, name, image);
  store.attach(team, name, lastImage);
  for (const kind of ['script', 'subtitle', 'voice']) {
    store.attach(team, name, { kind, user: 'UV', url: 'https://example.com/' + kind });
  }
  assert.deepEqual(store.pendingNotifications(setup.due), []);
  store.attach(team, name, { kind: 'bgm', user: 'UM', url: 'https://example.com/music' });
  store.confirm(team, name, 'bgm', 1, 'UE');
  const [ready] = store.pendingNotifications(setup.due);
  assert.equal(ready.user, 'UE');
  assert.equal(ready.key, 'ready');
  assert.match(ready.text, /100\.000001/);
  store.markNotified(team, name, ready.key);
  store.close();
  store = openStore(file);
  assert.deepEqual(store.pendingNotifications(setup.due), []);
  assert.equal(store.get(team, name).confirmed.bgm, 1);
});
