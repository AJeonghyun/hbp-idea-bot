import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { openStore } from './store.mjs';
import { runSocket, slackApi } from './slack.mjs';
import { deliverNotifications } from './notifications.mjs';

async function main() {
  const { SLACK_APP_TOKEN: appToken, SLACK_BOT_TOKEN: botToken } = process.env;
  if (!appToken || !botToken) throw new Error('.env에 SLACK_APP_TOKEN과 SLACK_BOT_TOKEN을 설정하세요. README.md에 설치 순서가 있습니다.');
  const api = slackApi(botToken);
  const auth = await api('auth.test', {});
  if (!auth.team_id) throw new Error('워크스페이스를 확인할 수 없습니다.');
  const path = process.env.DB_PATH || './data/hbp.sqlite';
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const store = openStore(path);
  // GitHub Actions 같은 제한 시간이 있는 환경에서는 데이터를 저장하고 스스로 종료한 뒤 다음 실행이 이어받습니다.
  let stopping = false, timer;
  const stop = reason => {
    if (stopping) return;
    stopping = true;
    console.log(reason + ' — 데이터를 저장하고 종료합니다.');
    clearInterval(timer);
    try { store.close(); } finally { process.exit(0); }
  };
  process.once('SIGTERM', () => stop('종료 신호 수신'));
  process.once('SIGINT', () => stop('종료 신호 수신'));
  const maxMinutes = Number(process.env.MAX_RUNTIME_MINUTES);
  if (maxMinutes > 0) setTimeout(() => stop(`실행 시간 ${maxMinutes}분 도달`), maxMinutes * 60_000).unref();
  let active = false;
  async function tick() {
    if (active) return;
    active = true;
    try {
      await deliverNotifications(store, api, auth.team_id);
    } catch (error) {
      console.error('알림 확인 실패', error.message);
    } finally {
      active = false;
    }
  }
  timer = setInterval(tick, 60_000);
  timer.unref();
  void tick();
  try {
    await runSocket(store, appToken, botToken, auth.team_id);
  } finally {
    clearInterval(timer);
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
