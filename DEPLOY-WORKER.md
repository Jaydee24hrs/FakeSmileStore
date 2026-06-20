# Deploying the Nomba Worker

This guide walks you through deploying `worker.js` to **Cloudflare Workers** (free tier — 100,000 requests/day, more than enough). After this, your Nomba private key lives safely on Cloudflare's edge, never in your website code.

**Time: ~10 minutes.**

---

## 0. Before you start — REGENERATE your Nomba keys

The keys you pasted in our chat are publicly visible in this conversation history. Open your Nomba dashboard → **Developer → API Keys**, click **"Regenerate Keys"**, and grab the new ones. **Don't paste them in chat this time.**

You'll need the three new values handy:
- `NOMBA_CLIENT_ID`
- `NOMBA_ACCOUNT_ID`
- `NOMBA_PRIVATE_KEY`

---

## 1. Create a free Cloudflare account

1. Go to https://dash.cloudflare.com/sign-up → sign up (free).
2. After verifying your email, go to https://dash.cloudflare.com → **Workers & Pages** (left sidebar).

---

## 2. Create the Worker

1. From the **Workers & Pages** dashboard, click **"Create"** (or **"Create Worker"** — name varies).
2. On the **"Ship something new"** screen, click **"Start with Hello World!"** (the green-globe option). This is the equivalent of an empty Worker — you'll replace the default code in a moment.
3. Give it a name like `fakesmile-nomba` → click **"Deploy"**. Cloudflare deploys a default "Hello World" worker in a few seconds.
4. You'll land on the Worker's overview page. **Copy the Worker URL at the top** — it looks like:
   ```
   https://fakesmile-nomba.YOUR-SUBDOMAIN.workers.dev
   ```
   You'll paste this into `checkout.js` later.
5. Click **"Edit code"** (top-right). The code editor opens.
6. In the editor pane, **`Ctrl+A` → Delete** to clear the default Hello World code.
7. Open `worker.js` from your project folder in VSCode → **`Ctrl+A` → `Ctrl+C`** to copy the whole file.
8. Back in Cloudflare's editor → **`Ctrl+V`** to paste.
9. Click **"Save and deploy"** in the top-right.

> **If you don't see a "Start with Hello World!" option**, look for "Create Worker" or "Hello World" anywhere on the page — same thing. You can also click **"Select a template"** → pick the "Hello World" template.

---

## 3. Set the secret environment variables

Still in the Worker page:

1. Click **"Settings"** (top tab) → **"Variables and Secrets"** (or **"Variables"** depending on UI version).
2. Click **"Add"** for each of these. **Choose type "Secret"** for each (encrypted, not visible after saving):

| Variable name | Value |
|---|---|
| `NOMBA_CLIENT_ID` | (your new Client ID) |
| `NOMBA_ACCOUNT_ID` | (your new Account ID) |
| `NOMBA_PRIVATE_KEY` | (your new Private Key) |
| `ALLOWED_ORIGIN` | `*` for now (lock it down to your real domain later — see step 6) |

Optionally (for sandbox testing):
| `NOMBA_BASE` | `https://sandbox.nomba.com/v1` (Type: plain text, not secret) |

3. Click **"Deploy"** to apply the variables.

---

## 4. Test the Worker

Open your terminal (PowerShell on Windows, Terminal on Mac) and run:

```bash
curl https://fakesmile-nomba.YOUR-SUBDOMAIN.workers.dev/health
```

You should see:
```json
{ "ok": true, "service": "fakesmile-nomba-worker" }
```

If you see that, the worker is alive. ✓

---

## 5. Paste the Worker URL into `checkout.js`

Open `scripts/checkout.js` and find this line near the top:

```js
const NOMBA_WORKER_URL = 'https://fakesmile-nomba.YOUR-SUBDOMAIN.workers.dev';
```

Replace `YOUR-SUBDOMAIN` with the subdomain from step 2 (or paste the full URL).

That's it for Nomba.

---

## 6. (Optional but recommended) Lock down `ALLOWED_ORIGIN`

