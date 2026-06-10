// Serves the static site from the ASSETS binding and forces HTTPS, so a
// browser never shows "Not secure" for an http:// visit. Runs before assets
// (run_worker_first) purely to catch the redirect; everything else is handed
// straight to the static-asset server.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.protocol === 'http:') {
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }
    return env.ASSETS.fetch(request);
  },
};
