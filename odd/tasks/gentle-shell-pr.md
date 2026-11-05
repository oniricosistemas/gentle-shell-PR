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

## Tasks

- [x] **T1** — S1, S2, S3, S9 — Route: parent — Scaffold the public Gentle Shell extension repository and package metadata. Commit: `8ed44f4`.
- [x] **T2** — S6, S7, S8 — Route: parent — Implement and test the bounded read-only GitHub PR state collector. Commit: `c104c8a`.
- [x] **T3** — S5, S6, S7, S8 — Route: parent — Implement and test the compact theme-aware Gentle Shell sidebar and lifecycle. Commits: `ff31ac2`, `f7d6cf0`.
- [x] **T4** — S4 — Route: parent — Enroll the project for Engram Cloud synchronization and record reproducible configuration. Commit: `abe72cb`.
- [x] **T5** — S1, S2, S3, S9 — Route: parent — Publish the repository, apply discovery topics, and verify public metadata. Commit: `abe72cb` (first public push).
- [x] **T6** — S1-S9 — Route: parent — Run package, test, installation, and repository verification; document the verified usage path. Commit: `4aea7f1`.
- [ ] **T7** — S7, S8 — Route: parent — Sanitize GitHub-controlled text before terminal rendering. Commit: pending.

## Log

- **L1** — "ok, vamos con eso entonces:\n1- crea el repo en github en https://github.com/oniricosistemas\npara que figure en el hub de la web gentlemanprogramming pide esto:\nAdd the gentle-shell-package topic to a public Shell resource repository, or gentle-hub-project to any public community project. Discovery is eventual once configured; no publishing schedule is currently promised.\n\nResource subtype topics are optional: gentle-shell-extension, gentle-shell-theme, gentle-shell-skill, and gentle-shell-prompt. Without one, your listing appears as Resource; no subtype is guessed.\n\n2- enrola el proyecto para que se sincronice con engram cloud\n3- el sidebar debe tomar los colores del theme que este seleccionado"
- **L2** — Repository/package choice: "gentle-shell-PR".
- **L3** — Engram configured from `.engram/config.json` as `gentle-shell-PR`; Engram normalizes the cloud identity to `gentle-shell-pr`.
- **L4** — Engram Cloud enrollment verified as enrolled; explicit export/import sync completed with 1 local chunk, 1 remote chunk, and 0 pending imports.
- **L5** — Public repository created at `https://github.com/oniricosistemas/gentle-shell-PR` with topics `gentle-shell-package` and `gentle-shell-extension`.
- **L6** — Verified 12 deterministic tests, syntax checks, package dry-run contents, isolated local Pi installation, live read-only GitHub collection, public repository metadata, and successful push to remote `main`.
- **L7** — Final hardening added after review of the reference implementation's warning that external PR titles can contain terminal control or bidirectional formatting characters.
