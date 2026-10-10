# claude-mods

Mods for Claude Code. Each folder is one mod.

## Mods

### edited-files

A sidebar pane that lists every file Claude edits or writes during a session, with the lines added and removed per file:

```
4 files                  +163 -23 m: minimize

edited-files/hooks/       +92 -11
└─ register.tsx           +92 -11
install.sh new            +40 -0
old-notes.md deleted       +0 -12
README.md                 +31 -0
```

Paths are relative to the session's directory. A folder with nothing in it but one subfolder folds into it, so you get `edited-files/hooks/` on one line, and its counts are the sum of everything under it. New files are green, deleted ones red and struck through.

Focus the pane (ctrl+x tab), Tab to a file and press Enter to see its diff for the session. Each edit's hunks are listed in order. `b` goes back to the tree.

On a big change set the tree gets tall. `m` (or the button in the top row) minimizes the pane to that one summary row, and `m` again expands it. The `x` still closes it.

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
