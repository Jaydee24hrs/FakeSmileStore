# FakeSmile — Streetwear E-commerce Site

A premium streetwear e-commerce website for the **FakeSmile** brand (UK & Nigeria).
Dark theme, liquid-glass aesthetic, brand-green accent (`#00d957` / `#00ff7a`),
brick/streetwear vibe. Tagline: _"Smile Even If It's Fake" · "Wear The Story" · "Built On The Bricks"._

> **Keep this file current.** Whenever the project changes (new product, new page,
> new script, behaviour change), update the relevant section below so the README
> always reflects the live state of the site.

---

## 1. Tech Stack

- **Pure static site** — HTML + vanilla CSS + vanilla JavaScript. No framework, no build step, no backend.
- Hosted as plain files; open `index.html` in a browser to run.
- State persists in the browser via **`localStorage`** (cart, promo, currency, orders).
- Font: Google Fonts **Poppins**.
- Live exchange-rate data fetched from a public FX API (see §7).

### Testing
Test in a **real browser** with a hard refresh (`Ctrl + F5`). The VSCode Live
Preview serves over `file://` and hits navigation/security limits — avoid it for
flow testing (shop → product → cart → checkout → orders).

---

## 2. File Structure

```
fakesmile33/
├── index.html          Home — hero, category showcase, 4 product carousels, bento, CTA
├── shop.html           Full product grid with filters + sort
├── product.html        Product detail page (reads ?id= from URL)
├── cart.html           Shopping cart
├── checkout.html       Checkout — contact/shipping/payment form + order summary
├── orders.html         Order history with delivery tracker + reorder
├── about.html          Brand story
├── contact.html        Contact form
├── README.md           This file
├── worker.js           Cloudflare Worker (deployed separately) — Nomba payment proxy
│                        + webhook / idempotent order completion (KV-backed)
├── DEPLOY-WORKER.md    Step-by-step setup for Nomba + EmailJS (one-time, ~25 min)
│
├── scripts/
│   ├── products.js     PRODUCTS database (45 products) + getProduct / getRelatedProducts
│   ├── base.js         Shared: cart core, currency system, header, newsletter
│   ├── home.js         index.html — carousels, typewriter, click-to-cart, promo copy
│   ├── shop.js         shop.html — grid render, filters, sort
│   ├── product.js      product.html — detail render, sizes, thumbs, add-to-cart, tabs
│   ├── cart.js         cart.html — cart render, qty, promo, checkout nav
│   ├── checkout.js     checkout.html — summary, validation, place order
│   ├── orders.js       orders.html — order history render, tracker, reorder
│   └── contact.js      contact.html — contact form validation
│
├── styles/
│   ├── base.css        Shared — header, footer, page-hero, buttons, cart toast, currency
│   ├── home.css        Home page
│   ├── shop.css        Shop grid
│   ├── product.css     Product detail
│   ├── cart.css        Cart
│   ├── checkout.css    Checkout
│   ├── orders.css      Orders
│   ├── about.css       About
│   ├── contact.css     Contact
│   ├── tops-fb.css     Front/Back image hover-swap (shared by home + shop)
│   └── lifestyle-banner.css   Lifestyle banner on home
│
└── images/            All images are WebP (q80) — converted from PNG/JPG for fast loads
    ├── (root)          Product photos by number: 45–108, 119, 189, 190, 596, 650
    ├── Tops F&B/       Statement-tops front/back/extra shots (2–43, 63–68)
    ├── Completewear/   Full-outfit "lifestyle" set photos (4–68)
    ├── PNGIMG/         Lifestyle/model photos (IMG_6416 … IMG_6443)
    ├── ool/            Model cut-out shots (2–6)
    ├── Fakesmile-1.webp Brand logo
    └── brick-bg.webp   Brick-wall texture (footer/hero watermark)
```

> **Images are WebP.** Every image is stored as `.webp` (quality 80) — the catalog
> dropped ~64% (147 MB → 54 MB) versus the original PNG/JPG set, so pages load
> much faster. When adding a new product image, convert it to WebP first and
> reference the `.webp` path in `products.js`.

---

## 3. Pages

