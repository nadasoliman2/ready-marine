import Script from 'next/script';

// Marketing tracking tags (per Ready Marine Website Tracking & Verification handoff).
// Loaded via next/script so each tag runs exactly once. Meta Pixel initialization
// lives here, while AnalyticsRouteTracker is the single owner of PageView events.
// IDs are fixed by the marketing team — do not edit, replace, or regenerate them.

const GA4_MEASUREMENT_ID = 'G-JKVVPVS38W'; // replaced G-253NTEC163 on 2026-10-15 (owner request)
const META_PIXEL_ID = '1447711580456108';
const CLARITY_PROJECT_ID = 'xf62eh7pq5';

export default function AnalyticsHead() {
  return (
    <>
      {/* Google Analytics 4 (gtag.js) */}
      <Script
        id="ga4-src"
        strategy="afterInteractive"
        src={`https://www.googletagmanager.com/gtag/js?id=${GA4_MEASUREMENT_ID}`}
      />
      <Script id="ga4-init" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA4_MEASUREMENT_ID}');`}
      </Script>

      {/* Microsoft Clarity */}
      <Script id="ms-clarity" strategy="afterInteractive">
        {`(function(c,l,a,r,i,t,y){
          c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
          t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
          y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
        })(window, document, "clarity", "script", "${CLARITY_PROJECT_ID}");`}
      </Script>

      {/* Meta Pixel */}
      <Script id="meta-pixel" strategy="afterInteractive">
        {`!function(f,b,e,v,n,t,s)
        {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
        n.callMethod.apply(n,arguments):n.queue.push(arguments)};
        if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
        n.queue=[];t=b.createElement(e);t.async=!0;
        t.src=v;s=b.getElementsByTagName(e)[0];
        s.parentNode.insertBefore(t,s)}(window, document,'script',
        'https://connect.facebook.net/en_US/fbevents.js');
        fbq('init', '${META_PIXEL_ID}');
        window.dispatchEvent(new Event('readycar:meta-pixel-ready'));`}
      </Script>
    </>
  );
}
