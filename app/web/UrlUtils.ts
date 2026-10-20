export const addHttpsProtocol = (url: string): string => {
  url = decodeURIComponent(url)
  if (!/^(?:f|ht)tps?:\/\//.test(url)) {
    url = 'https:' + url
  }
  return url
}

const MAX_URL_LENGTH = 2048

// Única puerta de entrada para cualquier URL que venga de fuera (lo que
// escribe el usuario, lo que devuelve un feed RSS o lo que llega guardado en
// sus preferencias). Se parsea con el parser del navegador (no con regex) y
// solo se aceptan http/https: así no pueden colarse "javascript:", "data:",
// "vbscript:", "file:" ni variantes ofuscadas ("JaVaScRiPt:", espacios,
// tabuladores...), que el parser normaliza antes de comprobar el esquema.
// También se rechazan credenciales embebidas (https://user:pass@host),
// típicas de enlaces de phishing.
export const safeHttpUrl = (
  value: unknown,
  { httpsOnly = false }: { httpsOnly?: boolean } = {}
): string | null => {
  if (typeof value !== 'string') return null
  const str = value.trim()
  if (!str || str.length > MAX_URL_LENGTH) return null
  let url: URL
  try {
    url = new URL(str)
  } catch {
    return null
  }
  const allowed = httpsOnly ? ['https:'] : ['https:', 'http:']
  if (!allowed.includes(url.protocol)) return null
  if (url.username || url.password) return null
  return url.href
}

// Para lo que el usuario añade a mano (fuentes RSS, buscadores): solo https.
export const isValidURL = (str: string): boolean => safeHttpUrl(str, { httpsOnly: true }) !== null

export const encode = (value: string) => encodeURIComponent(value)
