import { useUiStore } from '@/stores/ui'

import { useSettingsStore } from '@/stores/settings'

import { useGalleryStore } from '@/stores/gallery'

import { generateThumbCandidates, pickThumbCandidate } from '@/api/thumbs'

import { openThumbPicker } from '@/composables/useThumbPicker'

import { t } from '@/i18n'



export async function regenerateThumbSmart(videoId: string) {

  const ui = useUiStore()

  const settings = useSettingsStore()

  const gallery = useGalleryStore()

  const autoBest = settings.settings?.thumb_auto_select_best !== false



  if (autoBest) {

    try {

      const res = await generateThumbCandidates(videoId)

      const cands = res.candidates || []

      if (!cands.length) {

        ui.showToast(t('thumb.noCandidatesRetry'))

        return false

      }

      const best = cands[0]

      await pickThumbCandidate(videoId, best.index)

      ui.showToast(t('thumb.autoSelected', { pct: Math.round(best.pos * 100) }))

      await gallery.loadVideos()

      return true

    } catch {

      ui.showToast(t('thumb.autoPickFailed'))

    }

  }



  const picked = await openThumbPicker(videoId)

  if (picked) await gallery.loadVideos()

  return picked

}


