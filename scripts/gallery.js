/* ============================================= */
/* === CUSTOMER GALLERY — random 6 fits ========= */
/* ============================================= */
/* Populates any #fs-gallery-grid with 6 random shots from
   images/PNGIMG/gallery/ — real customers & models in FakeSmile wear.
   A fresh random 6 render on every page load. */
(function () {
    const BASE = 'images/PNGIMG/gallery/';
    const GALLERY_IMAGES = [
        'IMG_6412.webp', 'IMG_6413.webp', 'IMG_6414.webp', 'IMG_6416.webp',
        'IMG_6417.webp', 'IMG_6418.webp', 'IMG_6419.webp', 'IMG_6420.webp',
        'IMG_6421.webp', 'IMG_6422.webp', 'IMG_6423.webp', 'IMG_6424.webp',
        'IMG_6425.webp', 'IMG_6426.webp', 'IMG_6427.webp', 'IMG_6428.webp',
        'IMG_6429.webp', 'IMG_6430.webp', 'IMG_6431.webp', 'IMG_6432.webp',
        'IMG_6433.webp', 'IMG_6434.webp', 'IMG_6435.webp', 'IMG_6436.webp',
        'IMG_6437.webp', 'IMG_6438.webp', 'IMG_6439.webp', 'IMG_6440.webp',
        'IMG_6443.webp', 'IMG_6444.webp',
    ];

    const CHECK = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';

    function shuffle(arr) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    function render() {
        const grid = document.getElementById('fs-gallery-grid');
        if (!grid) return;
        const pick = shuffle(GALLERY_IMAGES).slice(0, 6);
        grid.innerHTML = pick.map((f) =>
            '<figure class="fs-gallery-item">' +
                '<img loading="lazy" decoding="async" src="' + BASE + f + '" alt="A FakeSmile customer in their fit">' +
                '<span class="fs-gallery-shine" aria-hidden="true"></span>' +
                '<figcaption class="fs-gallery-cap">' +
                    '<span class="fs-gallery-badge">' + CHECK + ' Real fit</span>' +
                '</figcaption>' +
            '</figure>'
        ).join('');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', render);
    } else {
        render();
    }
})();
