const axios = require('axios');

const API_BASE = 'https://pay.crypt.bot/api';

function getCryptoPayClient() {
  const token = process.env.CRYPTOPAY_TOKEN;
  if (!token) throw new Error('Missing CRYPTOPAY_TOKEN');

  const http = axios.create({
    baseURL: API_BASE,
    headers: {
      'Crypto-Pay-API-Token': token,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  });

  return http;
}

async function createInvoice({ amount, asset, payload }) {
  const http = getCryptoPayClient();
  const res = await http.post('/createInvoice', {
    amount,
    asset,
    payload,
    allow_comments: false,
    allow_anonymous: false,
  });

  if (!res.data?.ok) throw new Error('CryptoPay createInvoice failed');
  return res.data.result;
}

async function getInvoiceById(invoiceId) {
  const http = getCryptoPayClient();
  const res = await http.post('/getInvoices', { invoice_ids: String(invoiceId) });
  if (!res.data?.ok) throw new Error('CryptoPay getInvoices failed');
  const items = res.data.result?.items || [];
  return items[0] || null;
}

module.exports = {
  createInvoice,
  getInvoiceById,
};
