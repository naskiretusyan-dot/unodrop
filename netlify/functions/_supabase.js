const { createClient } = require('@supabase/supabase-js');

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

async function ensureUser(supabase, telegramId) {
  const { data: existing, error: selErr } = await supabase
    .from('users')
    .select('telegram_id,balance_rub')
    .eq('telegram_id', telegramId)
    .maybeSingle();

  if (selErr) throw selErr;

  if (existing) return existing;

  const { data: inserted, error: insErr } = await supabase
    .from('users')
    .insert({ telegram_id: telegramId, balance_rub: 0 })
    .select('telegram_id,balance_rub')
    .single();

  if (insErr) throw insErr;
  return inserted;
}

module.exports = {
  getSupabaseAdmin,
  ensureUser,
};
