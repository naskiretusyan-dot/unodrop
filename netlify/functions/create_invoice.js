const { verifyTelegramInitData } = require('./_telegram');
const { getSupabaseAdmin, ensureUser } = require('./_supabase');
const { createInvoice } = require('./_cryptopay');

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const body = JSON.parse(event.body || '{}');
    const initData = body.initData;
    const amount = Number(body.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Bad amount' }) };
    }

    const tg = verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN);
    if (!tg.ok) return { statusCode: 401, body: JSON.stringify({ error: tg.error }) };

    const telegramId = tg.user.id;

    const supabase = getSupabaseAdmin();
    await ensureUser(supabase, telegramId);

    const payload = JSON.stringify({ telegram_id: telegramId, amount });

    const invoice = await createInvoice({ amount, asset: 'USDT', payload });

    await supabase.from('deposits').insert({
      invoice_id: invoice.invoice_id,
      telegram_id: telegramId,
      amount_usdt: amount,
      status: invoice.status || 'active',
      processed: false,
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        invoice_id: invoice.invoice_id,
        status: invoice.status,
        pay_url: invoice.pay_url,
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
