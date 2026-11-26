import assert from 'node:assert/strict';
import test from 'node:test';
import { card, createHandler } from './slack.mjs';
import { openStore } from './store.mjs';

test('카드 첫 줄에 제출 상태를 강조하고 확인 가능한 자료에만 버튼을 표시한다', () => {
  const url = 'https://example.com/file';
  const message = card({
    name: '1화', editor: ['UE'], visualOwner: ['UV'], musicOwner: ['UM'], target: 35,
    assets: [{kind: 'image', count: 30, url}, {kind: 'subtitle', url}, {kind: 'bgm', url}],
    confirmed: {subtitle: 1}
  });
  const rows = message.blocks.filter(b => b.text?.text.includes('\n담당 '));
  assert.deepEqual(rows.map(row => row.text.text.split('\n')[0]), [
    '🔴 *미제출*  ·  대본', '🟡 *일부 제출*  ·  이미지 30/35장',
    '✅ *확인됨*  ·  요약 자막', '🟢 *제출됨*  ·  BGM',
    '🔴 *미제출*  ·  목소리 샘플 (선택)', '🔴 *미제출*  ·  편집 초안'
  ]);
  assert.ok(rows[1].text.text.includes('<' + url + '|최근 자료>'));
  assert.deepEqual(rows.flatMap(row => row.accessory ? [row.accessory.action_id] : []), ['confirm_bgm']);
});

test('복수 담당 회차 생성 → 공동 담당자 자료 등록 → 편집자 한 명의 수신 확인', async t => {
  const store = openStore(':memory:');
  t.after(() => store.close());
  const home = 'CHOME', team = 'T1', visual = 'UV', editor = 'UE';
  const original = process.env.HOME_CHANNEL_ID;
  process.env.HOME_CHANNEL_ID = home;
  t.after(() => {
    if (original === undefined) delete process.env.HOME_CHANNEL_ID;
    else process.env.HOME_CHANNEL_ID = original;
  });
  const calls = [];
  const handle = createHandler(store, async (method, body) => {
    calls.push({method, body});
    return { ok: true, ts: '123.000001', permalink: 'https://workspace.slack.com/card' };
  });
  const userPayload = id => ({team:{id:team, domain:'workspace'}, user:{id}, trigger_id:'trigger'});
  const input = v => ({value:v});
  const send = async (type, payload) => {
    const replies = [];
    await handle(type, payload, reply => replies.push(reply));
    assert.equal(replies.length, 1);
    return replies[0];
  };
  const submit = (user,view,values) => send('interactive', {
    ...userPayload(user),type:'view_submission',view:{...view,state:{values}}
  });
  await send('slash_commands', {team_id:team,user_id:editor,channel_id:home,text:'1화',trigger_id:'create'});
  const setup = calls.at(-1).body.view;
  assert.equal(setup.callback_id, 'setup');
  for (const role of ['editor', 'visual', 'music']) {
    assert.equal(setup.blocks.find(block => block.block_id === role).element.type, 'multi_users_select');
  }
  assert.deepEqual(setup.blocks.find(block => block.block_id === 'editor').element.initial_users, [editor]);
  const selection = {
    editor:input({selected_users:[editor,'UE2']}), visual:input({selected_users:[visual,'UV2']}),
    music:input({selected_users:['UM','UM2']}), target:input({value:'5'}), due:input({value:'2026-11-25 19:00'})
  };
  const invalid = await submit(editor,setup,{...selection,music:input({selected_users:[]})});
  assert.ok(invalid.errors.music);
  await submit(editor,setup,selection);
  assert.equal(calls.at(-1).method,'chat.postMessage');
  assert.equal(store.get(team,'1화').due, Date.parse('2026-11-25T19:00:00+09:00'));
  const posted = calls.at(-1).body.blocks.map(block => block.text?.text || '').join('\n');
  for (const names of ['<@UE> <@UE2>', '<@UV> <@UV2>', '<@UM> <@UM2>']) {
    assert.ok(posted.includes(names));
  }
  const shortcut = { ...userPayload('UV2'),type:'message_action',callback_id:'register_asset',
    message_ts:'234.000002',channel:{id:home} };
  await send('interactive', {...shortcut,channel:{id:'COTHER'}});
  assert.equal(calls.at(-1).body.view.callback_id,'info');
  await send('interactive', shortcut);
  const asset = calls.at(-1).body.view;
  assert.equal(asset.callback_id,'asset');
  const values = {kind:input({selected_option:{value:'image'}}),url:input({value:null}),count:input({value:'5'})};
  assert.equal((await submit('UM',asset,values)).response_action,'errors');
  await submit('UV2',asset,values);
  assert.equal(calls.at(-1).method,'chat.update');
  const card = calls.at(-1).body;
  const imageRow = card.blocks.find(item=>item.accessory?.action_id==='confirm_image');
  assert.match(imageRow.text.text,/5\/5장/);
  assert.match(store.get(team,'1화').assets[0].url,/234000002/);
  await send('interactive',{...userPayload('UE2'),type:'block_actions',channel:{id:home},actions:[imageRow.accessory]});
  assert.equal(store.get(team,'1화').confirmed.image,1);
  await send('interactive',{...shortcut,...userPayload('UM2')});
  const bgmView = calls.at(-1).body.view;
  assert.equal(bgmView.callback_id,'asset');
  await submit('UM2',bgmView,{...values,kind:input({selected_option:{value:'bgm'}})});
  assert.equal(store.get(team,'1화').assets.find(asset => asset.kind === 'bgm').user,'UM2');
  assert.equal(calls.filter(call=>call.method==='chat.postMessage').length,1);

  // A teammate can finish an older form that was already open during rollout.
  const olderView = {...setup,private_metadata:JSON.stringify({name:'2화',channel:home})};
  await submit(editor,olderView,{...selection,editor:input({selected_user:editor}),
    visual:input({selected_user:visual}),music:input({selected_user:'UM'})});
  assert.deepEqual(store.get(team,'2화').editor,[editor]);
});

