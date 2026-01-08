const { verifyTelegramInitData } = require('./_telegram');
const { getSupabaseAdmin, ensureUser } = require('./_supabase');

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const body = JSON.parse(event.body || '{}');
    const initData = body.initData;

    const tg = verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN);
    if (!tg.ok) return { statusCode: 401, body: JSON.stringify({ error: tg.error }) };

    const telegramId = tg.user.id;
    const items = Array.isArray(body.items) ? body.items : [];

    const supabase = getSupabaseAdmin();
    await ensureUser(supabase, telegramId);

    const normalized = items.map((it) => ({
      name: String(it?.name || 'Skin'),
      img: String(it?.img || ''),
      price: Number(it?.price || 0),
    }));

    const { error: upErr } = await supabase
      .from('user_inventory')
      .upsert({ telegram_id: telegramId, items: normalized }, { onConflict: 'telegram_id' });

    if (upErr) throw upErr;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, telegram_id: telegramId, items: normalized }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: e.message || 'Server error' }),
    };
  }
};
