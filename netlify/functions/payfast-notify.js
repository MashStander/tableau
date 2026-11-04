// payfast-notify.js  — PayFast Instant Transaction Notification (ITN) handler
// Runs on Netlify every time a payment is confirmed by PayFast.
// It generates an access code in Supabase and emails it to the buyer via Resend.

const crypto = require('crypto');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    // --- 1. Parse the POST data PayFast sent us ---
    const params = new URLSearchParams(event.body);
    const data = {};
    for (const [key, value] of params.entries()) {
      data[key] = value;
    }

    // --- 2. Validate the signature so we know it really came from PayFast ---
    const receivedSignature = data['signature'];
    const sigParts = [];
    for (const [key, value] of params.entries()) {
      if (key !== 'signature') {
        sigParts.push(`${key}=${encodeURIComponent(value).replace(/%20/g, '+')}`);
      }
    }
    const passphrase = process.env.PAYFAST_PASSPHRASE;
    if (passphrase) {
      sigParts.push(`passphrase=${encodeURIComponent(passphrase).replace(/%20/g, '+')}`);
    }
    const computedSignature = crypto
      .createHash('md5')
      .update(sigParts.join('&'))
      .digest('hex');

    if (computedSignature !== receivedSignature) {
      console.error('ITN signature mismatch — ignoring');
      return { statusCode: 400, body: 'Invalid signature' };
    }

    // --- 3. Only process completed payments ---
    if (data['payment_status'] !== 'COMPLETE') {
      console.log('ITN status not COMPLETE:', data['payment_status']);
      return { statusCode: 200, body: 'OK' };
    }

    // --- 4. Work out which plan tier from the amount paid ---
    const amount = parseFloat(data['amount_gross']);
    let tier, planName;
    if (amount >= 195 && amount <= 205) {
      tier = 2; planName = 'Full Planner';
    } else if (amount >= 95 && amount <= 105) {
      tier = 1; planName = 'Guest Page Plan';
    } else {
      console.error('ITN: unrecognised amount', amount);
      return { statusCode: 200, body: 'OK' };
    }

    const buyerEmail = data['email_address'];
    const buyerName  = data['name_first'] || '';
    const paymentId  = data['pf_payment_id'] || 'unknown';

    // --- 5. Generate a one-time access code in Supabase ---
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/generate_access_codes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({
        n: 1,
        note: `PayFast ${paymentId} – ${buyerEmail}`,
        days: 365,
        tier,
      }),
    });

    if (!rpcRes.ok) {
      console.error('Supabase RPC error:', await rpcRes.text());
      return { statusCode: 500, body: 'Could not generate code' };
    }

    const codes = await rpcRes.json();
    const code  = codes && codes[0] && codes[0].code;
    if (!code) {
      console.error('No code returned from Supabase');
      return { statusCode: 500, body: 'No code generated' };
    }

    // --- 6. Email the code to the buyer via Resend ---
    const html = `
<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#333;">
  <div style="background:#f9f5f0;padding:32px;border-radius:12px;">
    <h2 style="color:#7a6652;margin-top:0;">Your Tableau access code 🎉</h2>
    <p>Hi ${buyerName || 'there'},</p>
    <p>Thank you for your purchase! Here is your <strong>${planName}</strong> access code:</p>
    <div style="background:#fff;border:2px dashed #c9b8a4;border-radius:10px;padding:24px;
                text-align:center;margin:24px 0;">
      <span style="font-size:36px;font-weight:bold;letter-spacing:6px;color:#5a4a3a;">${code}</span>
    </div>
    <p><strong>How to use it:</strong></p>
    <ol style="line-height:1.9;">
      <li>Go to <a href="https://tableauevents.co.za" style="color:#7a6652;">tableauevents.co.za</a></li>
      <li>Sign in or create a free account</li>
      <li>Enter this code in the access code box</li>
    </ol>
    <p style="color:#888;font-size:13px;margin-top:24px;">
      This code is valid for one year and can only be used once. Keep it somewhere safe!
    </p>
    <p>Enjoy planning your special day 💍</p>
    <p style="color:#7a6652;"><strong>The Tableau Team</strong></p>
  </div>
</div>`;

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'Tableau <hello@tableauevents.co.za>',
        to: [buyerEmail],
        subject: `Your Tableau ${planName} access code`,
        html,
      }),
    });

    if (!emailRes.ok) {
      // Log but don't fail — the code was generated; we don't want PayFast to retry
      console.error('Resend error:', await emailRes.text());
    }

    console.log(`ITN OK — payment ${paymentId}, tier ${tier}, code emailed to ${buyerEmail}`);
    return { statusCode: 200, body: 'OK' };

  } catch (err) {
    console.error('ITN unexpected error:', err);
    return { statusCode: 500, body: 'Internal error' };
  }
};
