import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { catalog } from './catalog.mjs';

const DAY = 86_400_000;
const ENTERTAINMENT_FEED = 'https://www.yna.co.kr/rss/entertainment.xml';
const REQUEST_TIMEOUT = 15_000;

export function edition(now, slot) {
  if (!['09', '21'].includes(slot)) throw new Error('IDEA_SLOT에 09 또는 21을 설정하세요.');
  const date = new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
  return {
    title: `영상 아이디어 · ${date} ${slot === '09' ? '오전판' : '저녁판'}`,
    postAt: Date.parse(`${date}T${slot}:00:00+09:00`) / 1000,
  };
}

function escapeText(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function readTag(item, tag) {
  const match = item.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
  return (match?.[1] ?? '').replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1')
    .replace(/&(?:quot|apos|amp|lt|gt|#39);/g, entity => ({
      '&quot;': '"', '&apos;': "'", '&amp;': '&', '&lt;': '<', '&gt;': '>', '&#39;': "'",
    })[entity]).trim();
}

// Use the publisher's RSS headlines as article references. Each angle is tied to a specific reporting question.
const storyAngles = [
  [/원작|각색|실사화/, '원작의 한 장면은 화면에서 어떻게 달라졌을까?', '원작 소개와 공식 예고편에서 같은 사건을 찾아 두 장면의 시점과 구도를 비교한다.'],
  [/리메이크/, '새 버전은 원작의 어떤 순간을 살렸을까?', '두 버전의 공식 소개에서 같은 대목을 찾고 달라진 표현을 짚어 본다.'],
  [/(티켓|공연|투어|콘서트).{0,18}(매진|예매|선예매)/, '팬이 실제로 표를 구하는 과정은 어떨까?', '공식 예매 공지를 열고 좌석도와 판매 일정을 한 화면에서 읽는다.'],
  [/월드투어|월드 투어/, '이 투어는 어떤 도시를 거쳐 갈까?', '공식 발표에 나온 도시만 지도에 찍고 공연 일정에 맞춰 순서대로 잇는다.'],
  [/시청률|관객.{0,10}(만명|만 명|돌파)|박스오피스|차트.{0,12}(위|진입|정상)/, '이 기록은 무엇을 세어 만든 걸까?', '기사에 인용된 집계표에서 측정 기간과 단위를 먼저 가린 뒤 하나씩 공개한다.'],
  [/영화제.{0,15}(수상|후보)|시상식|남우주연상|여우주연상|작품상|신인상/, '이 상은 누가 어떤 기준으로 고를까?', '주최 측의 부문별 심사 기준에서 후보 자격과 최종 선정 방식을 찾아본다.'],
  [/선공개곡|타이틀곡|미니앨범|정규앨범|정규 앨범/, '팬들이 앨범을 듣기 전에 먼저 만나는 곡은 뭘까?', '공식 공개 일정에서 첫 티저부터 앨범 발매일까지를 타임라인으로 정리한다.'],
];

export function parseFeed(xml, now) {
  const stories = [];
  for (const item of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const title = readTag(item[1], 'title').replace(/\s+/g, ' ');
    const link = readTag(item[1], 'link');
    const published = Date.parse(readTag(item[1], 'pubDate'));
    const age = now.getTime() - published;
    if (!Number.isFinite(age) || age < 0 || age > 3 * DAY || !/^https:\/\/www\.yna\.co\.kr\/view\/[A-Za-z0-9]+$/.test(link)) continue;
    if (!title || title.length > 130 || /\[속보\]|\[부고\]|\[인사\]|사망|피살|성폭|참사|자살|열애설|루머|포토|피의자|피고인|기소|수사|해임|비위|횡령|협약|맞손|업무협력|인사말/.test(title)) continue;
    const angle = storyAngles.find(([keyword]) => keyword.test(title));
    if (angle) stories.push({ headline: title, question: angle[1], scene: angle[2], link, published });
  }
  return stories;
}

async function recentNews(now, request) {
  try {
    const response = await request(ENTERTAINMENT_FEED, { signal: AbortSignal.timeout(REQUEST_TIMEOUT) });
    if (!response.ok) throw new Error(String(response.status));
    return parseFeed(await response.text(), now);
  } catch (error) {
    console.warn('연예 기사 피드를 읽지 못해 일상 주제로 구성합니다.', error.message);
    return [];
  }
}

