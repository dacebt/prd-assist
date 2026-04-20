# Frontend Layout Refactor: Landing → Session Page

## Intent

Replace the current three-panel `SessionPage` (sessions sidebar | chat | PRD) with a two-page flow:

- **Landing (`/`)**: full-width, technical list of sessions with a "New session" button and theme toggle. Click a session → navigate.
- **Session page (`/sessions/:id`)**: top bar with explicit "← Sessions" back link + session title + PRD toggle + theme toggle. Chat fills the page by default. PRD opens as a right-side drawer, side-by-side with chat, with the PRD width resizable via a single drag handle. No sessions sidebar.

UI-only refactor. `api.ts`, polling hooks, `@prd-assist/shared`, server, and mcp are untouched.

## Goal (one sentence)

A user lands on `/`, sees their sessions, clicks one, lands on a chat-first session page with a clear back link and a togglable resizable PRD drawer — no nested resizable sidebar, no dead "select a session" panel.

## Approach (chosen)

- Routes already correct (`/` and `/sessions/:id`); rewrite the page bodies.
- Delete the "everywhere sidebar" model. `Sidebar.tsx` is removed; its pieces (`SessionList`, `NewSessionButton`, `ThemeToggle`) are reused directly inside the landing.
- Replace `usePanelLayout` (sidebar+chat+prd state) with a smaller `usePrdPanel` (open + width only).
- Reuse `ResizeHandle` for the single chat ↔ PRD divider; no other resize handles.
- Add a `TopBar` component owned by `SessionPage` for the back link, title, and right-side controls.
- Migrate localStorage cleanly: write to a new key, delete the old one on first load.

## Rejected alternatives

- **Tabs (chat XOR prd)** — rejected: user wants side-by-side preserved.
- **PRD as a separate route (`/sessions/:id/prd`)** — rejected: forces context switching for a panel meant to be glanceable.
- **Keep collapsible sessions sidebar on session page** — rejected: that's the "weird three panels" the user wants gone.
- **Carry forward `usePanelLayout`** — rejected: 70% of its state (sidebar + chat widths) is now meaningless; cheaper to replace than prune.

## Accepted risks (from rival)

1. **`NewSessionButton` never resets `loading=false` on success** — was invisible because the button unmounted on navigate. On the new landing it stays mounted. **Addressed**: rewrite with try/finally so `loading` always resets, including on the (currently unreachable) post-navigate path.
2. **localStorage key collision with old layout** — old key `prd-assist:panel-layout` stores `{sidebarWidth, chatWidth, prdOpen}`. **Addressed**: new key `prd-assist:prd-panel` (shape `{open: boolean, width: number}`); on first read, `localStorage.removeItem("prd-assist:panel-layout")` to clear the squatter.
3. **`SessionList` is fetch-once-on-mount, no refresh** — was invisible because navigation replaced the page. On the new landing, user creates a session → comes back via "← Sessions" → list is stale. **Addressed**: refetch on mount (covers in-app back-nav since `SessionListPage` unmounts on navigate-away) and on `document.visibilitychange` when `visible` (covers tab-switch and other-tab edits). No polling.
4. **No active-session highlight on landing** — N/A: landing is never visited while a session is "active"; back-nav clears that context. Not addressed; not needed.
5. **Browser-back vs. PRD toggle** — PRD open/closed is local state, not in URL. Browser-back navigates routes only, never closes the PRD. Acceptable; matches user mental model that PRD is a panel preference, not a navigation step.

## UX gaps (folded in)

