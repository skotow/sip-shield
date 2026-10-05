export async function sendTelegram(token, chatId) {
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(token || '') || !chatId) throw new Error('Set a valid Telegram bot token and chat ID first');
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: 'SIP Shield test alert: gateway management is online.' }),
    signal: AbortSignal.timeout(10000)
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error('Telegram rejected the alert; check token and chat ID');
}