function rank(seed, value) {
  return createHash('sha256').update(seed).update(value).digest().readUInt32BE(0);
}

// Each material comparison is confined to a physical property it is meaningful to measure.
const experimentFamilies = [
  {
    pairs: ['청바지와 면 티셔츠', '극세사 수건과 면 수건', '양말과 손수건', '행주와 수세미', '펠트와 면 천'],
    angles: [
      ['같은 양의 물을 흘리면 어느 쪽에 더 넓게 번질까?', '같은 크기의 천에 스포이트로 한 방울씩 떨어뜨리고 30초 뒤 번진 면적을 겹쳐 본다.'],
      ['물에 적셨다가 널면 어느 쪽이 먼저 마를까?', '같은 크기로 잘라 같은 무게의 물을 더한 뒤 10분마다 저울 눈금을 기록한다.'],
      ['끝만 물에 담가도 물이 위로 올라갈까?', '두 재료를 같은 너비로 잘라 색소 물에 끝을 담그고 물이 올라간 높이를 표시한다.'],
    ],
  },
  {
    pairs: ['보온병과 머그잔', '종이컵과 유리컵', '스테인리스 컵과 플라스틱 컵', '뚜껑 덮은 컵과 열린 컵', '넓은 그릇과 좁은 컵'],
    angles: [
      ['같은 온도의 물을 담으면 10분 뒤 몇 도 차이 날까?', '같은 양의 따뜻한 물을 동시에 붓고 온도계 두 개를 한 화면에서 찍는다.'],
      ['얼음을 똑같이 넣으면 어느 쪽에 더 오래 남을까?', '같은 무게의 얼음을 넣은 뒤 일정 시간마다 녹은 물의 양을 잰다.'],
      ['얼음물을 담으면 겉에 맺히는 물도 같은 양일까?', '용기 표면의 물기를 먼저 닦고 같은 시간 뒤 마른 천으로 닦아 무게 변화를 비교한다.'],
    ],
  },
  {
    pairs: ['신문지와 도화지', '종이 타월과 휴지', '복사용지와 잡지 종이', '커피 필터와 유산지', '골판지와 두꺼운 도화지'],
    angles: [
      ['물방울은 어느 쪽에서 더 오래 남을까?', '한 방울씩 떨어뜨리는 순간을 옆에서 찍고 윤곽이 사라질 때까지 시간을 잰다.'],
      ['손으로 찢으면 방향에 따라 모양이 달라질까?', '두 재료를 가로와 세로로 한 번씩 찢고 찢긴 가장자리를 확대한다.'],
      ['같은 폭의 다리를 만들면 동전을 얼마나 버틸까?', '같은 간격으로 세운 책 위에 재료를 놓고 가운데에 동전을 한 개씩 올린다.'],
    ],
  },
  {
    pairs: ['마룻바닥과 러그', '책상과 마우스패드', '매끈한 종이와 사포', '고무 매트와 타일', '펠트와 골판지'],
    angles: [
      ['같은 물건이 미끄러지기 시작하는 각도는 얼마나 다를까?', '각 표면을 판 위에 올린 뒤 같은 지우개가 움직이는 순간의 경사각을 잰다.'],
      ['구슬을 굴리면 멈추는 자리도 달라질까?', '동일한 경사로 끝에 두 표면을 번갈아 붙이고 구슬이 굴러간 거리를 표시한다.'],
      ['같은 탁구공을 떨어뜨리면 얼마나 다르게 튈까?', '같은 높이에서 놓은 공의 첫 반동을 눈금과 함께 슬로모션으로 찍는다.'],
    ],
  },
  {
    pairs: ['탁구공과 테니스공', '골프공과 고무공', '농구공과 배구공', '야구공과 테니스공', '폼볼과 탁구공'],
    angles: [
      ['같은 높이에서 놓으면 어떤 공이 더 높이 되튈까?', '같은 바닥에 동시에 놓고 첫 반동의 꼭대기를 정지 화면에 표시한다.'],
      ['같은 자리에 떨어뜨려도 바닥 소리가 왜 다를까?', '마이크 위치를 고정하고 공이 닿는 첫 순간의 파형과 실제 소리를 이어 붙인다.'],
      ['같은 경사로를 내려오면 도착 시간이 같을까?', '출발선을 가로지른 자를 들어 두 공을 동시에 놓고 결승선을 슬로모션으로 찍는다.'],
    ],
  },
  {
    pairs: ['스테인리스 숟가락과 나무 숟가락', '도자기 접시와 금속 쟁반', '유리판과 나무판', '실리콘 받침과 돌 받침', '알루미늄 포일과 종이'],
    angles: [
      ['실내 온도는 같은데 어느 쪽이 더 차갑게 느껴질까?', '두 재료를 같은 방에 둔 뒤 접촉식 온도계의 값과 손끝의 첫 느낌을 대조한다.'],
      ['같은 크기의 얼음을 올리면 어느 쪽이 먼저 녹을까?', '실온에 충분히 둔 두 표면 위에 얼음을 놓고 물이 처음 고이는 시간을 찍는다.'],
    ],
  },
];