7. **Initial-fetch flash on landing** — `SessionList` mounts with `[]` and renders "No sessions yet" until fetch resolves. Users with sessions briefly see a lying empty state. **Addressed**: list state becomes `{status: "loading"} | {status: "loaded"; sessions} | {status: "error"; message}`; initial render shows "Loading sessions…" not the empty state.
8. **Empty-state CTA is a dead end** — "No sessions yet" gives no path forward. **Addressed**: empty state copy = "No sessions yet — create one to get started." plus an inline secondary "New session" button that calls the same handler as the header button.
9. **`(untitled)` rows are indistinguishable** — server creates sessions with `title=""`; user can create several before sending a message. **Addressed**: each row shows `title || "(untitled)"` on line 1 and `<id-suffix> · <relative-time>` on line 2 (id suffix = last 8 chars of session id). Disambiguates without verbosity.
10. **`SessionList` rows are not keyboard-accessible** (real bug today) — `<li onClick>` is unfocusable, no Enter/Space handler. **Addressed**: rows become `<Link to={`/sessions/${id}`}>` (gives free focus, keyboard activation, middle-click new-tab, browser hover-preview). Outer `<li>` keeps `divide-y` styling; the `<Link>` is the full-row interactive child with focus-visible ring.
11. **TopBar title during loading and error** — `state.session` is undefined while loading or on error. **Addressed**: TopBar title falls back as `state.status === "loading" ? "Loading…" : state.status === "error" ? "Session not found" : (session.title || "(untitled)")`. Back link is always rendered, regardless of state.
12. **TopBar title truncation** — long titles must not push controls off-screen. **Addressed**: title element uses `truncate` (single-line ellipsis) inside a `min-w-0 flex-1` flex item; element gets `title={fullTitle}` for the native browser tooltip.
13. **Browser tab title disambiguation** — multiple session tabs all read "prd-assist". **Addressed**: `SessionPage` sets `document.title` via `useEffect` to `${sessionTitle || "(untitled)"} · prd-assist` on load and `prd-assist` on unmount. `SessionListPage` sets `document.title = "prd-assist"` on mount.
14. **Invalid session id deep link** (`/sessions/bogus`) — `fetchSession` throws. **Addressed by 11**: TopBar with back link still renders, error message ("Session not found" or server message) renders in the chat region. User can leave without browser-back.
15. **Unknown route fallthrough** (`/foo`) — currently white screen; React Router has no catch-all. **Addressed**: add `<Route path="*" element={<Navigate to="/" replace />} />` to the router.
16. **Send-in-flight + back navigation** — user sends a message, immediately clicks "← Sessions". The in-flight request keeps running on the server; client throws away the response (component unmounts, `turnInFlight` is local state). When user re-enters that session, `fetchSession`-on-mount fetches fresh state, which will include the assistant reply if the turn finished. **Accepted as-is**: no spinner persisted across navigation, but no data loss either. Worth a one-line comment in `SessionPage` explaining the behavior.
17. **`ResizeHandle` keyboard a11y** — pointer-only today. **Addressed**: add Left/Right Arrow handlers (±16px), Shift+Arrow (±64px), Home/End (snap to clamp min/max). Element gets `aria-valuenow={width}`, `aria-valuemin={PRD_MIN}`, `aria-valuemax={dynamic}`, `tabIndex={0}`, focus-visible ring.
18. **Narrow-viewport policy** — Chat min 320 + PRD min 320 = 640px before layout breaks. **Addressed**: declare desktop-first; below `window.innerWidth < 720`, the PRD toggle button is rendered with `disabled` and `title="PRD requires a wider viewport"`. If PRD is open and viewport drops below 720, it auto-closes (do not destroy persisted preference — `panel.open` toggle in storage stays as user set it; runtime state is the gate). Single `useEffect` with `resize` listener in `usePrdPanel`.
19. **Autofocus chat textarea on session-page mount** — user clicked into a session to talk; cursor should be ready. **Addressed**: `ChatPane` textarea gets `autoFocus`; if textarea was disabled (in-flight), focus when re-enabled is acceptable browser default.
20. **Loading copy in chat region during fetch** — keep current "Loading…" italic small text. Error stays red. No change needed; explicit so it isn't lost in the rewrite.
21. **`ThemeProvider` placement** — already wraps `App` in `main.tsx`, so both `SessionListPage` and `TopBar` can call `useTheme` freely. No change.

## Design

### File changes summary

