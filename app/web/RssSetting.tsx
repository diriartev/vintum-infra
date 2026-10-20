import { useState } from 'react'
import BeatLoader from 'react-spinners/BeatLoader'

import { BsRssFill } from 'react-icons/bs'
import { Button } from 'src/components/Elements'
import { useAddRssSource } from 'src/features/settings/hooks/useAddRssSource'

// "Add new Source": usa el mismo hook que las fuentes sugeridas, que valida
// la URL (solo https) y sanea lo que devuelve el motor sobre el feed.
export const RssSetting = () => {
  const { addRssSource, pendingUrl } = useAddRssSource()
  const [rssUrl, setRssUrl] = useState<string>('')
  const [feedback, setFeedback] = useState<string | undefined>()

  const onRssAddClick = async () => {
    if (!rssUrl.trim()) {
      setFeedback('Please provide an RSS Feed URL')
      return
    }
    const result = await addRssSource(rssUrl)
    setFeedback(result.ok ? 'RSS Feed Added' : result.message)
    if (result.ok) setRssUrl('')
  }

  const isLoading = pendingUrl !== null

  return (
    <div className="settingRow">
      <p className="settingTitle">RSS Feed URL</p>
      <div className="settingContent">
        <div className="form">
          <input
            type="text"
            inputMode="url"
            maxLength={2048}
            autoComplete="off"
            spellCheck={false}
            value={rssUrl}
            onChange={(e) => setRssUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !isLoading && onRssAddClick()}
            placeholder="https://url.com/rss/feed"
          />
          {isLoading ? (
            <BeatLoader color={'#A9B2BD'} loading={isLoading} size={6} />
          ) : (
            <div>
              <Button
                startIcon={<BsRssFill />}
                size="small"
                className="rssButton"
                onClick={onRssAddClick}>
                Add
              </Button>
            </div>
          )}
        </div>
        {feedback && (
          <div className="settingHint">
            <p>{feedback}</p>
          </div>
        )}
      </div>
    </div>
  )
}
