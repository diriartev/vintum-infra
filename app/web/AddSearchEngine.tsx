import { useState } from 'react'
import { safeHttpUrl } from 'src/utils/UrlUtils'

import { TiPlus } from 'react-icons/ti'
import { Button } from 'src/components/Elements'
import { AI_PROMPT_ENGINES } from 'src/config/SearchEngines'
import { useUserPreferences } from 'src/stores/preferences'

export const AddSearchEngine = () => {
  const { addSearchEngine, promptEngines } = useUserPreferences()
  const [searchEngineUrl, setSearchEngineUrl] = useState<string | undefined>()
  const [inputFeedback, setInputFeedback] = useState<string | undefined>()
  const mergedEngines = [...AI_PROMPT_ENGINES, ...promptEngines]

  const onAddSearchEngine = async () => {
    if (!searchEngineUrl) {
      setInputFeedback('Please provide a valid search engine URL')
      return
    }

    const safeUrl = safeHttpUrl(searchEngineUrl, { httpsOnly: true })
    if (!safeUrl) {
      setInputFeedback('Only https:// search engine URLs are allowed (e.g. https://duckduckgo.com/?q=)')
      return
    }

    // La búsqueda se añade al final de la URL: tiene que terminar en un
    // parámetro de consulta vacío (…?q= o …&query=).
    if (!/[?&][\w.-]+=$/.test(safeUrl)) {
      setInputFeedback('The URL must end with the search parameter, e.g. https://duckduckgo.com/?q=')
      return
    }

    if (mergedEngines.some((se) => se.url === safeUrl)) {
      setInputFeedback('Search engine already exists')
      return
    }

    // Nombre a partir del dominio (solo letras/números/guiones, máx. 30)
    const url = new URL(safeUrl)
    const label = url.hostname.replace(/^www\./, '').split('.')[0].replace(/[^a-z0-9-]/gi, '').slice(0, 30)
    if (!label || mergedEngines.some((se) => se.label.toLowerCase() === label.toLowerCase())) {
      setInputFeedback('Search engine already exists')
      return
    }

    addSearchEngine({ label: label, url: safeUrl, default: false })
    setSearchEngineUrl('')
    setInputFeedback('Search engine added successfully')
  }

  return (
    <div className="settingRow">
      <p className="settingTitle">Search engine URL</p>
      <div className="settingContent">
        <div className="form">
          <input
            type="text"
            inputMode="url"
            maxLength={2048}
            autoComplete="off"
            spellCheck={false}
            value={searchEngineUrl || ''}
            onChange={(e) => setSearchEngineUrl(e.target.value)}
            placeholder="https://duckduckgo.com/?q="
          />
          <div>
            <Button startIcon={<TiPlus />} size="small" onClick={onAddSearchEngine}>
              Add
            </Button>
          </div>
        </div>
        {inputFeedback && (
          <div className="settingHint">
            <p>{inputFeedback}</p>
          </div>
        )}
      </div>
    </div>
  )
}