| Page | Purpose | Scripts loaded |
|---|---|---|
| `index.html` | Home: hero + typewriter, category showcase, 4 carousels (Tops, Statement, Bottoms, Headwear), Full-Fit bridge banner, lifestyle banner, bento grid, contact CTA | products, base, home |
| `shop.html` | All 45 products in a grid; filter pills (All / Tops & Hoodies / Statement Tops / Joggers & Shorts / Headwear); sort (Featured / Price / Name) | products, base, shop |
| `product.html` | Single product detail via `?id=<slug>`; gallery + thumbs, size chips, qty, add-to-cart, tabs, randomized related products | products, base, product |
| `cart.html` | Cart items, qty steppers, promo code, totals, "Proceed To Checkout" | base, cart |
| `checkout.html` | 3-step form (Contact, Shipping, Payment), sticky order summary, success state | products, base, checkout |
| `orders.html` | Order history cards, delivery tracker, "Buy Again", clear history | products, base, orders |
| `about.html` | Brand story, pillars, crafted-in-Lagos section | base |
| `contact.html` | Contact form + info cards | base, contact |

**Nav** (all pages): About · Shop · Contact · Orders, plus a persistent cart pill (top-right).
Cart-flow pages (cart/product/checkout) show "Cart" instead of "Orders" in the nav.
The brand logo links home.

---

## 4. Product Catalog (`scripts/products.js`)

`PRODUCTS` is an object keyed by product id (slug). **45 products**:

| Category | Count | `categoryHash` |
|---|---|---|
| Tops & Hoodies | 17 | `products` |
| Statement Tops | 13 | `tops` |
| Joggers & Shorts | 9 | `bottoms` |
| Headwear | 6 | `headwear` |

### Product entry shape
```js
'product-id': {
    id: 'product-id',
    name: 'Display Name',
    tag: 'Hoodie',                       // Hoodie | Jersey | Tank | Long Sleeve | Tee | Crewneck | Joggers | Shorts | Bucket Hat | Cap
    category: 'Tops & Hoodies',          // one of the 4 categories above
    categoryHash: 'products',
    price: 18000,                        // NGN integer (base currency — see §7)
    image: 'images/45.webp',             // front image
    backImage: 'images/46.webp',         // optional — enables F/B hover swap
    completewear: 'images/Completewear/44.webp', // optional — full-set lifestyle photo
    partner: 'matching-product-id',      // optional — for set merging (see §5)
    badge: 'New' | 'Bestseller' | 'Limited',     // optional
    description: '...',
    details: { Material, Fit, Sizes, Care, Origin },
}
```

### Helper functions (in products.js)
- `getProduct(id)` — returns the product object or `null`.
- `getRelatedProducts(id)` — returns **one random product from each of**:
  Hoodie, Tee, Joggers, Shorts, Headwear (excluding `id`). Used by the
  "More From The Drop" section on the product page. Re-randomizes every load.

### Partner pairs (sets)
9 top↔bottom pairs are partnered (bidirectional `partner` fields). Adding either
piece collapses them into one cart row (see §5):
sunset / cloud / midnight brick hoodies ↔ matching signature joggers ·
steel brick hoodie ↔ heather stone joggers ·
crimson / forest / cloud / onyx / sunset court jerseys ↔ matching shorts.

---

## 5. Cart System (`scripts/base.js`)

Cart functions live in `base.js` so every page shares them.

### localStorage
- `fs_cart_items` — JSON array of cart entries (source of truth).
- `fs_cart_count`, `fs_cart_total` — derived mirrors (for quick header reads).

### Cart entry shape
```js
{
    id: 'cloud-brick-hoodie-set-m',      // cart key = productId + size suffix
    productId: 'cloud-brick-hoodie-set', // base id (no size) for product-page links
    name, tag, size, price, image, qty,
}
```

### `addToCart(input)` behaviour
1. **Set merge** — if the product has a `partner`, the item is rewritten into a
   single canonical set entry: `id = <topId>-set`, name = top's name,
   tag = `"Hoodie + Joggers"`, price = top + bottom, image = top's `completewear`.
   Both halves of a pair collapse into the same cart row.
2. **Size suffix** — the cart `id` is `baseId + '-' + size`, so different sizes of
   the same product are separate rows. Default size is `M` if none picked.
3. Increments qty if the entry already exists; otherwise pushes a new row.

