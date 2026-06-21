/* ============================================= */
/* === HOME SCRIPT (index.html) ================ */
/* ============================================= */

// ===== SYNC STATIC HOME CARDS TO THE CATALOG =====
// The home carousels are hand-authored HTML. Pull the product id out of each
// card's link and reconcile it with products.js so prices (incl. the per-item
// markup) and Coming-Soon state match the shop instead of drifting.
function cardProductId(card) {
    const link = card && card.querySelector('a[href*="product.html?id="]');
    if (!link) return null;
    const m = (link.getAttribute('href') || '').match(/[?&]id=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : null;
}
function syncHomeCardsToCatalog() {
    if (typeof PRODUCTS === 'undefined') return;
    document.querySelectorAll('.product-card').forEach((card) => {
        const id = cardProductId(card);
        const p = id && PRODUCTS[id];
        if (!p) return;
        const priceEl = card.querySelector('.product-price');
        const addBtn = card.querySelector('.product-add');
        const glass = card.querySelector('.product-glass') || card;
        if (p.comingSoon) {
            card.classList.add('coming-soon');
            if (priceEl) {
                priceEl.removeAttribute('data-price-ngn');
                priceEl.classList.add('product-price-soon');
                priceEl.textContent = 'Coming Soon';
            }
            if (addBtn) { addBtn.disabled = true; addBtn.setAttribute('aria-disabled', 'true'); }
            // One badge only — REPLACE the existing one (don't stack a second).
            // Keep "Limited" as-is; Bestseller/New/none become "Coming Soon".
            let badgeEl = card.querySelector('.product-badge');
            if (p.badge === 'Limited') {
                if (badgeEl) { badgeEl.textContent = 'Limited'; badgeEl.classList.remove('product-badge-soon'); }
            } else {
                if (!badgeEl) {
                    badgeEl = document.createElement('span');
                    badgeEl.className = 'product-badge';
                    glass.insertBefore(badgeEl, glass.firstChild);
                }
                badgeEl.textContent = 'Coming Soon';
                badgeEl.classList.add('product-badge-soon');
            }
        } else if (priceEl && typeof formatMarked === 'function') {
            priceEl.setAttribute('data-price-ngn', p.price);
            priceEl.innerHTML = formatMarked(p.price, 1);
        }
    });
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncHomeCardsToCatalog);
} else {
    syncHomeCardsToCatalog();
}

// ===== TYPEWRITER EFFECT FOR FAKESMILE =====
const typewriterEl = document.getElementById('typewriter');
const text = 'FAKESMILE';
let index = 0;
let isDeleting = false;

function typeWriter() {
    if (!typewriterEl) return;
    if (!isDeleting && index <= text.length) {
        typewriterEl.textContent = text.substring(0, index);
        index++;
        if (index > text.length) {
            isDeleting = true;
            setTimeout(typeWriter, 2500);
            return;
        }
        setTimeout(typeWriter, 200);
    } else if (isDeleting && index >= 0) {
        typewriterEl.textContent = text.substring(0, index);
        index--;
        if (index < 0) {
            isDeleting = false;
            index = 0;
            setTimeout(typeWriter, 500);
            return;
        }
        setTimeout(typeWriter, 100);
    }
}

if (typewriterEl) typeWriter();


// ===== HERO BUTTONS (View Products → shop, Add to Cart → cart) =====
const addToCartBtn = document.querySelector('.hero-buttons .btn-primary');
const viewProductsBtn = document.querySelector('.hero-buttons .btn-outline');

if (addToCartBtn) {
    addToCartBtn.addEventListener('click', () => {
        window.location.href = 'cart.html';
    });
}

if (viewProductsBtn) {
    viewProductsBtn.addEventListener('click', () => {
        window.location.href = 'shop.html';
    });
}

