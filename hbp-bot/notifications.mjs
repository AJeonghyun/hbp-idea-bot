import { createHash } from 'node:crypto';

function deliveryId({ team, name, key }) {
  const hex = createHash('sha256').update(JSON.stringify([team, name, key])).digest('hex');
  return [hex.slice(0, 8), hex.slice(8, 12), '4' + hex.slice(13, 16),
    '8' + hex.slice(17, 20), hex.slice(20, 32)].join('-');
}

export async function deliverNotifications(store, api, team, onError = console.error) {
  for (const item of store.pendingNotifications(Date.now())) {
    if (item.team !== team) continue;
    try {
      await api('chat.postMessage', {
        channel: item.user, text: item.text, client_msg_id: deliveryId(item),
        unfurl_links: false, unfurl_media: false
      });
      store.markNotified(item.team, item.name, item.key);
    } catch (error) {
      onError('제작 알림 전송 실패', error.message);
    }
  }
}