Other functions: `removeFromCart(id)`, `setCartQty(id, qty)`, `clearCart()`,
`readCart()`, `renderHeaderCart()`. A `cart:update` event fires on every write.

---

## 6. Click Behaviour

- **Home catalog cards** (`home.js`) — clicking the product image **adds to cart**
  (does not navigate). Cards have 3D transforms that break browser hit-testing, so
  a `pointerdown`/`pointerup` pair + `document.elementFromPoint()` resolves the
  visually-correct card. The `+` button has its own handler.
- **Shop cards** (`shop.js`) — the whole card is a native `<a>` to `product.html`;
  only the `+` button adds to cart.

---

## 7. Currency System (`scripts/base.js`)

All prices in `products.js` and the cart are stored as **NGN integers**.
`formatPrice(ngnValue)` converts + formats for display.

- **Default GBP**, switches to **NGN** if an IP lookup (`ipapi.co`) detects Nigeria.
  Saved in `localStorage.fs_currency`.
- **Live exchange rate** — fetched from the public FX API
  `cdn.jsdelivr.net/npm/@fawazahmed0/currency-api` (fallback mirror:
  `latest.currency-api.pages.dev`). Cached in `localStorage.fs_fx_rate` for 24h.
  Falls back to `₦2000/£1` only if API + cache are both unavailable.
- `applyCurrencyToPage()` rewrites every `.product-price` on load; hardcoded `₦`
  prices in HTML are read once, stored as `data-price-ngn`, then reformatted.
- A `currency:update` event fires when the rate or currency changes so cart /
  shop / product / checkout / orders pages re-render.

---

## 8. Checkout (`checkout.html` + `scripts/checkout.js`)

Reached from the cart's "Proceed To Checkout" button.

- **3 form steps**: Contact (email, phone) · Shipping (name, address, city, state,
  country dropdown, postal) · Payment (**Pay with Nomba** / Bank transfer).
- Sticky **order summary** mirrors the cart (items, subtotal, promo discount, total)
  via `formatPrice()`.
- Country auto-selects from detected currency (NGN→Nigeria, GBP→UK).
- Empty-cart guard: visiting `checkout.html` with an empty cart shows an empty state.

### Payment flow (Nomba via Cloudflare Worker)

Real money movement is wired through **Nomba** (Nigerian payment processor).
Because Nomba's API needs a **private key** that must never reach the browser,
a tiny **Cloudflare Worker** (`worker.js`) acts as a secure proxy.

```
Browser → /create-checkout (Worker)
            ↓
            Worker auths with Nomba (OAuth client_credentials),
            creates a checkout session, returns checkoutLink.
Browser → window.location = checkoutLink (Nomba hosted page)
       User pays (card / USSD / bank transfer / Nigerian wallet)
Nomba → redirects back to checkout.html?orderReference=FS-XXX  (Nomba appends this)
Browser → /verify-payment (Worker)
            ↓
            Worker asks Nomba: "Did FS-XXX clear?"
            Returns SUCCESS/PENDING/FAILED.
Browser → on SUCCESS: save order, fire 2 EmailJS notifications, show success card.
```

**Setup is documented step-by-step in `DEPLOY-WORKER.md`** — covers regenerating
Nomba keys, deploying the Worker free on Cloudflare, setting EmailJS templates,
and pasting the keys into the config block at the top of `scripts/checkout.js`.

### Order shape (`fs_orders`)
```js
{
    id: 'FS-A7K3P9', placedAt: <timestamp>, paidAt?: <timestamp>,
    nombaReference?: 'NMB-...',
    customer: { firstName, lastName, email, phone },
    shipping: { address1, address2, city, state, country, postal },
    payment: { method: 'nomba' | 'bank' },
    items: [ { id, productId, name, tag, size, price, qty, image } ],
    subtotal, discount, promoCode, total, currency,
    status: 'paid' | 'pending',  // 'paid' after Nomba verifies; 'pending' for bank transfer
}
```

### Order notification emails (EmailJS)

After a successful order, two emails fire:
- **Seller alert** (to you) — full order details so you can fulfil.
- **Customer confirmation** — order id, items, ship-to address.

