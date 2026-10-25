# Validation — 25 October 2026

- JavaScript syntax checks: passed for client, server and API.
- API integration suite: 3 tests passed, covering the full booking lifecycle, simultaneous reservation conflict, ownership, postcode coverage, availability filters, waiting-list isolation, verification permissions and instructor availability overlap.
- Chromium desktop 1440×1100: search results loaded; onboarding, booking review, confirmation, learner dashboard and cancellation passed.
- Chromium mobile 390×844: availability selection, checkout, booking confirmation, rescheduling, empty-result waiting-list save, admin overview and pending instructor application passed. No horizontal page overflow at either viewport.
- Images and fonts are bundled with the app after browser QA revealed external resources were unavailable in the browser environment.
- Area view is explicitly illustrative; real geocoding is not implemented.
- Hosted private deployment: succeeded at https://lane-driving-west-midlands.honestjay9.chatgpt.site. Owner-only access preserved. Hosted homepage and search API passed; live D1 contains all six schema tables and returned four matching demo instructors for B1 1AA. Service access correctly supplies no learner identity. Interactive authenticated flows were browser-tested locally; the hosted visitor sign-in flow was not browser-tested. The local dev identity is not included in the deployed Worker.
