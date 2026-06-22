/* ============================================= */
/* === PRODUCT DETAIL SCRIPT (product.html) ==== */
/* ============================================= */

(function () {
    const detailEl = document.getElementById('product-detail');
    const notFoundEl = document.getElementById('pd-not-found');
    const layoutEl = detailEl ? detailEl.querySelector('.pd-layout') : null;
    const tabsEl = detailEl ? detailEl.querySelector('.pd-tabs') : null;
    const relatedEl = detailEl ? detailEl.querySelector('.pd-related') : null;

    // ===== Resolve product from URL =====
    const params = new URLSearchParams(window.location.search);
    const id = (params.get('id') || '').trim();
    const product = typeof getProduct === 'function' ? getProduct(id) : null;

    if (!product) {
        if (layoutEl) layoutEl.hidden = true;
        if (tabsEl) tabsEl.hidden = true;
        if (relatedEl) relatedEl.hidden = true;
        if (notFoundEl) notFoundEl.hidden = false;
        return;
    }

    // ===== Populate hero strip =====
    document.title = `${product.name} ${product.tag} — FakeSmile`;
    const wordmark = document.getElementById('product-wordmark');
    if (wordmark) {
        const w = (product.name || 'DROP').toUpperCase();
        wordmark.textContent = w;
        wordmark.dataset.text = w;
    }
    const crumbCat = document.getElementById('crumb-cat');
    const crumbName = document.getElementById('crumb-name');
    if (crumbCat) {
        crumbCat.textContent = product.category;
        crumbCat.href = 'index.html#' + (product.categoryHash || 'products');
    }
    if (crumbName) crumbName.textContent = `${product.name} ${product.tag}`;
    const heroAccent = document.getElementById('hero-title-accent');
    if (heroAccent) heroAccent.textContent = product.tag;
    const heroSub = document.getElementById('hero-sub');
    if (heroSub) heroSub.textContent = `${product.category} · Crafted in Lagos · Free worldwide shipping.`;

    // ===== Populate info panel =====
    const badgeEl = document.getElementById('pd-badge');
    if (badgeEl) {
        // One badge: inactive products keep a "Limited" badge but show "Coming
        // Soon" for Bestseller/New/none.
        let badgeText = product.badge;
        if (product.comingSoon) badgeText = (product.badge === 'Limited') ? 'Limited' : 'Coming Soon';
        badgeEl.classList.toggle('product-badge-soon', badgeText === 'Coming Soon');
        if (badgeText) {
            badgeEl.textContent = badgeText;
            badgeEl.hidden = false;
        } else {
            badgeEl.hidden = true;
        }
    }

    const imgEl = document.getElementById('pd-image');
    if (imgEl) {
        imgEl.src = product.image;
        imgEl.alt = `${product.name} ${product.tag}`;
    }
    // Match the shop card: dim the gallery for coming-soon products so the
    // inactive state reads the same on the listing and the preview page.
    const galleryEl = document.getElementById('product-detail');
    if (galleryEl) galleryEl.classList.toggle('coming-soon', !!product.comingSoon);

    const categoryEl = document.getElementById('pd-category');
    if (categoryEl) categoryEl.textContent = product.category;
    const nameEl = document.getElementById('pd-name');
    if (nameEl) nameEl.textContent = product.name;
    const nameTagEl = document.getElementById('pd-name-tag');
    if (nameTagEl) nameTagEl.textContent = product.tag;
    const priceEl = document.getElementById('pd-price');
    if (priceEl) {
        if (product.comingSoon) {
            priceEl.removeAttribute('data-price-ngn');
            priceEl.innerHTML = 'Coming Soon';
            priceEl.classList.add('product-price-soon');
        } else {
            priceEl.setAttribute('data-price-ngn', product.price);
            priceEl.innerHTML = formatMarked(product.price, 1);
        }
    }
    const descEl = document.getElementById('pd-desc');
    if (descEl) descEl.textContent = product.description || '';
    const descLongEl = document.getElementById('pd-desc-long');
    if (descLongEl) descLongEl.textContent = product.description || '';

    const skuEl = document.getElementById('pd-sku');
    if (skuEl) skuEl.textContent = 'FS-' + product.id.toUpperCase();
    const metaCatEl = document.getElementById('pd-meta-cat');
    if (metaCatEl) metaCatEl.textContent = product.category;
    const metaTagEl = document.getElementById('pd-meta-tag');
    if (metaTagEl) metaTagEl.textContent = product.tag;

    // ===== Size chips =====
    const sizeChipsEl = document.getElementById('pd-size-chips');
    const sizeRowEl = document.getElementById('pd-sizes-row');
    let selectedSize = '';
    if (sizeChipsEl) {
        const sizesString = (product.details && product.details.Sizes) ? product.details.Sizes : '';
        const sizes = sizesString.split('/').map((s) => s.trim()).filter(Boolean);
        sizeChipsEl.innerHTML = '';
        if (sizes.length <= 1 && /OS|One/i.test(sizesString)) {
            // Single one-size: show a static chip
            const chip = document.createElement('span');
            chip.className = 'pd-size-chip is-static';
            chip.textContent = sizesString || 'One Size';
            sizeChipsEl.appendChild(chip);
            selectedSize = sizesString || 'One Size';
        } else if (sizes.length) {
            sizes.forEach((s, i) => {
                const chip = document.createElement('button');
                chip.type = 'button';
                chip.className = 'pd-size-chip';
                chip.textContent = s;
                chip.dataset.size = s;
                if (i === 1 || (i === 0 && sizes.length === 1)) {
                    chip.classList.add('selected');
                    selectedSize = s;
                }
                chip.addEventListener('click', () => {
                    sizeChipsEl.querySelectorAll('.pd-size-chip').forEach((c) => c.classList.remove('selected'));
                    chip.classList.add('selected');
                    selectedSize = s;
                });
                sizeChipsEl.appendChild(chip);
            });
            if (!selectedSize) selectedSize = sizes[0];
        } else if (sizeRowEl) {
            sizeRowEl.style.display = 'none';
        }
    }

    // ===== Thumbs — this product's images + partner's image =====
    // Strip is: front, back (if any), completewear (full-set, if any),
    // and the matching partner item (e.g. hoodie shows its joggers, jersey
    // shows its shorts). The user sells tops + bottoms as sets, so the
    // partner thumbnail makes that pairing visible on every product page.
    const thumbsEl = document.getElementById('pd-thumbs');
    const imageFrame = document.getElementById('pd-image-frame');
    if (thumbsEl) {
        thumbsEl.innerHTML = '';
        const sources = [];
        sources.push(product.image);
        if (product.backImage) sources.push(product.backImage);
        if (product.completewear) sources.push(product.completewear);

        // Add the matching partner item's front image (the joggers for a
        // hoodie, the shorts for a jersey, etc.)
        if (product.partner && typeof getProduct === 'function') {
            const partner = getProduct(product.partner);
            if (partner && partner.image) {
                sources.push(partner.image);
            }
        }

        const activeIndex = 0;

        sources.forEach((src, i) => {
            const t = document.createElement('button');
            t.type = 'button';
            t.className = 'pd-thumb' + (i === activeIndex ? ' active' : '');
            t.setAttribute('aria-label', `View image ${i + 1}`);
            const im = document.createElement('img');
            im.src = src;
            im.alt = '';
            t.appendChild(im);
            t.addEventListener('click', () => {
                thumbsEl.querySelectorAll('.pd-thumb').forEach((x) => x.classList.remove('active'));
                t.classList.add('active');
                if (imgEl) {
                    imgEl.style.opacity = '0';
                    setTimeout(() => {
                        imgEl.src = src;
                        imgEl.style.opacity = '';
                    }, 180);
                }
            });
            thumbsEl.appendChild(t);
        });

        // If the product has only a single image, hide the strip entirely so
        // there's no awkward single-thumb row.
        if (sources.length < 2) thumbsEl.style.display = 'none';
    }

    // ===== Hover-zoom on hero image =====
    if (imageFrame && imgEl) {
        imageFrame.addEventListener('mousemove', (e) => {
            const r = imageFrame.getBoundingClientRect();
            const x = ((e.clientX - r.left) / r.width) * 100;
            const y = ((e.clientY - r.top) / r.height) * 100;
            imgEl.style.transformOrigin = `${x}% ${y}%`;
            imgEl.style.transform = 'scale(1.18)';
        });
        imageFrame.addEventListener('mouseleave', () => {
            imgEl.style.transform = '';
        });
    }

    // ===== Quantity stepper =====
    const qtyValueEl = document.getElementById('pd-qty-value');
    const qtyMinusEl = document.getElementById('pd-qty-minus');
    const qtyPlusEl = document.getElementById('pd-qty-plus');
    let qty = 1;
    function setQty(n) {
        qty = Math.max(1, Math.min(99, n));
        if (qtyValueEl) qtyValueEl.textContent = qty;
    }
    if (qtyMinusEl) qtyMinusEl.addEventListener('click', () => setQty(qty - 1));
    if (qtyPlusEl) qtyPlusEl.addEventListener('click', () => setQty(qty + 1));

    // ===== Add to Cart =====
    const addBtn = document.getElementById('pd-add-btn');
    if (addBtn && product.comingSoon) {
        addBtn.disabled = true;
        addBtn.setAttribute('aria-disabled', 'true');
        addBtn.classList.add('is-disabled');
        const span = addBtn.querySelector('span');
        if (span) span.textContent = 'Coming Soon';
    } else if (addBtn && typeof addToCart === 'function') {
        addBtn.addEventListener('click', () => {
            addToCart({
                id: product.id,
                name: product.name,
                tag: product.tag,
                size: selectedSize || '',
                price: product.price,
                image: product.image,
                qty: qty,
            });
            const span = addBtn.querySelector('span');
            const original = span ? span.textContent : 'Add To Cart';
            if (span) span.textContent = 'Added!';
            addBtn.classList.add('added');
            setTimeout(() => {
                if (span) span.textContent = original;
                addBtn.classList.remove('added');
            }, 1400);
        });
    }

    // ===== Wishlist (visual only) =====
    const wishBtn = document.getElementById('pd-wish');
    if (wishBtn) {
        wishBtn.addEventListener('click', () => {
            wishBtn.classList.toggle('active');
        });
    }

    // ===== Tabs =====
    const tabBtns = document.querySelectorAll('.pd-tab');
    const tabPanels = document.querySelectorAll('.pd-tab-panel');
    tabBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.tab;
            tabBtns.forEach((b) => {
                b.classList.toggle('active', b === btn);
                b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
            });
            tabPanels.forEach((p) => {
                p.classList.toggle('active', p.dataset.panel === target);
            });
        });
    });

    // ===== Additional Info table =====
    const infoTable = document.querySelector('#pd-info-table tbody');
    if (infoTable && product.details) {
        infoTable.innerHTML = '';
        Object.keys(product.details).forEach((key) => {
            const tr = document.createElement('tr');
            const th = document.createElement('th');
            th.scope = 'row';
            th.textContent = key;
            const td = document.createElement('td');
            td.textContent = product.details[key];
            tr.appendChild(th);
            tr.appendChild(td);
            infoTable.appendChild(tr);
        });
    }

    // ===== Related products (1 of each: hoodie, tee, joggers, shorts, headwear) =====
    const grid = document.getElementById('pd-related-grid');
    if (grid && typeof getRelatedProducts === 'function') {
        const related = getRelatedProducts(product.id);
        grid.innerHTML = '';
        related.forEach((p) => {
            const a = document.createElement('a');
            a.className = 'pd-related-card';
            a.href = 'product.html?id=' + encodeURIComponent(p.id);
            a.innerHTML = `
                <div class="pd-related-img">
                    ${(p.comingSoon && p.badge !== 'Limited')
                        ? '<span class="pd-related-soon">Coming Soon</span>'
                        : (p.badge ? `<span class="pd-related-badge">${p.badge}</span>` : '')}
                    <img loading="lazy" decoding="async" src="${p.image}" alt="${p.name} ${p.tag}">
                </div>
                <div class="pd-related-info">
                    <span class="pd-related-tag">${p.tag}</span>
                    <h4 class="pd-related-name">${p.name}</h4>
                    <div class="pd-related-meta">
                        ${p.comingSoon ? '<span class="pd-related-price product-price-soon">Coming Soon</span>' : `<span class="pd-related-price" data-price-ngn="${p.price}">${formatMarked(p.price, 1)}</span>`}
                        <button type="button" class="pd-related-add" aria-label="Add ${p.name} to cart" data-id="${p.id}">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                        </button>
                    </div>
                </div>
            `;
            grid.appendChild(a);
        });

        // delegated add-to-cart on related cards
        grid.addEventListener('click', (e) => {
            const btn = e.target.closest('.pd-related-add');
            if (!btn) return;
            e.preventDefault();
            e.stopPropagation();
            const pid = btn.dataset.id;
            const p = typeof getProduct === 'function' ? getProduct(pid) : null;
            if (!p || typeof addToCart !== 'function') return;
            addToCart({
                id: p.id,
                name: p.name,
                tag: p.tag,
                price: p.price,
                image: p.image,
            });
            btn.style.transform = 'scale(1.25) rotate(180deg)';
            setTimeout(() => { btn.style.transform = ''; }, 350);
        });
    }
})();