| Path                                  | Action                                                                                                                  |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `src/router.tsx`                      | Add catch-all `*` → `Navigate to="/" replace`.                                                                          |
| `src/pages/SessionListPage.tsx`       | Rewrite: full-width landing.                                                                                            |
| `src/pages/SessionPage.tsx`           | Rewrite: TopBar + chat + optional PRD drawer + single ResizeHandle.                                                     |
| `src/components/TopBar.tsx`           | **New**. Session page header.                                                                                           |
| `src/components/Sidebar.tsx`          | **Delete**.                                                                                                             |
| `src/components/SessionList.tsx`      | Refactor: full-width row styling, refetch on mount + `visibilitychange`.                                                |
| `src/components/NewSessionButton.tsx` | Fix loading-reset bug; restyle for landing context.                                                                     |
| `src/components/ThemeToggle.tsx`      | Unchanged.                                                                                                              |
| `src/components/ChatPane.tsx`         | Strip `border-r`; add `autoFocus` to textarea.                                                                          |
| `src/components/PrdPane.tsx`          | Drop the `onClose` close-X (toggle now lives in TopBar); keep heading. Update prop type.                                |
| `src/components/ResizeHandle.tsx`     | Add Arrow/Shift+Arrow/Home/End keyboard handlers + `aria-valuenow/min/max` props + `tabIndex={0}` + focus-visible ring. |
| `src/hooks/usePanelLayout.ts`         | **Delete**.                                                                                                             |
| `src/hooks/usePrdPanel.ts`            | **New**.                                                                                                                |

### `usePrdPanel` hook

```ts
export const PRD_MIN = 320;
export const CHAT_MIN = 320;
export const NARROW_VIEWPORT_PX = 720;

interface PrdPanel {
  open: boolean; // effective open: persisted preference AND viewport >= NARROW_VIEWPORT_PX
  width: number;
  canOpen: boolean; // viewport >= NARROW_VIEWPORT_PX
  toggle: () => void; // updates persisted preference
  setWidth: (n: number) => void;
  maxWidth: number; // clamp ceiling, recomputed on resize
}
```

- Storage key `prd-assist:prd-panel`, JSON `{open: boolean, width: number}`.
- Defaults: persisted `open=false`, `width=480`.
- On first read: `localStorage.removeItem("prd-assist:panel-layout")` (one-time migration).
- `setWidth` clamps `n` to `[PRD_MIN, max(PRD_MIN, window.innerWidth - CHAT_MIN)]`.
- `window.resize` listener maintains `canOpen` and `maxWidth`; if width exceeds new `maxWidth`, re-clamp.
- Effective `open = persistedOpen && canOpen`. Persisted preference is never auto-mutated by viewport changes.
- Lazy `useState` initializer for persisted state; persist via `useEffect`.

### `TopBar` component

```ts
interface Props {
  title: string; // resolved by SessionPage: "Loading…" | "Session not found" | session.title || "(untitled)"
  prdOpen: boolean;
  prdCanOpen: boolean; // gates the toggle button
  onTogglePrd: () => void;
}
```

- Layout: left = `Link to="/"` styled as "← Sessions" + title (truncated, with `title={fullTitle}` tooltip). Right = PRD toggle button + `ThemeToggle`.
- PRD toggle button label: `prdOpen ? "Hide PRD" : "Show PRD"`. When `!prdCanOpen`, button is `disabled` with `title="PRD requires a wider viewport (≥720px)"`.
- Title element: `<h1 className="truncate min-w-0 flex-1 ..." title={fullTitle}>{title}</h1>` so it shrinks before pushing controls off-screen.
- Border-bottom matches existing border style (`border-gray-200 dark:border-gray-800`).
- Height ~48px, horizontal padding consistent with rest of app.

### `SessionPage` structure

```
<div className="flex h-screen flex-col overflow-hidden">
  <TopBar title={resolvedTitle} prdOpen={panel.open} prdCanOpen={panel.canOpen} onTogglePrd={panel.toggle} />
  <div className="flex flex-1 overflow-hidden">
    {state.status === "loaded" ? (
      panel.open ? (
        <>
          <div className="h-full flex-1 min-w-0"><ChatPane .../></div>
          <ResizeHandle
            ariaLabel="Resize PRD panel"
            valueNow={panel.width}
            valueMin={PRD_MIN}
            valueMax={panel.maxWidth}
            onResize={dx => panel.setWidth(panel.width - dx)} />
          <div style={{width: panel.width}} className="h-full shrink-0 overflow-hidden bg-gray-50 dark:bg-gray-950">
            <PrdPane prd={state.session.prd} />
          </div>
        </>
      ) : (
        <div className="h-full flex-1"><ChatPane .../></div>
      )
    ) : (
      <div className="flex-1 overflow-y-auto bg-gray-50 p-4 dark:bg-gray-950">
        {state.status === "loading" && <p className="text-sm text-gray-400 italic dark:text-gray-500">Loading…</p>}
        {state.status === "error"   && <p className="text-sm text-red-500 dark:text-red-400">{state.message}</p>}
      </div>
    )}
  </div>
</div>
```

