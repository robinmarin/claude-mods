#!/usr/bin/env bash
# Install mods from this repo into ~/.claude/mods and register them in
# ~/.claude/settings.json. Usage: ./install.sh [mod ...]  (default: all)
set -euo pipefail

repo=$(cd "$(dirname "$0")" && pwd)
mods_dir="$HOME/.claude/mods"
settings="$HOME/.claude/settings.json"

command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }

if [ $# -eq 0 ]; then
  set -- $(cd "$repo" && for d in */.claude-plugin/plugin.json; do echo "${d%%/*}"; done)
fi

mkdir -p "$mods_dir"
[ -f "$settings" ] || echo '{}' > "$settings"

for mod in "$@"; do
  src="$repo/$mod"
  [ -f "$src/.claude-plugin/plugin.json" ] || { echo "no such mod: $mod" >&2; exit 1; }
  dest="$mods_dir/$mod"
  mkdir -p "$dest"
  cp -R "$src/." "$dest/"

  # CLAUDE_CODE_PLUGIN_DIRS is a colon-separated list; append if missing
  tmp=$(mktemp)
  jq --arg d "$dest" '
    .env.CLAUDE_CODE_PLUGIN_DIRS as $cur
    | ($cur // "" | split(":") | map(select(. != ""))) as $dirs
    | if ($dirs | index($d)) then . else .env.CLAUDE_CODE_PLUGIN_DIRS = ($dirs + [$d] | join(":")) end
  ' "$settings" > "$tmp" && mv "$tmp" "$settings"
  echo "installed $mod -> $dest"
done

echo "Restart Claude Code to load the mods."
