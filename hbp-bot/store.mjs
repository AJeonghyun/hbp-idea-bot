import { DatabaseSync } from 'node:sqlite';

const roles = {
  script: 'visualOwner', image: 'visualOwner', subtitle: 'visualOwner',
  bgm: 'musicOwner', voice: 'visualOwner', draft: 'editor',
};
const labels = {
  script: '대본', image: '이미지', subtitle: '요약 자막',
  bgm: 'BGM', voice: '목소리 샘플', draft: '편집 초안',
};
const inputs = ['script', 'image', 'subtitle', 'bgm'];

function slackId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9]+$/.test(value)) {
    throw new Error('채널과 담당자를 확인해 주세요.');
  }
  return value;
}

function assignees(value) {
  const users = Array.isArray(value) ? value : [value];
  if (!users.length) throw new Error('역할마다 담당자를 한 명 이상 선택해 주세요.');
  return [...new Set(users.map(slackId))];
}

function readEpisode(row) {
  const episode = JSON.parse(row.body);
  for (const role of ['editor', 'visualOwner', 'musicOwner']) {
    episode[role] = assignees(episode[role]);
  }
  return episode;
}

function quantity(value, description) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 10000) {
    throw new Error(description + '는 1~10000 사이의 정수여야 합니다.');
  }
  return value;
}

function assetUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('자료의 전체 HTTPS 링크를 입력해 주세요.');
  }
  if (typeof raw !== 'string' || !/^https:\/\//i.test(raw) || raw.length > 2500 || /[\s<>|\\]/u.test(raw)
      || parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error('자료의 전체 HTTPS 링크를 입력해 주세요.');
  }
  return parsed.href;
}

function requireKind(kind) {
  if (!Object.hasOwn(roles, kind)) throw new Error('자료 종류를 확인해 주세요.');
}

function submitted(episode, kind) {
  const assets = episode.assets.filter(asset => asset.kind === kind);
  if (kind === 'image') {
    return assets.reduce((total, asset) => total + asset.count, 0) >= episode.target;
  }
  return assets.length > 0;
}

