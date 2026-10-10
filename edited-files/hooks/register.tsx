import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Change, FileStat, FileStatus } from '../types'

const PANE = 'edited-files'
const files = atom({ plugin: 'edited-files', key: 'files' } as const, [])
const open = atom({ plugin: 'edited-files', key: 'open' } as const, null)
const minimized = atom({ plugin: 'edited-files', key: 'minimized' } as const, false)

// ponytail: a change keeps its first 500 diff lines, enough to read, not to replay
const MAX_LINES = 500

type Hunk = { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }

const count = (lines: string[], ch: string) => lines.filter(l => l[0] === ch).length

const hunkLines = (patch: Hunk[]) =>
  patch.flatMap(h => [`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`, ...h.lines])

// created then edited stays new; deleted then recreated is a change to what was there
const merge = (a: FileStatus, b: FileStatus): FileStatus =>
  a === 'new' && b !== 'deleted' ? 'new' : a === 'deleted' && b === 'new' ? 'modified' : b

const record = ($: EngineInterface, stat: FileStat) =>
  update($, files, list => {
    const old = list.find(f => f.path === stat.path)
    const rest = list.filter(f => f.path !== stat.path)
    if (!old) return [...rest, stat]
    return [...rest, {
      path: stat.path,
      adds: old.adds + stat.adds,
      dels: old.dels + stat.dels,
      // entries from before a reload may lack status and changes
      status: merge(old.status ?? 'modified', stat.status),
      changes: [...(old.changes ?? []), ...stat.changes],
    }]
  })

const patchStat = (path: string, lines: string[], status: FileStatus): FileStat => ({
  path, status, adds: count(lines, '+'), dels: count(lines, '-'),
  changes: [{ kind: 'patch', lines: lines.slice(0, MAX_LINES) }],
})

// Bash has no patch to read, so snapshot the work tree as a git tree before and
// after the command and diff the two. A private index in .git keeps the real
// one untouched and caches file stats, so only changed files get rehashed.
// ponytail: git repos only; edits made by anything else during the command count too
const SNAPSHOT = `top=$(git rev-parse --show-toplevel 2>/dev/null) || exit 1
cd "$top" || exit 1
GIT_INDEX_FILE="$(git rev-parse --absolute-git-dir)/edited-files.index" git add -A || exit 1
GIT_INDEX_FILE="$(git rev-parse --absolute-git-dir)/edited-files.index" git write-tree && echo "$top"`

type Snapshot = { tree: string; top: string }

const snapshot = async ($: EngineInterface): Promise<Snapshot | undefined> => {
  try {
    const r = await $.process.run(['sh', '-c', SNAPSHOT])
    const [tree, top] = r.stdout.trim().split('\n')
    return r.exitCode === 0 && tree && top ? { tree, top } : undefined
  } catch {
    return undefined
  }
}

// `git diff-tree -z` with --numstat: "adds\tdels\tpath\0" ("-" for binary);
// with --name-status: "A\0path\0"
const bashStats = async ($: EngineInterface, top: string, before: string, after: string): Promise<FileStat[]> => {
  const git = (flag: string) => $.process.run(['git', 'diff-tree', '-r', '-z', flag, before, after], { cwd: top })
  const [num, names] = await Promise.all([git('--numstat'), git('--name-status')])
  const status = new Map<string, FileStatus>()
  const parts = names.stdout.split('\0')
  for (let i = 0; i + 1 < parts.length; i += 2)
    status.set(parts[i + 1]!, parts[i] === 'A' ? 'new' : parts[i] === 'D' ? 'deleted' : 'modified')
  return num.stdout.split('\0').filter(Boolean).map(line => {
    const [adds, dels, ...p] = line.split('\t')
    const rel = p.join('\t')
    return {
      path: `${top}/${rel}`, adds: Number(adds) || 0, dels: Number(dels) || 0,
      status: status.get(rel) ?? 'modified', changes: [{ kind: 'git', top, before, after, rel }],
    }
  })
}

// a git change is diffed now, headers dropped: from its first hunk on, or the
// "Binary files differ" line
const diffLines = async ($: EngineInterface, changes: Change[]) => {
  const out: string[] = []
  for (const c of changes) {
    if (c.kind === 'patch') { out.push(...c.lines); continue }
    const r = await $.process.run(['git', 'diff', '--no-color', '--no-ext-diff', c.before, c.after, '--', c.rel], { cwd: c.top })
    const lines = r.stdout.split('\n')
    const at = lines.findIndex(l => l.startsWith('@@'))
    out.push(...(at >= 0 ? lines.slice(at, at + MAX_LINES) : lines.filter(l => l.startsWith('Binary'))))
  }
  return out.filter(l => l !== '')
}

type Dir = { dirs: Map<string, Dir>; files: Map<string, FileStat>; adds: number; dels: number }
type Row = { key: string; prefix: string; name: string; adds: number; dels: number; file?: FileStat }

const newDir = (): Dir => ({ dirs: new Map(), files: new Map(), adds: 0, dels: 0 })

