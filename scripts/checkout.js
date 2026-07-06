/* ============================================= */
/* === CHECKOUT SCRIPT (checkout.html) ========== */
/* ============================================= */
/*
 *  Payment flow (Nomba via Cloudflare Worker + EmailJS notifications):
 *
 *  1. User clicks "Place Order"
 *  2. validate form → build draft order → save to localStorage as "pending"
 *     (localStorage, not sessionStorage — survives the mobile payment round-trip)
 *  3. POST to Worker /create-checkout → Worker auths with Nomba → returns checkoutLink
 *  4. window.location = checkoutLink (Nomba's hosted page)
 *  5. User pays on Nomba (card / USSD / transfer)
 *  6. Nomba redirects back to the clean callbackUrl, appending ?orderReference=FS-XXX
 *  7. On page load we detect the pending order + ref, POST to Worker /verify-payment
 *  8. On return: save order to localStorage.fs_orders, clear cart, then
 *     REDIRECT to orders.html?new=<id> (works on desktop + mobile). A paying
 *     customer is only ever sent back to the form on an explicit "failed";
 *     an inconclusive check records a "processing" order and still goes to
 *     Orders (the Worker webhook confirms + emails server-side).
 *     (Nomba is the only payment method — no bank-transfer branch.)
 *
 *  See DEPLOY-WORKER.md for setup steps and where to paste keys.
 */

/* ============================================= */
/* === CONFIG — paste your keys here ============ */
/* ============================================= */
// Cloudflare Worker URL (from DEPLOY-WORKER.md step 2). NO trailing slash.
const NOMBA_WORKER_URL = 'https://fakesmile-nomba.josephnwach11.workers.dev';

// EmailJS — from emailjs.com dashboard (see DEPLOY-WORKER.md step 7).
const EMAILJS_PUBLIC_KEY        = 'GCI_Znw_6wpAMXjgw';
const EMAILJS_SERVICE_ID        = 'service_ghjhenl';
const EMAILJS_TEMPLATE_SELLER   = 'template_xvb7qor';
const EMAILJS_TEMPLATE_CUSTOMER = 'template_cbazcvl';


// Where Nomba should redirect after payment. checkout.js detects this on load.
const NOMBA_RETURN_URL = window.location.origin + window.location.pathname;

