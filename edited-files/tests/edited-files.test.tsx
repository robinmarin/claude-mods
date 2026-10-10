import { expect, test } from 'claude-code/testing'

const patch = [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 3, lines: [' a', '-b', '+c', '+d'] }]

test('sums +/- per file across edits', async ($, on) => {
  on('tool.call', { tool: 'Edit' }, (_$, e) => ({
    result: {
      filePath: e.file_path, oldString: e.old_string, newString: e.new_string,
      originalFile: null, structuredPatch: patch, userModified: false, replaceAll: false,
    },
  }))
  for (const id of ['t1', 't2'])
    await $.tool.call({ tool: 'Edit', tool_use_id: id, file_path: '/x/a.ts', old_string: 'b', new_string: 'c\nd' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'edited-files', surface, component: 'Pane', requestId: 'edited-files',
      props: { title: 'Edited files', isFocused: false, bodyColumns: 60, bodyRows: 20, placement: 'dock', scroll: { top: 0 } } as never,
    })
    expect(await ui.find({ type: 'Text', text: '+4' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '-2' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '/x/a.ts' })).toBeDefined()
    await ui.unmount()
  }
})

test('counts files a Bash command changed, from git tree snapshots', async ($, on) => {
  const trees = ['t-before', 't-after']
  const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('process.run', (_$, e) =>
    ok(e.argv[0] === 'sh' ? `${trees.shift()}\n/repo\n` : '31\t0\tREADME.md\x002\t1\tsrc/a b.ts\x00-\t-\timg.png\x00'))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'cat > README.md', description: 'x' })

  const ui = await $.ui.mount({
    plugin: 'edited-files', surface: 'terminal', component: 'Pane', requestId: 'edited-files',
    props: { title: 'Edited files', isFocused: false, bodyColumns: 60, bodyRows: 20, placement: 'dock', scroll: { top: 0 } } as never,
  })
  expect(await ui.find({ type: 'Text', text: '+31 ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '/repo/README.md' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '/repo/src/a b.ts' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '/repo/img.png' })).toBeDefined()
  await ui.unmount()
})
