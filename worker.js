/* ==============================================================
   FAKESMILE NOMBA WORKER
   Deploy to: Cloudflare Workers (free tier — 100k requests/day)

   This file does NOT run as part of the website. It runs on
   Cloudflare's edge servers so your Nomba private key never
   touches the browser.

   ENV VARS (set as encrypted Worker secrets — see DEPLOY-WORKER.md):
     NOMBA_CLIENT_ID    — from Nomba dashboard
     NOMBA_ACCOUNT_ID   — from Nomba dashboard
     NOMBA_PRIVATE_KEY  — from Nomba dashboard (client secret)
     NOMBA_BASE         — optional. Defaults to https://api.nomba.com/v1
                          Use https://sandbox.nomba.com/v1 for testing.
     ALLOWED_ORIGIN     — your site's URL, e.g. https://fakesmilestore.com
                          or "*" for local dev (less secure).

     --- Webhook / server-side completion (optional but recommended) ---
     NOMBA_SIGNATURE_KEY — Signature Key from Nomba dashboard → Webhooks.
                           Required to accept /webhook calls (verifies HMAC).
     EMAILJS_PRIVATE_KEY — EmailJS "private key" (accessToken) for server-side
                           sends. Plus the 4 EMAILJS_* values below.
     EMAILJS_PUBLIC_KEY, EMAILJS_SERVICE_ID,
     EMAILJS_TEMPLATE_SELLER, EMAILJS_TEMPLATE_CUSTOMER

   KV BINDING (optional but recommended):
     ORDERS — a KV namespace bound as `ORDERS`. Stores the draft order at
              create-checkout time so the webhook can finalize + email it
              even if the customer's browser never returns. Without it, the
              site falls back to browser-side completion (today's behavior).

   ENDPOINTS:
     POST /create-checkout  { amount, email, orderId, callbackUrl,
                              customerName?, order? }
       -> { checkoutLink, orderReference, ... } from Nomba
     POST /verify-payment   { orderReference }   -> raw Nomba transaction
     POST /finalize         { orderReference }   -> idempotent completion
       -> { status:'paid'|'failed'|'pending', emailed:bool, order? }
     POST /webhook          (Nomba -> us; HMAC-signed) payment_success
     GET  /order-status?ref=<orderReference>     -> { status, order? }
   ============================================================== */

export default {
    async fetch(request, env) {
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders(env) });
        }

        const url = new URL(request.url);

        try {
            if (url.pathname === '/create-checkout' && request.method === 'POST') {
                return await handleCreateCheckout(request, env);
            }
            if (url.pathname === '/verify-payment' && request.method === 'POST') {
                return await handleVerifyPayment(request, env);
            }
            if (url.pathname === '/finalize' && request.method === 'POST') {
                return await handleFinalize(request, env);
            }
            if (url.pathname === '/webhook' && request.method === 'POST') {
                return await handleWebhook(request, env);
            }
            if (url.pathname === '/order-status' && request.method === 'GET') {
                return await handleOrderStatus(url, env);
            }
            if (url.pathname === '/' || url.pathname === '/health') {
                return json({ ok: true, service: 'fakesmile-nomba-worker' }, 200, env);
            }
            return json({ error: 'Not found' }, 404, env);
        } catch (err) {
            console.error(err);
            return json({ error: err.message || 'Internal error' }, 500, env);
        }
    },
};

const ORDER_TTL_SECONDS = 60 * 60 * 24 * 30; // keep orders 30 days in KV

/* ============================================================== */
/* === HANDLERS ================================================= */
/* ============================================================== */

