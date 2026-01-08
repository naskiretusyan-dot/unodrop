const axios = require('axios');
const { verifyTelegramInitData } = require('./_telegram');

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const body = JSON.parse(event.body || '{}');
    const initData = body.initData;

    const tg = verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN);
    if (!tg.ok) return { statusCode: 401, body: JSON.stringify({ error: tg.error }) };

    const user = tg.user;
    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    let photoUrl = null;
    try {
      const photosRes = await axios.get(`https://api.telegram.org/bot${botToken}/getUserProfilePhotos`, {
        params: { user_id: user.id, limit: 1 },
        timeout: 15000,
      });

      const ok = photosRes.data?.ok;
      const photos = photosRes.data?.result?.photos;
      if (ok && photos && photos.length > 0 && photos[0].length > 0) {
        const fileId = photos[0][0].file_id;
        const fileRes = await axios.get(`https://api.telegram.org/bot${botToken}/getFile`, {
          params: { file_id: fileId },
          timeout: 15000,
        });
        const filePath = fileRes.data?.result?.file_path;
        if (fileRes.data?.ok && filePath) {
          photoUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
        }
      }
    } catch {
      // ignore: avatar is optional
    }

    const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telegram_id: user.id,
        name: name || user.username || 'User',
        username: user.username || null,
        photo_url: photoUrl,
      }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: e.message || 'Server error' }),
    };
  }
};
