import { useEffect, useRef, useState } from 'react'

import { ipcApi } from '@renderer/ipc'

/** An object URL for an audio file NOVA Studio saved, read through the main process. */
export function useAudioUrl(path: string, type: string): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    let created: string | null = null
    void ipcApi.request('nova.media.read_file', { path }).then((bytes) => {
      if (!live || !bytes) return
      created = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type }))
      setUrl(created)
    })
    return () => {
      live = false
      if (created) URL.revokeObjectURL(created)
    }
  }, [path, type])
  return url
}

/** Records from the microphone into a WebM/Opus file. */
export function useRecorder() {
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current)
      recorder.current?.stream.getTracks().forEach((track) => track.stop())
    },
    []
  )

  const start = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    chunks.current = []
    const next = new MediaRecorder(stream)
    next.ondataavailable = (event) => chunks.current.push(event.data)
    next.start()
    recorder.current = next
    setSeconds(0)
    setRecording(true)
    timer.current = setInterval(() => setSeconds((value) => value + 1), 1000)
  }

  /** Stops recording and resolves with the recording's bytes. */
  const stop = () =>
    new Promise<Uint8Array<ArrayBuffer>>((resolve) => {
      const current = recorder.current
      if (!current) return resolve(new Uint8Array())
      current.onstop = async () => {
        current.stream.getTracks().forEach((track) => track.stop())
        resolve(new Uint8Array(await new Blob(chunks.current, { type: 'audio/webm' }).arrayBuffer()))
      }
      current.stop()
      if (timer.current) clearInterval(timer.current)
      setRecording(false)
    })

  return { recording, seconds, start, stop }
}
