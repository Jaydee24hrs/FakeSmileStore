#!/usr/bin/env node
/* =====================================================================
   tools/build-products.js — pre-render for search engines.

   The site is still a plain static site with no framework, but product
   detail used to exist ONLY as product.html?id=<slug> rendered by JS.
   Crawlers and AI summarisers treat 41 near-identical query-string URLs
   whose content appears only after script execution as low-quality
   "randomised inventory". This script bakes real HTML:

     1. products/<id>.html  — one full page per product (title, meta,
        canonical, Product + BreadcrumbList JSON-LD, images with alt text,
        price, sizes, details, related items). product.js then hydrates the
        same DOM for interactivity, so nothing else changes.
     2. shop.html           — the product grid pre-rendered between the
        BUILD:SHOP-GRID markers (shop.js re-renders it for filters/sort).
     3. sitemap.xml         — static pages + every product URL.

   Run it after ANY change to scripts/products.js or product.html:

       node tools/build-products.js

   Requires Node ≥ 14. No dependencies.
   ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://fakesmilestore.com';
const MARKUP_NGN = 5000;                 // keep in sync with base.js
const TODAY = new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------
// 1. Load the catalog by executing products.js in a sandbox
// ---------------------------------------------------------------------
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'scripts', 'products.js'), 'utf8') +
    '\n;this.__PRODUCTS = PRODUCTS;',
    sandbox
);
const PRODUCTS = sandbox.__PRODUCTS;
const LIST = Object.values(PRODUCTS);
if (LIST.length < 10) throw new Error('products.js loaded but only ' + LIST.length + ' products found');

// ---------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------
const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ngn = (n) => '&#8358;' + Math.round(Number(n) || 0).toLocaleString('en-US') + '.00';
const displayPrice = (p) => ngn((Number(p.price) || 0) + MARKUP_NGN);
const abs = (rel) => encodeURI(SITE + '/' + String(rel || '').replace(/^\/+/, ''));
const productHref = (id) => 'products/' + encodeURIComponent(id) + '.html';
const altFor = (p, view) => {
    const base = p.name + ' ' + p.tag;
    if (view === 'back') return base + ' — back view, FakeSmile streetwear';
    if (view === 'outfit') return base + ' worn as a full FakeSmile outfit';
    return base + ' — front view, FakeSmile streetwear';
};
const shortDesc = (p) => {
    const d = (p.description || '').replace(/\s+/g, ' ').trim();
    if (d.length <= 155) return d;
    return d.slice(0, 152).replace(/\s+\S*$/, '') + '…';
};
const ld = (obj) => '<script type="application/ld+json">' + JSON.stringify(obj) + '</script>';

/** Replace `needle` in `html` exactly once; throw if the template drifted. */
function replaceOnce(html, needle, replacement, label) {
    const i = html.indexOf(needle);
    if (i < 0) throw new Error('Template drift — could not find ' + (label || needle) + ' in product.html');
    if (html.indexOf(needle, i + needle.length) >= 0) throw new Error('Template ambiguity — ' + (label || needle) + ' appears more than once');
    return html.slice(0, i) + replacement + html.slice(i + needle.length);
}
function replaceRe(html, re, replacement, label) {
    const m = html.match(re);
    if (!m) throw new Error('Template drift — regex for ' + label + ' matched nothing');
    return html.replace(re, replacement);
}

const PLUS_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
const PLUS_SVG_16 = PLUS_SVG.replace(/width="14" height="14"/, 'width="16" height="16"');

// Deterministic "related" pick: first of each garment bucket (product.js
// re-randomises on hydrate, this just gives crawlers real internal links).
function relatedFor(id) {
    const buckets = { hoodie: [], tee: [], joggers: [], shorts: [], headwear: [] };
    LIST.forEach((p) => {
        if (p.id === id) return;
        if (p.tag === 'Hoodie') buckets.hoodie.push(p);
        else if (p.tag === 'Tee') buckets.tee.push(p);
        else if (p.tag === 'Joggers') buckets.joggers.push(p);
        else if (p.tag === 'Shorts') buckets.shorts.push(p);
        else if (p.category === 'Headwear') buckets.headwear.push(p);
    });
    return [buckets.hoodie, buckets.tee, buckets.joggers, buckets.shorts, buckets.headwear]
        .map((b) => b[0]).filter(Boolean);
}

