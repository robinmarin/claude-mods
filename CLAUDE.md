# claude-mods

## Refresh the installed copy on every commit

Claude Code loads each mod from `~/.claude/mods/<mod>`, a copy that `install.sh` makes. It does not load the repo. Edits here do nothing in a running session until that copy is refreshed.

After committing a change to a mod, run `./install.sh <mod>` for each mod the commit touched, then check with `diff -rq ~/.claude/mods/<mod> <mod>`. The only difference should be `.claude-plugin/types`, which the engine writes into the installed copy.