async function handleCreateCheckout(request, env) {
    const body = await request.json();
    const { amount, email, orderId, callbackUrl, customerName, order } = body;

    if (!amount || !email || !orderId || !callbackUrl) {
        return json({ error: 'Missing required fields: amount, email, orderId, callbackUrl' }, 400, env);
    }
    // Nomba's checkout API requires amount as a STRING in major units ("10000.00").
    // Sending a raw number can make Nomba ignore callbackUrl and fall back to a
    // default redirect (it lands on nomba.com after payment).
    const amountNum = Number(amount);
    if (!isFinite(amountNum) || amountNum <= 0) {
        return json({ error: 'amount must be a positive number (in NGN)' }, 400, env);
    }
    const amountStr = amountNum.toFixed(2);

    const token = await getNombaToken(env);

    const res = await fetch(`${nombaBase(env)}/checkout/order`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'accountId': env.NOMBA_ACCOUNT_ID,
            'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
            order: {
                orderReference: orderId,
                customerId: email,
                customerEmail: email,
                amount: amountStr,
                currency: 'NGN',
                callbackUrl: callbackUrl,
                customerName: customerName || '',
            },
        }),
    });

    const data = await res.json();
    if (!res.ok) {
        return json({ error: 'Nomba checkout creation failed', detail: data }, res.status, env);
    }

    // Nomba returns { ..., data: { checkoutLink, orderReference, ... } }
    const payload = data.data || data;
    const nombaRef = payload.orderReference || payload.orderRef || payload.reference || orderId;

    // Persist the full draft order so the webhook can finalize + email it even
    // if the customer's browser never returns. Keyed by Nomba's orderReference.
    if (env.ORDERS && order) {
        try {
            await env.ORDERS.put(
                'order:' + nombaRef,
                JSON.stringify({
                    order,                 // full order (items, shipping, customer, totals)
                    merchantOrderId: orderId,
                    amount: amountNum,
                    status: 'pending',
                    emailsSent: false,
                    createdAt: Date.now(),
                }),
                { expirationTtl: ORDER_TTL_SECONDS }
            );
        } catch (e) {
            console.error('KV put failed (continuing):', e);
        }
    }

    return json(payload, 200, env);
}

async function handleVerifyPayment(request, env) {
    const body = await request.json();
    const { orderReference } = body;
    if (!orderReference) return json({ error: 'Missing orderReference' }, 400, env);
    const data = await nombaLookup(env, orderReference);
    return json(data, 200, env);
}

// Idempotent completion entry point. Called by the browser (on return / resume)
// AND internally by the webhook. Verifies with Nomba, marks the KV order paid,
// and sends emails EXACTLY once (emailsSent flag) so the two paths never
// duplicate. Safe to call repeatedly.
async function handleFinalize(request, env) {
    const body = await request.json();
    const { orderReference } = body;
    if (!orderReference) return json({ error: 'Missing orderReference' }, 400, env);
    const result = await finalizeOrder(env, orderReference);
    return json(result, 200, env);
}

async function handleWebhook(request, env) {
    const raw = await request.text();

    // Verify the HMAC-SHA256 signature so only genuine Nomba calls are trusted.
    if (!env.NOMBA_SIGNATURE_KEY) {
        console.warn('Webhook hit but NOMBA_SIGNATURE_KEY not set — rejecting.');
        return new Response('webhook not configured', { status: 503 });
    }
    const ok = await verifyNombaSignature(request, raw, env.NOMBA_SIGNATURE_KEY);
    if (!ok) return new Response('invalid signature', { status: 401 });

    let evt;
    try { evt = JSON.parse(raw); } catch (_) { return new Response('bad json', { status: 400 }); }

    const type = String(evt.event_type || evt.event || evt.type || '').toLowerCase();
    const d = evt.data || evt;
    const orderRef = d.orderReference || d.order_reference || d.orderRef ||
        (d.order && d.order.orderReference) || d.merchantTxRef || null;

    // Only act on successful payments; acknowledge everything else.
    if (orderRef && /payment_success|payment\.success|success|paid|completed/.test(type)) {
        try { await finalizeOrder(env, orderRef); }
        catch (e) { console.error('Webhook finalize error:', e); }
    }
    // Always 200 so Nomba doesn't retry-storm a duplicate we already handled.
    return json({ received: true }, 200, env);
}

async function handleOrderStatus(url, env) {
    const ref = url.searchParams.get('ref');
    if (!ref) return json({ error: 'Missing ref' }, 400, env);
    if (!env.ORDERS) return json({ status: 'unknown', stored: false }, 200, env);
    const rec = await env.ORDERS.get('order:' + ref, 'json');
    if (!rec) return json({ status: 'unknown', stored: false }, 200, env);
    return json({ status: rec.status, emailed: !!rec.emailsSent, order: rec.order }, 200, env);
}

