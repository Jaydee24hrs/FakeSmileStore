/* ============================================= */
/* === GOOGLE SIGN-IN (customer account) ======== */
/* ============================================= */
/* Wires up the header "account" button to Google Identity Services (GIS) —
 * a client-only sign-in: no backend, no password, no server session. Google
 * hands back a signed ID token; we decode it (name/email/picture) and keep
 * it in localStorage so the header can greet the customer by name.
 *
 * HONEST ABOUT LIMITS: this is per-browser, not a real account system.
 *   - It does NOT verify the token server-side (there's no server to do it
 *     on) — fine for a friendly greeting, not something to trust for
 *     anything sensitive. Never gate a paid action on this alone.
 *   - It does NOT sync orders across devices. "My Orders" still reads the
 *     same localStorage.fs_orders it always has (see orders.js). Signing in
 *     on a different device/browser starts with an empty order list there.
 *   - Signing out only clears the LOCAL sign-in state; it does not revoke
 *     anything on Google's side (that's `disableAutoSelect`, which we do
 *     call, so Google won't silently re-sign the user in next visit).
 *
 * SETUP REQUIRED — see GOOGLE-SIGNIN-SETUP.md. Until GOOGLE_CLIENT_ID below
 * is a real value, the panel shows a "not configured yet" message instead
 * of a broken sign-in button.
 */
