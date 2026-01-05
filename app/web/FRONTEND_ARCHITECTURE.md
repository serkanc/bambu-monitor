# Frontend Architecture Contract

This document is the single source of truth for frontend architecture, naming,
and module boundaries. New code should follow this contract.

## AppContext Contract

The global entry point is `window.appContext`. It is the only allowed global
surface for shared dependencies.

Required keys:
- `api`: low-level HTTP client (see `static/js/api/appClient.js`).
- `services`: domain services (see `static/js/services/*`).
- `stores`: state container(s) (core store under `stores.core`).
- `actions`: state mutation + side-effect layer.
- `selectors`: derived state readers (see `static/js/store/selectors/*`).
- `utils`: shared helpers (`static/js/utils/*`).
- `events`: UI binders for modules (`bindXEvents`, `bindXDocumentEvents`).
- `serviceHooks`: shared telemetry hooks (`onError`, `onMetric`).
- `logger`: centralized logger (`static/js/core/logger.js`).
- `features`: feature flag manager (`static/js/core/feature_flags.js`).

All modules must consume dependencies from `appContext` and avoid direct global
reach beyond this object.

## Event System

Central event binding lives in `static/js/core/event_registry.js`.

Rules:
- Event names are defined in `EVENT_KEYS`.
- Modules register handlers through `appContext.events.register(key, { component, document })`.
- Binding is triggered via `appContext.eventRegistry.bindComponentEvents()` /
  `bindDocumentEvents()` (or `bindAllEvents()`).
- Inline `onclick`/`onchange` usage is not allowed in templates.

## API / Service Layer

Rules:
- UI code never calls `fetch` directly; use `appContext.services.*`.
- All API calls go through `services/api.js` and `api/appClient.js`.
- Service functions return raw responses or normalized payloads, not DOM
  mutations or toasts.
- Services never mutate store state; actions handle updates.

Service layout:
- `services/api.js`: request wrapper + retries + metrics hooks.
- `services/*Service.js`: domain operations (files, status, controls, printers).

## Actions Layer

Rules:
- Only actions mutate state.
- Actions perform side-effects (API calls, timers, polling).
- UI events call actions; UI never mutates state directly.

## State + Selectors

Rules:
- State is the single source of truth.
- Selectors are the only read interface for UI.
- Avoid hidden state in UI modules; use store state instead.
- Use `store.update(path, updater)` for immutable nested updates.
- Use slice helpers (`setUiState`, `setControlsUiState`, etc.) for UI state.

Selectors live in `static/js/store/selectors/*`.

## UI Feedback Standard

Use a single feedback vocabulary:
- Toasts: `utils/dom.js -> showToast(message, type)`.
- Transfer overlay: use `transfer-overlay-command` events.

Error handling:
- User-cancelled actions must not log as errors.
- UI should show clear status text for long operations.
- `error` fields live in state, not in DOM.

Toast levels:
- `success`: completed actions (green).
- `info`: neutral updates (green).
- `warning`: expected but negative outcomes (amber).
- `error`: failures (red).

Toast type normalization is centralized in `utils/dom.js` (aliases like `warn` → `warning`).

## Helper / Utils Placement

All shared helpers must live under:
- `static/js/utils/dom.js`
- `static/js/utils/format.js`
- `static/js/utils/time.js`
- `static/js/utils/pendingState.js`

Do not add ad-hoc helpers to UI modules.

## Naming and File Rules

File naming:
- UI modules: `snake_case.js` (ex: `print_setup.js`, `file_explorer.js`).
- UI submodules: `snake_case.js` in module folder.
- Services: `camelCaseService.js` (ex: `fileService.js`).
- Selectors: module name (ex: `store/selectors/statusPanel.js`).

Code naming:
- Functions and variables: `camelCase`.
- Constants: `SCREAMING_SNAKE_CASE` only when truly static.
- State keys: `camelCase`.

## CSS Naming Standard

We keep CSS scalable using a prefix + modifier pattern that matches the current
codebase. Use these rules for new styles:

