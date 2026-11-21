import path from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fileErrorCodes } from '@shared/ipc/errors/file'
import type { AbsoluteFilePath } from '@shared/types/file'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

vi.mock('../../system', () => ({ safeOpen: vi.fn() }))

const { safeOpen } = await import('../../system')
const { application } = await import('@application')
const { resolveRequestedPath, openRequestPath } = await import('../requestedPath')

const HOME = path.resolve('fixtures', 'home', 'alice')
const WORKSPACE = path.join(HOME, 'project') as AbsoluteFilePath

function expectRejected(rawPath: string, reason: 'relative' | 'invalid', workspaceRoot?: AbsoluteFilePath): void {
  try {
    resolveRequestedPath(rawPath, workspaceRoot)
    throw new Error(`expected ${JSON.stringify(rawPath)} to be rejected`)
  } catch (error) {
    expect(error).toMatchObject({
      code: fileErrorCodes.OPEN_TARGET_UNAVAILABLE,
      data: { path: rawPath, reason }
    })
  }
}

describe('resolveRequestedPath', () => {
  beforeEach(() => {
    vi.spyOn(application, 'getPath').mockImplementation((key: string) => {
      if (key === 'sys.home') return HOME
      throw new Error(`Unexpected application.getPath(${key})`)
    })
  })

  it('resolves a workspace-relative path against the session workspace', () => {
    expect(resolveRequestedPath('assets/logo.png', WORKSPACE)).toBe(path.join(WORKSPACE, 'assets', 'logo.png'))
  })

  it('leaves an already-absolute path alone even when a workspace root is given', () => {
    const target = path.resolve('output', 'logo.png')
    expect(resolveRequestedPath(target, WORKSPACE)).toBe(target)
  })

  it('expands a home-relative path', () => {
    expect(resolveRequestedPath('~/notes/draft.md')).toBe(path.join(HOME, 'notes', 'draft.md'))
  })

  it('allows an escape above the workspace root, which agents legitimately produce', () => {
    expect(resolveRequestedPath('../shared/logo.png', WORKSPACE)).toBe(path.join(HOME, 'shared', 'logo.png'))
  })

  it('refuses a relative path when no workspace root is available', () => {
    expectRejected('assets/logo.png', 'relative')
  })

  it('refuses a relative path whose root is itself not absolute', () => {
    expectRejected('assets/logo.png', 'relative', 'project' as AbsoluteFilePath)
  })

  it.each(['', '   '])('refuses an empty path %j', (rawPath) => {
    expectRejected(rawPath, 'invalid', WORKSPACE)
  })
})

describe('openRequestPath', () => {
  it.each([{ channel: 'ai.agent.session.open_path' } as const, undefined])(
    'forwards context %j unchanged after workspace resolution',
    async (context) => {
      vi.mocked(safeOpen).mockClear()
      await openRequestPath('assets/report.docx', WORKSPACE, context)
      expect(safeOpen).toHaveBeenCalledExactlyOnceWith(path.join(WORKSPACE, 'assets', 'report.docx'), context)
      expect(vi.mocked(safeOpen).mock.calls[0][1]).toBe(context)
    }
  )
})
