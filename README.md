# claude-mods

Mods for Claude Code. Each folder is one mod.

## Mods

### edited-files

A sidebar pane that lists every file Claude edits or writes during a session, with the lines added and removed per file:

```
+4 -2 /src/app.ts
+31 -0 /src/new-file.ts
```

The counts add up across repeated edits to the same file. The Edit and Write tools report their own diffs. For Bash, the mod snapshots the git working tree before and after each command and diffs the two, so files changed by `sed`, heredocs, scripts and so on show up too. That part only works inside a git repo, skips gitignored files, and counts anything else that changed the tree while the command ran. The snapshots use a separate index at `.git/edited-files.index`, so your staging area is never touched.

The pane opens on session start and on each prompt. If you close it, `/edited-files` brings it back. On a terminal narrower than 144 columns it shows inline above the prompt instead of docking to the side.

## Install

Needs `jq`.

```sh
git clone git@github.com:robinmarin/claude-mods.git
cd claude-mods
./install.sh              # every mod
./install.sh edited-files # just one
```

The script copies each mod to `~/.claude/mods/<name>` and appends that path to `env.CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json`. Running it again updates the files and leaves the setting alone. Restart Claude Code afterwards.

To uninstall, delete the folder and remove its path from `CLAUDE_CODE_PLUGIN_DIRS`.