const experiments = experimentFamilies.flatMap(({ pairs, angles }) =>
  pairs.flatMap(pair => angles.map(([question, scene]) => [`${pair}, ${question}`, scene])));
const ideas = [...catalog, ...experiments];

export function composeMessage(title, history, stories, source = ideas) {
  const used = new Map();
  for (const { text, ts } of history) {
    for (const line of text.split('\n')) {
      const entry = line.match(/^\d+\. (.+)$/);
      if (entry) used.set(entry[1], Math.max(used.get(entry[1]) ?? 0, Number(ts)));
    }
  }
  const historyText = history.map(message => message.text).join('\n');
  const angles = new Set();
  const headlines = [];
  const newStories = stories.filter(story => !historyText.includes(story.link) && !historyText.includes(escapeText(story.headline)))
    .sort((a, b) => b.published - a.published);
  for (const story of newStories) {
    if (angles.has(story.question) || headlines.some(item => item.link === story.link)) continue;
    angles.add(story.question);
    headlines.push(story);
    if (headlines.length === 2) break;
  }
  const ranked = [...source].sort(([a], [b]) => (used.get(escapeText(a)) ?? 0) - (used.get(escapeText(b)) ?? 0)
    || rank(title, a) - rank(title, b));
  const entries = [];
  const scenes = new Set();
  for (const [question, scene] of ranked) {
    if (scenes.has(scene)) continue;
    scenes.add(scene);
    entries.push({ question, scene });
    if (entries.length === 7 - headlines.length) break;
  }
  entries.push(...headlines);
  if (entries.length !== 7) throw new Error('아이디어 7개를 구성할 수 없습니다.');

  const editionInfo = title.match(/(\d{4})-(\d{2})-(\d{2}) (오전판|저녁판)$/);
  const heading = editionInfo
    ? (editionInfo[4] === '오전판' ? '☀️ 아침의 영상 아이디어' : '🌙 저녁의 영상 아이디어')
    : title;
  const blocks = [{ type: 'header', text: { type: 'plain_text', text: heading, emoji: true } }];
  if (editionInfo) {
    const [, year, month, day] = editionInfo;
    blocks.push({ type: 'context', elements: [{ type: 'plain_text', text: `${year}년 ${Number(month)}월 ${Number(day)}일  ·  오늘의 주제 7개` }] });
  }

  const fallback = [title];
  entries.forEach(({ question, scene, headline, link, published }, index) => {
    if (index === 0 || (headlines.length && index === entries.length - headlines.length)) {
      blocks.push({ type: 'divider' }, { type: 'context', elements: [{
        type: 'mrkdwn', text: headline ? '*연예 뉴스에서*' : '*일상에서 찾은 질문*',
      }] });
    }
    const number = index + 1;
    const content = [
      { type: 'text', text: `${number}.  ${question}`, style: { bold: true } },
    ];
    let fallbackQuestion = escapeText(question);
    let fallbackScene = escapeText(scene);
    if (headline) {
      const date = new Date(published + 9 * 3_600_000).toISOString().slice(5, 10);
      // Use a native link for the publisher's headline so punctuation remains literal.
      content.push({ type: 'text', text: '\n' }, { type: 'link', url: link, text: headline },
        { type: 'text', text: `  ·  연합뉴스 ${date}` });
      fallbackQuestion = `“${escapeText(headline)}” — ${fallbackQuestion}`;
      fallbackScene += ` · <${link}|연합뉴스 ${date} 보도>`;
    }
    content.push({ type: 'text', text: `\n첫 장면  ·  ${scene}` });
    blocks.push({ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: content }] });
    fallback.push(`${number}. ${fallbackQuestion}\n   ${fallbackScene}`);
  });
  const ballot = '마음에 드는 주제의 번호 이모지로 투표해 주세요. 3번은 반응 추가에서 three를 검색해 3️⃣를 고르면 돼요. 여러 번호에 투표할 수 있고, 이모지 옆 숫자가 현재 득표수예요.';
  blocks.push({ type: 'divider' }, { type: 'context', elements: [{ type: 'mrkdwn', text: `*🗳️ 팀 투표*　${ballot}` }] });
  fallback.push(ballot);
  return { text: fallback.join('\n\n'), blocks };
}

