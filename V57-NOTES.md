# V57

Admin panel navigation duplicate fix.

- Canonical single sidebar/navigation is rebuilt once on load.
- Any duplicate `.admin-side` elements from stale/cached deployments are removed.
- Existing navigation entries are replaced with one canonical set.
- Keeps mobile hamburger behavior and active-page highlighting.
