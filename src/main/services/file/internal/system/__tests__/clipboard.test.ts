import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AbsoluteFilePath } from '@shared/types/file'

const { write } = vi.hoisted(() => ({ write: vi.fn() }))
vi.mock('electron', () => ({
  clipboard: { write },
  ClipboardItem: class {
    constructor(readonly data: Record<string, string>) {}
  }
}))

import { writeFileToClipboard } from '../clipboard'

const prefix = process.platform === 'win32' ? 'C:' : ''
const uriPrefix = process.platform === 'win32' ? 'file:///C:' : 'file://'

describe('writeFileToClipboard', () => {
  beforeEach(() => vi.resetAllMocks())
  it.each([
    ['/tmp/plain.txt', '/tmp/plain.txt'],
    ['/tmp/a # % 你好.txt', '/tmp/a%20%23%20%25%20%E4%BD%A0%E5%A5%BD.txt'],
    ['/tmp/line\nbreak.txt', '/tmp/line%0Abreak.txt'],
    ['/tmp/folder', '/tmp/folder']
  ])('writes a single URI for %s', async (path, expected) => {
    await writeFileToClipboard((prefix + path) as AbsoluteFilePath)
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0][0]).toHaveLength(1)
    expect(write.mock.calls[0][0][0].data).toEqual({ 'text/uri-list': uriPrefix + expected })
  })
  it('propagates clipboard failures', async () => {
    write.mockRejectedValueOnce(new Error('clipboard failed'))
    await expect(writeFileToClipboard('/tmp/a' as AbsoluteFilePath)).rejects.toThrow('clipboard failed')
  })
})
