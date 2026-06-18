/* ============================================= */
/* === BASE SCRIPT (shared by every page) ====== */
/* ============================================= */

// ===== ACTIVE NAV LINK =====
const navLinks = document.querySelectorAll('.main-nav a');
navLinks.forEach(link => {
    link.addEventListener('click', () => {
        // For in-page anchor links, swap active state.
        // External page links handle active via the new page's HTML.
        const href = link.getAttribute('href') || '';
        if (href.startsWith('#')) {
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
        }
    });
});


// ===== CURRENCY (auto: GBP default, NGN for Nigeria IPs) =====
// All prices in products.js + cart storage are NGN integers. formatPrice()
// converts to GBP using a LIVE exchange rate fetched from a public FX API
// (fawazahmed0 currency-api, sourced from the world FX market — same daily
// rates the major UK/EU market data feeds publish). The rate is cached in
// localStorage for 24 hours so we don't hammer the API.
const CURRENCY_KEY = 'fs_currency';
const FX_CACHE_KEY = 'fs_fx_rate';
const FX_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const FX_API_PRIMARY  = 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/gbp.json';
const FX_API_FALLBACK = 'https://latest.currency-api.pages.dev/v1/currencies/gbp.json';
const FX_FALLBACK_NGN_PER_GBP = 2000; // used only if both API + cache are unavailable
const CURRENCIES = {
    NGN: { symbol: '₦' },
    GBP: { symbol: '£' },
};

let currentCurrency = localStorage.getItem(CURRENCY_KEY);
if (!currentCurrency || !CURRENCIES[currentCurrency]) currentCurrency = 'GBP';

// Seed the live rate from cache so the first paint already has a real number
let ngnPerGbp = FX_FALLBACK_NGN_PER_GBP;
try {
    const cached = JSON.parse(localStorage.getItem(FX_CACHE_KEY) || 'null');
    if (cached && typeof cached.ratio === 'number' && cached.ratio > 0) {
        ngnPerGbp = cached.ratio;
    }
} catch (_) { /* keep fallback */ }