function relatedCard(p) {
    const badge = (p.comingSoon && p.badge !== 'Limited')
        ? '<span class="pd-related-soon">Coming Soon</span>'
        : (p.badge ? '<span class="pd-related-badge">' + esc(p.badge) + '</span>' : '');
    const price = p.comingSoon
        ? '<span class="pd-related-price product-price-soon">Coming Soon</span>'
        : '<span class="pd-related-price" data-price-ngn="' + p.price + '">' + displayPrice(p) + '</span>';
    return '<a class="pd-related-card" href="' + productHref(p.id) + '">' +
        '<div class="pd-related-img">' + badge +
            '<img loading="lazy" decoding="async" src="' + esc(p.image) + '" alt="' + esc(altFor(p, 'front')) + '">' +
        '</div>' +
        '<div class="pd-related-info">' +
            '<span class="pd-related-tag">' + esc(p.tag) + '</span>' +
            '<h4 class="pd-related-name">' + esc(p.name) + '</h4>' +
            '<div class="pd-related-meta">' + price +
                '<button type="button" class="pd-related-add" aria-label="Add ' + esc(p.name) + ' to cart" data-id="' + esc(p.id) + '">' + PLUS_SVG + '</button>' +
            '</div>' +
        '</div>' +
    '</a>';
}

// ---------------------------------------------------------------------
// 2. Structured data (mirrors product.js so both routes agree)
// ---------------------------------------------------------------------
function productJsonLd(p, url) {
    const fullName = p.name + ' ' + p.tag;
    const obj = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        '@id': url + '#product',
        name: fullName,
        url: url,
        image: [p.image, p.backImage, p.completewear].filter(Boolean).map(abs),
        description: p.description || '',
        sku: 'FS-' + p.id.toUpperCase(),
        brand: { '@type': 'Brand', name: 'FakeSmile' },
        manufacturer: { '@id': SITE + '/#org' },
        category: p.category,
        material: p.details && p.details.Material,
        countryOfOrigin: { '@type': 'Country', name: 'Nigeria' },
    };
    if (!p.comingSoon) {
        obj.offers = {
            '@type': 'Offer',
            url: url,
            priceCurrency: 'NGN',
            price: String(Math.round((Number(p.price) || 0) + MARKUP_NGN)),
            availability: 'https://schema.org/InStock',
            itemCondition: 'https://schema.org/NewCondition',
            seller: { '@id': SITE + '/#org' },
            shippingDetails: {
                '@type': 'OfferShippingDetails',
                shippingRate: { '@type': 'MonetaryAmount', value: 0, currency: 'NGN' },
                shippingDestination: [
                    { '@type': 'DefinedRegion', addressCountry: 'NG' },
                    { '@type': 'DefinedRegion', addressCountry: 'GB' },
                ],
                deliveryTime: {
                    '@type': 'ShippingDeliveryTime',
                    handlingTime: { '@type': 'QuantitativeValue', minValue: 1, maxValue: 3, unitCode: 'DAY' },
                    transitTime: { '@type': 'QuantitativeValue', minValue: 1, maxValue: 14, unitCode: 'DAY' },
                },
            },
            hasMerchantReturnPolicy: { '@id': SITE + '/#returns' },
        };
    }
    const crumbs = {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' },
            { '@type': 'ListItem', position: 2, name: 'Shop', item: SITE + '/shop' },
            { '@type': 'ListItem', position: 3, name: fullName, item: url },
        ],
    };
    return ld(obj) + '\n    ' + ld(crumbs);
}

// ---------------------------------------------------------------------
// 3. Render one product page from the product.html template
// ---------------------------------------------------------------------
const TEMPLATE = fs.readFileSync(path.join(ROOT, 'product.html'), 'utf8');
const NL = TEMPLATE.includes('\r\n') ? '\r\n' : '\n';

