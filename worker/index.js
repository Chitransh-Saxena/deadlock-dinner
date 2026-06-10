// Serves the static site from the ASSETS binding and forces HTTPS, so a
// browser never shows "Not secure" for an http:// visit. Runs before assets
// (run_worker_first) purely to catch the redirect; everything else is handed
// straight to the static-asset server.
//
// We only redirect when the request genuinely arrived at Cloudflare's edge over
// http — detected via the edge-only `cf-visitor` / `cf-ray` headers. Under
// `wrangler dev` those headers are absent (and wrangler even serves the request
// under the production hostname), so local preview over http://localhost is left
// alone instead of being bounced to an https port that nothing is listening on.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const onEdge = request.headers.has('cf-ray');
    let visitorScheme = null;
    try { visitorScheme = JSON.parse(request.headers.get('cf-visitor') || '{}').scheme; } catch { /* no-op */ }
    const cameOverHttp = visitorScheme === 'http' || (onEdge && url.protocol === 'http:');

    if (cameOverHttp) {
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }
    return env.ASSETS.fetch(request);
  },
};
