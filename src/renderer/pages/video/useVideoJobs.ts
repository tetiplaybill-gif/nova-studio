import { useCallback, useEffect, useState } from 'react'

import { ipcApi, useIpcOn } from '@renderer/ipc'
import type { NovaVideoJob, NovaVideoJobStatus } from '@shared/ipc/schemas/novaMedia'

export const RUNNING_STATUSES: readonly NovaVideoJobStatus[] = ['submitting', 'pending', 'in_progress', 'downloading']

/** The video history, newest first, kept current by the main process's job updates. */
export function useVideoJobs() {
  const [jobs, setJobs] = useState<NovaVideoJob[]>([])

  const reload = useCallback(async () => setJobs(await ipcApi.request('nova.video.list')), [])

  useEffect(() => {
    void reload()
  }, [reload])

  useIpcOn('nova.video.job_updated', (job) => {
    setJobs((current) => {
      const index = current.findIndex((entry) => entry.id === job.id)
      if (index === -1) return [job, ...current]
      const next = [...current]
      next[index] = job
      return next
    })
  })

  const remove = useCallback(async (ids: string[]) => {
    await ipcApi.request('nova.video.delete', { ids })
    setJobs((current) => current.filter((job) => !ids.includes(job.id)))
  }, [])

  const setFavorite = useCallback(async (id: string, favorite: boolean) => {
    await ipcApi.request('nova.video.update', { id, favorite })
  }, [])

  return { jobs, reload, remove, setFavorite }
}

/** Object URLs for finished clips, read through the main process so frames can be captured. */
const clipUrls = new Map<string, Promise<string | null>>()

export function clipUrl(path: string): Promise<string | null> {
  let url = clipUrls.get(path)
  if (!url) {
    url = ipcApi
      .request('nova.media.read_file', { path })
      .then((bytes) => (bytes ? URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'video/mp4' })) : null))
    clipUrls.set(path, url)
  }
  return url
}

export function useClipUrl(path: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setUrl(null)
    if (path) void clipUrl(path).then((value) => live && setUrl(value))
    return () => {
      live = false
    }
  }, [path])
  return url
}

/** The frame a video element shows, as a PNG data URL. */
export function captureFrame(video: HTMLVideoElement): string {
  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  canvas.getContext('2d')?.drawImage(video, 0, 0)
  return canvas.toDataURL('image/png')
}

/** Seeks a clip to its last frame and captures it. */
export function captureLastFrame(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'auto'
    video.onloadedmetadata = () => {
      video.currentTime = Math.max(0, video.duration - 0.05)
    }
    video.onseeked = () => resolve(captureFrame(video))
    video.onerror = () => reject(new Error('unreadable clip'))
    video.src = url
  })
}

/** Reads a picked image file as a data URL. */
export function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/** Length of a picked video file in seconds, for the price estimate. */
export function mediaSeconds(url: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => resolve(Number.isFinite(video.duration) ? Math.ceil(video.duration) : undefined)
    video.onerror = () => resolve(undefined)
    video.src = url
  })
}
