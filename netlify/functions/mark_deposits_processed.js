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
    const invoiceIds = Array.isArray(body.invoice_ids) ? body.invoice_ids : [];

    if (invoiceIds.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing invoice_ids' }) };
    }

    const supabase = getSupabaseAdmin();
    await ensureUser(supabase, telegramId);

    const { error } = await supabase
      .from('deposits')
      .update({ processed: true })
      .eq('telegram_id', telegramId)
      .in('invoice_id', invoiceIds);

    if (error) throw error;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: e.message || 'Server error' }),
    };
  }
};
