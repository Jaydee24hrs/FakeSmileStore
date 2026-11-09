/* ============================================= */
/* === HOME SCRIPT (index.html) ================ */
/* ============================================= */

// ===== HANGING RACK — home-page product rails =====
// Each of the 4 category sections (#products, #tops, #bottoms, #headwear)
// has an empty <div class="hanger-rail-track" id="rail-..."></div> left by
// index.html for this to fill, picked by the SAME categoryHash products.js
// already assigns every product for exactly this purpose (see "CANONICAL
// CATEGORY + HOME-SECTION ANCHOR" in products.js). Pure mockups only —
// no box, no carousel chrome, no price/badge/add-to-cart, no sold-out /
// coming-soon treatment: just the garment hanging, with the existing
// front/back hover-flip (styles/tops-fb.css, the "180 degree" view) where
// a back image exists. Cards keep the "product-card" class purely so that
// existing `.product-card:hover` rules (image lift, the F/B flip) keep
// working with zero new CSS — syncHomeCardsToCatalog() below is guarded
// to skip the "hanger-card" ones specifically so it can never re-inject a
// badge into them.
const HOME_RAILS = [
    { trackId: 'rail-products', hash: 'products', limit: 12 },
    { trackId: 'rail-tops', hash: 'tops', limit: 12 },
    { trackId: 'rail-bottoms', hash: 'bottoms', limit: 12 },
    { trackId: 'rail-headwear', hash: 'headwear', limit: 12 },
];

// A slim wire-hanger silhouette (hook loop + an open triangular frame),
// stroked rather than filled — a boutique/studio look instead of a bold
// graphic icon.
const HANGER_SVG =
    '<svg class="hanger-hook" viewBox="0 0 60 44" aria-hidden="true">' +
        '<path d="M30 2c-4 0-7.2 2.8-7.2 6.3 0 2.2 1.3 4 3.4 4.9l1.8.8c1.5.6 2.5 1.9 2.5 3.4v2.6M30 19.6 4 37h52L30 19.6Z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>' +
    '</svg>';

function hangerCardHTML(p) {
    const hasBack = !!p.backImage;
    const wrapClass = hasBack ? 'product-image-wrap product-image-fb' : 'product-image-wrap';
    const altFront = p.name + ' ' + p.tag + ', front view, FakeSmile streetwear';
    const altBack = p.name + ' ' + p.tag + ', back view, FakeSmile streetwear';
    const imgs = hasBack
        ? '<img loading="lazy" decoding="async" class="fb-front" src="' + p.image + '" alt="' + altFront + '">' +
          '<img loading="lazy" decoding="async" class="fb-back" src="' + p.backImage + '" alt="' + altBack + '">'
        : '<img loading="lazy" decoding="async" src="' + p.image + '" alt="' + altFront + '">';
    const ariaName = p.name + ' ' + p.tag;

    // Keeps the "product-card" class (not just "hanger-card") purely so the
    // existing hover rules — image lift, and the front/back flip in
    // tops-fb.css ("180 degree" view) — which are written against
    // `.product-card:hover ...`, keep working with zero new CSS. The guard
    // in syncHomeCardsToCatalog() below stops that legacy sync logic from
    // touching these (it would otherwise re-inject a Sold Out/Coming Soon
    // badge, which this pure-mockup rail deliberately has none of).
    return '<article class="product-card hanger-card">' +
        HANGER_SVG +
        '<a class="' + wrapClass + '" href="' + productUrl(p.id) + '" aria-label="View ' + ariaName + '">' +
            imgs +
        '</a>' +
    '</article>';
}

function renderHomeRails() {
    if (typeof PRODUCTS === 'undefined') return;
    const all = Object.values(PRODUCTS);
    HOME_RAILS.forEach((cfg) => {
        const track = document.getElementById(cfg.trackId);
        if (!track) return;
        const items = all.filter((p) => p.categoryHash === cfg.hash).slice(0, cfg.limit);
        track.innerHTML = items.map(hangerCardHTML).join('');
    });
}
renderHomeRails();

// ===== SYNC HOME CARDS TO THE CATALOG =====
// renderHomeRails() above already builds cards straight from PRODUCTS, so
// this is mostly a no-op safety net now (kept in case any card is ever
// hand-authored again). Pull the product id out of each card's link and
// reconcile it with products.js so prices (incl. the per-item markup) and
// Coming-Soon state match the shop instead of drifting.
function cardProductId(card) {
    // Cards link to the static product page: products/<id>.html
    // (legacy product.html?id=<id> links are still understood).
    const link = card && card.querySelector('a[href*="products/"], a[href*="product.html?id="]');
    if (!link) return null;
    const href = link.getAttribute('href') || '';
    const m = href.match(/products\/([a-z0-9-]+)\.html/i) || href.match(/[?&]id=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : null;
}
function syncHomeCardsToCatalog() {
    if (typeof PRODUCTS === 'undefined') return;
    document.querySelectorAll('.product-card').forEach((card) => {
        // Pure-mockup hanging rack cards: no price/badge/add-button to sync,
        // and this must never re-inject a badge into them.
        if (card.classList.contains('hanger-card')) return;
        const id = cardProductId(card);
        const p = id && PRODUCTS[id];
        if (!p) return;
        const priceEl = card.querySelector('.product-price');
        const addBtn = card.querySelector('.product-add');
        const glass = card.querySelector('.product-glass') || card;
        const soldOut = !p.comingSoon && !!p.soldOut;
        if (p.comingSoon) {
            card.classList.add('coming-soon');
            card.classList.remove('sold-out');
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
                if (badgeEl) { badgeEl.textContent = 'Limited'; badgeEl.classList.remove('product-badge-soon', 'product-badge-sold'); }
            } else {
                if (!badgeEl) {
                    badgeEl = document.createElement('span');
                    badgeEl.className = 'product-badge';
                    glass.insertBefore(badgeEl, glass.firstChild);
                }
                badgeEl.textContent = 'Coming Soon';
                badgeEl.classList.add('product-badge-soon');
                badgeEl.classList.remove('product-badge-sold');
            }
        } else if (soldOut) {
            card.classList.add('sold-out');
            card.classList.remove('coming-soon');
            // Sold-out items still show their real price — only remove the
            // ability to add them, and mark the badge, same as the shop card.
            if (priceEl && typeof formatMarked === 'function') {
                priceEl.setAttribute('data-price-ngn', p.price);
                priceEl.innerHTML = formatMarked(p.price, 1);
            }
            if (addBtn) { addBtn.disabled = true; addBtn.setAttribute('aria-disabled', 'true'); }
            let badgeEl = card.querySelector('.product-badge');
            if (!badgeEl) {
                badgeEl = document.createElement('span');
                badgeEl.className = 'product-badge';
                glass.insertBefore(badgeEl, glass.firstChild);
            }
            badgeEl.textContent = 'Sold Out';
            badgeEl.classList.add('product-badge-sold');
            badgeEl.classList.remove('product-badge-soon');
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
// === CLICK PRODUCT IMAGE → OPEN PREVIEW ======= //
// ============================================= //
// Clicking a product image navigates to its preview (product.html) via the
// card's native <a class="product-image-wrap" href="..."> link. Only the
// "+" button adds to cart (handled by the .product-add listener above).
// (Previously the image click was hijacked to add-to-cart; that is removed so
//  the image opens the product detail page as users expect.)

