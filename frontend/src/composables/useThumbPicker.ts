import { generateThumbCandidates } from '@/api/thumbs'
import { t } from '@/i18n'
import { useUiStore } from '@/stores/ui'

export async function openThumbPicker(videoId: string, subtitle = ''): Promise<boolean> {
  const ui = useUiStore()
  try {
    const res = await generateThumbCandidates(videoId)
    return await ui.showThumbPicker({
      videoId,
      subtitle,
      candidates: res.candidates || [],
      version: res.version || String(Date.now()),
    })
  } catch {
    ui.showToast(t('thumb.noCandidates'))
    return false
  }
}
