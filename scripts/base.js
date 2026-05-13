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
    if (cartAmountEl) cartAmountEl.innerHTML = `&#8358;${getCartTotal(items).toLocaleString()}.00`;
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

renderHeaderCart();

// Sync header across tabs/windows
window.addEventListener('storage', (e) => {
    if (e.key === CART_KEY) renderHeaderCart();
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
