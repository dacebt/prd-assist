# Spec: Dark/Light Theme Toggle

**Date:** 2026-04-18
**Scope:** Frontend only (`src/web/`).

## Intent

Add a dark/light theme to the frontend. User can toggle between them. Default is dark. Preference persists across reloads.

## Approach

- Use Tailwind's `darkMode: 'class'` strategy (toggle a `dark` class on `<html>`).
- A small `ThemeProvider` + `useTheme` hook manages state, persists to `localStorage` under key `prd-assist:theme`, and applies the class on `document.documentElement`.
- Default: if no stored preference, apply `dark`.
- Apply the class pre-React-mount in `index.html` (inline script) to avoid a light-theme flash on first paint.
- Add a toggle control in `Sidebar` (sun/moon text label — no icon dependency).
- Retrofit existing components with `dark:` variants. Use semantic Tailwind tokens consistently.

## Color mapping (light → dark)

| Light                                                     | Dark                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------ |
| `bg-white`                                                | `dark:bg-gray-900`                                                       |
| `bg-gray-50`                                              | `dark:bg-gray-950`                                                       |
| `bg-gray-100`                                             | `dark:bg-gray-800`                                                       |
| `bg-gray-200` (user msg)                                  | `dark:bg-gray-700`                                                       |
| `text-gray-900` / `text-gray-800` / `text-gray-700`       | `dark:text-gray-100`                                                     |
| `text-gray-500` / `text-gray-400`                         | `dark:text-gray-400` / `dark:text-gray-500`                              |
| `border-gray-200` / `border-gray-100` / `border-gray-300` | `dark:border-gray-700` / `dark:border-gray-800` / `dark:border-gray-600` |
| `bg-blue-50` / `border-blue-100` (assistant msg)          | `dark:bg-blue-950/40` / `dark:border-blue-900`                           |
| Status pills (yellow/green/gray)                          | muted dark equivalents (`dark:bg-*-900/40 dark:text-*-300`)              |

## Slices

### Slice 1: Theme infrastructure

- Update `tailwind.config.js`: add `darkMode: 'class'`.
- Create `src/web/src/hooks/useTheme.ts` exporting `ThemeProvider` and `useTheme` (context-based; read/write localStorage; apply `dark` class to `documentElement`).
- Wrap app in `ThemeProvider` (in `main.tsx` or `App.tsx`).
- Add inline script to `src/web/index.html` `<head>` that applies the `dark` class before React mounts, reading `localStorage` and defaulting to dark.
- Extend `globals.css` if needed so `body`/root pick up theme backgrounds (e.g., `@apply bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100` on `body`).

**Verify:** loading the app with no stored preference shows dark background; `localStorage.getItem('prd-assist:theme')` returns `'dark'` after first load; the `<html>` element has class `dark`.

### Slice 2: Toggle control

- Add a theme toggle button to `Sidebar.tsx` header (shows "Dark" or "Light" label, clicking flips the theme).
- Style the button consistently for both themes.

**Verify:** clicking the toggle switches the whole UI between dark and light; preference persists across reload.

### Slice 3: Component dark variants

- Retrofit: `Sidebar`, `NewSessionButton`, `SessionList`, `ChatPane`, `MessageBubble`, `PrdPane`, `SectionBlock`, `SessionListPage`, `SessionPage` with `dark:` variants per color map above.
- Ensure focus rings, hover states, disabled states, and markdown prose all read correctly in both modes. For markdown, use `dark:prose-invert` on `SectionBlock` prose wrapper.
- Error text (`text-red-500`) should be readable in both — leave as-is or use `dark:text-red-400`.

**Verify:** every page/component has no pure-white flashes in dark mode and no pure-black regions in light mode. All text remains readable. Status pills legible in both. Markdown-rendered PRD sections readable in both.

## Verification Scenarios

1. **Default dark on first visit:** clear localStorage, load `/`. UI renders dark. `<html>` has `dark` class.
2. **Toggle flips UI:** click toggle in sidebar. UI flips to light. Click again, returns to dark.
3. **Persistence:** set to light, reload page. UI stays light.
4. **No flash:** hard reload with stored dark preference — no white flash.
5. **Session page:** navigate to `/sessions/<id>` in both modes. Chat bubbles, PRD pane, section blocks all legible.
6. **Build clean:** `pnpm typecheck` and `pnpm build` succeed.

## Rejected Alternatives

- **CSS variables + custom palette:** more flexible but overkill for a two-theme toggle on a small app; Tailwind's class strategy is idiomatic here.
- **`prefers-color-scheme` auto-detect:** spec explicitly says default to dark, not follow OS. Simpler to skip.
- **Third-party theme library (next-themes, etc.):** unnecessary for this scale; 30 lines of context code suffice.

## Accepted Risks

- Manual `dark:` retrofit across ~9 components is mechanical; minor visual polish (exact shade choices) may need a follow-up pass.
- Inline script in `index.html` duplicates the storage key string — accepted for flash-prevention.

## Adaptation Log

_(empty — populated during work-mode)_
