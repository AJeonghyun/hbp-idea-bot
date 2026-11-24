import { pathToFileURL } from 'node:url';
import { slackClient, botHistory } from './ideas.mjs';

const EDITION = '영상 아이디어 · ';
const NOTICE = '제작 주제 선정 · ';
const HOUR = 3600;
const NUMBER_EMOJI = ['one', 'two', 'three', 'four', 'five', 'six', 'seven'];

export function winningTopic(message) {
  const votes = NUMBER_EMOJI.map(name => message.reactions?.find(reaction => reaction.name === name)?.count ?? 0);
  const count = Math.max(...votes);
  if (count < 2 || votes.filter(v => v === count).length !== 1) return;
  const number = votes.indexOf(count) + 1;
  const lines = message.text.split('\n').map(line => line.trim());
  const row = lines.findIndex(line => line.startsWith(number + '. '));
  if (row < 0 || !lines[row + 1] || /^\d+\. /.test(lines[row + 1])) {
    throw new Error(`선정 항목을 읽을 수 없습니다 (${message.ts}, ${number}번).`);
  }
  return { number, count, question: lines[row].slice(3), scene: lines[row + 1] };
}

export async function tally({ env = process.env, now = new Date(), request = fetch } = {}) {
  const channel = env.SLACK_CHANNEL_ID;
  if (!channel || !env.SLACK_BOT_TOKEN) throw new Error('SLACK_CHANNEL_ID와 SLACK_BOT_TOKEN을 설정하세요.');
  const slack = slackClient(env.SLACK_BOT_TOKEN, request);
  const current = now.getTime() / 1000;
  const oldest = current - 7 * 24 * HOUR;
  const history = await botHistory(slack, channel, oldest, [EDITION, NOTICE]);
  const notices = history.filter(row => row.text.startsWith(NOTICE)).map(row => row.text);
  let examined = 0;
  let announced = 0;
  for (const message of history) {
    if (!message.text.startsWith(EDITION) || Number(message.ts) < oldest || current - Number(message.ts) < 11 * HOUR) continue;
    examined++;
    // The original permalink is both the readers' route to vote details and the per-edition identifier.
    const original = `/archives/${channel}/p${message.ts.replace('.', '')}`;
    if (notices.some(text => text.includes(original + '|') || text.includes(original + '>'))) continue;
    const winner = winningTopic(message);
    if (!winner) continue;
    const edition = message.text.split('\n')[0].slice(EDITION.length);
    const { permalink } = await slack('chat.getPermalink', { channel, message_ts: message.ts });
    if (!permalink?.endsWith(original)) throw new Error('Slack 추천 글 링크를 확인하지 못했습니다.');
    const text = [
      NOTICE + edition,
      `팀원 투표에서 ${winner.count}표로 단독 1위를 차지한 ${winner.number}번을 제작 주제로 선정했어요.`,
      winner.question,
      '첫 장면 · ' + winner.scene,
      `<${permalink}|원래 추천 글과 투표 보기>`,
    ].join('\n\n');
    const result = await slack('chat.postMessage', { channel, text, unfurl_links: false, unfurl_media: false });
    if (!result.ts) throw new Error('선정 공지의 Slack 게시 결과를 확인하지 못했습니다.');
    notices.push(text);
    announced++;
  }
  return { examined, announced };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await tally()));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
