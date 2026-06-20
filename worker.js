/* ==============================================================
   FAKESMILE NOMBA WORKER
   Deploy to: Cloudflare Workers (free tier — 100k requests/day)

   This file does NOT run as part of the website. It runs on
   Cloudflare's edge servers so your Nomba private key never
   touches the browser.

   ENV VARS (set as encrypted Worker secrets — see DEPLOY-WORKER.md):
     NOMBA_CLIENT_ID    — from Nomba dashboard
     NOMBA_ACCOUNT_ID   — from Nomba dashboard
     NOMBA_PRIVATE_KEY  — from Nomba dashboard (regenerate the one
                          you pasted in chat earlier first!)
     NOMBA_BASE         — optional. Defaults to https://api.nomba.com/v1
                          Use https://sandbox.nomba.com/v1 for testing.
     ALLOWED_ORIGIN     — your site's URL, e.g. https://fakesmilestore.com
                          or "*" for local dev (less secure).

   ENDPOINTS:
     POST /create-checkout  { amount, email, orderId, callbackUrl,
                              customerName? }
       -> { checkoutLink, sessionId, ... } from Nomba

     POST /verify-payment   { orderReference }
       -> { status: 'success'|'pending'|'failed', amount, ... }
   ============================================================== */

export default {
    async fetch(request, env) {
        // ===== CORS preflight =====
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
            // Health check / root
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

/* ============================================================== */
/* === HANDLERS ================================================= */
/* ============================================================== */

async function handleCreateCheckout(request, env) {
    const body = await request.json();
    const { amount, email, orderId, callbackUrl, customerName } = body;

    if (!amount || !email || !orderId || !callbackUrl) {
        return json({ error: 'Missing required fields: amount, email, orderId, callbackUrl' }, 400, env);
    }
    // Accept a number or numeric string from the browser, but Nomba's checkout
    // API requires amount as a STRING in major units, e.g. "10000.00".
    // Sending a raw number is a spec violation that can make Nomba ignore the
    // callbackUrl and fall back to a default redirect (it lands on nomba.com).
    const amountNum = Number(amount);
    if (!isFinite(amountNum) || amountNum <= 0) {
        return json({ error: 'amount must be a positive number (in NGN)' }, 400, env);
    }
    const amountStr = amountNum.toFixed(2);

    const token = await getNombaToken(env);

    // Nomba checkout: amount in NGN major units (naira, not kobo) as a string.
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

    // Nomba returns { code, description, data: { checkoutLink, sessionId, orderReference, ... } }
    const payload = data.data || data;
    return json(payload, 200, env);
}

async function handleVerifyPayment(request, env) {
    const body = await request.json();
    const { orderReference } = body;

    if (!orderReference) {
        return json({ error: 'Missing orderReference' }, 400, env);
    }

    const token = await getNombaToken(env);

    const res = await fetch(
        `${nombaBase(env)}/transactions/accounts/single?orderReference=${encodeURIComponent(orderReference)}`,
        {
            method: 'GET',
            headers: {
                'accountId': env.NOMBA_ACCOUNT_ID,
                'Authorization': `Bearer ${token}`,
            },
        }
    );

    const data = await res.json();
    if (!res.ok) {
        return json({ error: 'Nomba verify failed', detail: data }, res.status, env);
    }

    // Shape varies by Nomba account — surface the raw payload so the
    // browser can read it. checkout.js inspects `data.status === 'SUCCESS'`
    // or `data.transactionStatus === 'SUCCESS'` defensively.
    return json(data.data || data, 200, env);
}

/* ============================================================== */
/* === NOMBA AUTH =============================================== */
/* ============================================================== */

async function getNombaToken(env) {
    if (!env.NOMBA_CLIENT_ID || !env.NOMBA_ACCOUNT_ID || !env.NOMBA_PRIVATE_KEY) {
        throw new Error('Worker missing NOMBA_* env vars — set them as encrypted secrets.');
    }

    // Nomba auth: credentials go in the BODY, accountId in a header.
    // No Authorization header.
    const res = await fetch(`${nombaBase(env)}/auth/token/issue`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'accountId': env.NOMBA_ACCOUNT_ID,
        },
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
        headers: {
            'Content-Type': 'application/json',
            ...corsHeaders(env),
        },
    });
}