/* ============================================= */
/* === ORDERS SCRIPT (orders.html) ============== */
/* ============================================= */

(function () {
    const listEl = document.getElementById('orders-list');
    if (!listEl) return;

    const wrapEl = document.getElementById('orders-wrap');
    const emptyEl = document.getElementById('orders-empty');
    const countEl = document.getElementById('orders-count');
    const clearBtn = document.getElementById('orders-clear');
    const heroSubEl = document.getElementById('orders-hero-sub');

    const ORDERS_KEY = 'fs_orders';

    // Country code → readable name (matches the checkout dropdown)
    const COUNTRY_NAMES = {
        NG: 'Nigeria', GB: 'United Kingdom', US: 'United States', CA: 'Canada',
        GH: 'Ghana', ZA: 'South Africa', KE: 'Kenya', EG: 'Egypt', DE: 'Germany',
        FR: 'France', NL: 'Netherlands', ES: 'Spain', IT: 'Italy', IE: 'Ireland',
        SE: 'Sweden', NO: 'Norway', DK: 'Denmark', BE: 'Belgium', CH: 'Switzerland',
        AT: 'Austria', AU: 'Australia', NZ: 'New Zealand', AE: 'UAE',
        SA: 'Saudi Arabia', QA: 'Qatar', IN: 'India', JP: 'Japan',
        KR: 'South Korea', SG: 'Singapore', HK: 'Hong Kong', BR: 'Brazil',
        MX: 'Mexico', OTHER: 'Other',
    };

    const PAYMENT_LABELS = {
        card: 'Card', paystack: 'Paystack', bank: 'Bank transfer',
    };

    function readOrders() {
        try {
            const arr = JSON.parse(localStorage.getItem(ORDERS_KEY) || '[]');
            return Array.isArray(arr) ? arr : [];
        } catch (_) { return []; }
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[<>&]/g, (c) => (
            { '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]
        ));
    }

    function fmtDate(ts) {
        const d = new Date(ts || Date.now());
        return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    // No backend — derive a believable fulfilment status from how long ago
    // the order was placed so the tracker feels alive.
    function deriveStage(placedAt) {
        const days = (Date.now() - (placedAt || Date.now())) / 86400000;
        if (days < 1) return 1;  // Processing
        if (days < 4) return 2;  // Shipped
        return 3;                // Delivered
    }
    const STAGE_META = {
        1: { key: 'processing', label: 'Processing' },
        2: { key: 'shipped',    label: 'Shipped' },
        3: { key: 'delivered',  label: 'Delivered' },
    };

    function trackerHTML(stage) {
        const steps = ['Processing', 'Shipped', 'Delivered'];
        const check = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        return steps.map((label, i) => {
            const stepNo = i + 1;
            let cls = 'order-track-step';
            if (stepNo < stage) cls += ' is-done';
            else if (stepNo === stage) cls += ' is-done is-current';
            return `
                <div class="${cls}">
                    <span class="order-track-dot">${check}</span>
                    <span class="order-track-label">${label}</span>
                </div>`;
        }).join('');
    }

    function buildOrderHTML(order) {
        const stage = deriveStage(order.placedAt);
        const meta = STAGE_META[stage];
        const items = Array.isArray(order.items) ? order.items : [];

        const itemsHtml = items.map((it) => {
            const img = it.image || 'images/Fakesmile-1.png';
            const name = escapeHtml(it.name || 'Product');
            const size = it.size ? 'Size ' + escapeHtml(it.size) : 'One size';
            const line = (it.price || 0) * (it.qty || 0);
            return `
                <div class="order-item">
                    <span class="order-item-thumb">
                        <img src="${img}" alt="">
                        <span class="order-item-qty">${it.qty || 1}</span>
                    </span>
                    <div class="order-item-info">
                        <span class="order-item-name">${name}</span>
                        <span class="order-item-meta">${size} &middot; ${escapeHtml(it.tag || '')}</span>
                    </div>
                    <span class="order-item-price">${formatPrice(line)}</span>
                </div>`;
        }).join('');

        const ship = order.shipping || {};
        const cust = order.customer || {};
        const country = COUNTRY_NAMES[ship.country] || ship.country || '';
        const shipName = [cust.firstName, cust.lastName].filter(Boolean).join(' ');
        const shipParts = [ship.address1, ship.city, ship.state, country].filter(Boolean).join(', ');
        const payLabel = PAYMENT_LABELS[(order.payment && order.payment.method) || 'card'] || 'Card';
        const promoLine = order.promoCode
            ? `<div class="order-foot-line"><span class="label">Promo</span><span class="value">${escapeHtml(order.promoCode)} applied</span></div>`
            : '';

        return `
            <article class="order-card" data-id="${escapeHtml(order.id)}">
                <header class="order-card-head">
                    <div class="order-id-block">
                        <span class="order-id-label">Order</span>
                        <strong class="order-id">${escapeHtml(order.id)}</strong>
                    </div>
                    <div class="order-meta">
                        <span class="order-date">${fmtDate(order.placedAt)}</span>
                        <span class="order-status order-status-${meta.key}">${meta.label}</span>
                    </div>
                </header>

                <div class="order-track">${trackerHTML(stage)}</div>

                <div class="order-items">${itemsHtml}</div>

                <footer class="order-card-foot">
                    <div class="order-foot-info">
                        <div class="order-foot-line">
                            <span class="label">Ship to</span>
                            <span class="value">${escapeHtml(shipName)}${shipName && shipParts ? ' &mdash; ' : ''}${escapeHtml(shipParts)}</span>
                        </div>
                        <div class="order-foot-line">
                            <span class="label">Payment</span>
                            <span class="value">${escapeHtml(payLabel)}</span>
                        </div>
                        ${promoLine}
                    </div>
                    <div class="order-foot-right">
                        <div class="order-total-block">
                            <span>Total</span>
                            <strong>${formatPrice(order.total || 0)}</strong>
                        </div>
                        <button type="button" class="order-reorder" data-id="${escapeHtml(order.id)}">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>
                            Buy Again
                        </button>
                    </div>
                </footer>
            </article>`;
    }

    function render() {
        const orders = readOrders().slice().sort((a, b) => (b.placedAt || 0) - (a.placedAt || 0));

        if (orders.length === 0) {
            if (wrapEl) wrapEl.hidden = true;
            if (emptyEl) emptyEl.hidden = false;
            if (heroSubEl) heroSubEl.textContent = 'No orders yet — the drop is live, pull up.';
            return;
        }

        if (wrapEl) wrapEl.hidden = false;
        if (emptyEl) emptyEl.hidden = true;
        if (countEl) countEl.textContent = String(orders.length);
        if (clearBtn) clearBtn.hidden = false;
        if (heroSubEl) {
            heroSubEl.textContent = `${orders.length} order${orders.length > 1 ? 's' : ''} placed. Track each drop, reorder your favourites.`;
        }

        listEl.innerHTML = orders.map(buildOrderHTML).join('');
    }

    // ===== Reorder — push the order's items back into the cart =====
    listEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.order-reorder');
        if (!btn) return;
        const order = readOrders().find((o) => o.id === btn.dataset.id);
        if (!order || typeof addToCart !== 'function') return;

        (order.items || []).forEach((it) => {
            // Pass productId (the base/-set id) so addToCart re-derives the
            // size suffix itself — passing it.id would double the suffix.
            addToCart({
                id: it.productId || it.id,
                name: it.name,
                tag: it.tag,
                size: it.size,
                price: it.price,
                image: it.image,
                qty: it.qty || 1,
            });
        });

        btn.classList.add('is-added');
        const original = btn.innerHTML;
        btn.innerHTML = 'Added to bag &check;';
        btn.disabled = true;
        setTimeout(() => {
            btn.innerHTML = original;
            btn.classList.remove('is-added');
            btn.disabled = false;
        }, 1800);
    });

    // ===== Clear order history =====
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            if (readOrders().length === 0) return;
            if (!confirm('Clear your entire order history? This cannot be undone.')) return;
            localStorage.removeItem(ORDERS_KEY);
            render();
        });
    }

    // Re-render on currency change so totals/line prices reformat
    document.addEventListener('currency:update', render);
    window.addEventListener('storage', (e) => {
        if (e.key === ORDERS_KEY) render();
    });

    render();
})();