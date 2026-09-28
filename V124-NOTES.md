# V124 — Unified Member Bottom Navigation

- Standardized the mobile bottom navigation across all member pages that contain the five-item navigation.
- Same 5-column grid, 72px height, icon size, label size, spacing, radius, position, and active color.
- Added a final shared stylesheet loaded after page-specific CSS so finance/dashboard/support page rules cannot resize the navigation independently.
- Kept the active page blue while inactive items use the same muted color.
- Added a compact breakpoint only for very narrow screens without changing the normal mobile dimensions.
