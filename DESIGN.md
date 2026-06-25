# Design

## Visual Theme
A premium, dark-dominant academic aesthetic. Dark backgrounds contrast with off-white typography and subtle gold and deep crimson accents, projecting reliability, focus, and intelligence.

## Color Palette
The colors are managed using CSS custom properties:
- **Dark Backgrounds**:
  - `--color-dark` / `--primary-bg`: `#0A0908` / `#121212` (Ink / Deep Charcoal)
  - `--secondary-bg`: `#1a1a1a`
  - `--card-bg`: `#1e1e1e`
- **Typographic Ink**:
  - `--color-offwhite` / `--text-primary`: `#F5F1EC` / `#ffffff`
  - `--text-secondary`: `#b0b0b0`
  - `--text-muted`: `#8c8c8c`
- **Gold Accent (Trust & Excellence)**:
  - `--color-gold`: `#B4AB8B`
  - `--color-gold-soft`: `#C9C0A0`
  - `--color-gold-deep`: `#8E866B`
  - `--accent-soft`: `rgb(180 171 139 / 10%)`
- **Crimson Accent (Action & Alert)**:
  - `--color-crimson`: `#6D001A`
  - `--color-crimson-soft`: `#9B0827`
  - `--color-crimson-glow`: `#FF1744`

## Typography

### Font Families
- **Display Typeface**: `'Cabinet Grotesk'`, `sans-serif` — Used for display titles, section headings (H1, H2, H3), and hero copy.
- **Body Typeface**: `'General Sans'`, `-apple-system`, `BlinkMacSystemFont`, `'Segoe UI'`, `sans-serif` — Used for body copy, buttons, tooltips, and labels.
- **Monospace Typeface**: `'JetBrains Mono'`, `ui-monospace`, `SFMono-Regular`, `monospace` — Used for technical pipelines, code blocks, and data grids.

### Type Scale (1.333 Modular Scale)
- **xs**: `0.75rem` (12px) — Captions, legal text, tiny labels.
- **sm**: `0.875rem` (14px) — Secondary copy, support metadata, secondary buttons.
- **base**: `1rem` (16px) — Body prose, default inputs, main actions.
- **md (H3)**: `1.333rem` (21px) — Grid headers, section subtitles.
- **lg (H2)**: `1.777rem` (28px) — Section headings, subheadings.
- **xl (H1)**: `2.369rem` (38px) — Hero headlines, main title.

### Spacing & Layout
A 4px baseline grid guides all margins and padding:
- `--space-1`: `4px`
- `--space-2`: `8px`
- `--space-3`: `12px`
- `--space-4`: `16px`
- `--space-5`: `24px`
- `--space-6`: `32px`
- `--space-7`: `48px`
- `--space-8`: `64px`

Paragraph text container width is capped at `max-width: 65ch` or `75ch` to guarantee comfortable readability.
