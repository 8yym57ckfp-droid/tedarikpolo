# Safepays V125

Registration validation UX update.

- Registration form uses custom validation instead of browser-native validation popups.
- Invalid Turkish mobile phone numbers get a red field border and inline message: “Geçerli bir telefon numarası girin.”
- Invalid/empty email gets a red field border and inline message: “Geçerli bir e-posta girin.” / “E-posta adresi gerekli.”
- Validation runs on blur and again on submit; typing fixes the highlighted field immediately.
- Existing +90 fixed-prefix / numeric-only phone behavior is preserved.
- Existing registration flow is otherwise unchanged.
