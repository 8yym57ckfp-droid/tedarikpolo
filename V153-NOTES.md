# V153 — Content Center Event Tab Fix
- Fixed the Haber / Görsel Blog and Etkinlik tab buttons on mobile/iOS.
- Explicitly set button type="button" to prevent form/default-button behavior.
- Uses addEventListener with preventDefault/stopPropagation for reliable tab switching.
- Added defensive z-index/pointer-events/touch-action rules for the tabs.
- Preserves V152 carousel and all previous fixes.