The EmailJS SDK is loaded in `checkout.html`; 4 placeholders at the top of
`scripts/checkout.js` (`EMAILJS_PUBLIC_KEY`, `EMAILJS_SERVICE_ID`,
`EMAILJS_TEMPLATE_SELLER`, `EMAILJS_TEMPLATE_CUSTOMER`) hold the IDs you
get from emailjs.com. Free tier covers ~100 orders/month.

---

## 9. Orders (`orders.html` + `scripts/orders.js`)

Reads `localStorage.fs_orders` (written by checkout). For each order:

- Order id, date, status badge.
- **Delivery tracker** (3-step: Processing → Shipped → Delivered). With no backend,
  the stage is derived from order age: `<1 day` Processing, `1–4 days` Shipped,
  `>4 days` Delivered.
- Item rows, ship-to address, payment method, promo, total.
- **"Buy Again"** re-adds the whole order to the cart (`addToCart` with `productId`).
- **"Clear History"** wipes `fs_orders` (with confirm).
- Empty state when no orders exist.

---

## 10. Promo Codes

Applied on the cart page, carried into checkout. Defined in `cart.js` / `checkout.js`:

| Code | Discount |
|---|---|
| `STREETS25` | 25% off |
| `DROP02` | 10% off |
| `CREW10` | 10% off |

Stored in `localStorage.fs_cart_promo`. The home bento grid copies `STREETS25` to clipboard.

---

## 11. localStorage Keys (full list)

| Key | Holds |
|---|---|
| `fs_cart_items` | Cart entries (array) |
| `fs_cart_count` | Derived item count |
| `fs_cart_total` | Derived NGN total |
| `fs_cart_promo` | Applied promo code |
| `fs_currency` | `NGN` or `GBP` |
| `fs_fx_rate` | Cached FX rate `{ ratio, date, fetchedAt }` |
| `fs_orders` | Placed orders (array) |

(`localStorage` also holds a short-lived `fs_pending_order` key during the
Nomba round-trip — it lets checkout.js complete the order on return from
Nomba's hosted page. It's in `localStorage` rather than `sessionStorage` because
mobile Safari frequently clears `sessionStorage` across the cross-site payment
redirect; `handleReturnFromNomba()` removes it once the order is finalized or
found stale, 30 min after `placedAt`.)

---

## 12. Design System

- **Colors**: background `#050505`/`#000`; brand green `#00d957` → `#00ff7a`;
  text white with muted greys.
- **Liquid glass**: `backdrop-filter: blur()` + green-tinted gradients + inset
  highlights on cards and the header.
- **Shared classes**: `.page-hero` (orbs, grid, brick watermark, wordmark),
  `.page-btn` / `.page-btn-primary` / `.page-btn-ghost`, `.section-tag`,
  `.accent-italic` (green gradient italic text), `.liquid-glass-header`, `.site-footer`.
- **Front/Back swap** (`tops-fb.css`): products with `backImage` flip image on
  hover (desktop) / auto-cycle every 8s (touch).
- Responsive throughout; tight mobile layouts with `env(safe-area-inset-bottom)`
  padding on cart/checkout/orders.

---

## 13. Known Stubs / Not Yet Built

- ~~**Payment processing**~~ — **DONE**: Nomba via Cloudflare Worker. Needs the
  Worker deployed (see `DEPLOY-WORKER.md`) and 3 Nomba keys + 4 EmailJS values
  pasted into the config block at the top of `scripts/checkout.js`.
- Newsletter & contact forms validate + show a message but don't send anywhere
  (could be wired through the same EmailJS account easily).
- Footer links (FAQ, Shipping, Returns, Size Guide, Wholesale, Privacy/Terms/Cookies)
  are placeholders (`#`).
- "Orders" status is **time-simulated for visual progression**. Once Nomba is live,
  the `status` field on each order reflects real payment state (`paid`/`pending`),
  but ship/deliver stages still come from `orders.js`'s age-based heuristic
  (no real fulfilment integration).
- Unused `Completewear` images `64` and `67` are not yet mapped to a product;
  images `95`/`96` (a green/white tank pair) are also unmapped.

---

## 14. Change Log

- Joggers are now **priced/active** (₦40,000 base — review). Fixed stacked badges
  on inactive cards: one badge only — a **Limited** item keeps its Limited badge,
  Bestseller/New/none show **Coming Soon** (applied on shop, product detail,
  related, and home carousels).
