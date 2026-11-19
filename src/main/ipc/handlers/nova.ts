import { application } from '@application'
import { novaAccountService } from '@main/services/nova/NovaAccountService'
import type { novaRequestSchemas } from '@shared/ipc/schemas/nova'
import type { novaMediaRequestSchemas } from '@shared/ipc/schemas/novaMedia'
import type { IpcHandlersFor } from '@shared/ipc/types'

const media = () => application.get('NovaMediaService')

export const novaHandlers: IpcHandlersFor<typeof novaRequestSchemas> = {
  'nova.status': () => novaAccountService.status(),
  'nova.sign_in': ({ email, password, otp }) => novaAccountService.signIn(email, password, otp),
  'nova.create_key': () => novaAccountService.createKey(),
  'nova.summary': () => novaAccountService.summary(),
  'nova.sign_out': () => novaAccountService.signOut()
}

export const novaMediaHandlers: IpcHandlersFor<typeof novaMediaRequestSchemas> = {
  'nova.media.catalog': ({ refresh }) => media().catalog(refresh),
  'nova.media.enhance_prompt': ({ prompt, kind }) => media().enhancePrompt(prompt, kind),
  'nova.media.reveal': async ({ path }) => media().reveal(path),
  'nova.media.save_as': ({ path, suggestedName }) => media().saveAs(path, suggestedName),
  'nova.media.save_image': ({ dataUrl, suggestedName }) => media().saveImage(dataUrl, suggestedName),
  'nova.media.read_file': ({ path }) => media().readFile(path),
  'nova.video.list': async () => media().listVideos(),
  'nova.video.create': (input) => media().createVideos(input),
  'nova.video.retry': ({ id }) => media().retryVideo(id),
  'nova.video.update': async ({ id, favorite }) => media().updateVideo(id, favorite),
  'nova.video.delete': ({ ids }) => media().deleteVideos(ids),
  'nova.video.input_image': ({ path }) => media().inputImage(path),
  'nova.speech.list': async () => media().listSpeech(),
  'nova.speech.synthesize': (input) => media().synthesize(input),
  'nova.speech.delete': ({ ids }) => media().deleteSpeech(ids),
  'nova.transcription.list': async () => media().listTranscripts(),
  'nova.transcription.run': (input) => media().transcribe(input),
  'nova.transcription.delete': ({ ids }) => media().deleteTranscripts(ids),
  'nova.voice.settings': async () => media().voiceSettings(),
  'nova.voice.update_settings': (changes) => media().updateVoiceSettings(changes),
  'nova.extraction.run': (input) => media().extract(input),
  'nova.decision.run': (input) => media().decide(input)
}