- Component prefixes: `printer-*`, `file-*`, `ams-*`, `event-*`, `status-*`,
  `control-*`, `dashboard-*`, `card`.
- State modifiers: `.is-*` and `.has-*` only (ex: `.is-open`, `.is-active`).
- Utilities: avoid adding new one-off utilities in `style.css`; place shared
  helpers under `web/src/input.css` (Tailwind) or `utils/` if JS-driven.
- Never mix two different naming styles in the same component.

When adding new UI, pick one prefix and keep the entire component scoped under it.

Scoping rules:
- Card layout styles live under `.dashboard-main .card`.
- File explorer styles are scoped under `.file-explorer-card`.
- Control panel styles are scoped under `.control-card`.

## Lifecycle Contract

Each UI module must expose:
- `initX` function in `ui/` module file.
- `bindXEvents` and `bindXDocumentEvents` in `appContext.events`.

Initialize modules only after dependencies are ready. Use the module init
pattern already in place (check for store + services before bootstrap).

## Modal Gate (Background Freeze)

When a modal is open, background modules must not re-render or poll. Use the
global modal gate in state:

- Store path: `ui.modalGate.active`
- Values: `settings`, `printer`, `fileAction`, `printSetup`, `transfer`, `printError`, `amsMaterial`, `customFilament`, `nozzle`
- Each modal sets the gate on open and clears on close.
- Background modules skip render/poll when `ui.modalGate.active` is set.

This prevents focus loss and unintended UI refreshes while modals are active.

## Modal Manager

Central modal behavior lives in `static/js/core/modal_manager.js` and is data-attribute driven.

Rules:
- Each modal root must include `data-modal-id="modalKey"`.
- Close affordances (backdrop, close/cancel) should include `data-modal-close="modalKey"`.
- Open triggers should include `data-modal-open="modalKey"`.
- UI modules that need setup/teardown should register with the manager:
  - `openClass` for `.is-open` modals.
  - `hiddenClass` for `.is-hidden` modals.
  - `gateKey` to set the modal gate.
  - `onOpen`/`onClose` for custom hooks.

Default behavior:
- `Escape` closes the topmost modal.
- `aria-hidden` + `inert` are managed automatically.
- Focus restores to the opener unless `focusRestore: false`.

## Setup + Login Flow

Flow rules:
- `/setup` is shown only when there are no printers or no admin password.
- `/login` is required before `/` and `/debug`.
- Setup is step-based: admin password first, then printer add.
- Setup uses session cookies; API token remains for external clients.

The setup page should not start dashboard polling modules.

## Settings Modal

Minimal admin controls available in the settings modal:
- Change admin password (optional force logout via session rotate).
- API token view/copy/rotate.
- Admin token rotate.
- Admin allowlist edit.
- Session secret rotate (force logout, restart required).
- Logout button is separate in the sidebar.

## Smoke + Telemetry

We ship a minimal smoke test and telemetry harness:
- `core/telemetry.js`: timing + slow-call reporting.
- `core/smoke.js`: opt-in DOM/service checks (enable with `?smoke=1`).

New modules should add:
- a DOM selector check in smoke (if user-facing)
- a telemetry timing mark for init if it can be slow

## Tests

Frontend tests live under `app/web/tests` and run with:
- `node app/web/tests/run.mjs`

Add tests for:
- store behavior (slice updates, immutable updates)
- adapters (status payload/formatting)
- modal manager behavior (focus/stacking)

## Feature Flags

Flags live in `appContext.features` and are sourced from:
- `window.__APP_CONFIG__.featureFlags`
- `window.__FEATURE_FLAGS__`

Use:
- `features.isEnabled('flagName')`
- `features.enable('flagName')` / `features.disable('flagName')`
- `features.define({ flagName: true })` for defaults

## State Stream (SSE)

The backend can stream state updates via SSE:
- Endpoint: `/api/state/stream` (token protected).
- First event is `snapshot` (full state).
- Subsequent events are `diff` with path → value changes.

Frontend can apply diffs directly to the store to avoid full re-renders.
