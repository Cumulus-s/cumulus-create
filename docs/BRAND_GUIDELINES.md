# Cumulus Marketing Site — Brand Guidelines

**Inherits from the Cumulus master brand spec v1.0.
The master spec wins on any disagreement.** When this file and the
master disagree, fix this file. Anything below is either a restatement
of the master to make it discoverable from the site repo, or a
documented site-specific deviation.

This site is the most decorated of the three Cumulus surfaces (Tado,
Relay, this marketing site). It carries the most legacy code; the
v1.0 alignment pass rewired the foundation (color tokens, type system,
glass utilities, button radius, brand mark) without rewriting every
consumer component. Expect to find legacy `glass-*` classes still
sprinkled across `src/components/`; the underlying CSS now collapses
them to the EditorialCard treatment.

---

## Foundation (from the master spec)

The brand is **monochrome ink-on-paper plus a single chromatic moment**.

- `--color-ink: #1A1A1A` — the deep cool ground
- `--color-paper: #F5F5F5` — the bright lifted form
- `--color-terracotta: #A44718` — the single accent (≤10% of any composition)

Transparency tiers (ink scale on a paper ground; paper scale on an ink
ground) live in `src/app/globals.css` as `--color-ink-2`/`-3`/`-4`/
`-5`/`-hair`/`-hair-soft`/`-wash` and the matching `--color-paper-*`
set. **Never** use raw hex outside of `globals.css`; reach for the
tokens.

### Terracotta usage

- Reserved for: focus rings, the **single primary CTA per page**, the
  live status dot, the brand mark dot, destructive-confirmation accent.
- **Never** a hero fill, a wash, a gradient, a card background.

### Mode primacy

This site defaults to **ink-first (dark)**. Light mode is wired through
`[data-theme="light"]` in `globals.css` and must remain first-class.

---

## Typography

Exactly **two font families load**:

- **Plus Jakarta Sans** (`--font-display`) — the only readable typeface.
  Self-hosted via `next/font`. Weights 200–800. **No italics.**
- **JetBrains Mono** (`--font-mono`) — the data partner. Used only for
  kickers, mono meta, code, keyboard hints, brand-mark tracking lines.
  Weights 400/500/600. No italics.

**Drafting Mono** and **Manrope** are retired — do not reintroduce.
(The legacy `/public/DraftingMono*.ttf` files remain on disk pending
a separate cleanup pass; they are not loaded.)

### Type scale (unified)

`src/lib/brand/tokens.ts → CUMULUS.type` exposes the master scale
(`text9`, `text10`, `text11`, `text12`, `text13`, `text14`, `text18`,
`text22`, `text40`, `text56`, `text60`, `text72`). Legacy keys (`h1`,
`h2`, `h3`, `h4`, `body`, `display`, `displayXl`, `micro`, `label`,
`mono`, `monoLg`, `caption`, `bodyLg`) are aliases that map onto the
unified entries — they keep existing consumers compiling and should
be retired component-by-component.

`clamp()`-based font sizing is deprecated. Use the unified scale.

---

## The one component — the 5.5px Editorial Card

> **A 5.5px-radius rectangle with a 1px hairline border, no shadow,
> holding a typographic composition.**

The site primitive is `src/components/ui/editorial-card.tsx`
(`EditorialCard`). Use it for new surfaces. Geometry:

```
border-radius: 5.5px      // = var(--radius-card)
border: 1px solid var(--hairline)
background: var(--bg)
box-shadow: none
```

### Derived shapes

- **Buttons** — `src/components/ui/button.tsx` (5.5px radius across all
  variants, including the `brand` variant which used to be a pill).
- **Inputs / textareas / selects** — 5.5px radius via the migrated
  `rounded-[5.5px]` classes.
- **Pills / badges** — also 5.5px. No chamfer, no pill shape.
- **Modals / sheets** — the only place the master shadow
  `--shadow-modal` (`0 18px 40px rgba(26, 26, 26, 0.18)`) is allowed.

### Exceptions — `rounded-full` only on true circles

`rounded-full` survives only on small elements ≤8px square: the 6×6
status dot, the 6×6 brand-mark dot, true avatars, dot indicators. The
old footer-link pill capsules and the old `brand` button pill are
gone.

---

## Section grammar (unchanged)