(function () {
    // ===== CONFIG — replace with your real OAuth Client ID =====
    // Google Cloud Console → APIs & Services → Credentials → Create OAuth
    // client ID → Web application → Authorized JavaScript origins:
    //   https://fakesmilestore.com  and  https://www.fakesmilestore.com
    // (add http://localhost:8000 too if you test locally). Full walkthrough
    // in GOOGLE-SIGNIN-SETUP.md.
    const GOOGLE_CLIENT_ID = 'YOUR-GOOGLE-CLIENT-ID.apps.googleusercontent.com';

    const USER_KEY = 'fs_user';
    const configured = GOOGLE_CLIENT_ID.indexOf('YOUR-GOOGLE-CLIENT-ID') === -1;

    // ===== Stored user (localStorage) =====
    function getUser() {
        try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); }
        catch (_) { return null; }
    }
    function setUser(u) {
        localStorage.setItem(USER_KEY, JSON.stringify(u));
        document.dispatchEvent(new CustomEvent('user:update', { detail: { user: u } }));
    }
    function clearUser() {
        localStorage.removeItem(USER_KEY);
        document.dispatchEvent(new CustomEvent('user:update', { detail: { user: null } }));
    }

    // Decode a JWT's payload WITHOUT verifying its signature. Safe here only
    // because we use it for a display name/photo, never as proof of
    // identity for anything that matters — see the file header.
    function decodeJwt(token) {
        try {
            const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
            const json = decodeURIComponent(
                atob(base64).split('').map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
            );
            return JSON.parse(json);
        } catch (_) { return null; }
    }

    function initials(name, email) {
        const src = (name || email || '?').trim();
        const parts = src.split(/\s+/).filter(Boolean);
        if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
        return src.slice(0, 2).toUpperCase();
    }

    // ===== Header button (avatar / initials / default icon) =====
    const DEFAULT_ICON =
        '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
        '<circle cx="12" cy="8" r="4"></circle><path d="M4 21c0-4 4-6.5 8-6.5s8 2.5 8 6.5"></path></svg>';

    function renderHeaderButton() {
        const btn = document.querySelector('.header-profile');
        if (!btn) return;
        const user = getUser();
        if (user) {
            btn.classList.add('is-signed-in');
            btn.setAttribute('aria-label', 'Account: signed in as ' + (user.name || user.email));
            btn.title = user.name || user.email;
            btn.innerHTML = user.picture
                ? '<img src="' + user.picture + '" alt="" referrerpolicy="no-referrer">'
                : '<span class="header-profile-initials">' + initials(user.name, user.email) + '</span>';
        } else {
            btn.classList.remove('is-signed-in');
            btn.setAttribute('aria-label', 'Sign in');
            btn.title = 'Sign in';
            btn.innerHTML = DEFAULT_ICON;
        }
    }

    // ===== Account panel (opens on click) =====
    let panelEl = null;

    function closePanel() {
        if (panelEl) { panelEl.remove(); panelEl = null; }
        document.removeEventListener('keydown', onEscape);
    }
    function onEscape(e) { if (e.key === 'Escape') closePanel(); }

    function buildSignedOutPanel(body) {
        body.innerHTML =
            '<div class="fs-account-head">' +
                '<span class="fs-account-icon">' + DEFAULT_ICON + '</span>' +
                '<h3>Sign in to FakeSmile</h3>' +
                '<p>Sign in with Google for a faster checkout and to see your name here. We only ever read your name, email and photo, never your Google password.</p>' +
            '</div>' +
            (configured
                ? '<div class="fs-gsi-btn" id="fs-gsi-btn"></div>'
                : '<p class="fs-account-note">Google Sign-In isn\'t switched on for this store yet.</p>') +
            '<p class="fs-account-fine">By continuing you agree to our <a href="' + fsUrl('terms.html') + '">Terms</a> and <a href="' + fsUrl('privacy.html') + '">Privacy Policy</a>.</p>';

        if (configured) requestAnimationFrame(() => renderGsiButton(document.getElementById('fs-gsi-btn')));
    }

    function buildSignedInPanel(body, user) {
        body.innerHTML =
            '<div class="fs-account-head fs-account-head-signedin">' +
                (user.picture
                    ? '<img class="fs-account-avatar" src="' + user.picture + '" alt="" referrerpolicy="no-referrer">'
                    : '<span class="fs-account-avatar fs-account-avatar-fallback">' + initials(user.name, user.email) + '</span>') +
                '<h3>' + (user.name ? escapeHtml(user.name) : 'Welcome back') + '</h3>' +
                '<p class="fs-account-email">' + escapeHtml(user.email || '') + '</p>' +
            '</div>' +
            '<div class="fs-account-links">' +
                '<a href="' + fsUrl('orders.html') + '" class="page-btn page-btn-ghost"><span>My Orders (this device)</span></a>' +
            '</div>' +
            '<button type="button" class="page-btn page-btn-ghost fs-account-signout" id="fs-signout-btn"><span>Sign Out</span></button>';

        document.getElementById('fs-signout-btn').addEventListener('click', () => {
            if (configured && window.google && window.google.accounts) {
                window.google.accounts.id.disableAutoSelect();
            }
            clearUser();
            renderHeaderButton();
            closePanel();
        });
    }

    function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

    function openPanel() {
        if (panelEl) { closePanel(); return; }
        panelEl = document.createElement('div');
        panelEl.className = 'fs-account-overlay';
        panelEl.innerHTML =
            '<div class="fs-account-panel" role="dialog" aria-modal="true" aria-label="Account">' +
                '<button type="button" class="fs-account-close" aria-label="Close">' +
                    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>' +
                '</button>' +
                '<div class="fs-account-body"></div>' +
            '</div>';
        document.body.appendChild(panelEl);
        panelEl.addEventListener('click', (e) => { if (e.target === panelEl) closePanel(); });
        panelEl.querySelector('.fs-account-close').addEventListener('click', closePanel);
        document.addEventListener('keydown', onEscape);

        const body = panelEl.querySelector('.fs-account-body');
        const user = getUser();
        if (user) buildSignedInPanel(body, user); else buildSignedOutPanel(body);
    }

    // ===== Google Identity Services =====
    function handleCredentialResponse(response) {
        const payload = decodeJwt(response.credential);
        if (!payload) return;
        setUser({
            sub: payload.sub,
            name: payload.name || '',
            email: payload.email || '',
            picture: payload.picture || '',
            signedInAt: Date.now(),
        });
        renderHeaderButton();
        closePanel();
    }

    let gisInitialized = false;
    function ensureGisInitialized() {
        if (gisInitialized || !configured) return gisInitialized;
        if (!window.google || !window.google.accounts || !window.google.accounts.id) return false;
        window.google.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: handleCredentialResponse,
            auto_select: false,
            itp_support: true,
        });
        gisInitialized = true;
        return true;
    }

    function renderGsiButton(container, attempt) {
        if (!container) return;
        if (!ensureGisInitialized()) {
            // The GIS script (accounts.google.com/gsi/client) loads async and
            // may not be ready the instant the panel opens — poll briefly.
            attempt = (attempt || 0) + 1;
            if (attempt > 20) { container.innerHTML = '<p class="fs-account-note">Sign-in is taking a moment to load. Please try again.</p>'; return; }
            setTimeout(() => renderGsiButton(container, attempt), 150);
            return;
        }
        window.google.accounts.id.renderButton(container, {
            theme: 'filled_black', size: 'large', shape: 'pill',
            text: 'signin_with', logo_alignment: 'left', width: 280,
        });
    }

    // ===== Wire it up =====
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.header-profile');
        if (btn) { e.preventDefault(); openPanel(); }
    });

    renderHeaderButton();
    document.addEventListener('user:update', renderHeaderButton);
})();