function renderProduct(p) {
    const url = SITE + '/products/' + encodeURIComponent(p.id);
    const fullName = p.name + ' ' + p.tag;
    const title = fullName + ' — FakeSmile | Lagos Streetwear';
    const desc = shortDesc(p) + (p.comingSoon ? '' : ' Original FakeSmile design, made in Lagos, shipping included worldwide.');
    let h = TEMPLATE;

    // <html>/<body> hooks for base.js (path root) and product.js (hydration id)
    h = replaceOnce(h, '<html lang="en">', '<html lang="en" data-root="../">', '<html>');
    h = replaceOnce(h, '<body class="page-product">', '<body class="page-product" data-product-id="' + esc(p.id) + '">', '<body>');

    // Head
    h = replaceRe(h, /<title>[^<]*<\/title>/, '<title>' + esc(title) + '</title>', 'title');
    h = replaceRe(h, /(<meta name="description" content=")[^"]*(")/, '$1' + esc(desc) + '$2', 'description');
    h = replaceRe(h, /(<link rel="canonical" href=")[^"]*(")/, '$1' + url + '$2', 'canonical');
    h = replaceRe(h, /(<meta property="og:title" content=")[^"]*(")/, '$1' + esc(title) + '$2', 'og:title');
    h = replaceRe(h, /(<meta property="og:description" content=")[^"]*(")/, '$1' + esc(desc) + '$2', 'og:description');
    h = replaceRe(h, /(<meta property="og:url" content=")[^"]*(")/, '$1' + url + '$2', 'og:url');
    h = replaceRe(h, /(<meta property="og:image" content=")[^"]*(")/, '$1' + abs(p.image) + '$2', 'og:image');
    h = replaceRe(h, /<\/head>/, '    ' + productJsonLd(p, url) + NL + '</head>', '</head>');

    // Hero
    h = replaceOnce(h, 'data-text="DROP" id="product-wordmark">DROP</div>',
        'data-text="' + esc(p.name.toUpperCase()) + '" id="product-wordmark">' + esc(p.name.toUpperCase()) + '</div>', 'wordmark');
    h = replaceOnce(h, '<a href="index.html#products" id="crumb-cat">Shop</a>',
        '<a href="index.html#' + esc(p.categoryHash || 'products') + '" id="crumb-cat">' + esc(p.category) + '</a>', 'crumb-cat');
    h = replaceOnce(h, '<span id="crumb-name">Product</span>', '<span id="crumb-name">' + esc(fullName) + '</span>', 'crumb-name');
    h = replaceOnce(h, '<span class="accent-italic" id="hero-title-accent">Drop</span>',
        '<span class="accent-italic" id="hero-title-accent">' + esc(p.tag) + '</span>', 'hero-title-accent');
    h = replaceOnce(h, '<p class="page-hero-sub" id="hero-sub">Detail on detail. Built on the bricks.</p>',
        '<p class="page-hero-sub" id="hero-sub">' + esc(p.category) + ' · Crafted in Lagos · Free worldwide shipping.</p>', 'hero-sub');

    // Detail section state + badge
    if (p.comingSoon) {
        h = replaceOnce(h, '<section class="product-detail" id="product-detail">',
            '<section class="product-detail coming-soon" id="product-detail">', 'product-detail');
    }
    let badgeText = p.badge || '';
    if (p.comingSoon) badgeText = (p.badge === 'Limited') ? 'Limited' : 'Coming Soon';
    h = replaceOnce(h, '<span class="pd-badge" id="pd-badge" hidden></span>',
        badgeText
            ? '<span class="pd-badge' + (badgeText === 'Coming Soon' ? ' product-badge-soon' : '') + '" id="pd-badge">' + esc(badgeText) + '</span>'
            : '<span class="pd-badge" id="pd-badge" hidden></span>', 'pd-badge');

    // Gallery
    h = replaceOnce(h, '<img loading="eager" fetchpriority="high" decoding="async" id="pd-image" src="" alt="">',
        '<img loading="eager" fetchpriority="high" decoding="async" id="pd-image" src="' + esc(p.image) + '" alt="' + esc(altFor(p, 'front')) + '">', 'pd-image');
    const views = [[p.image, altFor(p, 'front')]];
    if (p.backImage) views.push([p.backImage, altFor(p, 'back')]);
    if (p.completewear) views.push([p.completewear, altFor(p, 'outfit')]);
    const partner = p.partner && PRODUCTS[p.partner];
    if (partner && partner.image) {
        views.push([partner.image, partner.name + ' ' + partner.tag + ' — the matching piece for the ' + fullName]);
    }
    const thumbs = views.length < 2 ? '' : views.map(([src, alt], i) =>
        '<button type="button" class="pd-thumb' + (i === 0 ? ' active' : '') + '" aria-label="View: ' + esc(alt) + '">' +
            '<img src="' + esc(src) + '" alt="' + esc(alt) + '">' +
        '</button>').join('');
    h = replaceOnce(h, '<div class="pd-thumbs" id="pd-thumbs" aria-label="Product views"></div>',
        '<div class="pd-thumbs" id="pd-thumbs" aria-label="Product views"' + (views.length < 2 ? ' style="display:none"' : '') + '>' + thumbs + '</div>', 'pd-thumbs');

    // Info panel
    h = replaceOnce(h, '<span id="pd-category">Drop</span>', '<span id="pd-category">' + esc(p.category) + '</span>', 'pd-category');
    h = replaceOnce(h, '<span id="pd-name">Product</span>', '<span id="pd-name">' + esc(p.name) + '</span>', 'pd-name');
    h = replaceOnce(h, '<em class="accent-italic" id="pd-name-tag"></em>', '<em class="accent-italic" id="pd-name-tag">' + esc(p.tag) + '</em>', 'pd-name-tag');
    h = replaceOnce(h, '<span class="pd-price" id="pd-price">&#8358;0.00</span>',
        p.comingSoon
            ? '<span class="pd-price product-price-soon" id="pd-price">Coming Soon</span>'
            : '<span class="pd-price" id="pd-price" data-price-ngn="' + p.price + '">' + displayPrice(p) + '</span>', 'pd-price');
    h = replaceRe(h, /<p class="pd-desc" id="pd-desc">[^<]*<\/p>/, '<p class="pd-desc" id="pd-desc">' + esc(p.description) + '</p>', 'pd-desc');

    const sizesString = (p.details && p.details.Sizes) || '';
    const sizes = sizesString.split('/').map((s) => s.trim()).filter(Boolean);
    let chips;
    if (sizes.length <= 1 && /OS|One/i.test(sizesString)) {
        chips = '<span class="pd-size-chip is-static">' + esc(sizesString || 'One Size') + '</span>';
    } else {
        chips = sizes.map((s, i) =>
            '<button type="button" class="pd-size-chip' + ((i === 1 || (i === 0 && sizes.length === 1)) ? ' selected' : '') + '" data-size="' + esc(s) + '">' + esc(s) + '</button>').join('');
    }
    h = replaceOnce(h, '<div class="pd-size-chips" id="pd-size-chips"></div>', '<div class="pd-size-chips" id="pd-size-chips">' + chips + '</div>', 'pd-size-chips');

    if (p.comingSoon) {
        h = replaceRe(h, /<button type="button" class="page-btn page-btn-primary pd-add-btn" id="pd-add-btn">(\s*)<span>Add To Cart<\/span>/,
            '<button type="button" class="page-btn page-btn-primary pd-add-btn is-disabled" id="pd-add-btn" disabled aria-disabled="true">$1<span>Coming Soon</span>', 'pd-add-btn');
    }

    h = replaceOnce(h, '<span class="pd-meta-value" id="pd-sku">FS-—-—</span>', '<span class="pd-meta-value" id="pd-sku">FS-' + esc(p.id.toUpperCase()) + '</span>', 'pd-sku');
    h = replaceOnce(h, '<span class="pd-meta-value" id="pd-meta-cat">—</span>', '<span class="pd-meta-value" id="pd-meta-cat">' + esc(p.category) + '</span>', 'pd-meta-cat');
    h = replaceOnce(h, '<span class="pd-meta-value" id="pd-meta-tag">—</span>', '<span class="pd-meta-value" id="pd-meta-tag">' + esc(p.tag) + '</span>', 'pd-meta-tag');

    // Tabs
    h = replaceRe(h, /<p id="pd-desc-long">[^<]*<\/p>/, '<p id="pd-desc-long">' + esc(p.description) + '</p>', 'pd-desc-long');
    const rows = Object.keys(p.details || {}).map((k) =>
        '<tr><th scope="row">' + esc(k) + '</th><td>' + esc(p.details[k]) + '</td></tr>').join('');
    h = replaceRe(h, /(<table class="pd-info-table" id="pd-info-table">\s*<tbody>)(<\/tbody>)/, '$1' + rows + '$2', 'pd-info-table');
    h = replaceOnce(h, 'href="mailto:fakeasmile29@gmail.com?subject=Review"',
        'href="mailto:fakeasmile29@gmail.com?subject=' + encodeURIComponent('Review: ' + fullName) + '"', 'review mailto');

    // Related
    h = replaceOnce(h, '<div class="pd-related-grid" id="pd-related-grid"></div>',
        '<div class="pd-related-grid" id="pd-related-grid">' + relatedFor(p.id).map(relatedCard).join('') + '</div>', 'pd-related-grid');

    // Finally: the page lives one folder down, so every site-relative href/src
    // gets a ../ prefix. Absolute, protocol, root, anchor, mailto, data: and
    // already-prefixed URLs are left alone.
    h = h.replace(/(\s(?:href|src)=")(?!(?:https?:|\/\/|\/|#|mailto:|tel:|data:|\.\.\/))([^"]+)"/g, '$1../$2"');
    return h;
}

// ---------------------------------------------------------------------
// 4. Shop grid (mirrors scripts/shop.js buildCardHTML, featured order)
// ---------------------------------------------------------------------
function shopCard(p) {
    const hasBack = !!p.backImage;
    const wrapClass = hasBack ? 'product-image-wrap product-image-fb' : 'product-image-wrap';
    const imgs = hasBack
        ? '<img loading="lazy" decoding="async" class="fb-front" src="' + esc(p.image) + '" alt="' + esc(altFor(p, 'front')) + '">' +
          '<img loading="lazy" decoding="async" class="fb-back" src="' + esc(p.backImage) + '" alt="' + esc(altFor(p, 'back')) + '">' +
          '<span class="fb-hint">F &middot; B</span>'
        : '<img loading="lazy" decoding="async" src="' + esc(p.image) + '" alt="' + esc(altFor(p, 'front')) + '">';
    const cs = !!p.comingSoon;
    let badge;
    if (cs && p.badge === 'Limited') badge = '<span class="product-badge">Limited</span>';
    else if (cs) badge = '<span class="product-badge product-badge-soon">Coming Soon</span>';
    else badge = p.badge ? '<span class="product-badge">' + esc(p.badge) + '</span>' : '';
    const ariaName = esc(p.name + ' ' + p.tag);
    const price = cs
        ? '<span class="product-price product-price-soon">Coming Soon</span>'
        : '<span class="product-price" data-price-ngn="' + p.price + '">' + displayPrice(p) + '</span>';
    const addBtn = cs
        ? '<button class="product-add" disabled aria-disabled="true" aria-label="' + ariaName + ' coming soon">' + PLUS_SVG_16 + '</button>'
        : '<button class="product-add" aria-label="Add ' + ariaName + ' to cart">' + PLUS_SVG_16 + '</button>';
    return '<article class="product-card shop-card' + (cs ? ' coming-soon' : '') + '" data-category="' + esc(p.category) + '">' +
        '<div class="product-glass">' + badge +
            '<a class="' + wrapClass + '" href="' + productHref(p.id) + '" aria-label="View ' + ariaName + '">' +
                '<div class="product-glow"></div>' + imgs +
            '</a>' +
            '<div class="product-info">' +
                '<span class="product-tag">' + esc(p.tag) + '</span>' +
                '<h3 class="product-name">' + esc(p.name) + '</h3>' +
                '<div class="product-meta">' + price + addBtn + '</div>' +
            '</div>' +
        '</div>' +
    '</article>';
}

function buildShop() {
    const file = path.join(ROOT, 'shop.html');
    let h = fs.readFileSync(file, 'utf8');
    const nl = h.includes('\r\n') ? '\r\n' : '\n';
    const START = '<!-- BUILD:SHOP-GRID:START (generated by tools/build-products.js — do not edit by hand) -->';
    const END = '<!-- BUILD:SHOP-GRID:END -->';
    const cards = LIST.map((p) => '                ' + shopCard(p)).join(nl);
    const block = START + nl + cards + nl + '                ' + END;
    if (h.includes(START)) {
        const a = h.indexOf(START), b = h.indexOf(END) + END.length;
        h = h.slice(0, a) + block + h.slice(b);
    } else {
        h = replaceOnce(h, '<!-- Cards populated by scripts/shop.js -->', block, 'shop grid placeholder');
    }
    // Static counts (shop.js recomputes them, this just makes the HTML honest).
    const counts = { all: LIST.length };
    LIST.forEach((p) => { counts[p.category] = (counts[p.category] || 0) + 1; });
    h = h.replace(/<strong id="shop-result-count">\d+<\/strong>/, '<strong id="shop-result-count">' + LIST.length + '</strong>');
    h = h.replace(/(data-count-for="([^"]+)">)\d+(<\/em>)/g, (m, open, key, close) => {
        const k = key.replace(/&amp;/g, '&');
        return open + (counts[k] || 0) + close;
    });
    fs.writeFileSync(file, h);
    return LIST.length;
}

// ---------------------------------------------------------------------
// 5. Sitemap
// ---------------------------------------------------------------------
function buildSitemap() {
    const staticPages = [
        ['/', '1.0', 'weekly'], ['/shop', '0.9', 'weekly'], ['/about', '0.8', 'monthly'], ['/contact', '0.7', 'monthly'],
        ['/faq', '0.7', 'monthly'], ['/shipping', '0.6', 'monthly'], ['/returns', '0.6', 'monthly'], ['/size-guide', '0.6', 'monthly'],
        ['/privacy', '0.3', 'yearly'], ['/terms', '0.3', 'yearly'], ['/cookies', '0.3', 'yearly'],
    ];
    const entry = (loc, pr, cf) =>
        '  <url>\n    <loc>' + loc + '</loc>\n    <lastmod>' + TODAY + '</lastmod>\n    <changefreq>' + cf + '</changefreq>\n    <priority>' + pr + '</priority>\n  </url>';
    const urls = staticPages.map(([p, pr, cf]) => entry(SITE + p, pr, cf))
        .concat(LIST.map((p) => entry(SITE + '/products/' + encodeURIComponent(p.id), p.comingSoon ? '0.5' : '0.7', 'weekly')));
    fs.writeFileSync(path.join(ROOT, 'sitemap.xml'),
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls.join('\n') + '\n</urlset>\n');
    return urls.length;
}

// ---------------------------------------------------------------------
// run
// ---------------------------------------------------------------------
const outDir = path.join(ROOT, 'products');
fs.mkdirSync(outDir, { recursive: true });
// Remove pages for products that no longer exist in the catalog.
const live = new Set(LIST.map((p) => p.id + '.html'));
fs.readdirSync(outDir).filter((f) => f.endsWith('.html') && !live.has(f)).forEach((f) => {
    fs.unlinkSync(path.join(outDir, f));
    console.log('removed stale products/' + f);
});
LIST.forEach((p) => fs.writeFileSync(path.join(outDir, p.id + '.html'), renderProduct(p)));
console.log('products/  : ' + LIST.length + ' pages written');
console.log('shop.html  : ' + buildShop() + ' cards pre-rendered');
console.log('sitemap.xml: ' + buildSitemap() + ' URLs');
