/* ============================================= */
/* === CART SCRIPT (cart.html) ================= */
/* ============================================= */

// ===== CART PAGE (cart.html) =====
(function () {
    const itemsEl = document.getElementById('cart-items');
    if (!itemsEl) return; // not on cart page

    const layoutEl = document.getElementById('cart-layout');
    const emptyEl = document.getElementById('cart-empty');
    const itemsCountEl = document.getElementById('cart-items-count');
    const subtotalEl = document.getElementById('sum-subtotal');
    const totalEl = document.getElementById('sum-total');
    const discountLineEl = document.getElementById('sum-discount-line');
    const discountAmountEl = document.getElementById('sum-discount');
    const discountCodeEl = document.getElementById('sum-discount-code');
    const heroSubEl = document.getElementById('cart-hero-sub');
    const clearBtn = document.getElementById('cart-clear');
    const promoInput = document.getElementById('cart-promo-input');
    const promoApply = document.getElementById('cart-promo-apply');
    const promoHint = document.getElementById('cart-promo-hint');
    const checkoutBtn = document.getElementById('cart-checkout');

    const PROMO_KEY = 'fs_cart_promo';
    const VALID_PROMOS = {
        'STREETS25': { off: 0.25, label: 'STREETS25' },
        'DROP02':    { off: 0.10, label: 'DROP02' },
        'CREW10':    { off: 0.10, label: 'CREW10' },
    };

    const fmt = (n) => `&#8358;${Number(n || 0).toLocaleString()}.00`;

    function getPromo() {
        const code = (localStorage.getItem(PROMO_KEY) || '').toUpperCase();
        return VALID_PROMOS[code] ? { code, ...VALID_PROMOS[code] } : null;
    }

    function setPromo(code) {
        if (code) localStorage.setItem(PROMO_KEY, code);
        else localStorage.removeItem(PROMO_KEY);
    }

    function render() {
        const items = readCart();
        const count = items.reduce((s, i) => s + (i.qty || 0), 0);
        const subtotal = items.reduce((s, i) => s + (i.price || 0) * (i.qty || 0), 0);
        const promo = getPromo();
        const discount = promo ? Math.round(subtotal * promo.off) : 0;
        const total = Math.max(0, subtotal - discount);

        if (count === 0) {
            if (layoutEl) layoutEl.style.display = 'none';
            if (emptyEl) emptyEl.hidden = false;
            if (heroSubEl) heroSubEl.textContent = 'Nothing in the bag yet. Pull up to the drop.';
            return;
        }

        if (layoutEl) layoutEl.style.display = '';
        if (emptyEl) emptyEl.hidden = true;
        if (heroSubEl) heroSubEl.textContent = `${count} item${count > 1 ? 's' : ''} ready. Adjust the count or slide to checkout.`;
        if (itemsCountEl) itemsCountEl.textContent = String(count);

        itemsEl.innerHTML = items.map((it) => {
            const lineTotal = (it.price || 0) * (it.qty || 0);
            const safeImg = it.image || 'images/Fakesmile-1.png';
            const safeName = (it.name || 'Product').replace(/</g, '&lt;');
            const safeTag = (it.tag || '').replace(/</g, '&lt;');
            const safeSize = (it.size || '').replace(/</g, '&lt;');
            return `
                <article class="cart-item" data-id="${it.id}">
                    <div class="cart-item-img">
                        <img src="${safeImg}" alt="${safeName}">
                    </div>
                    <div class="cart-item-body">
                        ${safeTag ? `<span class="cart-item-tag">${safeTag}</span>` : ''}
                        <h3 class="cart-item-name">${safeName}</h3>
                        ${safeSize ? `<span class="cart-item-size">Size <strong>${safeSize}</strong></span>` : ''}
                        <p class="cart-item-price">${fmt(it.price)} each</p>
                    </div>
                    <div class="cart-item-controls">
                        <button class="cart-item-remove" data-action="remove" aria-label="Remove ${safeName}">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                        <div class="cart-qty">
                            <button data-action="dec" aria-label="Decrease">&minus;</button>
                            <span class="cart-qty-value">${it.qty}</span>
                            <button data-action="inc" aria-label="Increase">+</button>
                        </div>
                        <span class="cart-item-subtotal">${fmt(lineTotal)}</span>
                    </div>
                </article>`;
        }).join('');

        if (subtotalEl) subtotalEl.innerHTML = fmt(subtotal);
        if (totalEl) totalEl.innerHTML = fmt(total);

        if (discountLineEl && discountAmountEl && discountCodeEl) {
            if (promo) {
                discountLineEl.hidden = false;
                discountAmountEl.innerHTML = `&minus;${fmt(discount)}`;
                discountCodeEl.textContent = promo.label;
            } else {
                discountLineEl.hidden = true;
            }
        }
    }

    // Delegated click handler for qty/remove
    itemsEl.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        const card = btn.closest('.cart-item');
        if (!card) return;
        const id = card.dataset.id;
        const items = readCart();
        const item = items.find(i => i.id === id);
        if (!item) return;

        const action = btn.dataset.action;
        if (action === 'inc') {
            setCartQty(id, (item.qty || 0) + 1);
            render();
        } else if (action === 'dec') {
            const next = (item.qty || 0) - 1;
            if (next <= 0) {
                card.classList.add('is-removing');
                setTimeout(() => { removeFromCart(id); render(); }, 280);
            } else {
                setCartQty(id, next);
                render();
            }
        } else if (action === 'remove') {
            card.classList.add('is-removing');
            setTimeout(() => { removeFromCart(id); render(); }, 280);
        }
    });

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            if (readCart().length === 0) return;
            const confirmed = confirm('Clear all items from your cart?');
            if (!confirmed) return;
            setPromo(null);
            clearCart();
            render();
        });
    }

    if (promoApply && promoInput) {
        // Pre-fill from saved promo
        const saved = getPromo();
        if (saved) {
            promoInput.value = saved.code;
            if (promoHint) {
                promoHint.classList.remove('error');
                promoHint.textContent = `${saved.label} applied — ${Math.round(saved.off * 100)}% off.`;
            }
        }
        promoApply.addEventListener('click', () => {
            const code = (promoInput.value || '').trim().toUpperCase();
            if (!code) {
                setPromo(null);
                if (promoHint) { promoHint.classList.remove('error'); promoHint.textContent = ''; }
                render();
                return;
            }
            if (VALID_PROMOS[code]) {
                setPromo(code);
                if (promoHint) {
                    promoHint.classList.remove('error');
                    promoHint.textContent = `${code} applied — ${Math.round(VALID_PROMOS[code].off * 100)}% off.`;
                }
            } else {
                setPromo(null);
                if (promoHint) {
                    promoHint.classList.add('error');
                    promoHint.textContent = "That code didn't work. Try STREETS25.";
                }
            }
            render();
        });
        promoInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); promoApply.click(); }
        });
    }

    if (checkoutBtn) {
        checkoutBtn.addEventListener('click', () => {
            const items = readCart();
            if (items.length === 0) return;
            const original = checkoutBtn.querySelector('span').textContent;
            checkoutBtn.querySelector('span').textContent = 'Redirecting…';
            checkoutBtn.disabled = true;
            setTimeout(() => {
                alert('Checkout flow coming soon. Your bag is saved.');
                checkoutBtn.querySelector('span').textContent = original;
                checkoutBtn.disabled = false;
            }, 600);
        });
    }

    // Re-render if cart changes elsewhere (other tab / programmatic)
    document.addEventListener('cart:update', render);
    window.addEventListener('storage', (e) => {
        if (e.key === CART_KEY || e.key === PROMO_KEY) render();
    });

    render();
})();