Every marketing section keeps the editorial grammar intact:

```
Eyebrow  ── tiny mono caps with explicit tracking
Headline ── Plus Jakarta Sans Light, breathing
Lead     ── one sentence, sub-color
CTA      ── single primary per page, ghost everything else
```

The **Eyebrow → Headline → Lead → CTA** order is the brand rhythm.
Do not invert it.

---

## Section: Pricing page

The pricing page (`src/app/(marketing)/models/`) has its own grammar
(plan card, price emphasis, feature list, CTA) but **must conform**
to the master spec on every visual primitive: 5.5px radius on the
plan card, hairline border, no shadow, terracotta only on the single
primary CTA per plan, mono kickers, Plus Jakarta Sans display
numerals.

If a pricing page rule conflicts with the master spec, fix the
pricing page. There are no plan-card-specific exceptions.

---

## Site-specific deviations (allowed)

Per the master spec's "deviations" rule, the marketing site declares:

- **Three.js voxel scenes** (`HomeVoxelScene`, `VoxelBackground`,
  `home-oil-landscape`) — retired in v1.0 alignment but **kept on
  disk**. Each mount site is commented with
  `// brand-alignment: voxel scene retired per CUMULUS-BRAND.md;
  restore by uncommenting if needed`. The components themselves are
  not deleted; you can restore by uncommenting the import + JSX.

- **Glass-* CSS class consumers** — components that still emit
  `class="glass-surface glass-standard glass-e3"` are not yet
  rewritten. The CSS collapses every variant to the EditorialCard
  treatment, so the visuals match the master spec; the call-site
  rewrite is a separate pass.

- **`/public/DraftingMono*.ttf`** — kept pending a separate cleanup;
  the font is not loaded.

---

## Implementation notes

- **Tokens**: import from `@/lib/brand/tokens` (the typed `CUMULUS`
  object + `ct()` helper). New code should reach for the unified
  `text9`–`text72` keys; legacy aliases are deprecated but compiling.
- **CSS variables**: `--color-ink`, `--color-paper`,
  `--color-terracotta`, the `--color-ink-*` and `--color-paper-*`
  scales, plus the legacy aliases (`--bg`, `--fg`, `--title`,
  `--text`, `--subtitle`, `--muted`, `--hairline`, `--accent`)
  pointing at the foundation.
- **Tailwind v4**: config lives in `globals.css` via `@theme inline`;
  there is no `tailwind.config.js`.
- **Brand mark** (`6×6` terracotta dot + JetBrains Mono caps lockup):
  the canonical implementation is in `src/components/site/header.tsx`
  and `src/components/site/footer.tsx`. Match that pattern when you
  add the mark to a new surface.

---

## Don'ts

- No decorative color beyond terracotta at ≤10%.
- No second sans. No third font.
- No radius ≠ 5.5px except the 6×6 status dot (`999px`).
- No shadows on cards. Only the palette modal casts the master
  `--shadow-modal`.
- No glass morphism. No `backdrop-filter`. No specular borders.
- No gradients.
- No `text-transform: uppercase` without an explicit
  `letter-spacing`.

---

## Version history

- **v2.0** (2026-04-29) — Master Cumulus brand alignment pass.
  Foundation rewired to ink/paper/terracotta with documented
  transparency tiers. Plus Jakarta Sans + JetBrains Mono load
  exclusively. Glass utility CSS collapsed to the EditorialCard
  treatment. All `rounded-xl|2xl|3xl|[Nrem]` swept to
  `rounded-[5.5px]`. Button `brand` variant is no longer a pill.
  EditorialCard primitive added. Brand mark (6×6 terracotta dot +
  mono caps lockup) added to header and footer. Voxel scenes
  retired (commented out, not deleted).
- **v1.6** (2025-12-15) — Typography hierarchy update.
- **v1.5** (2025-12-06) — Body text on brand colors.
- **v1.4** (2025-12-06) — Drafting Mono adoption.
- **v1.3** (2025-12-06) — Cloud Dancer / Inverse Cloud Dancer palette.
- **v1.2** (2026-01-01) — Palette + typography + CTA refresh.
- **v1.1** (2025-10-04) — Verified for restructured repo.
- **v1.0** (2025-10-03) — Initial brand guidelines.
