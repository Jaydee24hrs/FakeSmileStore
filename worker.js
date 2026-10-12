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

     --- Drop-alert subscribers (optional) ---
     EMAILJS_TEMPLATE_SUBSCRIBE — EmailJS template that notifies YOU when
                           someone joins the drop-alert list. Only sent if
                           this is set AND the EMAILJS_* values above are
                           configured (same email setup as order emails).
     SUBSCRIBERS_EXPORT_KEY — a long random secret you make up. Required to
                           use GET /subscribers (see below) — without it,
                           that endpoint is disabled (emails still save to
                           KV, you just can't pull the list until you set
                           this). Set it with `wrangler secret put`, same as
                           the other secrets — never put it in this file.

     --- Admin login (tools/admin.html) ---
     ADMIN_EMAILS    — comma-separated allowlist, e.g.
                        "you@gmail.com,cofounder@gmail.com". Only these
                        emails can log in.
     ADMIN_PASSWORD  — the shared login password. Checked server-side; the
                        admin page never embeds it. On success POST
                        /admin-login hands back SUBSCRIBERS_EXPORT_KEY, so
                        set that too or login succeeds but the dashboard
                        has nothing to fetch with.

   KV BINDING (optional but recommended):
     ORDERS — a KV namespace bound as `ORDERS`. Stores the draft order at
              create-checkout time so the webhook can finalize + email it
              even if the customer's browser never returns. Without it, the
              site falls back to browser-side completion (today's behavior).
              ALSO doubles as the drop-alert subscriber list (keys prefixed
              "sub:") — no second KV namespace needed.

   ENDPOINTS:
     POST /create-checkout  { amount, email, orderId, callbackUrl,
                              customerName?, order? }
       -> { checkoutLink, orderReference, ... } from Nomba
     POST /verify-payment   { orderReference }   -> raw Nomba transaction
     POST /finalize         { orderReference }   -> idempotent completion
       -> { status:'paid'|'failed', emailed:bool, order? }
     POST /webhook          (Nomba -> us; HMAC-signed) payment_success
     GET  /order-status?ref=<orderReference>     -> { status, order? }
     POST /subscribe        { email, source? }   -> { ok, alreadySubscribed }
       Called by the site's drop-alert banner (scripts/base.js) and footer
       newsletter form. Stores the email in KV so it's a real, exportable
       list — not just a decorative form.
     GET  /subscribers?key=<SUBSCRIBERS_EXPORT_KEY>
       -> { count, subscribers: [{ email, subscribedAt, source }] }
       Pull the list to paste into whatever you send drop announcements
       with. Example: curl "https://<your-worker>.workers.dev/subscribers?key=YOUR_SECRET"
     GET  /orders?key=<SUBSCRIBERS_EXPORT_KEY>
       -> { count, orders: [{ nombaReference, status, order, amount,
            createdAt, paidAt, emailsSent, ... }] }
       Every order currently in KV (30-day TTL — see ORDER_TTL_SECONDS),
       newest first. Same secret as /subscribers; powers tools/admin.html.
     POST /admin-login      { email, password }
       -> { ok: true, key: <SUBSCRIBERS_EXPORT_KEY> } or 401 Unauthorized.
       Gate for the admin dashboard: checks email against ADMIN_EMAILS and
       password against ADMIN_PASSWORD, both server-side. On success hands
       back the export key so the page can call /orders and /subscribers
       without the admin ever typing or seeing that key directly.
     POST /resend-email     { orderReference, key }
       -> { ok: true }
       Re-sends the order confirmation emails (seller + customer) for an
       order, bypassing the emailsSent guard. Admin-only (same key as
       /orders) — key goes in the JSON body, not the querystring.
     POST /admin-set-status { orderReference, status: 'paid'|'failed', key }
       -> { ok: true, status, emailed }
       Manually overrides an order's status from the admin dashboard, for
       cases the Nomba lookup can't resolve on its own. Marking an order
       paid this way also sends the confirmation emails if they haven't
       gone out yet. Admin-only (same key as /orders).
     GET  /traffic?key=<SUBSCRIBERS_EXPORT_KEY>&days=14
       -> { configured: false } if CF_API_TOKEN/CF_ACCOUNT_ID/CF_SITE_TAG
          aren't set, or { configured: true, totalPageviews, days: {date:
          count} }, or { configured: true, error } if Cloudflare's API
          rejected the request. Pulls pageview counts from Cloudflare Web
          Analytics (RUM) via the GraphQL Analytics API — see the three
          CF_* vars below for what to set and where to find them.

     --- Site traffic tab (optional) ---
     CF_API_TOKEN   — a Cloudflare API token with "Account Analytics: Read"
                       permission (dash.cloudflare.com -> My Profile ->
                       API Tokens -> Create Token).
     CF_ACCOUNT_ID  — your Cloudflare account ID (same one Wrangler uses;
                       visible on the right-hand side of any zone's
                       Overview page in the dashboard).
     CF_SITE_TAG    — set up Web Analytics first: dashboard -> Analytics &
                       Logs -> Web Analytics -> Add Site -> fakesmilestore.com.
                       It hands you a <script> snippet to paste on the
                       site; the site tag is the 32-char hex value inside
                       its data-cf-beacon="{"token":"..."}" attribute.
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
            // Nomba (and other providers) validate a webhook URL by pinging it
            // with a GET/HEAD before saving. Answer 200 so validation passes;
            // real events always arrive as POST above.
            if (url.pathname === '/webhook' && (request.method === 'GET' || request.method === 'HEAD')) {
                return json({ ok: true, webhook: 'ready' }, 200, env);
            }
            if (url.pathname === '/order-status' && request.method === 'GET') {
                return await handleOrderStatus(url, env);
            }
            if (url.pathname === '/subscribe' && request.method === 'POST') {
                return await handleSubscribe(request, env);
            }
            if (url.pathname === '/subscribers' && request.method === 'GET') {
                return await handleSubscribersExport(url, env);
            }
            if (url.pathname === '/orders' && request.method === 'GET') {
                return await handleOrdersExport(url, env);
            }
            if (url.pathname === '/admin-login' && request.method === 'POST') {
                return await handleAdminLogin(request, env);
            }
            if (url.pathname === '/resend-email' && request.method === 'POST') {
                return await handleResendEmail(request, env);
            }
            if (url.pathname === '/admin-set-status' && request.method === 'POST') {
                return await handleAdminSetStatus(request, env);
            }
            if (url.pathname === '/traffic' && request.method === 'GET') {
                return await handleTraffic(url, env);
            }
            if (url.pathname === '/debug-lookup' && request.method === 'GET') {
                return await handleDebugLookup(url, env);
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
    // Confirmed by direct testing against the live lookup API: Nomba's
    // transaction-lookup endpoint (/transactions/accounts/single) wants the
    // MERCHANT's own orderReference (orderId, e.g. "FS-XXX") — not Nomba's own
    // internal "onlineCheckoutOrderId" (a UUID), even though a UUID is what
    // their checkout-creation response echoes back under orderReference/
    // orderRef/reference. Using that UUID as the KV key made every later
    // lookup (finalize, webhook, admin "Check With Nomba") silently 404.
    const nombaRef = orderId;

    // Persist the full draft order so the webhook can finalize + email it even
    // if the customer's browser never returns. Keyed by the merchant orderId.
    if (env.ORDERS && order) {
        try {
            await env.ORDERS.put(
                'order:' + nombaRef,
                JSON.stringify({
                    order,                 // full order (items, shipping, customer, totals)
                    merchantOrderId: orderId,
                    amount: amountNum,
                    // No "pending" state: an order is 'paid' once finalizeOrder
                    // confirms it, 'failed' until then (covers not-yet-attempted,
                    // abandoned and genuinely failed alike — the admin only
                    // needs to know paid vs not).
                    status: 'failed',
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

    // Parse first (tolerant): Nomba's URL-validation ping and other test calls
    // may be empty or unsigned. We must still answer 200 for those, or Nomba
    // refuses to save the webhook.
    let evt = {};
    try { if (raw) evt = JSON.parse(raw); } catch (_) { evt = {}; }

    const type = String(evt.event_type || evt.event || evt.type || '').toLowerCase();
    const d = evt.data || evt;
    // onlineCheckoutOrderReference is the field name confirmed by direct
    // testing against the live transaction-lookup API — checked first.
    // merchantTxRef is deliberately NOT used: on a real transaction it held a
    // human-readable bank-transfer description, not an order reference.
    const orderRef = d.onlineCheckoutOrderReference || d.orderReference || d.order_reference ||
        d.orderRef || (d.order && d.order.orderReference) || null;

    // Verify the HMAC-SHA256 signature (defense in depth). This is NOT the only
    // guard: finalizeOrder independently asks Nomba's API whether this reference
    // actually paid, so a forged/unsigned call can never mark an unpaid order as
    // paid. We therefore log signature status but never reject the request — that
    // keeps Nomba's unsigned validation ping working while real events still get
    // authenticated end-to-end via the Nomba lookup.
    let signatureOk = false;
    if (env.NOMBA_SIGNATURE_KEY) {
        try { signatureOk = await verifyNombaSignature(request, raw, env.NOMBA_SIGNATURE_KEY); }
        catch (_) { signatureOk = false; }
    }

    const isSuccess = orderRef && /payment_success|payment\.success|success|paid|completed/.test(type);
    if (isSuccess) {
        if (!signatureOk) console.warn('Webhook success event with unverified signature — relying on Nomba lookup:', orderRef);
        try { await finalizeOrder(env, orderRef); }
        catch (e) { console.error('Webhook finalize error:', e); }
    }

    // Always 200: acknowledges validation pings and prevents Nomba retry storms.
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
/* === DROP-ALERT SUBSCRIBERS ==================================== */
/* ============================================================== */
// Reuses the ORDERS KV namespace with a "sub:" key prefix — no second KV
// binding to set up. Stored indefinitely (no TTL): this is a marketing
// list, not transient order data, so it doesn't expire like orders do.

function isValidEmail(email) {
    return typeof email === 'string' && email.length <= 254 &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function handleSubscribe(request, env) {
    let body;
    try { body = await request.json(); } catch (_) { return json({ error: 'Invalid JSON body' }, 400, env); }

    const email = String((body && body.email) || '').trim().toLowerCase();
    if (!isValidEmail(email)) {
        return json({ error: 'Please enter a valid email address.' }, 400, env);
    }
    if (!env.ORDERS) {
        return json({ error: 'Subscriber storage is not configured on this Worker (bind a KV namespace as ORDERS).' }, 503, env);
    }

    const key = 'sub:' + email;
    const existing = await env.ORDERS.get(key, 'json');
    if (existing) {
        return json({ ok: true, alreadySubscribed: true }, 200, env);
    }

    const record = {
        email,
        subscribedAt: Date.now(),
        source: (body && String(body.source || '').slice(0, 40)) || 'unknown',
    };
    await env.ORDERS.put(key, JSON.stringify(record)); // no expirationTtl — keep indefinitely

    // Best-effort "you have a new subscriber" ping to the owner. Never blocks
    // or fails the signup if email isn't configured or the send errors.
    if (env.EMAILJS_TEMPLATE_SUBSCRIBE && emailConfigured(env)) {
        try {
            await sendEmailJS(env, env.EMAILJS_TEMPLATE_SUBSCRIBE, {
                subscriber_email: email,
                subscribed_at: new Date(record.subscribedAt).toISOString(),
                source: record.source,
            });
        } catch (e) {
            console.error('Subscriber notify email failed (continuing):', e);
        }
    }

    return json({ ok: true, alreadySubscribed: false }, 200, env);
}

async function handleSubscribersExport(url, env) {
    if (!env.SUBSCRIBERS_EXPORT_KEY) {
        return json({ error: 'Export not enabled. Set SUBSCRIBERS_EXPORT_KEY as a Worker secret first.' }, 501, env);
    }
    const provided = url.searchParams.get('key') || '';
    if (!timingSafeEqual(provided, env.SUBSCRIBERS_EXPORT_KEY)) {
        return json({ error: 'Unauthorized' }, 401, env);
    }
    if (!env.ORDERS) return json({ error: 'KV not configured' }, 503, env);

    const subscribers = [];
    let cursor;
    do {
        const page = await env.ORDERS.list({ prefix: 'sub:', cursor, limit: 1000 });
        for (const k of page.keys) {
            const rec = await env.ORDERS.get(k.name, 'json');
            if (rec) subscribers.push(rec);
        }
        cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);

    subscribers.sort((a, b) => (b.subscribedAt || 0) - (a.subscribedAt || 0));
    return json({ count: subscribers.length, subscribers }, 200, env);
}

/* ============================================================== */
/* === ORDERS ADMIN EXPORT ======================================= */
/* ============================================================== */
// Same gate as /subscribers (SUBSCRIBERS_EXPORT_KEY) — both are owner-only
// reads of the same ORDERS KV namespace, just different key prefixes, so
// there's no reason to make the owner set up a second secret.

async function handleOrdersExport(url, env) {
    if (!env.SUBSCRIBERS_EXPORT_KEY) {
        return json({ error: 'Export not enabled. Set SUBSCRIBERS_EXPORT_KEY as a Worker secret first.' }, 501, env);
    }
    const provided = url.searchParams.get('key') || '';
    if (!timingSafeEqual(provided, env.SUBSCRIBERS_EXPORT_KEY)) {
        return json({ error: 'Unauthorized' }, 401, env);
    }
    if (!env.ORDERS) return json({ error: 'KV not configured' }, 503, env);

    const orders = [];
    let cursor;
    do {
        const page = await env.ORDERS.list({ prefix: 'order:', cursor, limit: 1000 });
        for (const k of page.keys) {
            const rec = await env.ORDERS.get(k.name, 'json');
            if (rec) orders.push({ nombaReference: k.name.slice('order:'.length), ...rec });
        }
        cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);

    orders.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return json({ count: orders.length, orders }, 200, env);
}

/* ============================================================== */
/* === ADMIN LOGIN ================================================ */
/* ============================================================== */
// Server-side email + password check so neither ever ships in the admin
// page's source. Deliberately generic on failure (doesn't say whether the
// email or the password was wrong) so the response can't be used to probe
// which emails are in ADMIN_EMAILS.

async function handleAdminLogin(request, env) {
    if (!env.ADMIN_EMAILS || !env.ADMIN_PASSWORD) {
        return json({ error: 'Admin login is not configured on this Worker (set ADMIN_EMAILS and ADMIN_PASSWORD).' }, 501, env);
    }
    let body;
    try { body = await request.json(); } catch (_) { return json({ error: 'Invalid JSON body' }, 400, env); }

    const email = String((body && body.email) || '').trim().toLowerCase();
    const password = String((body && body.password) || '');
    const allowed = env.ADMIN_EMAILS.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);

    const emailOk = allowed.includes(email);
    const passwordOk = timingSafeEqual(password, env.ADMIN_PASSWORD);
    if (!emailOk || !passwordOk) {
        return json({ error: 'Invalid email or password.' }, 401, env);
    }
    if (!env.SUBSCRIBERS_EXPORT_KEY) {
        return json({ error: 'Logged in, but SUBSCRIBERS_EXPORT_KEY isn’t set, so there’s no data to fetch yet.' }, 501, env);
    }
    return json({ ok: true, key: env.SUBSCRIBERS_EXPORT_KEY }, 200, env);
}

/* ============================================================== */
/* === ADMIN ORDER ACTIONS ======================================= */
/* ============================================================== */
// Both take the export key in the JSON body (not the querystring, since
// these are POSTs) — same secret as /orders and /subscribers.

async function handleResendEmail(request, env) {
    if (!env.SUBSCRIBERS_EXPORT_KEY) {
        return json({ error: 'Export not enabled. Set SUBSCRIBERS_EXPORT_KEY as a Worker secret first.' }, 501, env);
    }
    let body;
    try { body = await request.json(); } catch (_) { return json({ error: 'Invalid JSON body' }, 400, env); }
    if (!timingSafeEqual(String((body && body.key) || ''), env.SUBSCRIBERS_EXPORT_KEY)) {
        return json({ error: 'Unauthorized' }, 401, env);
    }
    const orderRef = String((body && body.orderReference) || '');
    if (!orderRef) return json({ error: 'Missing orderReference' }, 400, env);
    if (!env.ORDERS) return json({ error: 'KV not configured' }, 503, env);

    const rec = await env.ORDERS.get('order:' + orderRef, 'json');
    if (!rec) return json({ error: 'Order not found' }, 404, env);
    if (!rec.order) return json({ error: 'No order details stored for this order — nothing to email.' }, 400, env);
    if (!emailConfigured(env)) return json({ error: 'Email isn’t configured on this Worker (EMAILJS_* secrets missing).' }, 501, env);

    try {
        await sendOrderEmails(env, rec.order, rec.nombaReference || orderRef);
    } catch (e) {
        return json({ error: 'Email send failed: ' + (e.message || 'unknown error') }, 502, env);
    }

    rec.emailsSent = true;
    rec.lastEmailResendAt = Date.now();
    await env.ORDERS.put('order:' + orderRef, JSON.stringify(rec), { expirationTtl: ORDER_TTL_SECONDS });
    return json({ ok: true }, 200, env);
}

async function handleAdminSetStatus(request, env) {
    if (!env.SUBSCRIBERS_EXPORT_KEY) {
        return json({ error: 'Export not enabled. Set SUBSCRIBERS_EXPORT_KEY as a Worker secret first.' }, 501, env);
    }
    let body;
    try { body = await request.json(); } catch (_) { return json({ error: 'Invalid JSON body' }, 400, env); }
    if (!timingSafeEqual(String((body && body.key) || ''), env.SUBSCRIBERS_EXPORT_KEY)) {
        return json({ error: 'Unauthorized' }, 401, env);
    }
    const orderRef = String((body && body.orderReference) || '');
    const status = String((body && body.status) || '');
    if (!orderRef) return json({ error: 'Missing orderReference' }, 400, env);
    if (status !== 'paid' && status !== 'failed') return json({ error: 'status must be "paid" or "failed"' }, 400, env);
    if (!env.ORDERS) return json({ error: 'KV not configured' }, 503, env);

    const rec = await env.ORDERS.get('order:' + orderRef, 'json');
    if (!rec) return json({ error: 'Order not found' }, 404, env);

    rec.status = status;
    rec.manualOverride = true;
    let emailed = false;
    if (status === 'paid') {
        rec.paidAt = rec.paidAt || Date.now();
        if (!rec.emailsSent && rec.order && emailConfigured(env)) {
            try {
                await sendOrderEmails(env, rec.order, rec.nombaReference || orderRef);
                rec.emailsSent = true;
                emailed = true;
            } catch (e) {
                console.error('Manual-override email send failed:', e);
            }
        }
    } else {
        rec.failedAt = Date.now();
    }

    await env.ORDERS.put('order:' + orderRef, JSON.stringify(rec), { expirationTtl: ORDER_TTL_SECONDS });
    return json({ ok: true, status: rec.status, emailed: emailed || !!rec.emailsSent }, 200, env);
}

/* ============================================================== */
/* === SITE TRAFFIC (Cloudflare Web Analytics via GraphQL) ====== */
/* ============================================================== */

async function handleTraffic(url, env) {
    if (!env.SUBSCRIBERS_EXPORT_KEY) {
        return json({ error: 'Export not enabled. Set SUBSCRIBERS_EXPORT_KEY as a Worker secret first.' }, 501, env);
    }
    const provided = url.searchParams.get('key') || '';
    if (!timingSafeEqual(provided, env.SUBSCRIBERS_EXPORT_KEY)) {
        return json({ error: 'Unauthorized' }, 401, env);
    }
    if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID || !env.CF_SITE_TAG) {
        return json({ configured: false }, 200, env);
    }

    const days = Math.min(Math.max(parseInt(url.searchParams.get('days') || '14', 10) || 14, 1), 30);
    const until = new Date();
    const since = new Date(until.getTime() - days * 86400000);

    const query = `query TrafficStats($accountTag: String!, $siteTag: String!, $since: Time!, $until: Time!) {
        viewer {
            accounts(filter: { accountTag: $accountTag }) {
                rumPageloadEventsAdaptiveGroups(
                    limit: 5000
                    filter: { siteTag: $siteTag, datetime_geq: $since, datetime_leq: $until }
                ) {
                    count
                    dimensions { ts: datetimeFifteenMinutes }
                }
            }
        }
    }`;

    try {
        const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${env.CF_API_TOKEN}`,
            },
            body: JSON.stringify({
                query,
                variables: {
                    accountTag: env.CF_ACCOUNT_ID,
                    siteTag: env.CF_SITE_TAG,
                    since: since.toISOString(),
                    until: until.toISOString(),
                },
            }),
        });
        const data = await res.json().catch(() => null);
        if (!data) return json({ configured: true, error: 'Cloudflare returned an unparseable response (HTTP ' + res.status + ').' }, 502, env);
        if (data.errors && data.errors.length) {
            // Surface the full raw error objects too — Cloudflare's GraphQL
            // errors are often terse ("Authentication error") with the real
            // cause only visible in extensions/other fields.
            return json({
                configured: true,
                error: data.errors.map((e) => e.message || JSON.stringify(e)).join('; '),
                httpStatus: res.status,
                rawErrors: data.errors,
            }, 502, env);
        }
        const accounts = data.data && data.data.viewer && data.data.viewer.accounts;
        const groups = (accounts && accounts[0] && accounts[0].rumPageloadEventsAdaptiveGroups) || [];

        const byDay = {};
        let total = 0;
        for (const g of groups) {
            const ts = g.dimensions && g.dimensions.ts;
            if (!ts) continue;
            const day = String(ts).slice(0, 10);
            byDay[day] = (byDay[day] || 0) + (g.count || 0);
            total += g.count || 0;
        }
        return json({ configured: true, totalPageviews: total, days: byDay }, 200, env);
    } catch (err) {
        return json({ configured: true, error: err.message || 'Request to Cloudflare failed' }, 502, env);
    }
}

/* ============================================================== */
/* === DEBUG: raw Nomba lookup ==================================== */
/* ============================================================== */
// Temporary diagnostic — same gate as /subscribers and /orders. Returns
// exactly what Nomba's transaction-lookup API sends back for one
// reference, unmodified, so a status-matching mismatch in finalizeOrder()
// can be diagnosed from real data instead of guessed at. Safe to remove
// once that's sorted, or safe to leave — it can't do anything but read.
async function handleDebugLookup(url, env) {
    if (!env.SUBSCRIBERS_EXPORT_KEY) {
        return json({ error: 'Export not enabled. Set SUBSCRIBERS_EXPORT_KEY as a Worker secret first.' }, 501, env);
    }
    const provided = url.searchParams.get('key') || '';
    if (!timingSafeEqual(provided, env.SUBSCRIBERS_EXPORT_KEY)) {
        return json({ error: 'Unauthorized' }, 401, env);
    }
    const ref = url.searchParams.get('ref');
    if (!ref) return json({ error: 'Missing ref' }, 400, env);

    try {
        const token = await getNombaToken(env);
        const res = await fetch(
            `${nombaBase(env)}/transactions/accounts/single?orderReference=${encodeURIComponent(ref)}`,
            { method: 'GET', headers: { 'accountId': env.NOMBA_ACCOUNT_ID, 'Authorization': `Bearer ${token}` } }
        );
        const raw = await res.text();
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch (_) {}
        return json({ nombaBase: nombaBase(env), httpStatus: res.status, raw: parsed || raw }, 200, env);
    } catch (err) {
        return json({ error: err.message || 'Lookup failed' }, 500, env);
    }
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
    let lookup = await nombaLookup(env, orderRef);
    // Self-heals orders created before the orderId-vs-UUID lookup bug was
    // fixed (see handleCreateCheckout): if the KV key itself isn't a lookup-
    // able reference, retry with the merchant orderId stored alongside it.
    if (lookup && lookup.notFound && rec && rec.merchantOrderId && rec.merchantOrderId !== orderRef) {
        lookup = await nombaLookup(env, rec.merchantOrderId);
    }
    const status = String(
        lookup.status || lookup.transactionStatus || lookup.paymentStatus || ''
    ).toUpperCase();
    const paid = ['SUCCESS', 'SUCCESSFUL', 'COMPLETED', 'PAID'].includes(status);

    if (!paid) {
        // No "pending"/"unknown" middle state — anything that isn't a
        // confirmed success (an explicit failure, still-processing, or no
        // record at all) is marked failed. finalizeOrder only ever runs when
        // the customer already returned from Nomba, Nomba's own webhook fired
        // a success event, or the admin manually re-checks, so there's no
        // risk of marking an in-progress payment failed too early.
        if (rec) {
            rec.status = 'failed';
            rec.failedAt = Date.now();
            if (env.ORDERS) {
                await env.ORDERS.put('order:' + orderRef, JSON.stringify(rec), { expirationTtl: ORDER_TTL_SECONDS });
            }
            return { status: 'failed', emailed: false, order: rec.order, nombaReference: orderRef };
        }
        return { status: 'failed', emailed: false };
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

// GET the transaction from Nomba by orderReference. Must be the MERCHANT
// orderReference (orderId) — confirmed by direct testing that Nomba's own
// internal "onlineCheckoutOrderId" (a UUID) 404s on this endpoint even
// though it's what checkout-creation echoes back as orderReference/reference.
async function nombaLookup(env, orderReference) {
    const token = await getNombaToken(env);
    const res = await fetch(
        `${nombaBase(env)}/transactions/accounts/single?orderReference=${encodeURIComponent(orderReference)}`,
        { method: 'GET', headers: { 'accountId': env.NOMBA_ACCOUNT_ID, 'Authorization': `Bearer ${token}` } }
    );
    if (res.status === 404) return { notFound: true };
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
        vat: formatNGN(order.vat || 0),
        total: formatNGN(order.total || 0),
        shipping_address: shipAddr,
        payment_method: 'Nomba',
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
