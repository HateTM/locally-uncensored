// How many further photos the model on screen reads besides the source image.
// 0 hides the reference strip. One reader for the strip and for the saved
// characters that load into it.
import { useCreateStore } from '../../../stores/createStore'
import { classifyModel } from '../../../api/comfyui'
import { extraReferenceSlots } from '../../../lib/edit-references'
import { referenceModel, studioExtraPhotoSlots } from '../../../lib/render/create-studio'

export function useReferenceSlots(): number {
  const backend = useCreateStore((s) => s.backend)
  const intent = useCreateStore((s) => s.intent())
  const imageModel = useCreateStore((s) => s.imageModel)
  const listedType = useCreateStore((s) => s.imageModelList.find((m) => m.name === s.imageModel)?.type)
  const cloudImageModel = useCreateStore((s) => s.cloudImageModel)
  const cloudVideoModel = useCreateStore((s) => s.cloudVideoModel)
  const cloudOpModel = useCreateStore((s) => s.cloudOpModel)
  // The type from the fetched list carries the header sniff; the name is the
  // fallback, exactly as useCreate decides the pipeline.
  if (backend === 'cloud') {
    const pick = referenceModel(intent, { cloudImageModel, cloudVideoModel, cloudOpModel })
    return pick ? studioExtraPhotoSlots(pick) : 0
  }
  return intent === 'edit' ? extraReferenceSlots(listedType ?? classifyModel(imageModel), imageModel) : 0
}