- **Per-item price markup + Coming-Soon products.** (1) Contact emails now point to
  `fakeasmile29@gmail.com`. (2) Catalog prices set best-guess **by type** from the
  WhatsApp catalog screenshots (`CATALOG_PRICE_BY_TAG` in `products.js`: Hoodie
  ₦60k, Tee ₦38k, Bucket Hat ₦35k, Cap ₦20k — 19 products). (3) Every product
  carries a **per-item markup in the displayed currency**: +₦5,000 in Naira, +£15
  in Pounds, applied at listing, cart, and checkout (`unitDisplayAmount` /
  `formatMarked` / `unitChargeNgn` in `base.js`). GBP is display; the £ total is
  converted to NGN and charged via Nomba. (4) Products with **no catalog price**
  (Jersey, Tank, Long Sleeve, Crewneck, Joggers, Shorts — 22 products) show a
  **"Coming Soon"** badge with a disabled Add-to-Cart (shop, product, related, and
  the synced home carousels; `addToCart` also hard-blocks them). Orders/emails store
  the marked NGN so records stay consistent. *(Prices are a best-guess for review —
  adjust `CATALOG_PRICE_BY_TAG` or individual products.)*
- Hooked up real **social links** site-wide (Instagram `@trendsbyfakeasmile`, TikTok,
  WhatsApp) — replacing the `#` placeholders in every page footer and the contact
  page's community block. Dropped the unused X/Twitter and YouTube icons (no handles).
- Temporarily **hid 4 tees** (Olive Anthem, Onyx Stack, Storm Anthem, Mist Stack) —
  commented out in `products.js` (catalog now 41 products); uncomment the block to
  relist them.
- Content: founding year corrected to **2023** across all pages (hero marquees,
  about "started in 2023" / "Est. 2023"); home hero copy replaced with the
  "more than a brand… welcome to the movement" manifesto; free-shipping threshold
  in the contact FAQ raised **₦50,000 → ₦100,000**.
