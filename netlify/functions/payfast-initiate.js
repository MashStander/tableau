// payfast-initiate.js — creates a signed PayFast payment and returns the form parameters
// Called by the site when a buyer clicks "Buy".  Runs on Netlify (server-side),
// so the credentials never appear in the browser.

const crypto = require('crypto');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { tier, email, firstName } = JSON.parse(event.body || '{}');

    if (!tier || !email) {
      return { statusCode: 400, body: 'Missing tier or email' };
    }

    const amount   = tier === 2 ? '200.00' : '100.00';
    const itemName = tier === 2
      ? 'Tableau Full Planner (1 year)'
      : 'Tableau Guest Page Plan (1 year)';

    // Build the PayFast parameters in the order PayFast expects them
    const params = {
      merchant_id:   process.env.PAYFAST_MERCHANT_ID,
      merchant_key:  process.env.PAYFAST_MERCHANT_KEY,
      return_url:    'https://tableauevents.co.za/?payment=success',
      cancel_url:    'https://tableauevents.co.za/?payment=cancelled',
      notify_url:    'https://tableauevents.co.za/.netlify/functions/payfast-notify',
      name_first:    firstName || '',
      email_address: email,
      amount,
      item_name:     itemName,
    };

    // Build the signature string — skip empty values, then append passphrase
    const sigParts = [];
    for (const [key, value] of Object.entries(params)) {
      if (value !== '') {
        sigParts.push(`${key}=${encodeURIComponent(value).replace(/%20/g, '+')}`);
      }
    }
    const passphrase = process.env.PAYFAST_PASSPHRASE;
    if (passphrase) {
      sigParts.push(`passphrase=${encodeURIComponent(passphrase).replace(/%20/g, '+')}`);
    }
    params.signature = crypto.createHash('md5').update(sigParts.join('&')).digest('hex');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        url:    'https://www.payfast.co.za/eng/process',
        params,
      }),
    };

  } catch (err) {
    console.error('payfast-initiate error:', err);
    return { statusCode: 500, body: 'Internal error' };
  }
};
