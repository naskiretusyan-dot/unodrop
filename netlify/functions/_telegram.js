const crypto = require('crypto');

function parseInitData(initData) {
  const params = new URLSearchParams(initData);
  const obj = {};
  for (const [k, v] of params.entries()) obj[k] = v;
  return obj;
}

function buildDataCheckString(obj) {
  return Object.keys(obj)
    .filter((k) => k !== 'hash')
    .sort()
    .map((k) => `${k}=${obj[k]}`)
    .join('\n');
}

function verifyTelegramInitData(initData, botToken) {
  if (!initData) return { ok: false, error: 'Missing initData' };
  if (!botToken) return { ok: false, error: 'Missing bot token' };

  const data = parseInitData(initData);
  if (!data.hash) return { ok: false, error: 'Missing hash' };

  const dataCheckString = buildDataCheckString(data);

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (computedHash !== data.hash) return { ok: false, error: 'Bad signature' };

  let user = null;
  try {
    user = data.user ? JSON.parse(data.user) : null;
  } catch {
    return { ok: false, error: 'Bad user JSON' };
  }

  if (!user?.id) return { ok: false, error: 'Missing user.id' };

  return { ok: true, user };
}

module.exports = {
  verifyTelegramInitData,
};
