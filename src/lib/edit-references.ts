import type { ModelType } from '../api/comfyui'

/** Qwen-Image-Edit (2509/2511) and FireRed edit files take the source image
 *  through TextEncodeQwenImageEditPlus; plain Qwen-Image does latent img2img. */
export function isQwenImageEditModel(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.includes('edit') && (lower.includes('qwen') || lower.includes('firered'))
}

/** The most extra references any family takes in LU (Qwen-Image 2.1). */
export const MAX_EXTRA_REFERENCES = 3

/** The most further photos the store keeps for a cloud run: the cap of five
 *  photos (create-studio MAX_STUDIO_PHOTOS) minus the large source image. Each
 *  model shows and sends only as many as it reads. */
export const MAX_STORED_REFERENCES = 4

/**
 * How many reference images an Edit may carry BESIDES the source, for one
 * local image model. 0 hides the reference strip.
 *
 * GH #144 and Discord (s3aldra 2026-09-23 and 09-27, tbjdrw 2026-09-25):
 * Edit took one image, so "put the person from this photo into that scene"
 * could not be asked at all. Read off the node schemas:
 *   - TextEncodeQwenImage21 (Qwen-Image 2.1) has an Autogrow group of
 *     reference slots image_1 to image_16. LU offers four images in all, the
 *     range the official edit template and the model card show.
 *   - TextEncodeQwenImageEditPlus (Qwen-Image-Edit 2509/2511) has image1 to
 *     image3, so the source plus two.
 */
export function extraReferenceSlots(type: ModelType | null | undefined, modelName: string): number {
  if (type === 'qwenimage') return MAX_EXTRA_REFERENCES
  if (type === 'qwenimage1' && isQwenImageEditModel(modelName)) return 2
  return 0
}