(function () {
    const layout = document.getElementById('checkout-layout');
    if (!layout) return;

    const emptyEl = document.getElementById('checkout-empty');
    const successEl = document.getElementById('checkout-success');
    const itemsEl = document.getElementById('ck-items');
    const subtotalEl = document.getElementById('ck-subtotal');
    const totalEl = document.getElementById('ck-total');
    const discountLineEl = document.getElementById('ck-discount-line');
    const discountAmountEl = document.getElementById('ck-discount');
    const discountCodeEl = document.getElementById('ck-discount-code');
    const heroSubEl = document.getElementById('checkout-hero-sub');

    const form = document.getElementById('checkout-form');
    const hint = document.getElementById('ck-hint');
    const placeBtn = document.getElementById('ck-place');
    const paymentNote = document.getElementById('payment-note');

    const PROMO_KEY = 'fs_cart_promo';
    const ORDERS_KEY = 'fs_orders';
    const PENDING_ORDER_KEY = 'fs_pending_order';

    const VALID_PROMOS = {
        'STREETS25': { off: 0.25, label: 'STREETS25' },
        'DROP02':    { off: 0.10, label: 'DROP02' },
        'CREW10':    { off: 0.10, label: 'CREW10' },
    };

    // Initialize EmailJS if SDK loaded + key configured
    if (typeof emailjs !== 'undefined' && EMAILJS_PUBLIC_KEY && !EMAILJS_PUBLIC_KEY.startsWith('YOUR_')) {
        try { emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY }); } catch (_) {}
    }

    function getPromo() {
        const code = (localStorage.getItem(PROMO_KEY) || '').toUpperCase();
        return VALID_PROMOS[code] ? Object.assign({ code }, VALID_PROMOS[code]) : null;
    }

    /* ============================================= */
    /* === RENDER SUMMARY ============================ */
    /* ============================================= */
    function renderSummary() {
        const items = readCart();
        const count = items.reduce((s, i) => s + (i.qty || 0), 0);
        const promo = getPromo();
        // Display totals in the active currency, including the per-item markup.
        const subtotal = items.reduce((s, i) => s + unitDisplayAmount(i.price) * (i.qty || 0), 0);
        const discount = promo ? subtotal * promo.off : 0;
        const total = Math.max(0, subtotal - discount);

        if (count === 0 && !localStorage.getItem(PENDING_ORDER_KEY)) {
            layout.style.display = 'none';
            if (emptyEl) emptyEl.hidden = false;
            if (heroSubEl) heroSubEl.textContent = 'Nothing to check out — add a fit first.';
            return { count, subtotal, discount, total };
        }

        if (count > 0) {
            layout.style.display = '';
            if (emptyEl) emptyEl.hidden = true;
            if (heroSubEl) heroSubEl.textContent = `${count} item${count > 1 ? 's' : ''} ready. Lock in your details to complete the drop.`;

            itemsEl.innerHTML = items.map((it) => {
                const safeImg = fsImg(it.image);
                const safeName = (it.name || 'Product').replace(/</g, '&lt;');
                const safeSize = (it.size || '').replace(/</g, '&lt;');
                return `
                    <div class="ck-item">
                        <span class="ck-item-thumb">
                            <img src="${safeImg}" alt="" onerror="this.onerror=null;this.src='images/Fakesmile-1.webp'">
                            <span class="ck-item-qty">${it.qty || 1}</span>
                        </span>
                        <div class="ck-item-body">
                            <strong class="ck-item-name">${safeName}</strong>
                            <span class="ck-item-meta">${safeSize ? 'Size ' + safeSize : 'One size'}</span>
                        </div>
                        <span class="ck-item-price">${formatMarked(it.price, it.qty)}</span>
                    </div>
                `;
            }).join('');

            subtotalEl.innerHTML = formatMoney(subtotal);
            totalEl.innerHTML = formatMoney(total);

            if (promo) {
                discountLineEl.hidden = false;
                discountAmountEl.innerHTML = '&minus;' + formatMoney(discount);
                discountCodeEl.textContent = promo.label;
            } else {
                discountLineEl.hidden = true;
            }
        }

        return { count, subtotal, discount, total };
    }

    /* ============================================= */
    /* === PAYMENT METHOD UI ========================= */
    /* ============================================= */
    const paymentNotes = {
        nomba: 'You\'ll be redirected to <strong>Nomba</strong> to complete payment. Card · Bank · USSD · Transfer — all in one secure flow.',
    };

    function updatePaymentUI() {
        const radios = document.querySelectorAll('input[name="payment"]');
        let selected = 'nomba';
        radios.forEach((r) => {
            const wrap = r.closest('.payment-method');
            if (r.checked) {
                selected = r.value;
                if (wrap) wrap.classList.add('is-selected');
            } else if (wrap) {
                wrap.classList.remove('is-selected');
            }
        });
        if (paymentNote && paymentNotes[selected]) {
            paymentNote.innerHTML = paymentNotes[selected];
            paymentNote.hidden = false;
        }
        const span = placeBtn ? placeBtn.querySelector('span') : null;
        if (span) span.textContent = selected === 'nomba' ? 'Pay with Nomba' : 'Place Order';
    }
    document.querySelectorAll('input[name="payment"]').forEach((r) => {
        r.addEventListener('change', updatePaymentUI);
    });

    // Auto-select country from detected currency
    const countrySelect = document.getElementById('ck-country');
    if (countrySelect && !countrySelect.value && typeof currentCurrency !== 'undefined') {
        if (currentCurrency === 'NGN') countrySelect.value = 'NG';
        else if (currentCurrency === 'GBP') countrySelect.value = 'GB';
    }

    /* ============================================= */
    /* === ORDER ID + ORDER BUILDER ================== */
    /* ============================================= */
    function generateOrderId() {
        const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
        let s = '';
        for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
        return 'FS-' + s;
    }

    function buildOrderFromForm() {
        const data = new FormData(form);
        const items = readCart();
        // Charge in NGN (Nomba is NGN-only). unitChargeNgn() bakes in the per-item
        // markup expressed in NGN: Naira view = base + ₦5,000; Pounds view = the
        // £ unit price (incl. £15) converted to NGN at the live rate. We store the
        // marked NGN prices on the order so records/emails/Orders page stay
        // consistent (no extra markup applied downstream).
        const promo = getPromo();
        const subtotal = items.reduce((s, i) => s + unitChargeNgn(i.price) * (i.qty || 0), 0);
        const discount = promo ? Math.round(subtotal * promo.off) : 0;
        const total = Math.max(0, subtotal - discount);

        return {
            id: generateOrderId(),
            placedAt: Date.now(),
            customer: {
                firstName: (data.get('firstName') || '').toString().trim(),
                lastName: (data.get('lastName') || '').toString().trim(),
                email: (data.get('email') || '').toString().trim(),
                phone: (data.get('phone') || '').toString().trim(),
            },
            shipping: {
                address1: (data.get('address1') || '').toString().trim(),
                address2: (data.get('address2') || '').toString().trim(),
                city: (data.get('city') || '').toString().trim(),
                state: (data.get('state') || '').toString().trim(),
                country: (data.get('country') || '').toString().trim(),
                postal: (data.get('postal') || '').toString().trim(),
            },
            payment: { method: (data.get('payment') || 'nomba').toString().trim() },
            items: items.map((it) => ({
                id: it.id, productId: it.productId, name: it.name, tag: it.tag,
                size: it.size, price: unitChargeNgn(it.price), qty: it.qty, image: it.image,
            })),
            subtotal, discount,
            promoCode: promo ? promo.code : null,
            total,
            currency: (typeof currentCurrency !== 'undefined' ? currentCurrency : 'NGN'),
            status: 'pending',
        };
    }

    /* ============================================= */
    /* === VALIDATION ================================ */
    /* ============================================= */
    function validate(order) {
        const c = order.customer, s = order.shipping;
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        function err(msg, id) {
            hint.classList.add('error');
            hint.textContent = msg;
            const el = id ? document.getElementById(id) : null;
            if (el) el.focus();
            return false;
        }
        if (!emailRegex.test(c.email))                return err('Drop a valid email so we can confirm the order.', 'ck-email');
        if (c.phone.replace(/\D/g, '').length < 7)    return err('Add a real phone number so logistics can reach you.', 'ck-phone');
        if (!c.firstName)                             return err('First name is required.', 'ck-firstname');
        if (!c.lastName)                              return err('Last name is required.', 'ck-lastname');
        if (!s.address1)                              return err('Shipping address is required.', 'ck-address1');
        if (!s.city)                                  return err('City is required.', 'ck-city');
        if (!s.state)                                 return err('State / region is required.', 'ck-state');
        if (!s.country)                               return err('Select your country.', 'ck-country');
        // Postal / ZIP code is optional.
        hint.classList.remove('error');
        hint.textContent = '';
        return true;
    }

    /* ============================================= */
    /* === NOMBA: redirect to hosted checkout ======== */
    /* ============================================= */
    async function processNombaPayment(order) {
        if (NOMBA_WORKER_URL.includes('YOUR-SUBDOMAIN')) {
            hint.classList.add('error');
            hint.textContent = 'Worker URL not configured. See DEPLOY-WORKER.md.';
            resetPlaceBtn();
            return;
        }

        // Save pending order so we can complete it after the Nomba return.
        // Use localStorage (not sessionStorage): mobile Safari frequently clears
        // sessionStorage across the cross-site payment round-trip.
        localStorage.setItem(PENDING_ORDER_KEY, JSON.stringify(order));

        try {
            const res = await fetch(`${NOMBA_WORKER_URL}/create-checkout`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    amount: order.total, // NGN integer (Worker formats to "X.XX")
                    email: order.customer.email,
                    orderId: order.id,
                    // Pass a CLEAN url — Nomba appends its own ?orderReference=<id>
                    // on redirect. Adding our own ?orderRef= here produced a
                    // malformed double-"?" URL that broke the return redirect
                    // (browser ended up stuck on nomba.com on mobile).
                    callbackUrl: NOMBA_RETURN_URL,
                    customerName: `${order.customer.firstName} ${order.customer.lastName}`.trim(),
                    // Full order so the Worker can store it (KV) and finalize +
                    // email server-side via the webhook even if this browser
                    // never returns. Harmless if the Worker has no KV configured.
                    order: order,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || 'Failed to create Nomba checkout');
            }
            const link = data.checkoutLink || data.checkout_url || data.link;
            if (!link) throw new Error('Nomba response missing checkoutLink');

            // IMPORTANT: Nomba ignores the orderId we send and generates its OWN
            // orderReference (a UUID). That is the value it appends to the return
            // URL and the only id its transaction-lookup knows — so we must store
            // it and use it for matching + verification on return.
            order.nombaRef = data.orderReference || data.orderRef || data.reference || null;
            localStorage.setItem(PENDING_ORDER_KEY, JSON.stringify(order));

            // Redirect to Nomba — flow continues in handleReturnFromNomba()
            window.location.href = link;
        } catch (err) {
            localStorage.removeItem(PENDING_ORDER_KEY);
            hint.classList.add('error');
            hint.textContent = 'Payment setup failed: ' + (err.message || 'Unknown error');
            resetPlaceBtn();
        }
    }

    /* ============================================= */
    /* === RETURN FROM NOMBA (verify + complete) ==== */
    /* ============================================= */
    async function handleReturnFromNomba() {
        const pendingRaw = localStorage.getItem(PENDING_ORDER_KEY);
        if (!pendingRaw) return false;            // no payment in progress
        let pending;
        try { pending = JSON.parse(pendingRaw); }
        catch (_) { localStorage.removeItem(PENDING_ORDER_KEY); return false; }

        // Nomba appends its own reference to the callbackUrl on redirect (param
        // name has varied: orderReference / orderRef / reference). On mobile the
        // query string is sometimes dropped, so we also treat a FRESH pending
        // order as a return.
        const params = new URLSearchParams(window.location.search);
        const returnedRef = params.get('orderReference') || params.get('orderRef') || params.get('reference');
        const hasReturnSignal = !!returnedRef || params.has('status') ||
            params.has('transactionId') || params.has('nombaTransactionId');

        // Guard against a stale pending order from an abandoned attempt: only
        // auto-verify when Nomba sent us back with a param, or the pending order
        // is fresh (< 30 min).
        const isRecent = pending.placedAt && (Date.now() - pending.placedAt) < 30 * 60 * 1000;
        if (!hasReturnSignal && !isRecent) { localStorage.removeItem(PENDING_ORDER_KEY); return false; }

        // Verify with the reference Nomba appended on RETURN (the authoritative
        // one for its transaction lookup); fall back to the ref captured at
        // create-checkout, then our own order id. NOTE: we intentionally do NOT
        // bail on a ref "mismatch" — in sandbox the returned ref can differ from
        // the create-checkout ref, and bailing left the customer stuck bouncing
        // back to the checkout form after a successful payment.
        const orderRef = returnedRef || pending.nombaRef || pending.id;

        // Show "Verifying payment…" while we check with Nomba
        layout.style.display = 'none';
        if (emptyEl) emptyEl.hidden = true;
        if (heroSubEl) heroSubEl.textContent = 'Verifying payment with Nomba…';

        try {
            // Prefer the Worker's idempotent /finalize: it verifies with Nomba,
            // records the order server-side, and emails ONCE (so it never clashes
            // with the webhook). If /finalize isn't available (older Worker), fall
            // back to /verify-payment + client-side EmailJS (legacy behavior).
            let outcome = await finalizeViaWorker(orderRef);
            if (!outcome) outcome = await verifyViaWorker(orderRef);

            // Only an EXPLICIT "failed" sends the customer back to the form.
            if (outcome && outcome.status === 'failed') {
                localStorage.removeItem(PENDING_ORDER_KEY);
                showFailure('Payment did not complete. Your bag is still saved — try again when ready.');
                return true;
            }

            // Confirmed paid, OR an inconclusive/unavailable check after the
            // customer has completed Nomba and returned to our callback. Either
            // way we record the order and move on to the Orders page — a paying
            // customer is never stranded on the checkout form. The Worker webhook
            // is the server-side source of truth and finalises + emails if the
            // browser could not confirm (a "processing" order flips to paid there).
            const confirmed = !!(outcome && outcome.status === 'paid');
            const emailedByServer = !!(outcome && outcome.emailed);
            await completeAndGoToOrders(pending, orderRef, confirmed, emailedByServer);
        } catch (err) {
            // Unexpected error, but the customer has already paid on Nomba —
            // record what we have and take them to Orders, not back to the form.
            await completeAndGoToOrders(pending, orderRef, false, false);
        }
        return true;
    }

    // Persist the completed order, clear the cart, send the confirmation emails,
    // then hand off to the Orders page. `confirmed` = Nomba/Worker verified it as
    // paid; otherwise it is recorded as "processing" pending the server webhook.
    async function completeAndGoToOrders(pending, orderRef, confirmed, emailedByServer) {
        pending.status = confirmed ? 'paid' : 'processing';
        pending.paidAt = Date.now();
        pending.nombaReference = orderRef;
        persistOrder(pending);

        localStorage.removeItem(PENDING_ORDER_KEY);
        clearCart();
        localStorage.removeItem(PROMO_KEY);

        // Hold the "confirmed" state visible while we send the emails.
        if (layout) layout.style.display = 'none';
        if (emptyEl) emptyEl.hidden = true;
        if (successEl) successEl.hidden = true;
        if (heroSubEl) heroSubEl.textContent = 'Payment confirmed — sending your confirmation…';

        // Send the seller + customer emails from the browser UNLESS the server
        // already did (webhook, once live keys are in). We AWAIT them (capped at
        // 6s) so the redirect below can't abort the in-flight request — that was
        // why no emails were arriving.
        if (!emailedByServer) {
            try {
                await Promise.race([
                    sendOrderEmails(pending),
                    new Promise((resolve) => setTimeout(resolve, 6000)),
                ]);
            } catch (e) { console.warn('EmailJS:', e); }
        }

        goToOrders(pending.id);
    }

    // Redirect to the Orders page (works the same on desktop + mobile). Uses
    // location.replace so Back doesn't return to the stale checkout, and strips
    // the Nomba query params first so nothing re-runs verify.
    function goToOrders(orderId) {
        if (layout) layout.style.display = 'none';
        if (emptyEl) emptyEl.hidden = true;
        if (successEl) successEl.hidden = true;
        if (heroSubEl) heroSubEl.textContent = 'Order confirmed — taking you to your orders…';
        if (history.replaceState) {
            history.replaceState({}, document.title, window.location.pathname);
        }
        const url = 'orders.html?new=' + encodeURIComponent(orderId || '');
        setTimeout(() => { window.location.replace(url); }, 200);
    }

    // fetch() with a hard timeout so a slow/unreachable Worker can never leave
    // the customer stuck on "Verifying payment…". On timeout it rejects and the
    // caller returns null → the return flow records "processing" and moves on.
    function fetchWithTimeout(url, opts, ms) {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), ms || 12000);
        return fetch(url, Object.assign({ signal: ctrl.signal }, opts))
            .finally(() => clearTimeout(t));
    }

    // POST /finalize — returns { status, emailed, nombaReference } or null if the
    // endpoint is unavailable (e.g. Worker not yet redeployed with /finalize).
    async function finalizeViaWorker(orderRef) {
        try {
            const res = await fetchWithTimeout(`${NOMBA_WORKER_URL}/finalize`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderReference: orderRef }),
            }, 12000);
            if (res.status === 404) return null; // old Worker — use legacy path
            const data = await res.json();
            if (!res.ok) return null;
            return {
                status: data.status,
                emailed: !!data.emailed,
                nombaReference: data.nombaReference || (data.order && data.order.nombaReference) || null,
            };
        } catch (_) { return null; }
    }

    // Legacy fallback: POST /verify-payment, client emails afterwards.
    async function verifyViaWorker(orderRef) {
        try {
            const res = await fetchWithTimeout(`${NOMBA_WORKER_URL}/verify-payment`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderReference: orderRef }),
            }, 12000);
            const data = await res.json();
            if (!res.ok) return null;
            const status = String(data.status || data.transactionStatus || data.paymentStatus || '').toUpperCase();
            const SUCCESS = ['SUCCESS', 'COMPLETED', 'PAID', 'SUCCESSFUL', 'APPROVED'];
            const FAILED = ['FAILED', 'DECLINED', 'CANCELLED', 'CANCELED', 'EXPIRED', 'REVERSED', 'ERROR'];
            // Anything not clearly success/failure is "unknown" → the return flow
            // records a "processing" order and still goes to Orders (never a
            // false "failed" that bounces a paying customer back to the form).
            return {
                status: SUCCESS.includes(status) ? 'paid' : (FAILED.includes(status) ? 'failed' : 'unknown'),
                emailed: false, // legacy → browser sends the emails
                nombaReference: data.reference || data.transactionId || orderRef,
            };
        } catch (_) { return null; }
    }

    function persistOrder(order) {
        try {
            const orders = JSON.parse(localStorage.getItem(ORDERS_KEY) || '[]');
            orders.push(order);
            localStorage.setItem(ORDERS_KEY, JSON.stringify(orders));
        } catch (_) {}
    }

    function showFailure(message) {
        // The cart is never cleared on a failed attempt, so re-render the
        // checkout with all the customer's products intact and let them retry.
        renderSummary();
        layout.style.display = '';
        if (emptyEl) emptyEl.hidden = true;
        if (successEl) successEl.hidden = true;
        if (heroSubEl) heroSubEl.textContent = message;
        hint.classList.add('error');
        hint.textContent = message;
        resetPlaceBtn();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        // Strip query params so a refresh doesn't re-run verify.
        if (history.replaceState) {
            history.replaceState({}, document.title, window.location.pathname);
        }
    }

    function resetPlaceBtn() {
        const span = placeBtn.querySelector('span');
        const original = (document.querySelector('input[name="payment"]:checked') || {}).value === 'nomba' ? 'Pay with Nomba' : 'Place Order';
        if (span) span.textContent = original;
        placeBtn.disabled = false;
        placeBtn.classList.remove('is-loading');
    }

    /* ============================================= */
    /* === EMAILJS: seller alert + customer confirm = */
    /* ============================================= */
    async function sendOrderEmails(order) {
        if (typeof emailjs === 'undefined') {
            console.error('[EmailJS] SDK not loaded — script tag missing from checkout.html?');
            return;
        }
        if (EMAILJS_PUBLIC_KEY.startsWith('YOUR_')) {
            console.warn('[EmailJS] Public key still a placeholder — skipping.');
            return;
        }

        const itemsText = (order.items || []).map((it) => {
            const sizeStr = it.size ? ` (Size ${it.size})` : '';
            return `${it.qty} × ${it.name}${sizeStr} — ${formatPrice(it.price * it.qty)}`;
        }).join('\n');

        const shipAddr = [
            order.shipping.address1,
            order.shipping.address2,
            `${order.shipping.city}, ${order.shipping.state}${order.shipping.postal ? ' ' + order.shipping.postal : ''}`,
            order.shipping.country,
        ].filter(Boolean).join('\n');

        const params = {
            order_id: order.id,
            customer_name: `${order.customer.firstName} ${order.customer.lastName}`.trim(),
            customer_email: order.customer.email,
            customer_phone: order.customer.phone,
            items: itemsText,
            subtotal: formatPrice(order.subtotal).replace(/<[^>]+>/g, ''),
            discount: formatPrice(order.discount).replace(/<[^>]+>/g, ''),
            total: formatPrice(order.total).replace(/<[^>]+>/g, ''),
            shipping_address: shipAddr,
            payment_method: 'Nomba',
            status: order.status,
            nomba_reference: order.nombaReference || '',
        };

        console.log('[EmailJS] Sending with params:', params);

        const tasks = [];
        if (EMAILJS_TEMPLATE_SELLER && !EMAILJS_TEMPLATE_SELLER.startsWith('YOUR_')) {
            tasks.push(
                emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_SELLER, params)
                    .then((r) => console.log('[EmailJS] Seller email OK:', r))
                    .catch((e) => console.error('[EmailJS] Seller email FAILED:', e))
            );
        }
        if (EMAILJS_TEMPLATE_CUSTOMER && !EMAILJS_TEMPLATE_CUSTOMER.startsWith('YOUR_')) {
            tasks.push(
                emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_CUSTOMER, params)
                    .then((r) => console.log('[EmailJS] Customer email OK:', r))
                    .catch((e) => console.error('[EmailJS] Customer email FAILED:', e))
            );
        }
        await Promise.allSettled(tasks);
    }

    /* ============================================= */
    /* === SUBMIT HANDLER ============================ */
    /* ============================================= */
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (readCart().length === 0) { renderSummary(); return; }

        const order = buildOrderFromForm();
        if (!validate(order)) return;

        const span = placeBtn.querySelector('span');
        const original = span ? span.textContent : 'Place Order';
        if (span) span.textContent = 'Processing…';
        placeBtn.disabled = true;
        placeBtn.classList.add('is-loading');

        // Nomba is the only payment method.
        await processNombaPayment(order);
    });

    /* ============================================= */
    /* === INIT ====================================== */
    /* ============================================= */
    document.addEventListener('cart:update', renderSummary);
    document.addEventListener('currency:update', renderSummary);
    window.addEventListener('storage', (e) => {
        if (e.key === CART_KEY || e.key === PROMO_KEY) renderSummary();
    });

    updatePaymentUI();

    // If a payment round-trip is in progress (a pending order is stored), show
    // the "Verifying…" state IMMEDIATELY so the checkout form never flashes
    // before we redirect to Orders. Otherwise render the cart as normal.
    if (localStorage.getItem(PENDING_ORDER_KEY)) {
        if (layout) layout.style.display = 'none';
        if (emptyEl) emptyEl.hidden = true;
        if (successEl) successEl.hidden = true;
        if (heroSubEl) heroSubEl.textContent = 'Verifying payment with Nomba…';
        handleReturnFromNomba().then((handled) => { if (!handled) renderSummary(); });
    } else {
        renderSummary();
    }
})();