Right now `ALLOWED_ORIGIN=*` means any website could call your worker. Once your site is live, go back to the Worker's Variables and change it to your actual domain:

```
ALLOWED_ORIGIN=https://fakesmilestore.com
```

For local dev, you may need a separate Worker with `*`, or keep `*` until you deploy. Not a huge risk — the worker only creates checkouts with **your** Nomba account, so the worst someone could do is generate Nomba checkout links that pay you.

---

## 7. Set up EmailJS (for order notifications)

1. Sign up at https://www.emailjs.com (free tier: 200 emails/month).
2. **Email Services** → **Add new service** → connect Gmail (or any provider). Note the **Service ID**, e.g. `service_abc123`.
3. **Email Templates** → **Create new template**. Make two:

**Template A — "Seller New Order Alert"** (sent to YOU):
- To Email: `chinedue856@gmail.com` (your address)
- Subject: `New Order: {{order_id}}`
- Body:
  ```
  New order placed on FakeSmile.

  Order ID: {{order_id}}
  Customer: {{customer_name}} ({{customer_email}})
  Phone: {{customer_phone}}

  Items:
  {{items}}

  Subtotal: {{subtotal}}
  Discount: {{discount}}
  Total: {{total}}

  Ship to:
  {{shipping_address}}

  Payment: {{payment_method}}
  Status: {{status}}
  ```
- Save → note the **Template ID**, e.g. `template_seller_xyz`.

**Template B — "Customer Order Confirmation"** (sent to the buyer):
- To Email: `{{customer_email}}`
- Subject: `Your FakeSmile order {{order_id}} is confirmed`
- Body:
  ```
  Hi {{customer_name}},

  Thanks for the order — your fit is locked in.

  Order ID: {{order_id}}
  Total: {{total}}

  Items:
  {{items}}

  We'll ship to:
  {{shipping_address}}

  You'll get another email when it ships.

  — FakeSmile
  ```
- Save → note the **Template ID**, e.g. `template_customer_abc`.

4. **Account** → **General** → copy your **Public Key**.

5. Open `scripts/checkout.js` and find this block near the top:

```js
const EMAILJS_PUBLIC_KEY    = 'YOUR_EMAILJS_PUBLIC_KEY';
const EMAILJS_SERVICE_ID    = 'YOUR_EMAILJS_SERVICE_ID';
const EMAILJS_TEMPLATE_SELLER   = 'YOUR_TEMPLATE_ID_FOR_SELLER';
const EMAILJS_TEMPLATE_CUSTOMER = 'YOUR_TEMPLATE_ID_FOR_CUSTOMER';
```

Paste your 4 values in. Done.

---

## 8. Test the full flow

1. Hard-refresh `checkout.html` in your browser.
2. Add a product to cart → proceed to checkout → fill form → select **Pay with Nomba**.
3. You should be redirected to Nomba's hosted checkout page.
4. Pay with a test card (in sandbox) or a small real amount (in live mode).
5. After payment, Nomba redirects you back. The page should verify the payment, show the success card with the order ID, and you + the customer should receive emails within seconds.

---

## 9. (Recommended) Server-side completion — webhook + KV

By default the order is finalized by the **browser** when it returns from Nomba.
If the customer's browser never comes back (mobile redirect fails, app closed,
Nomba sandbox dumps them on nomba.com), the order would never be recorded or
emailed. This step makes completion **server-authoritative** so it never depends
on the browser. It's all additive — skip it and everything still works as before.

The Worker already exposes `/webhook`, `/finalize`, and `/order-status`. You just
need to give it somewhere to store orders and a way to send email + verify the
webhook signature.

### 9a. Create a KV namespace (stores the in-progress order)

1. Cloudflare dashboard → **Storage & Databases → KV → Create namespace**.
   Name it e.g. `fakesmile-orders`.
2. Your Worker → **Settings → Bindings → Add → KV namespace**.
   - **Variable name:** `ORDERS`  (must be exactly this)
   - **KV namespace:** the one you just created.
3. Save & Deploy.

Now `/create-checkout` saves the full order under `order:<nombaOrderReference>`
(30-day TTL), and `/finalize` + `/webhook` mark it paid and email it.

