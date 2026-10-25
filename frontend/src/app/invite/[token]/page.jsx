import { redirect } from 'next/navigation';

/**
 * The landing path every WhatsApp invitation points at.
 *
 * A WhatsApp template declares ONE fixed base URL for its button and Meta checks
 * that the delivered link starts with it, so Friends and Family — which have
 * separate landing pages — needed a shared prefix. This page is that prefix: it
 * asks the backend which kind of invitation the token is and forwards to the
 * page that already knows how to render it. Neither of those pages moved, so
 * links sent under the old paths still work exactly as before.
 *
 * Deliberately a SERVER component. The forward happens as a real 307 before
 * anything renders, so the invitee never sees a spinner and never depends on
 * JavaScript running — this link is opened inside WhatsApp's in-app browser,
 * which is the least forgiving place to rely on either.
 */
export const dynamic = 'force-dynamic';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api').replace(/\/$/, '');

const resolveInvite = async (token) => {
    try {
        const res = await fetch(`${API_BASE}/invitations/${encodeURIComponent(token)}/resolve`, {
            // Always ask. An invitation's kind never changes, but caching a 404
            // would strand a link that was resolved a moment before it existed.
            cache: 'no-store',
        });
        if (!res.ok) return null;
        return await res.json();
    } catch (err) {
        // The API is unreachable. Fall through to the friends page, which loads
        // its own preview and will show a proper error — better than a Next.js
        // crash screen for someone who just tapped a link from a friend.
        return null;
    }
};

export default async function InviteLandingPage({ params }) {
    const token = String(params?.token || '');
    const resolved = await resolveInvite(token);
    const kind = resolved?.kind || null;

    // An invitation to someone who already has an account is answered from their
    // account, so the backend names that page. Only site-relative paths are followed.
    if (typeof resolved?.redirect === 'string' && resolved.redirect.startsWith('/') && !resolved.redirect.startsWith('//')) {
        redirect(resolved.redirect);
    }

    // `redirect` throws by design in Next — it must not sit inside a try/catch,
    // which is why the fetch above has its own.
    const pages = {
        family: '/family/invitation/',
        company: '/company/invitation/',
    };
    redirect(`${pages[kind] || '/friends/invitation/'}${encodeURIComponent(token)}`);
}
