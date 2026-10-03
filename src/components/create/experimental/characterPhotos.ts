// What a set of character photos can do next: load into the reference strip,
// or start a training set in Character Studio. Used by the frames picked from
// a video and by a saved character (lib/saved-characters).
import { useCreateStore } from '../../../stores/createStore'
import { MAX_STORED_REFERENCES } from '../../../lib/edit-references'
import { frameFileName } from '../../../lib/video-frames'
import { loadImageRef } from './loadImage'
import { mediaRefFrom } from './mediaRef'

function asFiles(name: string, photos: readonly Blob[]): File[] {
  return photos.map((blob, i) => new File([blob], frameFileName(name, i), { type: blob.type || 'image/jpeg' }))
}

/**
 * The first photo becomes the source image, the next ones fill the reference
 * strip under it. Edit and Animate Image keep their tab, every other tab
 * switches to Edit. A model shows and sends only as many photos as it reads.
 * Returns how many photos were loaded.
 */
export async function loadPhotosAsReferences(name: string, photos: readonly Blob[]): Promise<number> {
  const files = asFiles(name, photos).slice(0, MAX_STORED_REFERENCES + 1)
  if (files.length === 0) return 0
  const st = useCreateStore.getState()
  const intent = st.intent()
  if (intent !== 'edit' && intent !== 'animate') st.setIntent('edit')
  const refs = []
  for (const file of files) refs.push(await loadImageRef(file))
  const now = useCreateStore.getState()
  now.setBatchSources([])
  now.setMask(null)
  now.setSource(refs[0])
  now.setReferences(refs.slice(1))
  return refs.length
}

/** The photos join the training set in Character Studio. The studio's own
 *  minimum and maximum stay as they are. */
export function sendPhotosToStudio(name: string, photos: readonly Blob[]): void {
  const st = useCreateStore.getState()
  st.setIntent('character')
  st.setCharacterTab('train')
  st.addTrainImages(asFiles(name, photos).map(mediaRefFrom))
}
