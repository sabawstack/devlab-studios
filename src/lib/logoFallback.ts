import { getImage } from 'astro:assets'
import devlabStudiosLogo from '../assets/devlabstudios-logo-only.png'

/**
 * The bundled copy of the logo the navbar and footer swap to when the R2 logo
 * cannot load. The source PNG is 839x1135 (36 KB) and was served as-is for a
 * 40-44 px slot; this is a 2x (88 px) WebP of it instead. Both components ask
 * for the same size, so a page fetches it at most once.
 */
export async function logoFallbackSrc(): Promise<string> {
  const image = await getImage({ src: devlabStudiosLogo, width: 88, format: 'webp' })
  return image.src
}