// ===== PRODUCT CAROUSEL (LIQUID GLASS 3D) =====
function initCarousel(section) {
    const track = section.querySelector('.carousel-track');
    if (!track) return;

    const cards = Array.from(track.children);
    const prevBtn = section.querySelector('.carousel-prev');
    const nextBtn = section.querySelector('.carousel-next');
    const progressBar = section.querySelector('.carousel-progress-bar');
    const viewport = section.querySelector('.carousel-viewport');

    let index = 0;
    let visible = 5;

    function computeVisible() {
        const w = window.innerWidth;
        if (w <= 480) return 1;
        if (w <= 720) return 2;
        if (w <= 980) return 3;
        if (w <= 1280) return 4;
        return 5;
    }

    function maxIndex() {
        return Math.max(0, cards.length - visible);
    }

    function update() {
        visible = computeVisible();
        if (index > maxIndex()) index = maxIndex();

        const card = cards[0];
        const cardW = card.getBoundingClientRect().width;
        const gap = parseFloat(getComputedStyle(track).gap) || 22;
        const offset = (cardW + gap) * index;

        track.style.transform = `translate3d(${-offset}px, 0, 0)`;

        cards.forEach((c, i) => {
            const inView = i >= index && i < index + visible;
            const distFromCenter = Math.abs(i - (index + visible / 2 - 0.5));
            c.style.opacity = inView ? '1' : '0.35';
            c.style.transform = inView
                ? `translateZ(${-distFromCenter * 8}px)`
                : 'translateZ(-40px)';
            c.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        });

        prevBtn.disabled = index === 0;
        nextBtn.disabled = index >= maxIndex();

        const pct = maxIndex() === 0 ? 100 : ((index / maxIndex()) * 70 + 30);
        progressBar.style.width = `${pct}%`;
    }

    prevBtn.addEventListener('click', () => {
        index = Math.max(0, index - 1);
        update();
    });
    nextBtn.addEventListener('click', () => {
        index = Math.min(maxIndex(), index + 1);
        update();
    });

    viewport.setAttribute('tabindex', '0');
    viewport.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') prevBtn.click();
        if (e.key === 'ArrowRight') nextBtn.click();
    });

    let startX = 0, deltaX = 0, dragging = false;
    const onStart = (x) => { startX = x; deltaX = 0; dragging = true; };
    const onMove = (x) => { if (dragging) deltaX = x - startX; };
    const onEnd = () => {
        if (!dragging) return;
        dragging = false;
        if (deltaX < -40) nextBtn.click();
        else if (deltaX > 40) prevBtn.click();
    };

    viewport.addEventListener('touchstart', (e) => {
        if (e.target.closest('button, a, input, select, textarea, [role="button"]')) return;
        onStart(e.touches[0].clientX);
    }, { passive: true });
    viewport.addEventListener('touchmove', (e) => onMove(e.touches[0].clientX), { passive: true });
    viewport.addEventListener('touchend', onEnd);
    viewport.addEventListener('mousedown', (e) => {
        // Don't engage drag when the user is pressing a button, link, or product image (image clicks open the product page).
        if (e.target.closest('button, a, input, select, textarea, [role="button"], .product-image-wrap')) return;
        onStart(e.clientX);
        e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => onMove(e.clientX));
    window.addEventListener('mouseup', onEnd);

    // No per-card mousemove tilt — it dynamically rotates the glass up to
    // ±10°, which makes hit-testing unstable on desktop (clicks can land on
    // the wrong card when transforms shift mid-click). The static :hover lift
    // in CSS gives the depth feel without breaking clicks.

    window.addEventListener('resize', update);
    requestAnimationFrame(update);
}

document.querySelectorAll('.catalogue-section').forEach(initCarousel);

// ===== Delegated add-to-cart for ALL product cards (every carousel) =====
// Capture-phase listeners on document so nothing can intercept the click first.
document.addEventListener('mousedown', (e) => {
    if (e.target.closest('.product-add')) e.stopPropagation();
}, true);
document.addEventListener('touchstart', (e) => {
    if (e.target.closest('.product-add')) e.stopPropagation();
}, { capture: true, passive: true });

document.addEventListener('click', (e) => {
    const btn = e.target.closest('.product-add');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();

    const card = btn.closest('.product-card');
    if (!card) return;

    try {
        const priceEl = card.querySelector('.product-price');
        const nameEl  = card.querySelector('.product-name');
        const tagEl   = card.querySelector('.product-tag');
        const imgEl   = card.querySelector('.product-image-wrap img');
        const price = readCardPriceNgn(priceEl);
        const name  = nameEl ? nameEl.textContent.trim() : 'Product';
        const tag   = tagEl ? tagEl.textContent.trim() : '';
        addToCart({
            id: cardProductId(card) || slugify(name + ' ' + tag),
            name,
            tag,
            price,
            image: imgEl ? imgEl.getAttribute('src') : '',
        });
    } catch (err) {
        console.error('add-to-cart failed:', err);
    }

    btn.style.transform = 'scale(1.25) rotate(180deg)';
    setTimeout(() => { btn.style.transform = ''; }, 350);
}, true); // capture phase — runs before any other click handler

// ===== CATEGORY SHOWCASE — 3D mouse tilt =====
document.querySelectorAll('.showcase-card[data-tilt]').forEach((card) => {
    const content = card.querySelector('.showcase-content');
    let raf = null;

    card.addEventListener('mouseenter', () => card.classList.add('is-tilting'));

    card.addEventListener('mousemove', (e) => {
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
            card.style.transform =
                `translateY(-12px) scale(1.01) rotateX(${-y * 6}deg) rotateY(${x * 8}deg)`;
            if (content) {
                content.style.transform = `translateY(-6px) translateZ(30px) rotateX(${-y * 3}deg) rotateY(${x * 4}deg)`;
            }
        });
    });

    card.addEventListener('mouseleave', () => {
        card.classList.remove('is-tilting');
        card.style.transform = '';
        if (content) content.style.transform = '';
    });
});