### 9b. Add the webhook signature key + EmailJS server vars

Add these in **Settings → Variables and Secrets** (Secret type):

| Variable name | Value |
|---|---|
| `NOMBA_SIGNATURE_KEY` | **Signature Key** from Nomba dashboard → Developers/Webhooks |
| `EMAILJS_PRIVATE_KEY` | EmailJS → Account → **API Keys → Private Key** (and enable "Allow EmailJS API for non-browser applications") |
| `EMAILJS_PUBLIC_KEY` | same public key as in `checkout.js` |
| `EMAILJS_SERVICE_ID` | same service id as in `checkout.js` |
| `EMAILJS_TEMPLATE_SELLER` | same seller template id |
| `EMAILJS_TEMPLATE_CUSTOMER` | same customer template id |

> The browser still has its own EmailJS keys. To avoid **duplicate** emails the
> Worker emails *once* (a KV `emailsSent` flag), and the site only emails from the
> browser when the server reports it did **not** — so once the server vars above
> are set, the Worker becomes the single sender automatically.

### 9c. Register the webhook URL in Nomba

In the Nomba dashboard → **Webhooks** (or Developers → Webhooks):

1. **Webhook URL:** `https://<your-worker-subdomain>.workers.dev/webhook`
2. Subscribe to the **`payment_success`** event.
3. Copy the **Signature Key** into `NOMBA_SIGNATURE_KEY` (step 9b).
4. Save & Deploy the Worker.

### 9d. Verify

- Cloudflare → your Worker → **Logs** (live tail), then do a test payment.
- You should see the `/webhook` hit, signature pass, and `finalizeOrder` run.
- Re-deliver the event from Nomba's dashboard: it should be idempotent (no second
  email). `GET /order-status?ref=<nombaOrderReference>` should return `"paid"`.

> **Note:** this needs **live** keys to fully test — Nomba **sandbox** does not
> reliably deliver `payment_success` webhooks or honor `callbackUrl` (it lands on
> nomba.com), and its verify endpoint returns canned sample data.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Worker returns "missing NOMBA_* env vars" | Check Variables tab — make sure all 3 are saved as **Secret** type and the Worker has been re-deployed since you added them. |
| Browser console: "CORS blocked" | Check `ALLOWED_ORIGIN` — either set it to `*` temporarily, or to the exact origin you're testing from (including `http://` vs `https://`). |
| Nomba returns 401 | Keys are wrong, or you're hitting `api.nomba.com` with sandbox keys (or vice versa). Verify `NOMBA_BASE` matches your key environment. |
| Customer doesn't get confirmation email | Check EmailJS dashboard → History tab. Often a free-tier email service needs a verification click. Also check the customer's spam folder. |
| Payment success but order doesn't save | Open browser DevTools → Application → Local Storage. Check `fs_orders`. If empty, the verify-payment call probably failed — check Worker logs (Cloudflare dashboard → your Worker → Logs). |
| Webhook returns 401 "invalid signature" | `NOMBA_SIGNATURE_KEY` doesn't match the dashboard Signature Key, or the body was altered. Re-copy the key and redeploy. |
| Webhook returns 503 "webhook not configured" | `NOMBA_SIGNATURE_KEY` isn't set on the Worker (step 9b). |
| Duplicate order emails | Both browser and Worker emailed. Make sure the EmailJS server vars (step 9b) are set so the Worker is the single sender; the site auto-skips browser email when the server reports `emailed:true`. |
| Webhook fires but no email / order | KV not bound as `ORDERS`, or EmailJS server vars missing. Without KV the Worker can confirm payment but can't store/email the order details. |

---

## Cost & limits

- **Cloudflare Workers free tier:** 100,000 requests/day, 10ms CPU per request. Even at heavy traffic, you'd never hit this.
- **EmailJS free tier:** 200 emails/month. Each order = 2 emails (you + customer), so ~100 orders/month before hitting the limit. Upgrade plans start at $7/mo for 1,000 emails.
- **Nomba:** standard payment processing fees (~1.5% + ₦100 for cards, etc. — check their pricing page).