const { verifyTelegramInitData } = require('./_telegram');
const { getSupabaseAdmin, ensureUser } = require('./_supabase');

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const adminSecret = process.env.DEV_ADMIN_SECRET;
    if (!adminSecret) {
      return { statusCode: 403, body: JSON.stringify({ error: 'DEV_ADMIN_SECRET not set' }) };
    }

    const body = JSON.parse(event.body || '{}');

    if (body.adminSecret !== adminSecret) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
    }

    const initData = body.initData;
    const tg = verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN);
    if (!tg.ok) return { statusCode: 401, body: JSON.stringify({ error: tg.error }) };

    const telegramId = tg.user.id;
    const amountRub = Number(body.amount_rub);

    if (!Number.isFinite(amountRub) || amountRub <= 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Bad amount_rub' }) };
    }

    const supabase = getSupabaseAdmin();
    await ensureUser(supabase, telegramId);

    // Create a synthetic invoice_id
    const invoiceId = Date.now();

    const { error: insErr } = await supabase.from('deposits').insert({
      invoice_id: invoiceId,
      telegram_id: telegramId,
      amount_usdt: 0,
      amount_rub: amountRub,
      status: 'paid',
      processed: false,
    });

    if (insErr) throw insErr;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, invoice_id: invoiceId, amount_rub: amountRub }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: e.message || 'Server error' }),
    };
  }
};
