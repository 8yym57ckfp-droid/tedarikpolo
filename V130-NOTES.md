# Safepays V130

- Owner/Content Center `safepays_content_v58` remains the single browser-side content source.
- Member dashboard news/event carousel is now generated from published owner content instead of hard-coded cards.
- Latest published content is shown first; up to 3 cards are rendered.
- Published content with an image uses the uploaded image in the member carousel.
- Member Events page already reads the same content key and remains compatible.
- Storage events refresh the member dashboard when owner content changes in another tab on the same origin.
- Custom `safepays-news-rendered` event reinitializes the carousel after dynamic content rendering.
- Important deployment limitation: this static Netlify demo uses browser localStorage. Content created in one browser/device is not a shared server database and therefore will not automatically appear on a different device/browser. Production cross-device publishing requires a backend/Netlify Function + persistent store.
