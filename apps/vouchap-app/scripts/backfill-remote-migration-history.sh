#!/usr/bin/env bash
# Backfill supabase_migrations.schema_migrations on LINKED remote so `supabase db push`
# only runs genuinely new files — without re-executing DDL on an already-provisioned DB.
#
# When: remote has e.g. only `20260109040027_remote_schema` (db pull baseline) but the
# database already contains schema from the rest of this repo.
#
# Usage (from vouchap-app, project linked):
#   chmod +x scripts/backfill-remote-migration-history.sh
#   ./scripts/backfill-remote-migration-history.sh        # dry-run: print repair commands
#   ./scripts/backfill-remote-migration-history.sh --execute
#
# Requires: Supabase CLI, `supabase link` done for this directory.
#
# NOTE: Former duplicate timestamp 20250313330000 was split: drop_firm_projects → 20250313330001.

set -euo pipefail
cd "$(dirname "$0")/.."

# Migrations you still want `db push` to APPLY (edit when adding new migrations).
SKIP_APPLY_REGEX='^20260501120000$'

# Already recorded on remote (optional skip; repair is idempotent on some CLI versions).
ALREADY_REMOTE_REGEX='^20260109040027$'

list_versions() {
  ls -1 supabase/migrations/[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]_*.sql 2>/dev/null \
    | sed -n 's|.*/\([0-9]\{14\}\)_.*|\1|p' \
    | sort -u
}

execute=false
if [[ "${1:-}" == "--execute" ]]; then
  execute=true
fi

count=0
while read -r ver; do
  [[ -z "$ver" ]] && continue
  if echo "$ver" | grep -qE "$SKIP_APPLY_REGEX"; then
    echo "# skip (pending real push): $ver"
    continue
  fi
  if echo "$ver" | grep -qE "$ALREADY_REMOTE_REGEX"; then
    echo "# skip (already on remote): $ver"
    continue
  fi
  if $execute; then
    supabase migration repair --status applied "$ver"
  else
    echo "supabase migration repair --status applied $ver"
  fi
  count=$((count + 1))
done < <(list_versions)

echo "# Total repair commands: $count (dry-run)" >&2
if ! $execute; then
  echo "# Re-run with: $0 --execute" >&2
fi
