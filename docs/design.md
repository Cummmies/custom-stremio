# Design language

How this app looks and behaves, so every new screen and every change feels like the same app.
Built on Apple's Human Interface Guidelines (iOS, tvOS, macOS), with a look of its own.

## The idea: glass over artwork

The art is the content. Everything else is **dark, frosted glass** floating over it, so the
pictures stay in front and the controls recede. You know the app by three things, used everywhere:

1. **Full-bleed artwork** with a dark scrim, so text over it always reads (the Home banner, title pages).
2. **Frosted glass chrome**: the nav pill, menus, popovers, sheets and toolbars are translucent,
   blurred, with a hairline border (`--glass`, `--glass-blur`, `--glass-border`, `--shadow-l`).
3. **The sliding square highlight**: every choice between a few options (the nav, filters,
   views) sits on a raised square that glides between them, can be dragged, and recolors only the
   part of a label it covers (`lib/slider.ts`; `Segmented.svelte`, `TopNav.svelte`).

One accent, violet (`--accent`), used sparingly: the chosen state, the one primary action, links.

## Tokens (`src/lib/styles/tokens.css`)

Every color, shadow, radius, size and duration the app reuses is a token, named by what it's for.
**Components never use raw colors.** To change the look, or add a theme (a light one: redefine
the tokens under `:root[data-theme="light"]`), only this file changes.

| Group | Tokens | For |
| --- | --- | --- |
| Surfaces | `--bg`, `--elevated`, `--elevated-2`, `--fill`, `--fill-hover`, `--separator`, `--highlight` | Page, cards and grouped lists, tracks and hovers, lines, the raised choice |
| Glass | `--glass`, `--glass-strong`, `--glass-thin`, `--glass-blur`, `--glass-border` | Menus, popovers, the nav, sheets |
| Scrims | `--scrim`, `--scrim-strong`, `--scrim-tag` | Darkening over artwork; tags on pictures |
| Labels | `--label`, `--label-2`, `--label-3`, `--on-accent`, `--on-media` | Primary, secondary, tertiary (large or non-essential text only), text on violet, text on artwork |
| Accent | `--accent`, `--accent-hover`, `--accent-text` | Chosen state and primary action; violet text on dark |
| Signal | `--ok`, `--warn`, `--bad`, `--bad-text` | Always with words, never color alone |
| Shadows | `--shadow-s`, `--shadow-m`, `--shadow-l` | The raised choice; toasts and toolbars; glass panels |
| Shape | `--radius-s` 6, `--radius-segment` 7, `--radius` 10, `--radius-l` 16, pills 999 | |
| Type | `--text-caption` 12, `--text-body` 14 (15 on phones), `--text-callout` 15, `--text-title3` 17, `--text-title2` 22, `--text-large` | Segoe UI Variable on Windows, the system font elsewhere |
| Motion | `--fast` 140 ms, `--slow` 420 ms, `--ease`; the slider glides 280 ms with a slight overshoot | Zero with Reduce Motion |

## Components

- **Segmented control** (`Segmented.svelte`): 2 to 5 choices of one kind (a filter, a view). Never a
  row of separate pills or chips. More than 5, or long lists: a pop-up menu (`PopupButton`).
- **Pop-up button** (`PopupButton.svelte`, or `.pill` buttons that open the menu): a choice that
  doesn't need to be on screen ("Type: All", "Sort: Recently Watched ↓").
- **Menus** (`menu.svelte.ts`): every menu, right-click and pop-up goes through one system, on glass.
- **Grouped lists** (Settings, Customize Home): rows on `--elevated` with hairline separators. A row
  that opens another page is the whole row, with a chevron (›). A switch is the app's `Toggle`.
- **Cards**: posters 2:3 and wide 16:9, rounded `--radius`; hover lifts with a light ring.
- **Circle buttons**: icon-only actions in the nav and on title pages (36 px; 44 px on touch).
- **Dialogs and sheets**: native `<dialog>`, glass; a bottom sheet on iPhone with Cancel / Save on top.
- **Toasts**: one short sentence at the bottom, with Undo when something can be undone.

## Rules of thumb

- **Calm, not busy.** One primary action per screen. No tinted cards, gradient banners or icons
  in colored squares or circles. A prompt is one line with a text button and ✕.
- **Empty states**: a plain symbol (no badge), a title, one line of what to do.
- **Words**: plain and short. Buttons and titles in Title Case ("Mark All as Read"); sentences
  otherwise. Errors say what to do ("Couldn't connect. Using backup."). Never the server's name:
  to people it's just the app.
- **Touch**: 44 pt targets on touch screens; hover-only controls also have a long-press menu.
- **TV**: every control reachable with the remote's arrows; focus is a clear ring; nothing
  hover-only; Back closes what's open.
- **Accessibility**: labels on icon buttons, `role`s on custom controls, contrast from the tokens
  (`--label-3` only for large or non-essential text), Reduce Motion and Reduce Transparency honored.
- **Dark on purpose** (immersive media), built so a light theme is a token file away.
