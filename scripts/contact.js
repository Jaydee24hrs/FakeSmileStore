/* ============================================= */
/* === CONTACT SCRIPT (contact.html) =========== */
/* ============================================= */

// ===== CONTACT FORM (contact.html) =====
const contactForm = document.getElementById('contact-form');
if (contactForm) {
    const hint = contactForm.querySelector('.form-hint');
    const submitBtn = contactForm.querySelector('button[type="submit"] span');
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    contactForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const data = new FormData(contactForm);
        const name = (data.get('name') || '').toString().trim();
        const email = (data.get('email') || '').toString().trim();
        const message = (data.get('message') || '').toString().trim();

        if (!name || !emailRegex.test(email) || message.length < 4) {
            if (hint) {
                hint.classList.add('error');
                hint.textContent = 'Fill in name, a valid email, and a real message.';
            }
            return;
        }
        if (hint) {
            hint.classList.remove('error');
            hint.textContent = `Sent! We'll hit you back at ${email} within 24 hours.`;
        }
        if (submitBtn) {
            const original = submitBtn.textContent;
            submitBtn.textContent = 'Sent ✓';
            setTimeout(() => { submitBtn.textContent = original; }, 2500);
        }
        contactForm.reset();
    });
}