function escapeSlack(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function notificationsFor(episode, now) {
  const missing = inputs.filter(kind => !submitted(episode, kind));
  const name = escapeSlack(episode.name);
  const link = episode.ts && 'https://app.slack.com/client/' + episode.team + '/' +
      episode.channel + '?message_ts=' + episode.ts;
  if (missing.length === 0) {
    const links = link ? '<' + link + '|회차 카드 열기>' : inputs.map(kind => {
      const last = episode.assets.filter(asset => asset.kind === kind).at(-1);
      return '<' + escapeSlack(last.url) + '|' + labels[kind] + '>';
    }).join(' · ');
    const text = name + ' 편집 자료가 모두 제출됐습니다. ' + links;
    // Keep the original delivery key for single-editor cards already notified.
    return episode.editor.map(user => ({
      key: episode.editor.length === 1 ? 'ready' : 'ready:' + user, user, text
    }));
  }
  if (!episode.due || episode.due > now) return [];
  const owners = new Map();
  for (const kind of missing) {
    for (const owner of episode[roles[kind]]) {
      if (!owners.has(owner)) owners.set(owner, []);
      owners.get(owner).push(labels[kind]);
    }
  }
  return [...owners].map(([user, items]) => ({
    key: 'overdue:' + user, user,
    text: name + ' 자료 마감이 지났습니다. 남은 항목은 ' + items.join(', ') + '입니다.' +
      (link ? ' <' + link + '|회차 카드 열기>' : ''),
  }));
}

export function openStore(path) {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS episodes (
      team TEXT NOT NULL, name TEXT NOT NULL, body TEXT NOT NULL,
      PRIMARY KEY (team, name)
    );
    CREATE TABLE IF NOT EXISTS sent_notifications (
      team TEXT NOT NULL, name TEXT NOT NULL, key TEXT NOT NULL,
      PRIMARY KEY (team, name, key)
    );
  `);
  const find = db.prepare('SELECT body FROM episodes WHERE team = ? AND name = ?');
  const write = db.prepare('UPDATE episodes SET body = ? WHERE team = ? AND name = ?');
  const insert = db.prepare('INSERT INTO episodes(team, name, body) VALUES (?, ?, ?)');
  const sent = db.prepare('SELECT 1 FROM sent_notifications WHERE team = ? AND name = ? AND key = ?');

  function get(team, name) {
    const row = find.get(team, name);
    return row && readEpisode(row);
  }

  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function change(team, name, edit) {
    return transaction(() => {
      const episode = get(team, name);
      if (!episode) throw new Error('회차를 찾을 수 없습니다.');
      edit(episode);
      write.run(JSON.stringify(episode), team, name);
      return episode;
    });
  }

  return {
    get,
    list(team) {
      return db.prepare('SELECT body FROM episodes WHERE team = ? ORDER BY rowid DESC')
        .all(team).map(readEpisode);
    },
    create({ team, name, channel, editor, visualOwner, musicOwner, target, due = null }) {
      if (typeof name !== 'string' || !name.trim() || name.trim().length > 75 || /[\p{Cc}]/u.test(name)) {
        throw new Error('회차 이름은 1~75자로 입력해 주세요.');
      }
      name = name.trim();
      slackId(team);
      slackId(channel);
      editor = assignees(editor);
      visualOwner = assignees(visualOwner);
      musicOwner = assignees(musicOwner);
      quantity(target, '목표 장수');
      if (due !== null && (!Number.isSafeInteger(due) || due <= 0 || due > 8640000000000000)) {
        throw new Error('마감 일시를 확인해 주세요.');
      }
      return transaction(() => {
        const existing = get(team, name);
        if (existing) return existing;
        const episode = { team, name, channel, editor, visualOwner, musicOwner, target, due,
          ts: null, assets: [], confirmed: {} };
        insert.run(team, name, JSON.stringify(episode));
        return episode;
      });
    },
    setCard(team, name, ts) {
      if (!/^\d+\.\d+$/.test(ts)) throw new Error('카드 메시지 번호가 올바르지 않습니다.');
      return change(team, name, episode => { episode.ts = ts; });
    },
    attach(team, name, { kind, url, count = 1, user }) {
      requireKind(kind);
      const link = assetUrl(url);
      if (kind === 'image') quantity(count, '이미지 장수');
      else count = 1;
      return change(team, name, episode => {
        if (!episode[roles[kind]].includes(user)) throw new Error('이 자료의 담당자만 등록할 수 있습니다.');
        const existing = episode.assets.find(asset => asset.kind === kind && asset.url === link);
        if (existing) {
          if (existing.count !== count) throw new Error('같은 링크가 다른 장수로 이미 등록됐습니다.');
          return;
        }
        episode.assets.push({ kind, url: link, count, user });
        delete episode.confirmed[kind];
      });
    },
    confirm(team, name, kind, revision, user) {
      requireKind(kind);
      return change(team, name, episode => {
        if (!episode.editor.includes(user)) throw new Error('이 회차의 편집자만 수신 확인할 수 있습니다.');
        const current = episode.assets.filter(asset => asset.kind === kind).length;
        if (current !== revision) throw new Error('새 자료가 등록됐습니다. 최신 카드를 확인해 주세요.');
        if (!submitted(episode, kind)) throw new Error('해당 자료가 모두 제출된 뒤 확인할 수 있습니다.');
        episode.confirmed[kind] = current;
      });
    },
    pendingNotifications(now = Date.now()) {
      const pending = [];
      for (const row of db.prepare('SELECT body FROM episodes').iterate()) {
        const episode = readEpisode(row);
        for (const item of notificationsFor(episode, now)) {
          if (!sent.get(episode.team, episode.name, item.key)) {
            pending.push({ team: episode.team, name: episode.name, ...item });
          }
        }
      }
      return pending;
    },
    markNotified(team, name, key) {
      db.prepare('INSERT OR IGNORE INTO sent_notifications(team,name,key) VALUES (?,?,?)')
        .run(team, name, key);
    },
    close() { db.close(); },
  };
}
