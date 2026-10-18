-- Migration 2: per-instance UI layout documents (canvas card positions, pinned graph
-- positions, ...). One JSON document per layout name, written by the signed-in browser
-- through PUT /api/ui/layout/{name}. No revision trigger: nothing caches these rows
-- in server memory; every GET reads the table directly.
CREATE TABLE ui_layout (
  name       TEXT PRIMARY KEY CHECK (length(name) BETWEEN 1 AND 40 AND name NOT GLOB '*[^a-z0-9_-]*'),
  data       TEXT NOT NULL CHECK (json_valid(data) AND length(data) <= 524288),
  updated_at INTEGER NOT NULL
) STRICT, WITHOUT ROWID;
