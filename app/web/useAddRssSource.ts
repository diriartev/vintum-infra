import { useState } from 'react'
import { getRssUrlFeed } from 'src/features/cards'
import { identifyUserCards, trackRssSourceAdd } from 'src/lib/analytics'
import { useUserPreferences } from 'src/stores/preferences'
import { SupportedCardType } from 'src/types'
import { safeHttpUrl } from 'src/utils/UrlUtils'

const MAX_CUSTOM_SOURCES = 50

// Misma lógica que ya usaba RssSetting.tsx para "Add new Source" (RSS
// manual) -- la saco a un hook compartido para que las fuentes sugeridas
// de seguridad usen exactamente el mismo camino (mismo proxy del engine
// público para resolver metadata del feed, sin URLs nuevas hardcodeadas
// como si fueran de confianza especial: se validan igual que cualquier
// RSS que un usuario tipee a mano).
export function useAddRssSource() {
  const { cards, setCards, userCustomCards, setUserCustomCards } = useUserPreferences()
  const [pendingUrl, setPendingUrl] = useState<string | null>(null)

  const isAdded = (feedUrl: string) => userCustomCards.some((card) => card.feedUrl === feedUrl)

  const addRssSource = async (rawUrl: string): Promise<{ ok: boolean; message: string }> => {
    const feedUrl = safeHttpUrl(rawUrl, { httpsOnly: true })
    if (!feedUrl) {
      return { ok: false, message: 'Invalid RSS Feed URL. Only https:// URLs are allowed' }
    }
    if (isAdded(feedUrl)) {
      return { ok: false, message: 'Already added' }
    }
    if (userCustomCards.length >= MAX_CUSTOM_SOURCES) {
      return { ok: false, message: `You can add up to ${MAX_CUSTOM_SOURCES} custom sources` }
    }

    setPendingUrl(feedUrl)
    try {
      const info = await getRssUrlFeed(feedUrl)
      // Lo que responde el motor sobre el feed es de terceros: título como
      // texto plano acotado, enlace solo http(s) e icono solo https.
      const title = String(info?.title ?? '')
        .replace(/[\u0000-\u001f<>]/g, '')
        .trim()
        .slice(0, 80)
      if (!title) {
        return { ok: false, message: "That URL doesn't look like a valid RSS feed" }
      }
      const link = safeHttpUrl(info.link) ?? feedUrl

      if (userCustomCards.some((card) => card.link === link)) {
        return { ok: false, message: 'RSS Feed already exists' }
      }

      const value = title.toLowerCase()
      if (userCustomCards.some((card) => card.value === value)) {
        return { ok: false, message: 'RSS Feed already exists' }
      }
      const customCard: SupportedCardType = {
        feedUrl,
        label: title,
        value,
        analyticsTag: value,
        link,
        type: 'rss',
        icon: safeHttpUrl(info.icon, { httpsOnly: true }) ?? undefined,
      }
      setUserCustomCards([...userCustomCards, customCard])
      const newCards = [
        ...cards,
        { id: cards.length, name: customCard.value, type: customCard.type },
      ]
      setCards(newCards)
      identifyUserCards(newCards.map((card) => card.name))
      trackRssSourceAdd(customCard.value)
      return { ok: true, message: 'Added' }
    } catch {
      return { ok: false, message: 'Error occured. Please check and try again' }
    } finally {
      setPendingUrl(null)
    }
  }

  return { addRssSource, isAdded, pendingUrl }
}
