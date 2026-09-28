# V122

- Fixed member mobile bottom navigation disappearing on the Yatır / Çek page.
- Root cause: `assets/finance.css` contained `.mobile-nav{display:none}`, overriding the shared mobile navigation rules.
- Removed the conflicting hide rule and added a scoped responsive mobile-nav layout for finance.html.
- Added extra bottom padding so the fixed navigation does not cover page content.
