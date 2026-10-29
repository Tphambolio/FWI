# Pyra — Privacy

*Source text for `privacy/index.html` (the page every footer's "Privacy" link opens). Keep the two in step.*

Pyra is a static website. There are no accounts, no logins, no cookies, no advertising, no fingerprinting, and nothing about you is sold or shared.

## What stays on your device

Your browser keeps a few settings so the app opens the way you left it: the station you chose, your fuel types, grass curing and PS%, the alarm threshold, the last FWI chain Pyra computed for a station (the "holding cache" that fills in when CWFIS is late), and — if you tap it — your last "Was this useful today?" rating. These live in the browser's local storage on your device. They are never sent to Pyra.

If you install Pyra (or just open it), the browser's service worker also keeps a copy of the pages and of the last data it fetched, so the last briefing you saw opens again with no signal. The page then shows an amber strip: "Offline — showing data cached at <time>". Clearing the site's data in your browser removes all of this.

## What leaves your device

**Weather data requests.** To show fire weather, the page fetches data straight from the public services — NRCan CWFIS, ECCC MSC (SWOB), Open-Meteo, Alberta Wildfire's mirror, BCWS data in this repo, and Esri map tiles. Those requests carry the coordinates of the station or map point you are looking at (that is how weather is fetched) and, like any web request, the services see your IP address and browser type. Pyra adds no identifier of its own. Each service has its own privacy terms.

**Location.** The station page may ask your browser for your location to pick the nearest station. The answer is used in the page only, to choose a station; it is not stored or sent to Pyra.

**Usage counting.** `config/telemetry.js` sets one of three modes:

- `none` — nothing is sent.
- `cloudflare` — the page loads Cloudflare Web Analytics, a cookieless counter that records page views and page-speed metrics without cookies, fingerprinting or personal data. This is the mode currently in use.
- `post` — once per page view the browser sends one small record to an endpoint run for Pyra, containing exactly: the page id (for example `ab/station`), province, app version, whether Pyra is running as an installed app, a coarse viewport class (`phone` / `desktop`), the record type, and a random session id that lives only in the tab's session storage and vanishes when the tab closes. Never the station you chose, never coordinates, never anything you typed.

**Feedback.** The "Feedback" button offers a 1–5 rating and a text box. The rating is sent only in `post` mode (same fields as above plus the rating); otherwise it is just noted on your device. "Open a GitHub issue" and "Email" open a new tab or your mail app with the page, version, province and your text prefilled — nothing is posted until you send it there yourself, and your station or location is only included if you type it.

## Third parties the pages load

Tailwind CSS (cdn.tailwindcss.com), Leaflet and plugins (cdn.jsdelivr.net), Google Fonts, Esri ArcGIS tiles, and — in `cloudflare` mode — Cloudflare Web Analytics. The PayPal donate button only contacts PayPal when you press it.

## Questions

Open an issue at https://github.com/Tphambolio/FWI/issues or message [@lactucafarm](https://x.com/lactucafarm).

*Last updated 2026-10-25.*
