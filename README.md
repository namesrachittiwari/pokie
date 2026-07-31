# Pokie

A fully autonomous job finding and applying agent — it hunts, you decide.

Live at **https://pokie.rachittiwari.com** (GitHub Pages, `gh-pages` branch).

This is the real app, not a prototype: every screen renders from the live API
at `https://api.rachittiwari.com`, and every control is bound to an endpoint.
There is no sample data to fall back to — a failed call says so in place.

`app.js` is copied verbatim from `jobhunt-backend/frontend/pokie/app.js`, which
is also served at `https://api.rachittiwari.com/app/`. The same file works in
both places: it uses relative paths when served by the API host and names the
API host when served from anywhere else. Edit it there, then copy it here —
never edit this copy directly, or the two drift apart.

Because this copy is cross-origin to the API, `https://pokie.rachittiwari.com`
must stay on the backend's CORS allow-list (`src/api/app.py`), or the browser
refuses every call at preflight and the page renders empty.
