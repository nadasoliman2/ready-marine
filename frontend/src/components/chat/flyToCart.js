/*
 * The add-to-cart flight: a copy of the product photo lifts off the card,
 * arcs across the screen and drops into the cart, which catches it with a
 * squash-and-bounce. Web Animations API only — the site has no animation
 * library, and this keeps it that way.
 *
 * Targets are marked in the markup: `[data-cart-target]` on the header cart
 * and `[data-chat-basket-target]` on the chat's own basket. The header cart is
 * used when it is on screen and not covered by the chat panel; otherwise the
 * chat basket catches it (phones, where the panel is full screen).
 */

const reducedMotion = () =>
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) return false;
    // Covered by something else (the full-screen chat panel on a phone)?
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !hit || el === hit || el.contains(hit);
};

function pickTargets() {
    const header = [...document.querySelectorAll('[data-cart-target]')].find(visible);
    const basket = [...document.querySelectorAll('[data-chat-basket-target]')].find(visible);
    return [header, basket].filter(Boolean);
}

export function bump(el) {
    if (!el?.animate || reducedMotion()) return;
    el.animate(
        [
            { transform: 'scale(1) rotate(0)' },
            { transform: 'translateY(3px) scale(1.22, .82) rotate(-8deg)', offset: 0.25 },
            { transform: 'translateY(-4px) scale(.9, 1.14) rotate(6deg)', offset: 0.5 },
            { transform: 'translateY(1px) scale(1.06, .96) rotate(-3deg)', offset: 0.75 },
            { transform: 'scale(1) rotate(0)' },
        ],
        { duration: 650, easing: 'ease-out' }
    );
}

/* A burst of sparks where the product lands. */
function sparks(x, y) {
    for (let i = 0; i < 8; i += 1) {
        const s = document.createElement('span');
        s.setAttribute('aria-hidden', 'true');
        Object.assign(s.style, {
            position: 'fixed', left: `${x - 2}px`, top: `${y - 4}px`, width: '4px', height: '8px', borderRadius: '3px',
            background: i % 2 ? '#00A6CE' : '#f97316', zIndex: 9999, pointerEvents: 'none',
        });
        document.body.appendChild(s);
        const angle = (i * 45 * Math.PI) / 180;
        const a = s.animate(
            [
                { transform: `rotate(${i * 45}deg) translateY(-6px) scale(.5)`, opacity: 0 },
                { opacity: 1, offset: 0.2 },
                { transform: `translate(${Math.sin(angle) * 34}px, ${-Math.cos(angle) * 34}px) rotate(${i * 45}deg) scale(0)`, opacity: 0 },
            ],
            { duration: 560, easing: 'cubic-bezier(.2,.7,.3,1)' }
        );
        a.onfinish = () => s.remove();
    }
}

/**
 * Fly `imageUrl` from `fromEl` (the card's photo) to the cart. `qty` rides on a
 * little badge. Resolves when the flight lands; never throws.
 */
export function flyToCart({ fromEl, imageUrl, qty = 1, delay = 0 }) {
    return new Promise((resolve) => {
        try {
            const targets = pickTargets();
            if (!fromEl || !targets.length || reducedMotion() || !document.body.animate) {
                targets.forEach(bump);
                resolve();
                return;
            }
            const from = fromEl.getBoundingClientRect();
            const size = Math.max(44, Math.min(84, from.width * 0.7));

            targets.forEach((target, index) => {
                const to = target.getBoundingClientRect();
                const ghost = document.createElement('div');
                ghost.setAttribute('aria-hidden', 'true');
                Object.assign(ghost.style, {
                    position: 'fixed',
                    left: `${from.left + from.width / 2 - size / 2}px`,
                    top: `${from.top + from.height / 2 - size / 2}px`,
                    width: `${size}px`,
                    height: `${size}px`,
                    borderRadius: '18px',
                    background: '#fff',
                    boxShadow: '0 14px 34px rgba(0,166,206,.28), 0 2px 6px rgba(0,0,0,.12)',
                    border: '2px solid #fff',
                    zIndex: 9999,
                    pointerEvents: 'none',
                    overflow: 'visible',
                });
                if (imageUrl) {
                    const img = document.createElement('img');
                    img.src = imageUrl;
                    img.alt = '';
                    Object.assign(img.style, { width: '100%', height: '100%', objectFit: 'contain', borderRadius: '16px', padding: '4px', background: '#fff' });
                    ghost.appendChild(img);
                }
                const badge = document.createElement('span');
                badge.textContent = `+${qty}`;
                Object.assign(badge.style, {
                    position: 'absolute', top: '-8px', insetInlineEnd: '-8px', minWidth: '22px', height: '22px', padding: '0 5px',
                    borderRadius: '999px', background: '#00A6CE', color: '#fff', font: '700 11px/18px system-ui, sans-serif',
                    textAlign: 'center', border: '2px solid #fff', direction: 'ltr',
                });
                ghost.appendChild(badge);
                document.body.appendChild(ghost);

                const dx = to.left + to.width / 2 - (from.left + from.width / 2);
                const dy = to.top + to.height / 2 - (from.top + from.height / 2);
                // Lift up first, then arc down into the cart.
                const lift = Math.min(140, Math.abs(dy) * 0.45 + 60);
                const flight = ghost.animate(
                    [
                        { transform: 'translate(0, 0) scale(.6) rotate(0)', opacity: 0 },
                        { transform: 'translate(0, -18px) scale(1.08) rotate(-6deg)', opacity: 1, offset: 0.14 },
                        { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - lift}px) scale(.85) rotate(8deg)`, opacity: 1, offset: 0.55 },
                        { transform: `translate(${dx}px, ${dy}px) scale(.18) rotate(0)`, opacity: 0.9, offset: 0.94 },
                        { transform: `translate(${dx}px, ${dy + 4}px) scale(.05)`, opacity: 0 },
                    ],
                    { duration: 1000, delay: delay + index * 90, easing: 'cubic-bezier(.45,0,.25,1)', fill: 'both' }
                );
                flight.onfinish = () => {
                    ghost.remove();
                    bump(target);
                    sparks(to.left + to.width / 2, to.top + to.height / 2);
                    if (index === targets.length - 1) resolve();
                };
            });
        } catch {
            resolve();
        }
    });
}
