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

    const supabase = getSupabaseAdmin();
    await ensureUser(supabase, telegramId);

    const { data: inv, error: invErr } = await supabase
      .from('user_inventory')
      .select('items')
      .eq('telegram_id', telegramId)
      .maybeSingle();

    if (invErr) throw invErr;

    const items = Array.isArray(inv?.items) ? inv.items : [];
    const balance = items.reduce((sum, it) => sum + Number(it?.price || 0), 0);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegram_id: telegramId, balance_rub: Number(balance || 0) }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: e.message || 'Server error' }),
    };
  }
};
