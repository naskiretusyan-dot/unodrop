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

    const { data, error } = await supabase
      .from('deposits')
      .select('invoice_id,amount_rub,created_at')
      .eq('telegram_id', telegramId)
      .eq('status', 'paid')
      .eq('processed', false)
      .order('created_at', { ascending: true });

    if (error) throw error;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deposits: data || [] }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: e.message || 'Server error' }),
    };
  }
};
