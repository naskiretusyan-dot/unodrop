const { getSupabaseAdmin } = require('./_supabase');
const { getInvoiceById } = require('./_cryptopay');

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const body = JSON.parse(event.body || '{}');
    const update = body;

    const invoiceId = update?.payload?.invoice_id || update?.invoice_id || update?.result?.invoice_id;
    if (!invoiceId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing invoice_id' }) };
    }

    const invoice = await getInvoiceById(invoiceId);
    if (!invoice) return { statusCode: 404, body: JSON.stringify({ error: 'Invoice not found' }) };

    if (invoice.status !== 'paid') {
      return { statusCode: 200, body: JSON.stringify({ ok: true, status: invoice.status }) };
    }

    const supabase = getSupabaseAdmin();

    const rate = Number(process.env.USDT_TO_RUB_RATE || 0);
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error('Missing or invalid USDT_TO_RUB_RATE');
    }

    const { data: dep, error: depErr } = await supabase
      .from('deposits')
      .select('invoice_id,telegram_id,amount_usdt,status')
      .eq('invoice_id', invoiceId)
      .maybeSingle();

    if (depErr) throw depErr;
    if (!dep) {
      return { statusCode: 200, body: JSON.stringify({ ok: true, note: 'deposit not tracked' }) };
    }

    if (dep.status === 'paid') {
      return { statusCode: 200, body: JSON.stringify({ ok: true, note: 'already paid' }) };
    }

    const telegramId = dep.telegram_id;
    const amountUsdt = Number(dep.amount_usdt);

    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('telegram_id,balance_rub')
      .eq('telegram_id', telegramId)
      .single();

    if (userErr) throw userErr;

    const rubToAdd = amountUsdt * rate;
    const newBalance = Number(user.balance_rub || 0) + rubToAdd;

    const { error: updUserErr } = await supabase
      .from('users')
      .update({ balance_rub: newBalance })
      .eq('telegram_id', telegramId);

    if (updUserErr) throw updUserErr;

    const { error: updDepErr } = await supabase
      .from('deposits')
      .update({ status: 'paid', amount_rub: rubToAdd, processed: false })
      .eq('invoice_id', invoiceId);

    if (updDepErr) throw updDepErr;

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: e.message || 'Server error' }),
    };
  }
};
