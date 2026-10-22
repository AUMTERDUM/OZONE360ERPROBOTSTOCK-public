// Cloudflare Pages Function — proxies /uploads/* (public robot/ticket media) to the Worker.
// See functions/api/[[path]].ts for why this is a same-origin proxy rather than a direct call.
const API_ORIGIN = 'https://your-api.your-subdomain.workers.dev';

export const onRequest: PagesFunction = async (context) => {
  const url = new URL(context.request.url);
  const target = new URL(url.pathname + url.search, API_ORIGIN);

  const upstream = await fetch(target, {
    method: context.request.method,
    headers: context.request.headers,
    redirect: 'manual',
  });

  return new Response(upstream.body, upstream);
};
