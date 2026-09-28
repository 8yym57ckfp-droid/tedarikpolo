# V131 — Owner image persistence/render fix

- Owner content images are resized/compressed before localStorage persistence to avoid quota/large-data failures.
- Dashboard member carousel now renders published images with a real `<img>` layer instead of only CSS background-image.
- Events page uses the same explicit image rendering.
- Invalid/unsupported image decoding gets a clear message.
- Image payload target is kept below ~420KB for static demo compatibility.
