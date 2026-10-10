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