/* ============================================================== */
/* === COMPLETION (shared by /finalize and /webhook) ============ */
/* ============================================================== */

async function finalizeOrder(env, orderRef) {
    let rec = env.ORDERS ? await env.ORDERS.get('order:' + orderRef, 'json') : null;

    // Already fully done — return without re-emailing.
    if (rec && rec.status === 'paid' && rec.emailsSent) {
        return { status: 'paid', emailed: true, alreadyDone: true, order: rec.order, nombaReference: rec.nombaReference || orderRef };
    }

    // Source of truth: ask Nomba whether this reference actually paid.
    const lookup = await nombaLookup(env, orderRef);
    const status = String(
        lookup.status || lookup.transactionStatus || lookup.paymentStatus || ''
    ).toUpperCase();
    const paid = ['SUCCESS', 'SUCCESSFUL', 'COMPLETED', 'PAID'].includes(status);

    if (!paid) {
        return { status: status ? 'pending' : 'unknown', emailed: false };
    }

    // No KV record (KV not configured, or order wasn't stored): we can confirm
    // payment but can't email server-side (we don't have the order details).
    if (!rec) {
        return { status: 'paid', emailed: false, stored: false };
    }

    rec.status = 'paid';
    rec.paidAt = Date.now();
    rec.nombaReference = lookup.reference || lookup.transactionId || lookup.id || orderRef;

    let emailed = false;
    if (!rec.emailsSent && emailConfigured(env)) {
        try {
            await sendOrderEmails(env, rec.order, rec.nombaReference);
            rec.emailsSent = true;
            emailed = true;
        } catch (e) {
            console.error('Server email send failed:', e);
        }
    }

    if (env.ORDERS) {
        await env.ORDERS.put('order:' + orderRef, JSON.stringify(rec), { expirationTtl: ORDER_TTL_SECONDS });
    }
    return { status: 'paid', emailed, order: rec.order, nombaReference: rec.nombaReference };
}

// GET the transaction from Nomba by orderReference.
async function nombaLookup(env, orderReference) {
    const token = await getNombaToken(env);
    const res = await fetch(
        `${nombaBase(env)}/transactions/accounts/single?orderReference=${encodeURIComponent(orderReference)}`,
        { method: 'GET', headers: { 'accountId': env.NOMBA_ACCOUNT_ID, 'Authorization': `Bearer ${token}` } }
    );
    const data = await res.json().catch(() => ({}));
    return data.data || data;
}

/* ============================================================== */
/* === SIGNATURE VERIFICATION (HMAC-SHA256) ===================== */
/* ============================================================== */

async function verifyNombaSignature(request, rawBody, signatureKey) {
    // Pull the signature from whichever header Nomba uses (robust to naming).
    const candidates = [
        'x-nomba-signature', 'nomba-signature', 'x-nomba-signature-value',
        'signature', 'x-signature', 'signature-value', 'x-webhook-signature',
    ];
    let provided = '';
    for (const name of candidates) {
        const v = request.headers.get(name);
        if (v) { provided = v.trim(); break; }
    }
    if (!provided) {
        // Fall back: scan every header value for one that matches our HMAC.
        const { hex, b64 } = await hmacSha256(signatureKey, rawBody);
        for (const [, value] of request.headers) {
            const v = (value || '').trim();
            if (timingSafeEqual(v.toLowerCase(), hex) || timingSafeEqual(v, b64)) return true;
        }
        return false;
    }
    const { hex, b64 } = await hmacSha256(signatureKey, rawBody);
    return timingSafeEqual(provided.toLowerCase(), hex) || timingSafeEqual(provided, b64);
}

async function hmacSha256(secret, message) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(message));
    const bytes = new Uint8Array(sigBuf);
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    const b64 = btoa(bin);
    return { hex, b64 };
}

function timingSafeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

/* ============================================================== */
/* === EMAIL (server-side via EmailJS REST) ===================== */
/* ============================================================== */