test('같은 사용법을 채널·스레드에 공유하거나 명령을 입력한 사람에게만 표시한다', async t => {
  const previous = process.env.HOME_CHANNEL_ID;
  process.env.HOME_CHANNEL_ID = 'CHOME';
  t.after(() => {
    if (previous === undefined) delete process.env.HOME_CHANNEL_ID;
    else process.env.HOME_CHANNEL_ID = previous;
  });
  const calls = [];
  const handle = createHandler(null, async (method, body) => calls.push({method, body}), 'T1');
  const event = {type:'message', channel:'CHOME', user:'U1', text:'사용법', ts:'1.0'};
  const sendEvent = async (changes, team = 'T1') => {
    let acks = 0;
    await handle('events_api', {team_id:team, type:'event_callback', event:{...event, ...changes}}, () => acks++);
    assert.equal(acks, 1);
  };
  let help;
  await handle('slash_commands', {team_id:'T1', user_id:'U1', channel_id:'CHOME', text:' 사용법 '}, reply => { help = reply; });
  assert.equal(help.response_type,'ephemeral');
  assert.match(help.text, /회차 자료로 등록/);
  assert.match(help.text, /수신 확인/);
  assert.equal(calls.length,0);
  await sendEvent({});
  await sendEvent({thread_ts:'0.5'});
  assert.deepEqual(calls, [
    {method:'chat.postMessage', body:{channel:'CHOME', text:help.text}},
    {method:'chat.postMessage', body:{channel:'CHOME', text:help.text, thread_ts:'0.5'}}
  ]);
  await sendEvent({}, 'T2');
  for (const change of [{channel:'COTHER'}, {text:'사용법 확인'}, {bot_id:'B1'}, {app_id:'A1'}, {subtype:'message_changed'}, {user:undefined}]) {
    await sendEvent(change);
  }
  assert.equal(calls.length,2);
});
