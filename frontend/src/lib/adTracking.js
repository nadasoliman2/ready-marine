'use client';

import { useEffect, useRef } from 'react';
import { stripLocale } from './locale';

/**
 * Client side of the ad analytics: what a visitor saw and did with an ad.
 *
 * Three events, all sent to POST /api/ads/events in small batches:
 *   impression — the ad was actually on screen (half of it, for a moment), once per ad,
 *                slot and page view;
 *   click      — the visitor followed the ad;
 *   action     — something the visitor then did where the ad led (WhatsApp, call, add to
 *                cart, order…), attributed to the last ad they clicked for that subject.
 *
 * The visitor is identified by a random id kept in localStorage, never by anything
 * personal: it exists so "how many people" can be told apart from "how many renders".
 * Sending is fire-and-forget; nothing here can throw into the page.
 */

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
const VIEWER_KEY = 'rc_viewer_id';
const ATTRIBUTION_KEY = 'rc_ad_attribution';
const ATTRIBUTION_TTL_MS = 6 * 60 * 60 * 1000; // a click stays "the reason" for six hours
const FLUSH_DELAY_MS = 1500;

const isBrowser = () => typeof window !== 'undefined';

export function getViewerId() {
  if (!isBrowser()) return '';
  try {
    let id = localStorage.getItem(VIEWER_KEY);
    if (!id) {
      id = (crypto?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`);
      localStorage.setItem(VIEWER_KEY, id);
    }
    return id;
  } catch {
    return '';
  }
}

let queue = [];
let timer = null;
const seenImpressions = new Set();

const currentPage = () => (isBrowser() ? stripLocale(window.location.pathname) : '');

function flush() {
  if (!isBrowser() || !queue.length) return;
  const events = queue;
  queue = [];
  timer = null;
  const body = JSON.stringify({ events, viewer_id: getViewerId(), referrer: document.referrer || '' });
  try {
    fetch(`${BASE_URL}/ads/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* telemetry only */
  }
}

function enqueue(event) {
  if (!isBrowser() || !event?.ad_id) return;
  queue.push(event);
  if (queue.length >= 20) flush();
  else if (!timer) timer = setTimeout(flush, FLUSH_DELAY_MS);
}

if (isBrowser()) {
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
}

const adIdOf = (ad) => (typeof ad === 'string' ? ad : ad?.ad_id || ad?._id || '');

/** The ad was on screen. Once per ad, slot and page view. */
export function trackAdImpression(ad, { placement = '' } = {}) {
  const ad_id = adIdOf(ad);
  if (!ad_id) return;
  const key = `${ad_id}|${placement}|${currentPage()}`;
  if (seenImpressions.has(key)) return;
  seenImpressions.add(key);
  enqueue({ ad_id, event: 'impression', placement, page: currentPage() });
}

const asList = (v) => (Array.isArray(v) ? v : [v]).map((s) => String(s || '')).filter(Boolean);

/**
 * The visitor followed the ad. Also remembers it so later actions can be attributed.
 * `subjects` are the keys the destination page will identify itself by — a product id,
 * a store username, and the path itself — any of them lets the page find this click.
 */
export function trackAdClick(ad, { placement = '', target = '', subjects = [] } = {}) {
  const ad_id = adIdOf(ad);
  if (!ad_id) return;
  enqueue({ ad_id, event: 'click', action: 'open', placement, page: currentPage(), target });
  rememberAttribution(ad_id, [...asList(subjects), target], placement);
  flush();
}

/**
 * Something happened where an ad led (WhatsApp tap, add to cart, order…).
 * With `adId` the action belongs to that ad outright (the button sat on the ad itself).
 * Otherwise it is recorded only when a recent click on an ad for one of `subjects`
 * exists — nothing is invented.
 */
export function trackAdAction(action, subjects, { target = '', adId = '', placement = '' } = {}) {
  if (adId) {
    enqueue({ ad_id: adId, event: 'action', action, placement, page: currentPage(), target });
    return;
  }
  const attribution = readAttribution(subjects);
  if (!attribution) return;
  enqueue({ ad_id: attribution.ad_id, event: 'action', action, placement: attribution.placement || '', page: currentPage(), target });
}

function rememberAttribution(ad_id, subjects, placement) {
  const keys = asList(subjects);
  if (!isBrowser() || !keys.length) return;
  try {
    const all = JSON.parse(sessionStorage.getItem(ATTRIBUTION_KEY) || '{}');
    for (const key of keys) all[key] = { ad_id, placement, at: Date.now() };
    sessionStorage.setItem(ATTRIBUTION_KEY, JSON.stringify(all));
  } catch { /* storage unavailable */ }
}

function readAttribution(subjects) {
  const keys = asList(subjects);
  if (!isBrowser() || !keys.length) return null;
  try {
    const all = JSON.parse(sessionStorage.getItem(ATTRIBUTION_KEY) || '{}');
    for (const key of keys) {
      const hit = all[key];
      if (hit && Date.now() - hit.at <= ATTRIBUTION_TTL_MS) return hit;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Hook: report an impression once the element is actually visible.
 * `ad` may be an id or an object carrying `ad_id` / `_id`; nothing happens when it is empty.
 *
 *   const ref = useAdImpression(ad, { placement: 'home_banner' });
 *   <div ref={ref}>…</div>
 */
export function useAdImpression(ad, { placement = '', enabled = true } = {}) {
  const ref = useRef(null);
  const adId = adIdOf(ad);

  useEffect(() => {
    if (!enabled || !adId || !ref.current || !isBrowser()) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      trackAdImpression(adId, { placement });
      return undefined;
    }
    let fired = false;
    let visibleSince = 0;
    let waiting = null;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
          if (!visibleSince) visibleSince = Date.now();
          if (!waiting) {
            waiting = setTimeout(() => {
              if (!fired) { fired = true; trackAdImpression(adId, { placement }); observer.disconnect(); }
            }, 500);
          }
        } else {
          visibleSince = 0;
          if (waiting) { clearTimeout(waiting); waiting = null; }
        }
      }
    }, { threshold: [0.5] });
    observer.observe(ref.current);
    return () => { observer.disconnect(); if (waiting) clearTimeout(waiting); };
  }, [adId, placement, enabled]);

  return ref;
}