function emailConfigured(env) {
    return !!(env.EMAILJS_PRIVATE_KEY && env.EMAILJS_PUBLIC_KEY && env.EMAILJS_SERVICE_ID &&
        (env.EMAILJS_TEMPLATE_SELLER || env.EMAILJS_TEMPLATE_CUSTOMER));
}

async function sendOrderEmails(env, order, nombaReference) {
    if (!order) return;
    const params = buildEmailParams(order, nombaReference);
    const tasks = [];
    if (env.EMAILJS_TEMPLATE_SELLER) tasks.push(sendEmailJS(env, env.EMAILJS_TEMPLATE_SELLER, params));
    if (env.EMAILJS_TEMPLATE_CUSTOMER) tasks.push(sendEmailJS(env, env.EMAILJS_TEMPLATE_CUSTOMER, params));
    await Promise.all(tasks);
}

async function sendEmailJS(env, templateId, templateParams) {
    const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            service_id: env.EMAILJS_SERVICE_ID,
            template_id: templateId,
            user_id: env.EMAILJS_PUBLIC_KEY,
            accessToken: env.EMAILJS_PRIVATE_KEY, // required for non-browser sends
            template_params: templateParams,
        }),
    });
    if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`EmailJS ${templateId} failed (${res.status}): ${txt}`);
    }
}

// Mirror the client-side params (scripts/checkout.js) so the same EmailJS
// templates render. Server has NGN integers, so format as NGN.
function buildEmailParams(order, nombaReference) {
    const itemsText = (order.items || []).map((it) => {
        const sizeStr = it.size ? ` (Size ${it.size})` : '';
        return `${it.qty} × ${it.name}${sizeStr} — ${formatNGN(it.price * it.qty)}`;
    }).join('\n');
    const s = order.shipping || {};
    const shipAddr = [
        s.address1, s.address2,
        `${s.city || ''}, ${s.state || ''} ${s.postal || ''}`.trim(),
        s.country,
    ].filter(Boolean).join('\n');
    const c = order.customer || {};
    return {
        order_id: order.id,
        customer_name: `${c.firstName || ''} ${c.lastName || ''}`.trim(),
        customer_email: c.email || '',
        customer_phone: c.phone || '',
        items: itemsText,
        subtotal: formatNGN(order.subtotal || 0),
        discount: formatNGN(order.discount || 0),
        total: formatNGN(order.total || 0),
        shipping_address: shipAddr,
        payment_method: (order.payment && order.payment.method) === 'nomba' ? 'Nomba' : 'Bank Transfer',
        status: 'paid',
        nomba_reference: nombaReference || '',
    };
}

function formatNGN(n) {
    const v = Math.round(Number(n) || 0);
    return '₦' + v.toLocaleString('en-NG');
}

/* ============================================================== */
/* === NOMBA AUTH =============================================== */
/* ============================================================== */

async function getNombaToken(env) {
    if (!env.NOMBA_CLIENT_ID || !env.NOMBA_ACCOUNT_ID || !env.NOMBA_PRIVATE_KEY) {
        throw new Error('Worker missing NOMBA_* env vars — set them as encrypted secrets.');
    }
    const res = await fetch(`${nombaBase(env)}/auth/token/issue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'accountId': env.NOMBA_ACCOUNT_ID },
        body: JSON.stringify({
            grant_type: 'client_credentials',
            client_id: env.NOMBA_CLIENT_ID,
            client_secret: env.NOMBA_PRIVATE_KEY,
        }),
    });
    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Nomba auth failed (${res.status}): ${txt}`);
    }
    const data = await res.json();
    const token = (data && data.data && data.data.access_token) || data.access_token;
    if (!token) throw new Error('Nomba auth response missing access_token');
    return token;
}

/* ============================================================== */
/* === HELPERS ================================================== */
/* ============================================================== */

function nombaBase(env) {
    return env.NOMBA_BASE || 'https://api.nomba.com/v1';
}

function corsHeaders(env) {
    return {
        'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
    };
}

function json(payload, status, env) {
    return new Response(JSON.stringify(payload), {
        status: status || 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(env) },
    });
}
