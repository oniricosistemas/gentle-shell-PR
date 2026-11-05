# gentle-shell-PR
Public Gentle Shell extension providing a compact, read-only pull-request sidebar for the active repository.
Repository target: `https://github.com/oniricosistemas/gentle-shell-PR`.

## Specs

1. **S1** — "crea el repo en github en https://github.com/oniricosistemas"
2. **S2** — "Add the gentle-shell-package topic to a public Shell resource repository, or gentle-hub-project to any public community project. Discovery is eventual once configured; no publishing schedule is currently promised."
3. **S3** — "Resource subtype topics are optional: gentle-shell-extension, gentle-shell-theme, gentle-shell-skill, and gentle-shell-prompt. Without one, your listing appears as Resource; no subtype is guessed."
4. **S4** — "enrola el proyecto para que se sincronice con engram cloud"
5. **S5** — "el sidebar debe tomar los colores del theme que este seleccionado"
6. **S6** — "no quiero algo tan complicado, que quede todo en un sidebar nomas"
7. **S7** — "sería posible hacer un sidebar que haga lo mismo"
8. **S8** — "ok, vamos con eso entonces"
9. **S9** — "gentle-shell-PR"
10. **S10** — "agregar al readme los comandos para actualizar la extension (o como se hace con una nueva version, teniendo instalda una ya)"
11. **S11** — "agregar al final de todo la imagen https://raw.githubusercontent.com/Gentleman-Programming/gentle-ai/main/docs/assets/brand/built-with-gentle-ai.png haciendo referencia a que se realizo con gentle-ai"
12. **S12** — "para no sobrecargar el sidebar, con convendria que al hacer click sobre el nombre del PR se abra una ventana con toda la información, en vez de mostrarla toda en el sidebar, hasta podriamos hacer como pestañas para lo que va a mostrar cada una de las versiones"
13. **S13** — "yo sacaria lo del diff gentle-shell ya trae uno. Vamos con el primer upgrade"

## Tasks

- [x] **T1** — S1, S2, S3, S9 — Route: parent — Scaffold the public Gentle Shell extension repository and package metadata. Commit: `8ed44f4`.
- [x] **T2** — S6, S7, S8 — Route: parent — Implement and test the bounded read-only GitHub PR state collector. Commit: `c104c8a`.
- [x] **T3** — S5, S6, S7, S8 — Route: parent — Implement and test the compact theme-aware Gentle Shell sidebar and lifecycle. Commits: `ff31ac2`, `f7d6cf0`.
- [x] **T4** — S4 — Route: parent — Enroll the project for Engram Cloud synchronization and record reproducible configuration. Commit: `abe72cb`.
- [x] **T5** — S1, S2, S3, S9 — Route: parent — Publish the repository, apply discovery topics, and verify public metadata. Commit: `abe72cb` (first public push).
- [x] **T6** — S1-S9 — Route: parent — Run package, test, installation, and repository verification; document the verified usage path. Commit: `4aea7f1`.
- [x] **T7** — S7, S8 — Route: parent — Sanitize GitHub-controlled text before terminal rendering. Commits: `578d11a`, `9f00a70`, `e814129`.
- [x] **T8** — S10, S11 — Route: parent — Document extension updates and Gentle AI attribution. Commit: `0ecfa3a`.
- [x] **T9** — S12, S13 — Route: worker — Add and test bounded read-only PR detail collection for Overview, Checks, and Files metadata. Commit: `1d6376f`.
- [x] **T10** — S12, S13 — Route: parent — Implement the theme-aware focused PR inspector with Overview, Checks, and Files tabs, without a diff viewer. Commit: `e2cf493`.
- [x] **T11** — S12, S13 — Route: parent — Open the inspector from PR title click and `/pr-focus`, preserving `/pr-open` and sidebar behavior. Commit: `8a5c88a`.
- [x] **T12** — S12, S13 — Route: parent — Update usage documentation, complete the design handoff, and verify the first upgrade. Commit: `1bea325`.

## Log

- **L1** — "ok, vamos con eso entonces:\n1- crea el repo en github en https://github.com/oniricosistemas\npara que figure en el hub de la web gentlemanprogramming pide esto:\nAdd the gentle-shell-package topic to a public Shell resource repository, or gentle-hub-project to any public community project. Discovery is eventual once configured; no publishing schedule is currently promised.\n\nResource subtype topics are optional: gentle-shell-extension, gentle-shell-theme, gentle-shell-skill, and gentle-shell-prompt. Without one, your listing appears as Resource; no subtype is guessed.\n\n2- enrola el proyecto para que se sincronice con engram cloud\n3- el sidebar debe tomar los colores del theme que este seleccionado"
- **L2** — Repository/package choice: "gentle-shell-PR".
- **L3** — Engram configured from `.engram/config.json` as `gentle-shell-PR`; Engram normalizes the cloud identity to `gentle-shell-pr`.
- **L4** — Engram Cloud enrollment verified as enrolled; explicit export/import sync completed with 1 local chunk, 1 remote chunk, and 0 pending imports.
- **L5** — Public repository created at `https://github.com/oniricosistemas/gentle-shell-PR` with topics `gentle-shell-package` and `gentle-shell-extension`.
- **L6** — Verified 12 deterministic tests, syntax checks, package dry-run contents, isolated local Pi installation, live read-only GitHub collection, public repository metadata, and successful push to remote `main`.
- **L7** — Final hardening added after review of the reference implementation's warning that external PR titles can contain terminal control or bidirectional formatting characters.
- **L8** — Independent verification found and reproduced two correction blockers: greedy OSC stripping removed visible text, and sanitizing stored branch identity broke current-PR selection. The correction now preserves raw identity for comparisons, sanitizes only presentation, preserves visible OSC-separated text, and passes 17 tests plus independent verification.
- **L9** — "ok un par de detalles...\n1- agregar al readme los comandos para actualizar la extension (o como se hace con una nueva version, teniendo instalda una ya)\n2- agregar al final de todo la imagen https://raw.githubusercontent.com/Gentleman-Programming/gentle-ai/main/docs/assets/brand/built-with-gentle-ai.png haciendo referencia a que se realizo con gentle-ai"
- **L10** — Design exploration created under `design/pr-sidebar-roadmap/` with four roadmap alternatives: `01-v02-focused-detail.html`, `02-v03-review-context.html`, `03-v04-merge-timeline.html`, and `04-v05-command-center.html`. No implementation artboard has been chosen.
- **L11** — "una duda, para no sobrecargar el sidebar, con convendria que al hacer click sobre el nombre del PR se abra una ventana con toda la información, en vez de mostrarla toda en el sidebar, hasta podriamos hacer como pestañas para lo que va a mostrar cada una de las versiones, que te parece?"
- **L12** — "ok, yo sacaria lo del diff gentle-shell ya trae uno. Vamos con el primer upgrade"
- **L13** — Implementation handoff selected `design/pr-sidebar-roadmap/01-v02-focused-detail.html`; the other roadmap artboards remain alternatives. The production inspector omits a diff viewer and uses Files only for metadata/listing because Gentle Shell already provides diff viewing.
- **L14** — v0.2 verification: `npm run check` passed all 30 tests; the selected HTML artboard parsed successfully; `git diff --check` passed. `npm run pack:check` was attempted once and timed out after 30 seconds without output, so package dry-run proof remains unavailable for this work unit.
