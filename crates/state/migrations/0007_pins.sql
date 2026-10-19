-- Migration 7: the owner's pinned notes and folders (the sidebar "Pinned" list), saved on
-- the server so every browser and device of this instance shows the same pins. One owner
-- per instance, like ui_layout, so there is no owner column.
--
--   kind 'note'  : one note (vault path with its .md);
--   kind 'folder': one folder (vault path without a trailing /).
--   position     : display order, 0-based; rewritten densely on every change.
--
-- Paths are vault-relative as the store names them (memora_state::pins::check_path). The
-- server rewrites them in the same transaction as a rename or move of the pinned item (or
-- a folder above it) and drops them when the item is deleted or trashed. A path changed
-- outside Memora stays as it was and is reported as missing. No revision trigger: every
-- read goes to the table.
CREATE TABLE IF NOT EXISTS pin (
  kind       TEXT NOT NULL CHECK (kind IN ('note', 'folder')),
  path       TEXT NOT NULL CHECK (length(path) BETWEEN 1 AND 1024
                                  AND path NOT GLOB '/*' AND path NOT GLOB '*/'),
  position   INTEGER NOT NULL CHECK (position BETWEEN 0 AND 9999),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (kind, path)
) STRICT, WITHOUT ROWID;
