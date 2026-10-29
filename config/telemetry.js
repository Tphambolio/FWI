/**
 * Pyra usage counting + feedback configuration — the only file to edit.
 * Loaded by every page before core/telemetry.js. docs/privacy.md and
 * privacy/index.html tell users what each setting means.
 *
 * provider:
 *   'none'        Nothing is sent anywhere.
 *   'cloudflare'  Cloudflare Web Analytics: loads their cookieless beacon
 *                 (static.cloudflareinsights.com/beacon.min.js) with `token`.
 *                 No cookies, no fingerprinting, no personal data; Cloudflare
 *                 counts page views and Web Vitals. Pyra sends nothing of its own.
 *   'post'        One navigator.sendBeacon() per page view to `endpoint`
 *                 (e.g. a Cloudflare Worker / Fly endpoint you run). Body =
 *                 JSON, Content-Type text/plain (no CORS preflight). Fields and
 *                 only these: type, page, province, version, installed,
 *                 viewport, session (+ rating for the feedback row). Never a
 *                 station, coordinates or anything typed by the user.
 *
 * endpoint:      absolute URL for provider 'post'. Empty = nothing sent.
 * token:         Cloudflare Web Analytics site token for provider 'cloudflare'.
 * feedbackEmail: address for the feedback panel's "Email" option. Empty hides it.
 *
 * The site has carried the Cloudflare beacon on its main pages since launch;
 * it now lives here. Set provider to 'none' to switch all counting off.
 */
window.PYRA_TELEMETRY = {
  provider: 'cloudflare',
  endpoint: '',
  token: '0baf6e1d2ac84db0be3fa0e961d4c4b9',
  feedbackEmail: '',
};
