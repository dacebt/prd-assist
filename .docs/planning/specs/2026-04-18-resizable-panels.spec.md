# Resizable & Toggleable Panels

## Intent

In `SessionPage`, make the three panels (Sidebar / Chat / PRD) horizontally resizable via drag handles, make the right PRD panel toggleable open/closed, keep the Sessions sidebar always visible (never collapsible), and enforce min-widths on each panel.

## Goal (one sentence)

A user can drag dividers to resize any of the three panels, toggle the PRD panel open/closed, and can never accidentally hide the sessions sidebar or shrink any panel below a readable minimum.

## Approach (chosen)

Custom pointer-event-based resize with two drag handles owned by `SessionPage`. Widths are held in a single hook (`usePanelLayout`) with `localStorage` persistence (lazy `useState` initializer to avoid flash). No new dependency.

Layout ownership moves to `SessionPage`: sizing classes (`w-64`, `w-[400px]`, `shrink-0`) are stripped from `Sidebar` and `ChatPane` so their internals fill the parent-controlled wrapper. PRD panel is conditionally rendered; a persistent toggle control (visible in both open and closed states) lives on the Chat/PRD boundary so it's always reachable.

## Rejected alternatives

- **`react-resizable-panels` dep** — rejected to keep scope minimal; the problem is small enough that ~80 lines of local code cost less than a new runtime dep.
- **Collapsible Sidebar** — rejected: user said sessions sidebar must always be visible.
- **Native CSS `resize`** — rejected: no horizontal-only support across browsers and no min/max enforcement against sibling panels.

## Accepted risks (from rival)

1. **Hardcoded widths in children** — addressed: remove `w-64`/`w-[400px]`/`shrink-0` from `Sidebar.tsx` and `ChatPane.tsx`; parent wrappers own sizing.
2. **PRD close/reopen layout** — addressed: when closed, PRD wrapper is unmounted; remaining space is absorbed by a `flex-1` wrapper around ChatPane. Stored PRD width is preserved for reopen.
3. **Overflow/scroll contexts** — addressed: each wrapper is a flex column with `h-full overflow-hidden`; scroll stays inside each pane's existing scroll container.
4. **Drag during in-flight send** — accepted as-is: resize is independent of send state; `scrollIntoView({behavior:"smooth"})` jank during drag is acceptable and minor.
5. **localStorage hydration flash** — addressed: lazy `useState(() => readStorage())` runs before first paint.
6. **Viewport < sum of min-widths** — addressed: clamp enforced in resize logic; on very narrow viewports, panels hit floor and overflow is hidden by root. Acceptable for desktop-only app.

## Design

### New file: `src/web/src/hooks/usePanelLayout.ts`

```ts
interface PanelLayout {
  sidebarWidth: number;
  chatWidth: number;
  prdOpen: boolean;
  setSidebarWidth: (n: number) => void;
  setChatWidth: (n: number) => void;
  togglePrd: () => void;
}
```

- Defaults: `sidebarWidth=256`, `chatWidth=400`, `prdOpen=true`.
- Min-widths (constants exported from the hook): `SIDEBAR_MIN=200`, `CHAT_MIN=320`, `PRD_MIN=320`.
- Persisted to `localStorage` key `prd-assist:panel-layout` as JSON `{sidebarWidth, chatWidth, prdOpen}`. Read via lazy init; write via `useEffect`.
- Setter clamps to `>= min`.

### New file: `src/web/src/components/ResizeHandle.tsx`

A 4-px wide vertical div with `cursor-col-resize`, hover highlight, `role="separator"`, `aria-orientation="vertical"`. Takes `onResize(deltaPx)` and manages `pointerdown/move/up` with pointer capture. Emits deltas; parent clamps.

### `SessionPage.tsx` changes

- Use `usePanelLayout`.
- Structure:
  ```
  <div class="flex h-screen overflow-hidden">
    <div style={{width: sidebarWidth}} class="shrink-0 h-full"><Sidebar/></div>
    <ResizeHandle onResize={dx => setSidebarWidth(sidebarWidth + dx)} />
    {prdOpen ? (
      <>
        <div style={{width: chatWidth}} class="shrink-0 h-full"><ChatPane .../></div>
        <ResizeHandle onResize={dx => setChatWidth(chatWidth + dx)} />
        <div class="flex-1 h-full overflow-hidden bg-gray-50 dark:bg-gray-950">
          <PrdPane prd={...} onTogglePrd={togglePrd} prdOpen={true}/>
        </div>
      </>
    ) : (
      <div class="flex-1 h-full"><ChatPane .../><FloatingOpenPrdButton onClick={togglePrd}/></div>
    )}
  </div>
  ```
- Simpler variant actually used: put the PRD toggle button inside `PrdPane` header when open, and render a small always-visible reopen button on the right edge of `SessionPage` when closed.

### `Sidebar.tsx` changes

- Remove `w-64 shrink-0`. Replace with `h-full w-full`.

### `ChatPane.tsx` changes

- Remove `w-[400px] shrink-0`. Replace with `h-full w-full`.

## Verification scenarios

1. Launch dev server, open a session. Sidebar, Chat, PRD all render. Drag handle 1 → sidebar resizes. Drag handle 2 → chat resizes, PRD absorbs remainder.
2. Drag each handle far left past the min — panel stops at min, does not disappear.
3. Click PRD close button → PRD hides, Chat grows to fill right side, reopen button appears.
4. Click reopen → PRD returns at prior width.
5. Reload page → widths and `prdOpen` are restored.
6. `pnpm typecheck` passes. `pnpm lint` passes.

## Slices

1. Add `usePanelLayout` hook (state + localStorage).
2. Add `ResizeHandle` component.
3. Strip hardcoded widths from `Sidebar` and `ChatPane`.
4. Wire `SessionPage` layout with handles and toggle; add reopen edge button; add close button in PRD header.
5. Verify: typecheck, lint, manual dev-server smoke.

## Adaptation log

(empty)
