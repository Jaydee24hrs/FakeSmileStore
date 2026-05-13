// ===== TYPEWRITER EFFECT FOR FAKESMILE =====
const typewriterEl = document.getElementById('typewriter');
const text = 'FAKESMILE';
let index = 0;
let isDeleting = false;

function typeWriter() {
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

typeWriter();

// ===== ACTIVE NAV LINK =====
const navLinks = document.querySelectorAll('.main-nav a');
navLinks.forEach(link => {
    link.addEventListener('click', () => {
        navLinks.forEach(l => l.classList.remove('active'));
        link.classList.add('active');
    });
});

// ===== CART FUNCTIONALITY =====
let cartCount = 0;
let cartTotal = 0;
const PRODUCT_PRICE = 5000; // ₦5,000 sample price

const cartCountEl = document.querySelector('.cart-count');
const cartAmountEl = document.querySelector('.cart-amount');
const addToCartBtn = document.querySelector('.btn-primary');
const viewProductsBtn = document.querySelector('.btn-outline');

addToCartBtn.addEventListener('click', () => {
    cartCount++;
    cartTotal += PRODUCT_PRICE;
    cartCountEl.textContent = cartCount;
    cartAmountEl.innerHTML = `&#8358;${cartTotal.toLocaleString()}.00`;

    // Visual feedback
    addToCartBtn.textContent = 'Added!';
    addToCartBtn.style.background = '#00d957';
    setTimeout(() => {
        addToCartBtn.textContent = 'Add to Cart';
        addToCartBtn.style.background = '';
    }, 1200);

    // Pulse cart icon
    const cartIcon = document.querySelector('.cart-icon');
    cartIcon.style.transform = 'scale(1.3)';
    cartIcon.style.transition = 'transform 0.2s ease';
    setTimeout(() => {
        cartIcon.style.transform = 'scale(1)';
    }, 200);
});

viewProductsBtn.addEventListener('click', () => {
    const products = document.getElementById('products');
    if (products) products.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

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

    viewport.addEventListener('touchstart', (e) => onStart(e.touches[0].clientX), { passive: true });
    viewport.addEventListener('touchmove', (e) => onMove(e.touches[0].clientX), { passive: true });
    viewport.addEventListener('touchend', onEnd);
    viewport.addEventListener('mousedown', (e) => { onStart(e.clientX); e.preventDefault(); });
    window.addEventListener('mousemove', (e) => onMove(e.clientX));
    window.addEventListener('mouseup', onEnd);

    cards.forEach((card) => {
        const glass = card.querySelector('.product-glass');
        card.addEventListener('mousemove', (e) => {
            const r = card.getBoundingClientRect();
            const x = (e.clientX - r.left) / r.width - 0.5;
            const y = (e.clientY - r.top) / r.height - 0.5;
            glass.style.transform =
                `translateY(-10px) rotateX(${-y * 8}deg) rotateY(${x * 10}deg)`;
        });
        card.addEventListener('mouseleave', () => { glass.style.transform = ''; });

        const btn = card.querySelector('.product-add');
        const priceEl = card.querySelector('.product-price');
        if (btn && priceEl) {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const price = parseInt(priceEl.textContent.replace(/[^\d]/g, ''), 10) || 0;
                cartCount++;
                cartTotal += price;
                cartCountEl.textContent = cartCount;
                cartAmountEl.innerHTML = `&#8358;${cartTotal.toLocaleString()}.00`;

                const cartIcon = document.querySelector('.cart-icon');
                cartIcon.style.transform = 'scale(1.3)';
                cartIcon.style.transition = 'transform 0.2s ease';
                setTimeout(() => { cartIcon.style.transform = 'scale(1)'; }, 200);

                btn.style.transform = 'scale(1.25) rotate(180deg)';
                setTimeout(() => { btn.style.transform = ''; }, 350);
            });
        }
    });

    window.addEventListener('resize', update);
    requestAnimationFrame(update);
}

document.querySelectorAll('.catalogue-section').forEach(initCarousel);

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
window.addEventListener('scroll', () => {
    if (window.scrollY > 50) {
        header.style.background = 'linear-gradient(135deg, rgba(20, 60, 50, 0.7) 0%, rgba(10, 30, 25, 0.8) 50%, rgba(20, 60, 50, 0.7) 100%)';
    } else {
        header.style.background = '';
    }
});