// ===== STATEMENT GRID — promo code copy =====
const promoCard = document.querySelector('.bento-promo');
if (promoCard) {
    const ctaText = promoCard.querySelector('.bento-cta-text');
    const code = promoCard.dataset.code || 'STREETS25';
    promoCard.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(code);
        } catch (_) {
            const ta = document.createElement('textarea');
            ta.value = code;
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch (_) {}
            document.body.removeChild(ta);
        }
        if (ctaText) {
            const original = ctaText.textContent;
            ctaText.textContent = 'Copied!';
            promoCard.classList.add('copied');
            setTimeout(() => {
                ctaText.textContent = original;
                promoCard.classList.remove('copied');
            }, 1800);
        }
    });
}

// ============================================= //
// === CLICK PRODUCT IMAGE → ADD TO CART ======== //
// ============================================= //
// Implementation note: cards have 3D transforms (translateZ + rotateY on hover
// inside a perspective container). Browser hit-testing on 3D-transformed
// elements is inconsistent — clicks on the visually-correct card can resolve
// to the wrong DOM target. To work around that we look up the element at the
// SCREEN POSITION via document.elementFromPoint() on pointerup, which always
// matches what the user actually sees. mouse / touch / pen all flow through
// the same path, with mouse/touch fallbacks for older browsers.
(function () {
    function fsAddFromCard(card) {
        if (!card || typeof addToCart !== 'function') return;
        const nameEl  = card.querySelector('.product-name');
        const tagEl   = card.querySelector('.product-tag');
        const priceEl = card.querySelector('.product-price');
        const imgEl   = card.querySelector('.product-image-wrap img');
        const link    = card.querySelector('a.product-image-wrap');
        const name  = nameEl  ? nameEl.textContent.trim()  : 'Product';
        const tag   = tagEl   ? tagEl.textContent.trim()   : '';
        const price = readCardPriceNgn(priceEl);
        const image = imgEl   ? imgEl.getAttribute('src')  : '';
        const id    = cardProductId(card) || (typeof slugify === 'function'
            ? slugify(name + ' ' + tag)
            : name.toLowerCase().replace(/\s+/g, '-'));
        addToCart({ id, name, tag, price, image });
        if (link) {
            link.style.transform = 'scale(0.97)';
            setTimeout(() => { link.style.transform = ''; }, 200);
        } else {
            card.style.transform = 'scale(0.99)';
            setTimeout(() => { card.style.transform = ''; }, 200);
        }
    }

    let downX = 0, downY = 0, downAt = 0, hasDown = false;

    function shouldIgnore(target) {
        if (!target || !target.closest) return true;
        if (target.closest('.product-add')) return true; // + button has its own handler
        if (target.closest('.carousel-btn')) return true; // carousel nav arrows
        return false;
    }

    function recordDown(target, x, y) {
        if (shouldIgnore(target)) { hasDown = false; return; }
        // Only arm if we're actually starting on a product card or its descendants
        const cardAtStart = target.closest && target.closest('.product-card');
        if (!cardAtStart) { hasDown = false; return; }
        downX = x; downY = y; downAt = Date.now(); hasDown = true;
    }

    function tryFire(x, y) {
        if (!hasDown) return false;
        hasDown = false;
        if (Math.abs(x - downX) > 10 || Math.abs(y - downY) > 10) return false; // it was a drag
        if (Date.now() - downAt > 1500) return false; // long press

        // CRITICAL: ask the browser what's actually visible at this screen
        // position — not the event target — to bypass 3D-transform hit-test
        // weirdness.
        const elAtPoint = document.elementFromPoint(x, y);
        if (!elAtPoint || shouldIgnore(elAtPoint)) return false;
        const card = elAtPoint.closest && elAtPoint.closest('.product-card');
        if (!card) return false;
        fsAddFromCard(card);
        return true;
    }

    // ===== Pointer events (modern, unifies mouse + touch + pen) =====
    document.addEventListener('pointerdown', (e) => {
        recordDown(e.target, e.clientX, e.clientY);
    }, true);
    document.addEventListener('pointerup', (e) => {
        if (tryFire(e.clientX, e.clientY)) {
            e.preventDefault();
            e.stopPropagation();
        }
    }, true);
    document.addEventListener('pointercancel', () => { hasDown = false; }, true);

    // ===== Mouse fallback (older browsers without PointerEvent) =====
    if (!window.PointerEvent) {
        document.addEventListener('mousedown', (e) => {
            recordDown(e.target, e.clientX, e.clientY);
        }, true);
        document.addEventListener('mouseup', (e) => {
            if (tryFire(e.clientX, e.clientY)) {
                e.preventDefault();
            }
        }, true);
    }

    // ===== Block native anchor navigation =====
    // Even if pointer-event tracking misses, the anchor's click should not
    // navigate to product.html — we handle the action ourselves.
    document.addEventListener('click', (e) => {
        const link = e.target.closest && e.target.closest('a.product-image-wrap');
        if (!link) return;
        e.preventDefault();
        e.stopPropagation();
        // If we missed the pointer pair (rare), fire now using elementFromPoint.
        const elAtPoint = document.elementFromPoint(e.clientX, e.clientY);
        const card = elAtPoint && elAtPoint.closest && elAtPoint.closest('.product-card');
        if (card && !shouldIgnore(elAtPoint)) {
            fsAddFromCard(card);
        }
    }, true);
})();