export function compose(title, history, stories, source = ideas) {
  return composeMessage(title, history, stories, source).text;
}

function slackClient(token, request) {
  return async (method, fields = {}) => {
    const url = new URL(`https://slack.com/api/${method}`);
    const get = method === 'conversations.history';
    if (get) url.search = new URLSearchParams(fields).toString();
    const response = await request(url, {
      method: get ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
      ...(get ? {} : { body: JSON.stringify(fields) }), signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });
    if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
    const result = await response.json();
    if (!result.ok) throw new Error(`${method}: ${result.error}`);
    return result;
  };
}

async function botHistory(slack, channel, oldest) {
  const auth = await slack('auth.test');
  const messages = [];
  let cursor;
  do {
    const page = await slack('conversations.history', { channel, oldest: String(oldest), limit: 200, ...(cursor ? { cursor } : {}) });
    for (const message of page.messages) {
      if (((auth.bot_id && message.bot_id === auth.bot_id) || message.user === auth.user_id)
          && message.text?.startsWith('영상 아이디어 · ')) messages.push(message);
    }
    cursor = page.response_metadata?.next_cursor;
  } while (cursor);
  return messages;
}

export async function run({ env = process.env, dryRun = false, now = () => new Date(), request = fetch } = {}) {
  const started = now();
  const { title, postAt } = edition(started, env.IDEA_SLOT);
  const secondsToSlot = postAt - started.getTime() / 1000;
  // Manual dispatch can recover today's edition until the adjacent edition is due.
  const outsideWindow = env.MANUAL_DISPATCH === 'true'
    ? Math.abs(secondsToSlot) >= 12 * 3600
    : secondsToSlot < -90 * 60 || secondsToSlot > 3 * 3600;
  if (!dryRun && outsideWindow) return { status: 'stale' };
  const channel = env.SLACK_CHANNEL_ID;
  const slack = slackClient(env.SLACK_BOT_TOKEN, request);
  let history = [];
  if (!dryRun) {
    if (!channel || !env.SLACK_BOT_TOKEN) throw new Error('SLACK_CHANNEL_ID와 SLACK_BOT_TOKEN을 설정하세요.');
    const pending = await slack('chat.scheduledMessages.list', { channel, oldest: String(postAt - 1), latest: String(postAt + 1) });
    if (pending.scheduled_messages.some(row => Number(row.post_at) === postAt)) return { status: 'already-scheduled' };
    history = await botHistory(slack, channel, postAt - 90 * DAY / 1000);
    if (history.some(row => row.text.split('\n')[0] === title)) return { status: 'already-sent' };
  }
  const message = composeMessage(title, history, await recentNews(started, request));
  if (dryRun) return { status: 'preview', ...message };
  const scheduled = postAt > now().getTime() / 1000;
  const fields = { channel, ...message, unfurl_links: false, unfurl_media: false, ...(scheduled ? { post_at: postAt } : {}) };
  const response = await slack(scheduled ? 'chat.scheduleMessage' : 'chat.postMessage', fields);
  const id = scheduled ? response.scheduled_message_id : response.ts;
  if (!id) throw new Error('Slack 전송 확인값을 받지 못했습니다. 다시 실행하여 예약·게시 기록을 확인하세요.');
  return { status: scheduled ? 'scheduled' : 'sent', id, postAt };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await run({ dryRun: process.argv.includes('--dry-run') });
    console.log(result.text ?? JSON.stringify(result));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