function formatPrice(ngnValue) {
    const n = Number(ngnValue) || 0;
    if (currentCurrency === 'NGN') {
        return CURRENCIES.NGN.symbol + Math.round(n).toLocaleString() + '.00';
    }
    const gbp = n / ngnPerGbp;
    return CURRENCIES.GBP.symbol + gbp.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function fetchExchangeRate() {
    // Skip network if cache is still fresh
    try {
        const cached = JSON.parse(localStorage.getItem(FX_CACHE_KEY) || 'null');
        if (cached && cached.fetchedAt && (Date.now() - cached.fetchedAt) < FX_CACHE_TTL_MS) {
            return;
        }
    } catch (_) { /* fall through and fetch */ }

    for (const url of [FX_API_PRIMARY, FX_API_FALLBACK]) {
        try {
            const r = await fetch(url);
            if (!r.ok) continue;
            const d = await r.json();
            const rate = d && d.gbp && d.gbp.ngn;
            if (typeof rate === 'number' && rate > 0) {
                ngnPerGbp = rate;
                localStorage.setItem(FX_CACHE_KEY, JSON.stringify({
                    ratio: rate,
                    date: d.date || null,
                    fetchedAt: Date.now(),
                }));
                applyCurrencyToPage();
                renderHeaderCart();
                document.dispatchEvent(new CustomEvent('currency:update', { detail: { code: currentCurrency, rate } }));
                return;
            }
        } catch (_) { /* try next mirror */ }
    }
}

// Returns the underlying NGN integer for a price element, preferring the
// data-price-ngn attribute and falling back to parsing the textContent
// (which is in NGN on first run because every page hardcodes ₦ in HTML).
function readCardPriceNgn(priceEl) {
    if (!priceEl) return 0;
    const attr = priceEl.getAttribute && priceEl.getAttribute('data-price-ngn');
    if (attr) return parseInt(attr, 10) || 0;
    const num = parseInt((priceEl.textContent || '').replace(/[^\d]/g, ''), 10);
    return isNaN(num) ? 0 : num;
}

function applyCurrencyToPage() {
    // Anything already tagged with the NGN value
    document.querySelectorAll('[data-price-ngn]').forEach((el) => {
        const ngn = parseInt(el.getAttribute('data-price-ngn'), 10);
        if (!isNaN(ngn)) el.innerHTML = formatPrice(ngn);
    });
    // Catalog cards: first run extracts NGN from the hardcoded ₦ HTML, then tags
    document.querySelectorAll('.product-price:not([data-price-ngn])').forEach((el) => {
        const num = parseInt((el.textContent || '').replace(/[^\d]/g, ''), 10);
        if (!isNaN(num) && num > 0) {
            el.setAttribute('data-price-ngn', num);
            el.innerHTML = formatPrice(num);
        }
    });
}

function setCurrency(code) {
    if (!CURRENCIES[code] || code === currentCurrency) return;
    currentCurrency = code;
    localStorage.setItem(CURRENCY_KEY, code);
    applyCurrencyToPage();
    renderHeaderCart();
    document.dispatchEvent(new CustomEvent('currency:update', { detail: { code } }));
}

async function detectCurrencyByIP() {
    // Respect a saved user preference if one exists
    if (localStorage.getItem(CURRENCY_KEY)) return;
    try {
        const r = await fetch('https://ipapi.co/json/');
        if (!r.ok) return;
        const d = await r.json();
        const country = (d.country_code || d.country || '').toUpperCase();
        const next = (country === 'NG') ? 'NGN' : 'GBP';
        if (next !== currentCurrency) setCurrency(next);
    } catch (_) { /* network blocked — keep GBP default */ }
}

// ===== CART FUNCTIONALITY (persisted across pages) =====
const PRODUCT_PRICE = 5000;
const CART_KEY = 'fs_cart_items';

const cartCountEl = document.querySelector('.cart-count');
const cartAmountEl = document.querySelector('.cart-amount');

function readCart() {
    try {
        return JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    } catch (_) { return []; }
}

function writeCart(items) {
    localStorage.setItem(CART_KEY, JSON.stringify(items));
    localStorage.setItem('fs_cart_count', String(getCartCount(items)));
    localStorage.setItem('fs_cart_total', String(getCartTotal(items)));
    document.dispatchEvent(new CustomEvent('cart:update', { detail: { items } }));
}

function getCartCount(items) {
    return (items || readCart()).reduce((sum, i) => sum + (i.qty || 0), 0);
}

function getCartTotal(items) {
    return (items || readCart()).reduce((sum, i) => sum + (i.price || 0) * (i.qty || 0), 0);
}

function renderHeaderCart() {
    const items = readCart();
    if (cartCountEl) cartCountEl.textContent = getCartCount(items);
    if (cartAmountEl) cartAmountEl.innerHTML = formatPrice(getCartTotal(items));
}

function pulseCart() {
    const cartIcon = document.querySelector('.cart-icon');
    if (!cartIcon) return;
    cartIcon.style.transform = 'scale(1.3)';
    cartIcon.style.transition = 'transform 0.2s ease';
    setTimeout(() => { cartIcon.style.transform = 'scale(1)'; }, 200);
}

function showCartToast(item) {
    const existing = document.querySelector('.cart-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = 'cart-toast';
    const safeName = (item && item.name ? item.name : 'Item').replace(/</g, '&lt;');
    const img = item && item.image ? item.image : '';
    toast.innerHTML = `
        ${img ? `<span class="toast-thumb"><img src="${img}" alt=""></span>` : ''}
        <span class="toast-body">
            <span class="toast-eyebrow">Added to bag</span>
            <strong class="toast-name">${safeName}</strong>
        </span>
        <a href="cart.html" class="toast-cta" aria-label="View cart">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
        </a>
    `;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, 2400);
}

function slugify(s) {
    return (s || '').toString().toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function addToCart(input) {
    // accept either a number (legacy hero price) or a full item object
    let item = typeof input === 'number'
        ? { id: 'fakesmile-drop', name: 'FakeSmile Drop', tag: 'Featured', price: input, image: 'images/Fakesmile-1.png' }
        : Object.assign({}, input);
    if (!item || !item.id) item.id = slugify(item.name) || 'item-' + Date.now();

    const baseId = item.id;

    // ===== SIZE DEFAULT =====
    // If no size was passed AND the product has sizes defined, default to "M"
    // (or the first listed size). This lets shop/catalog "+" clicks still pick
    // up a size — the product detail page passes the user-selected size.
    if (!item.size && typeof PRODUCTS !== 'undefined' && PRODUCTS[baseId]) {
        const p = PRODUCTS[baseId];
        if (p.details && p.details.Sizes) {
            const sizes = p.details.Sizes.split('/').map((s) => s.trim()).filter(Boolean);
            if (sizes.length > 0) {
                item.size = sizes.indexOf('M') >= 0 ? 'M' : sizes[0];
            }
        }
    }

    // ===== SET MERGE =====
    // FakeSmile sells matching outfits (hoodie+joggers, jersey+shorts) as
    // ONE product. If the item belongs to a partnered set, rewrite it into
    // a canonical "set" entry so both pieces collapse into the same cart row.
    if (typeof PRODUCTS !== 'undefined' && PRODUCTS[baseId] && PRODUCTS[baseId].partner) {
        const p = PRODUCTS[baseId];
        const partner = PRODUCTS[p.partner];
        if (partner) {
            const isTop = (p.category === 'Tops & Hoodies');
            const top = isTop ? p : partner;
            const bottom = isTop ? partner : p;
            const setId = top.id + '-set';
            item = {
                id: setId,
                name: top.name,
                tag: top.tag + ' + ' + bottom.tag,
                price: (top.price || 0) + (bottom.price || 0),
                image: top.completewear || top.image,
                size: item.size || '',
                qty: item.qty || 1,
            };
        }
    }

    // The cart entry key combines product id + size so different sizes of
    // the same product show as separate rows in the cart.
    const sizeKey = item.size ? '-' + String(item.size).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
    const cartId = item.id + sizeKey;

    const items = readCart();
    const existing = items.find((i) => i.id === cartId);
    if (existing) {
        existing.qty = (existing.qty || 0) + (item.qty || 1);
    } else {
        items.push({
            id: cartId,
            productId: item.id, // base id (without size) for future product look-ups
            name: item.name || 'Product',
            tag: item.tag || '',
            size: item.size || '',
            price: item.price || 0,
            image: item.image || '',
            qty: item.qty || 1,
        });
    }
    writeCart(items);
    renderHeaderCart();
    pulseCart();
    showCartToast(item);
}

function removeFromCart(id) {
    const items = readCart().filter(i => i.id !== id);
    writeCart(items);
    renderHeaderCart();
}

function setCartQty(id, qty) {
    const items = readCart();
    const item = items.find(i => i.id === id);
    if (!item) return;
    if (qty <= 0) return removeFromCart(id);
    item.qty = qty;
    writeCart(items);
    renderHeaderCart();
}

function clearCart() {
    writeCart([]);
    renderHeaderCart();
}

applyCurrencyToPage();
renderHeaderCart();
detectCurrencyByIP();
fetchExchangeRate();

// Sync header across tabs/windows
window.addEventListener('storage', (e) => {
    if (e.key === CART_KEY) renderHeaderCart();
    if (e.key === CURRENCY_KEY) {
        const code = e.newValue;
        if (CURRENCIES[code] && code !== currentCurrency) {
            currentCurrency = code;
            applyCurrencyToPage();
            renderHeaderCart();
            document.dispatchEvent(new CustomEvent('currency:update', { detail: { code } }));
        }
    }
});

// ===== FOOTER =====
const footerYear = document.getElementById('footer-year');
if (footerYear) footerYear.textContent = new Date().getFullYear();

const newsletterForm = document.getElementById('newsletter-form');
if (newsletterForm) {
    const input = newsletterForm.querySelector('input[type="email"]');
    const hint = newsletterForm.querySelector('.newsletter-hint');
    const submit = newsletterForm.querySelector('.newsletter-submit span');
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    newsletterForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const value = input.value.trim();
        if (!emailRegex.test(value)) {
            hint.textContent = 'Drop a valid email so we can keep you in the loop.';
            hint.classList.add('error');
            input.focus();
            return;
        }
        hint.classList.remove('error');
        hint.textContent = `You're in. Welcome to the movement, ${value.split('@')[0]}.`;
        submit.textContent = 'Subscribed';
        input.value = '';
        setTimeout(() => { submit.textContent = 'Subscribe'; }, 2500);
    });
}

// ===== HEADER SCROLL EFFECT =====
const header = document.querySelector('.liquid-glass-header');
if (header) {
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            header.style.background = 'linear-gradient(135deg, rgba(20, 60, 50, 0.7) 0%, rgba(10, 30, 25, 0.8) 50%, rgba(20, 60, 50, 0.7) 100%)';
        } else {
            header.style.background = '';
        }
    });
}

// Note: clicking a product image navigates to product.html via a native <a> tag
// wrapping the image (see .product-image-wrap in index.html). No JS needed —
// the anchor's href works in every browser, even when other listeners call
// preventDefault on mousedown.
