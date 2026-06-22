/* ============================================= */
/* === SHOP PAGE SCRIPT (shop.html) ============ */
/* ============================================= */

(function () {
    const grid = document.getElementById('shop-grid');
    const emptyEl = document.getElementById('shop-empty');
    const emptyResetBtn = document.getElementById('shop-empty-reset');
    const filterButtons = document.querySelectorAll('.shop-filter');
    const resultCount = document.getElementById('shop-result-count');
    const sortSelect = document.getElementById('shop-sort');
    const bannerTpl = document.getElementById('shop-fit-banner-tpl');

    if (!grid || typeof PRODUCTS === 'undefined') return;

    const allProducts = Object.values(PRODUCTS);

    // Preserve a stable "featured" order: original tops first, then statement,
    // then bottoms, then headwear (i.e. the insertion order in products.js).
    allProducts.forEach((p, i) => { p._featuredIndex = i; });

    let currentFilter = 'all';
    let currentSort = 'featured';

    function safeAttr(s) {
        return String(s || '').replace(/"/g, '&quot;');
    }

    function buildCardHTML(p) {
        const hasBack = !!p.backImage;
        const wrapClass = hasBack
            ? 'product-image-wrap product-image-fb'
            : 'product-image-wrap';

        const imgs = hasBack
            ? '<img loading="lazy" decoding="async" class="fb-front" src="' + safeAttr(p.image) + '" alt="' + safeAttr(p.name + ' ' + p.tag) + '">' +
              '<img loading="lazy" decoding="async" class="fb-back" src="' + safeAttr(p.backImage) + '" alt="' + safeAttr(p.name + ' ' + p.tag + ' back') + '">' +
              '<span class="fb-hint">F &middot; B</span>'
            : '<img loading="lazy" decoding="async" src="' + safeAttr(p.image) + '" alt="' + safeAttr(p.name + ' ' + p.tag) + '">';

        const cs = !!p.comingSoon;

        // One badge only (never stacked). For inactive products: keep a "Limited"
        // badge as-is; everything else (Bestseller / New / none) shows "Coming Soon".
        let badge;
        if (cs && p.badge === 'Limited') {
            badge = '<span class="product-badge">Limited</span>';
        } else if (cs) {
            badge = '<span class="product-badge product-badge-soon">Coming Soon</span>';
        } else {
            badge = p.badge ? '<span class="product-badge">' + p.badge + '</span>' : '';
        }

        const ariaName = safeAttr(p.name + ' ' + p.tag);

        const addSvg = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';

        const priceHTML = cs
            ? '<span class="product-price product-price-soon">Coming Soon</span>'
            : '<span class="product-price" data-price-ngn="' + p.price + '">' + formatMarked(p.price, 1) + '</span>';

        const addBtn = cs
            ? '<button class="product-add" disabled aria-disabled="true" aria-label="' + ariaName + ' coming soon">' + addSvg + '</button>'
            : '<button class="product-add" aria-label="Add ' + ariaName + ' to cart">' + addSvg + '</button>';

        return '<article class="product-card shop-card' + (cs ? ' coming-soon' : '') + '" data-category="' + safeAttr(p.category) + '">' +
                 '<div class="product-glass">' +
                   badge +
                   '<a class="' + wrapClass + '" href="product.html?id=' + encodeURIComponent(p.id) + '" aria-label="View ' + ariaName + '">' +
                     '<div class="product-glow"></div>' +
                     imgs +
                   '</a>' +
                   '<div class="product-info">' +
                     '<span class="product-tag">' + p.tag + '</span>' +
                     '<h3 class="product-name">' + p.name + '</h3>' +
                     '<div class="product-meta">' +
                       priceHTML +
                       addBtn +
                     '</div>' +
                   '</div>' +
                 '</div>' +
               '</article>';
    }

    function applyFilter(list) {
        if (currentFilter === 'all') return list.slice();
        return list.filter((p) => p.category === currentFilter);
    }

    function applySort(list) {
        const arr = list.slice();
        switch (currentSort) {
            case 'price-asc':
                arr.sort((a, b) => a.price - b.price);
                break;
            case 'price-desc':
                arr.sort((a, b) => b.price - a.price);
                break;
            case 'name-asc':
                arr.sort((a, b) => a.name.localeCompare(b.name));
                break;
            case 'featured':
            default:
                arr.sort((a, b) => a._featuredIndex - b._featuredIndex);
        }
        return arr;
    }

    // Drop the "Request a Custom Fit" banner into the middle of the grid as a
    // full-width row. Snap it to a row boundary (based on the live column count)
    // so it never leaves a gap in a partial row.
    function injectFitBanner(count) {
        if (!bannerTpl || count < 6) return;
        let cols = 1;
        const tracks = getComputedStyle(grid).gridTemplateColumns;
        if (tracks && tracks !== 'none') cols = tracks.split(' ').filter(Boolean).length;
        let mid = Math.round(count / 2 / cols) * cols;   // nearest row start
        if (mid < cols) mid = cols;
        if (mid >= count) mid = count - (count % cols || cols);
        const node = bannerTpl.content.firstElementChild.cloneNode(true);
        const ref = grid.children[mid];
        if (ref) grid.insertBefore(node, ref); else grid.appendChild(node);
    }

    function render() {
        const filtered = applyFilter(allProducts);
        const sorted = applySort(filtered);
        grid.innerHTML = sorted.map(buildCardHTML).join('');
        injectFitBanner(sorted.length);
        if (resultCount) resultCount.textContent = sorted.length;

        if (sorted.length === 0) {
            grid.hidden = true;
            if (emptyEl) emptyEl.hidden = false;
        } else {
            grid.hidden = false;
            if (emptyEl) emptyEl.hidden = true;
        }
    }

    function updateCounts() {
        const counts = { all: allProducts.length };
        allProducts.forEach((p) => {
            counts[p.category] = (counts[p.category] || 0) + 1;
        });
        document.querySelectorAll('.shop-filter-count').forEach((el) => {
            const key = el.getAttribute('data-count-for');
            el.textContent = counts[key] || 0;
        });
    }

    // ===== Filter clicks =====
    filterButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
            currentFilter = btn.dataset.filter;
            filterButtons.forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            render();
            // Smooth-scroll up so the user sees the new grid from the top
            const top = grid.getBoundingClientRect().top + window.scrollY - 110;
            window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
        });
    });

    // ===== Sort change =====
    if (sortSelect) {
        sortSelect.addEventListener('change', () => {
            currentSort = sortSelect.value;
            render();
        });
    }

    // ===== "Show All Products" from empty state =====
    if (emptyResetBtn) {
        emptyResetBtn.addEventListener('click', () => {
            currentFilter = 'all';
            filterButtons.forEach((b) => b.classList.toggle('active', b.dataset.filter === 'all'));
            render();
        });
    }

    // ===== Read ?cat=X from URL so we can deep-link a filter =====
    const params = new URLSearchParams(window.location.search);
    const requestedCat = params.get('cat');
    if (requestedCat) {
        const match = Array.from(filterButtons).find((b) => b.dataset.filter === requestedCat);
        if (match) {
            currentFilter = requestedCat;
            filterButtons.forEach((b) => b.classList.remove('active'));
            match.classList.add('active');
        }
    }

    // ===== Click on a product card → navigate to product.html =====
    // Native anchor handles navigation. The only special-case is the "+"
    // button, which adds to cart in place and stops propagation so the
    // surrounding anchor doesn't also fire.
    function fsAddFromCard(card) {
        if (!card || typeof addToCart !== 'function') return;
        const nameEl  = card.querySelector('.product-name');
        const tagEl   = card.querySelector('.product-tag');
        const priceEl = card.querySelector('.product-price');
        const imgEl   = card.querySelector('.product-image-wrap img');
        const name  = nameEl  ? nameEl.textContent.trim()  : 'Product';
        const tag   = tagEl   ? tagEl.textContent.trim()   : '';
        const price = readCardPriceNgn(priceEl);
        const image = imgEl   ? imgEl.getAttribute('src')  : '';
        const id    = typeof slugify === 'function'
            ? slugify(name + ' ' + tag)
            : name.toLowerCase().replace(/\s+/g, '-');
        addToCart({ id, name, tag, price, image });
    }

    // Per-card add button (the + circle) — explicit handler, blocks anchor nav
    document.addEventListener('click', (e) => {
        const btn = e.target.closest && e.target.closest('.product-add');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        const card = btn.closest('.product-card');
        if (card) fsAddFromCard(card);
        btn.style.transform = 'scale(1.25) rotate(180deg)';
        setTimeout(() => { btn.style.transform = ''; }, 350);
    }, true);

    // Re-render when currency changes so price labels swap NGN↔GBP
    document.addEventListener('currency:update', render);

    // First render
    updateCounts();
    render();
})();
