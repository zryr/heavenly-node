## 2026-09-26 - Modal Accessibility & Keyboard UX
**Learning:** Modal dialogs without `role="dialog"`, `aria-modal="true"`, and proper focus management (`Escape` key handling + returning focus to trigger element) are inaccessible to keyboard and screen reader users.
**Action:** Always add ARIA modal attributes, auto-focus close/primary controls on open, handle `Escape` key listeners, and restore focus to trigger buttons on close.