// paths under the session dir drawn relative to it, the rest from /; top-level
// entries sit flush left; a dir with one subdir and no files folds into it (a/b/c/)
const tree = (list: FileStat[], cwd: string): Row[] => {
  const root = newDir()
  for (const f of list) {
    const rel = f.path.startsWith(cwd + '/') ? f.path.slice(cwd.length + 1) : f.path
    const parts = rel.split('/')
    if (parts[0] === '') parts[0] = '/'
    let d = root
    for (const p of parts.slice(0, -1)) {
      if (!d.dirs.has(p)) d.dirs.set(p, newDir())
      d = d.dirs.get(p)!
      d.adds += f.adds
      d.dels += f.dels
    }
    d.files.set(parts.at(-1)!, f)
  }
  const rows: Row[] = []
  const walk = (d: Dir, indent: string | undefined, path: string) => {
    const kids: [string, Dir | FileStat][] = [
      ...[...d.dirs].sort(([a], [b]) => a.localeCompare(b)),
      ...[...d.files].sort(([a], [b]) => a.localeCompare(b)),
    ]
    kids.forEach(([name, kid], i) => {
      const last = i === kids.length - 1
      const prefix = indent === undefined ? '' : indent + (last ? '└─ ' : '├─ ')
      const next = indent === undefined ? '' : indent + (last ? '   ' : '│  ')
      if ('path' in kid) return rows.push({ key: path + name, prefix, name, adds: kid.adds, dels: kid.dels, file: kid })
      let label = name, dir = kid
      while (dir.files.size === 0 && dir.dirs.size === 1) {
        const [sub, subDir] = [...dir.dirs][0]!
        label = (label === '/' ? '/' : label + '/') + sub
        dir = subDir
      }
      label = label === '/' ? '/' : label + '/'
      rows.push({ key: path + label, prefix, name: label, adds: dir.adds, dels: dir.dels })
      walk(dir, next, path + label)
    })
  }
  walk(root, undefined, '')
  return rows
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'edited-files', description: 'Show files edited this session' })
    void $.ui.open({ id: PANE, title: 'Edited files' })
    return next(e)
  })

  // an open the mod makes on its own waits below 144 columns; one answering a
  // prompt is placed at any width, inline above the prompt when narrow
  on('prompt.submit', async ($, e, next) => {
    await $.ui.open({ id: PANE, title: 'Edited files' })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'edited-files' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Edited files' })
    return { text: 'Edited files pane opened.' }
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && !ran.isError) {
      const r = ran.result
      await record($, patchStat(r.filePath, hunkLines(r.structuredPatch), 'modified'))
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && !ran.isError) {
      const r = ran.result
      // a new file may come back with an empty patch: its content is the diff
      const lines = r.structuredPatch.length ? hunkLines(r.structuredPatch) : r.content.split('\n').map(l => '+' + l)
      await record($, patchStat(r.filePath, lines, r.type === 'create' ? 'new' : 'modified'))
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const before = await snapshot($)
    const ran = await next(e)
    if (!before || ran.deny !== undefined) return ran
    try {
      const after = await snapshot($)
      if (after && after.top === before.top && after.tree !== before.tree)
        for (const stat of await bashStats($, before.top, before.tree, after.tree)) await record($, stat)
    } catch {}
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const cwd = await $.session.cwd()
    const diff = await read($, open)

    if (diff) {
      const name = diff.path.startsWith(cwd + '/') ? diff.path.slice(cwd.length + 1) : diff.path
      return (
        <Box flexDirection="column">
          <Box flexDirection="row">
            <Button plain hotkey="b" autoFocus onPress={() => update($, open, () => null)}>back</Button>
            <Text bold wrap="truncate-end">  {name}</Text>
          </Box>
          {diff.lines.length === 0 && <Text dimColor>No diff to show.</Text>}
          {diff.lines.map(l => (
            <Text wrap="truncate-end" dimColor={l.startsWith('@@')}
              color={l[0] === '+' ? 'green' : l[0] === '-' ? 'red' : undefined}>{l}</Text>
          ))}
        </Box>
      )
    }

    const list = await read($, files)
    const min = await read($, minimized)
    const rows = min ? [] : tree(list, cwd)
    const show = (f: FileStat) => async () => {
      const lines = await diffLines($, f.changes ?? []).catch(() => ['(could not read the diff)'])
      await update($, open, () => ({ path: f.path, lines }))
    }

    return (
      <Box flexDirection="column">
        {list.length === 0 && <Text dimColor>No edits yet.</Text>}
        {list.length > 0 && (
          <Box flexDirection="row" marginBottom={min ? 0 : 1}>
            <Box flexGrow={1}>
              <Text dimColor>{list.length} file{list.length === 1 ? '' : 's'}</Text>
            </Box>
            <Text color="green" dimColor> +{list.reduce((n, f) => n + f.adds, 0)}</Text>
            <Text color="red" dimColor> -{list.reduce((n, f) => n + f.dels, 0)}</Text>
            <Text> </Text>
            <Button key="toggle" plain hotkey="m" dimColor onPress={() => update($, minimized, m => !m)}>
              {min ? 'expand' : 'minimize'}
            </Button>
          </Box>
        )}
        {rows.map(r => (
          <Box key={r.key} flexDirection="row">
            <Text dimColor>{r.prefix}</Text>
            <Box flexGrow={1}>
              {r.file
                ? <Button key={r.key} plain onPress={show(r.file)}>
                    <Text wrap="truncate-end" strikethrough={r.file.status === 'deleted'}
                      color={r.file.status === 'new' ? 'green' : r.file.status === 'deleted' ? 'red' : undefined}>{r.name}</Text>
                    {(r.file.status === 'new' || r.file.status === 'deleted') && <Text dimColor> {r.file.status}</Text>}
                  </Button>
                : <Text bold color="blue" wrap="truncate-end">{r.name}</Text>}
            </Box>
            <Text color="green" dimColor={!r.file}> +{r.adds}</Text>
            <Text color="red" dimColor={!r.file}> -{r.dels}</Text>
          </Box>
        ))}
        {!min && list.length > 0 && e.props.isFocused && <Text dimColor>Enter on a file shows its diff</Text>}
      </Box>
    )
  })
}