- `resolvedTitle`: `state.status === "loading" ? "Loading…" : state.status === "error" ? "Session not found" : (state.session.title || "(untitled)")`.
- `dx` sign: dragging the handle right (positive `dx`) shrinks PRD, so `setWidth(width - dx)`.
- `useEffect` sets `document.title = ${resolvedTitle} · prd-assist` (or `prd-assist` on unmount).
- A short comment explains the in-flight + back-nav behavior (#16): turn results are not preserved across navigation; re-entering the session refetches and shows whatever state the server has.

### `SessionListPage` structure

```
<div className="flex h-screen flex-col">
  <header className="flex items-center justify-between border-b ... px-6 py-4">
    <h1 className="text-base font-bold ...">prd-assist</h1>
    <ThemeToggle />
  </header>
  <div className="border-b ... px-6 py-3">
    <NewSessionButton />
  </div>
  <main className="flex-1 overflow-y-auto">
    <SessionList />
  </main>
</div>
```

- Sets `document.title = "prd-assist"` on mount.
- `SessionList` renders full-width rows per the refactor above.

### `SessionList` refactor

- Local state: `{status: "loading"} | {status: "loaded"; sessions: SessionSummary[]} | {status: "error"; message: string}`.
- Initial render: "Loading sessions…" italic small text. Avoids the empty-state flash.
- On error: small red message + retry button.
- On loaded + empty: "No sessions yet — create one to get started." plus an inline "New session" button (calls same `createSession` handler — extract a `useCreateSession` hook so both the header button and the empty-state button share the implementation; both reset loading via try/finally).
- Refetch triggers: mount (covers in-app back-nav) + `document.visibilitychange` when `visibilityState === "visible"` (covers tab switching). Cleanup listener on unmount.
- Row markup: each row is `<li><Link to={`/sessions/${s.id}`} className="block px-6 py-4 hover:bg-gray-50 dark:hover:bg-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">…</Link></li>`. Inside the link: title line (`s.title || "(untitled)"`, truncated) and a subtitle line `<id-suffix> · <relative-time>` where id-suffix is `s.id.slice(-8)`.
- `divide-y` stays on the `<ul>`.

### `NewSessionButton` fix + extraction

Extract `useCreateSession()` so the header button and the empty-state inline button share one implementation:

```ts
function useCreateSession() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const create = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const { id } = await createSession();
      navigate(`/sessions/${id}`);
    } catch (err) {
      console.error("Failed to create session", err);
    } finally {
      setLoading(false);
    }
  };
  return { create, loading };
}
```

`NewSessionButton` becomes a thin button that calls `useCreateSession`. Drop the `mx-4 my-3 w-[calc(100%-2rem)]` margin-hack; let the parent control layout. Empty-state button reuses the same hook (a separate render at a smaller size is fine; logic identical).

### `PrdPane` prop change

Drop `onClose`; `Props` becomes `{ prd: PRD }`. Header shows just "PRD".

### `ResizeHandle` keyboard support

Props gain `valueNow: number`, `valueMin: number`, `valueMax: number`. Element gets `tabIndex={0}`, `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, focus-visible ring class. `onKeyDown`:

- `ArrowLeft` → `onResize(-16)`, `ArrowRight` → `onResize(+16)`.
- `Shift+ArrowLeft/Right` → ±64.
- `Home` → `onResize(valueMin - valueNow)`, `End` → `onResize(valueMax - valueNow)`.
- All other keys: no-op.

### `router.tsx` catch-all

Add: `<Route path="*" element={<Navigate to="/" replace />} />`. Import `Navigate` from `react-router-dom`.

## Verification scenarios

1. `pnpm --filter @prd-assist/web typecheck` passes.
2. `pnpm --filter @prd-assist/web lint` passes.
3. `pnpm --filter @prd-assist/web test` passes.
4. Dev server: visit `/` → header, "New session" button, "Loading sessions…" briefly, then list (or empty state with inline CTA). No sidebar.
5. Click a session row → navigates to `/sessions/:id`. TopBar shows "← Sessions" + title. Chat fills page. No PRD visible. Chat textarea is focused.
6. TopBar title truncates with ellipsis on long titles; hover shows full title in browser tooltip. Browser tab title reads `<title> · prd-assist`.
7. Click "Show PRD" → PRD opens on the right at default 480px width. Chat shrinks. Toggle label becomes "Hide PRD".
8. Drag the chat↔PRD handle → PRD width changes. Focus the handle with Tab; press Left/Right arrows → width changes by 16px; Shift+Arrows by 64px; Home/End snap to min/max.
9. Reload → PRD open/closed state and width are preserved.
10. Click "Hide PRD" → PRD hides, chat fills page.
11. Click "← Sessions" → returns to landing. List reflects any newly created session (in-app back-nav triggers mount-fetch).
12. Open a second tab, create a session there, return to first tab → focused tab refetches via `visibilitychange` and shows the new session.
13. Empty-state path: with no sessions, landing shows "No sessions yet — create one to get started." plus inline "New session" button. Click it → creates and navigates.
14. Tab through the session list → each row is focusable, gets a visible focus ring, Enter activates it. Middle-click on a row opens session in a new tab.
15. Multiple `(untitled)` sessions: rows show id-suffix (last 8 chars) + relative time so they are distinguishable.
16. Visit `/sessions/bogus-id` directly → TopBar with "← Sessions" + "Session not found" renders; error message renders below; back link works.
17. Visit `/foo` → catch-all redirects to `/`.
18. Old localStorage key `prd-assist:panel-layout` is removed after first visit; new key `prd-assist:prd-panel` exists with `{open, width}`.
19. Resize browser to <720px width with PRD open → PRD auto-hides at runtime; toggle button is disabled with explanatory tooltip. Resize back above 720px → toggle re-enables; persisted preference re-applies.
20. Send a message, then immediately click "← Sessions" mid-flight → no client error; navigate succeeds. Re-enter the session → fetched state reflects whatever the server has (assistant reply if turn finished).
21. Theme toggle works on both pages; preference persists across navigation.

## Slices

1. Add `usePrdPanel` hook (open + width + viewport gate + maxWidth + storage migration); delete `usePanelLayout`.
2. Upgrade `ResizeHandle` with keyboard handlers + ARIA value props.
3. Add `TopBar` component (back link, truncated title with tooltip, PRD toggle with disabled state, theme toggle).
4. Rewrite `SessionPage`: TopBar + chat + optional PRD drawer + single resize handle; resolve title across loading/error/loaded; set `document.title`; autofocus chat.
5. Rewrite `SessionListPage` as full-width landing; set `document.title`; delete `Sidebar.tsx`.
6. Refactor `SessionList`: loading/loaded/error state, `<Link>` rows, id-suffix subtitle, inline empty-state CTA, visibility refetch.
7. Extract `useCreateSession`; rewrite `NewSessionButton` to use it (try/finally loading reset; restyled).
8. Trim `PrdPane` (drop `onClose`) and `ChatPane` (drop `border-r`, add `autoFocus`).
9. Add catch-all route in `router.tsx`.
10. Verify: typecheck, lint, test, manual dev-server walk through scenarios 4–21.

## Git Strategy

Full Agentic — orchestrator commits after each slice passes its gates, no per-slice confirmation.

## Adaptation log

- **2026-04-20 — Sequencing:** `usePanelLayout.ts` deletion moved from slice 1 to slice 4. Reason: `SessionPage` imports `usePanelLayout` until it is rewritten in slice 4; deleting in slice 1 would break typecheck between slices (Runnability First). Slice 1 adds `usePrdPanel` only; slice 4 deletes `usePanelLayout.ts` as part of the rewrite. No scope or behavior change.
