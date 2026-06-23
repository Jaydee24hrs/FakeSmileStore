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
 *  8. If verified: save order to localStorage.fs_orders, send EmailJS x 2,
 *     clear cart, show success card
 *  9. Bank-transfer branch skips Nomba and goes straight to success.
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
        bank:  'Bank account details will be sent to your email after placing the order. Order ships once payment is confirmed.',
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

        // Nomba appends ?orderReference=<id> to the callbackUrl on redirect
        // (older links used orderRef). On mobile the query string is sometimes
        // dropped when returning from a banking app, so fall back to the
        // pending order we stored before redirecting.
        const params = new URLSearchParams(window.location.search);
        const returnedRef = params.get('orderReference') || params.get('orderRef');

        // Guard against a stale pending order from an abandoned attempt: only
        // auto-verify when Nomba sent a ref back, or the pending order is fresh.
        const isRecent = pending.placedAt && (Date.now() - pending.placedAt) < 30 * 60 * 1000;
        if (!returnedRef && !isRecent) { localStorage.removeItem(PENDING_ORDER_KEY); return false; }

        // Verify with NOMBA's orderReference (the UUID it generated — see
        // processNombaPayment). Nomba appends that same ref to the return URL, so
        // if a ref came back it must match what we stored. If the query string was
        // dropped (common on mobile) we fall back to the stored Nomba ref.
        const nombaRef = pending.nombaRef || null;
        if (returnedRef && nombaRef && returnedRef !== nombaRef) return false; // not our order
        const orderRef = nombaRef || returnedRef || pending.id;

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

            if (!outcome || outcome.status !== 'paid') {
                if (outcome && outcome.status === 'failed') {
                    localStorage.removeItem(PENDING_ORDER_KEY);
                    showFailure('Payment did not complete. Your bag is still saved — try again when ready.');
                    return true;
                }
                throw new Error('Could not confirm payment status');
            }

            // Mark paid + persist locally (Orders page reads localStorage)
            pending.status = 'paid';
            pending.paidAt = Date.now();
            pending.nombaReference = outcome.nombaReference || orderRef;
            persistOrder(pending);

            // Clear cart + promo + pending
            localStorage.removeItem(PENDING_ORDER_KEY);
            clearCart();
            localStorage.removeItem(PROMO_KEY);

            // Only email from the browser if the server did NOT already (no dupes).
            if (!outcome.emailed) {
                sendOrderEmails(pending).catch((e) => console.warn('EmailJS:', e));
            }

            showSuccess(pending);
        } catch (err) {
            showFailure('Could not verify payment: ' + (err.message || 'Unknown error'));
        }
        return true;
    }

    // POST /finalize — returns { status, emailed, nombaReference } or null if the
    // endpoint is unavailable (e.g. Worker not yet redeployed with /finalize).
    async function finalizeViaWorker(orderRef) {
        try {
            const res = await fetch(`${NOMBA_WORKER_URL}/finalize`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderReference: orderRef }),
            });
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
            const res = await fetch(`${NOMBA_WORKER_URL}/verify-payment`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderReference: orderRef }),
            });
            const data = await res.json();
            if (!res.ok) return null;
            const status = String(data.status || data.transactionStatus || data.paymentStatus || '').toUpperCase();
            const isSuccess = ['SUCCESS', 'COMPLETED', 'PAID', 'SUCCESSFUL'].includes(status);
            return {
                status: isSuccess ? 'paid' : (status ? 'failed' : 'unknown'),
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

    function showSuccess(order) {
        layout.style.display = 'none';
        if (emptyEl) emptyEl.hidden = true;
        successEl.hidden = false;

        const idEl = document.getElementById('success-orderid');
        const emailEl = document.getElementById('success-email');
        const totalElSuccess = document.getElementById('success-total');
        if (idEl) idEl.textContent = order.id;
        if (emailEl) emailEl.textContent = order.customer.email;
        if (totalElSuccess) totalElSuccess.innerHTML = formatPrice(order.total);

        if (heroSubEl) heroSubEl.textContent = 'Order locked in. Welcome to the movement.';
        window.scrollTo({ top: 0, behavior: 'smooth' });

        // Strip the query params so a refresh doesn't re-trigger verify
        if (history.replaceState) {
            history.replaceState({}, document.title, window.location.pathname);
        }
    }

    function showFailure(message) {
        if (heroSubEl) heroSubEl.textContent = message;
        layout.style.display = '';
        if (emptyEl) emptyEl.hidden = true;
        hint.classList.add('error');
        hint.textContent = message;
        resetPlaceBtn();
        // Strip query params
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
            payment_method: order.payment.method === 'nomba' ? 'Nomba' : 'Bank Transfer',
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

        if (order.payment.method === 'nomba') {
            await processNombaPayment(order);
            return;
        }

        // ===== Bank-transfer branch — instant success, manual confirmation =====
        order.status = 'pending';
        persistOrder(order);
        sendOrderEmails(order).catch((e) => console.warn('EmailJS:', e));

        setTimeout(() => {
            clearCart();
            localStorage.removeItem(PROMO_KEY);
            showSuccess(order);
            if (span) span.textContent = original;
            placeBtn.disabled = false;
            placeBtn.classList.remove('is-loading');
        }, 700);
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
    renderSummary();

    // If the user just got bounced back from Nomba, run the verify flow
    handleReturnFromNomba();
})();