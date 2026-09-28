# V149 — Events data cleanup

- Migrates content storage from v58 to v59 and removes malformed legacy entries.
- Filters placeholder-only titles/excerpts and emoji-only titles.
- Removes seed/demo content from the user-facing events page.
- Image-less cards no longer render a large empty blue media area.
- Existing valid user-created content is preserved during migration.
