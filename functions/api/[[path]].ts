// Cloudflare Pages Function — proxies /api/* to the Worker backend.
//
// Why a proxy instead of pointing the frontend straight at the Worker's own
// *.workers.dev URL: the app's CSRF/session cookies are set with
// `SameSite=Strict`, which browsers refuse to send on any cross-site request —
// and pages.dev and workers.dev are different sites. Proxying through a Pages
// Function keeps every request same-origin (still pages.dev from the browser's
// point of view), so the existing cookie scheme works unmodified. This also
// means no CORS configuration is needed for this path — the Worker call below
// is a server-to-server fetch, not a browser one.
const API_ORIGIN = 'https://your-api.your-subdomain.workers.dev';

export const onRequest: PagesFunction = async (context) => {
  const url = new URL(context.request.url);
  const target = new URL(url.pathname + url.search, API_ORIGIN);

  const headers = new Headers(context.request.headers);
  // Preserve the visitor's real IP for the Worker's rate limiter — a fetch()
  // subrequest to another zone otherwise arrives as the Pages edge's own IP.
  const visitorIp = context.request.headers.get('CF-Connecting-IP');
  if (visitorIp) headers.set('CF-Connecting-IP', visitorIp);

  const upstream = await fetch(target, {
    method: context.request.method,
    headers,
    body: ['GET', 'HEAD'].includes(context.request.method) ? undefined : context.request.body,
    redirect: 'manual',
  });

  return new Response(upstream.body, upstream);
};