- **Server-side order completion via Nomba webhook (browser-independent).** The
  Worker now exposes `/webhook` (HMAC-SHA256 signature-verified), `/finalize`
  (idempotent), and `/order-status`, and persists the full order in Cloudflare
  **KV** at create-checkout time. On `payment_success` (or browser return), one
  shared `finalizeOrder()` marks the order paid and sends the seller + customer
  emails **server-side, exactly once** (KV `emailsSent` flag) — so an order is
  recorded and emailed even if the customer's browser never returns from Nomba.
  checkout.js now sends the full order to `/create-checkout` and completes through
  `/finalize`, only emailing client-side when the server reports it didn't (no
  duplicates). Fully backward-compatible: with no KV/webhook configured it falls
  back to the previous browser-side flow. **Requires a Worker redeploy + KV +
  webhook setup — see `DEPLOY-WORKER.md` §9.** Note: testable only with live keys
  (Nomba sandbox doesn't deliver webhooks reliably).
- **Worker now sends `amount` as a string** (`"10000.00"`), per Nomba's checkout
  spec. It was sending a raw number — a spec violation that can make Nomba ignore
  the `callbackUrl` and fall back to a default redirect (lands on nomba.com after
  payment instead of returning to checkout.html). **Requires a Worker redeploy** to
  take effect (the site auto-deploys, but `worker.js` runs on Cloudflare and must
  be re-uploaded). If it still redirects to nomba.com on **sandbox** keys after
  redeploy, that's a sandbox limitation — verify with **live** keys; the
  "Finish order" resume banner recovers the order either way.
- **Payment completion fix + resume safety net.** Discovered Nomba *ignores* the
  `orderId` we send and generates its **own `orderReference` (a UUID)** — that is
  what it appends to the return URL and the only id its verify endpoint knows. We
  now capture `data.orderReference` from the create-checkout response, store it on
  the pending order (`nombaRef`), and match/verify against it on return (previously
  we compared/verified against our `FS-XXX`, so the order never finalized). Added a
  site-wide **"Finish order" banner** (`base.js` + `.fs-resume-banner`): if the
  provider drops the user somewhere other than our `callbackUrl` (seen on mobile /
  Nomba sandbox, which lands on nomba.com), reopening any page within 30 min of a
  pending payment offers a one-tap return to checkout.html to verify + complete the
  order. Note: Nomba **sandbox** does not reliably honor `callbackUrl` (redirects to
  nomba.com) and its verify endpoint returns canned sample data — both behave
  correctly with live keys.
- **Fixed mobile payment return (stuck on nomba.com after paying).** Two bugs:
  (1) the `callbackUrl` was built as `${RETURN_URL}?orderRef=<id>`, but Nomba
  *appends its own* `?orderReference=<id>` — the resulting double-`?` URL was
  malformed, so the post-payment redirect failed. Now we pass a clean
  `callbackUrl` and read Nomba's `orderReference`. (2) The pending order was kept
  in `sessionStorage`, which mobile Safari clears across the cross-site round-trip,
  so the order never completed on return — moved to `localStorage` with a 30-min
  stale guard and a fallback that completes the order even if the query string is
  dropped. (checkout.js only — no Worker redeploy needed.)
- **Fixed iOS Safari crash ("A problem repeatedly occurred").** Root cause was
  image *memory*, not file size: 117/126 images were >4000px (many 3840×5760 = 22 MP),
  each needing ~88 MB of RAM when decoded, and the home page eager-loaded 58 of them
  at once — far past iOS Safari's per-tab limit. Fixes: (1) capped every image's long
  edge at **2560px** (Lanczos, WebP q82) — invisible at display sizes, peak decoded
  memory ~8 GB → ~2.5 GB worst case; (2) added `loading="lazy"` + `decoding="async"`
  to all images (above-the-fold hero/logo/product-main stay `eager` with
  `fetchpriority="high"`) so only near-viewport images decode; (3) removed 6
  unreferenced duplicate root `IMG_*.webp`.
- Fixed broken thumbnails for orders/cart saved **before** the WebP migration:
  `base.js` now exposes `fsImg()`, which rewrites any stored `.png`/`.jpg` path to
  `.webp` at render time (orders, cart, checkout, toast) and on re-save; image tags
  also carry an `onerror` fallback to the brand logo.
- **Images converted to WebP** (quality 80): all 126 product/lifestyle/brand images
  re-encoded from PNG/JPG and the originals removed. Catalog shrank ~64%
  (147 MB → 54 MB); every `.png`/`.jpg` reference across HTML/CSS/JS now points to
  `.webp`. Result: substantially faster page loads.

- Cart mobile layout tightened; phantom discount line fixed.
- Product catalog re-audited against the image folder — 7 mis-mapped products
  removed, forest/ivory/onyx long sleeves corrected, 6 new properly-mapped
  products added (court jerseys/shorts, cream-faces tank).
- 3 new hoodies added: Shadow Crest (119), Heather Crest (189), Pearl Crest (190).
- 2 new curved-brim caps added to Headwear: Olive Globe (651), Voltage Globe (652).
  First caps in the catalog (existing headwear is all bucket hats); priced ₦8,500.
- Orders page: each order card is now **collapsed by default** — the header shows
  ID, date, item count, total, and status; a chevron toggles the tracker / items /
  ship / payment / Buy Again. Reduces visual noise when a customer has multiple
  orders. Mobile breakpoints rewritten (900 / 720 / 480 / 360) so the layout
  reflows cleanly on every screen size.
- Cart item card rebuilt: **X (remove) is now an absolute top-right button** and
  the qty (–/+) + line subtotal share a single bottom row separated by a dashed
  divider. Desktop keeps qty/subtotal in column 2 under the body; mobile lets
  that bottom row span the full card width (image stays top-left, X stays
  top-right, qty bottom-left, subtotal bottom-right — one consistent layout).
- Currency system added — GBP default, NGN by IP, live FX rate.
- "More From The Drop" related section: now 1 random product per category.
- Checkout page + Orders page built and wired into cart / currency / order storage.
- **Real payments wired**: Nomba payment processor via Cloudflare Worker proxy
  (`worker.js`), EmailJS for seller + customer order confirmation emails.
  Checkout page now offers "Pay with Nomba" (card / USSD / transfer) and "Bank
  transfer" (manual). Deployment guide in `DEPLOY-WORKER.md`.
