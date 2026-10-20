// Las preferencias del front (temas seguidos, tarjetas visibles, layout,
// tema visual, etc.) son un blob que evoluciona junto con la UI de Vintum.
// En vez de espejar cada tipo interno del front acá (y romper cada vez que
// agreguen un campo), validamos la FORMA general: objeto plano, tamaño
// acotado, y que cada clave conocida tenga el tipo esperado si está
// presente. Nunca se interpreta ni se usa para construir queries -- solo se
// guarda y se devuelve tal cual (parametrizado), así que un campo con una
// forma inesperada no es una superficie de inyección, es simplemente
// rechazado antes de tocar la base.
const MAX_SERIALIZED_BYTES = 65536;

type FieldKind = "array" | "object" | "string" | "number" | "boolean" | "any";

const EXPECTED_SHAPE: Record<string, FieldKind> = {
  cards: "array",
  cardsSettings: "object",
  userSelectedTags: "array",
  layout: "string",
  theme: "string",
  occupation: "any", // string | null
  maxVisibleCards: "number",
  listingMode: "string",
  promptEngine: "string",
  promptEngines: "array",
  DNDDuration: "any", // string | { value, countdown }
  showReadPosts: "boolean",
  openLinksNewTab: "boolean",
  onboardingCompleted: "boolean",
  // Definición completa de cada fuente RSS custom que agregó el usuario
  // (label/url/icono) -- sin esto, otro dispositivo sabe QUÉ fuentes tiene
  // seleccionadas (via "cards") pero no CÓMO son, y no puede mostrarlas.
  userCustomCards: "array",
};

function kindOf(value: unknown): FieldKind {
  if (Array.isArray(value)) return "array";
  if (value === null) return "any";
  switch (typeof value) {
    case "object":
      return "object";
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    default:
      return "any";
  }
}

// --- URLs dentro de las preferencias -----------------------------------
// Los buscadores y fuentes RSS propios llevan URLs que luego el front abre o
// usa como imagen. El front ya las valida, pero eso se puede saltar llamando
// a la API directamente: aquí se vuelven a validar (defensa en profundidad)
// y se guarda solo una copia limpia de cada entrada, con campos conocidos.
const MAX_URL_LENGTH = 2048;
const MAX_PROMPT_ENGINES = 20;
const MAX_CUSTOM_CARDS = 50;

function safeUrl(value: unknown, httpsOnly: boolean): string | null {
  if (typeof value !== "string") return null;
  const str = value.trim();
  if (!str || str.length > MAX_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(str);
  } catch {
    return null;
  }
  if (httpsOnly ? url.protocol !== "https:" : !["https:", "http:"].includes(url.protocol)) return null;
  if (url.username || url.password) return null;
  return url.href;
}

function plainText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  // sin caracteres de control ni < > (nunca debería haber HTML aquí)
  const clean = value.replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, max);
  return clean || null;
}

function cleanPromptEngines(list: unknown[]): unknown[] | null {
  if (list.length > MAX_PROMPT_ENGINES) return null;
  const out = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) return null;
    const e = item as Record<string, unknown>;
    const label = plainText(e.label, 40);
    const url = safeUrl(e.url, true);
    if (!label || !url) return null;
    out.push({ label, url, default: e.default === true });
  }
  return out;
}

function cleanCustomCards(list: unknown[]): unknown[] | null {
  if (list.length > MAX_CUSTOM_CARDS) return null;
  const out = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) return null;
    const c = item as Record<string, unknown>;
    const feedUrl = safeUrl(c.feedUrl, false);
    const label = plainText(c.label, 120);
    const value = plainText(c.value, 120);
    if (!feedUrl || !label || !value) return null;
    const card: Record<string, unknown> = {
      feedUrl,
      label,
      value,
      analyticsTag: plainText(c.analyticsTag, 120) ?? value,
      link: safeUrl(c.link, false) ?? feedUrl,
      type: "rss",
    };
    const icon = safeUrl(c.icon, true);
    if (icon) card.icon = icon;
    out.push(card);
  }
  return out;
}

export function validatePreferencesPayload(body: unknown): Record<string, unknown> | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;

  const serialized = JSON.stringify(body);
  if (Buffer.byteLength(serialized, "utf8") > MAX_SERIALIZED_BYTES) return null;

  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    const expected = EXPECTED_SHAPE[key];
    if (!expected) continue; // ignora cualquier clave que no reconocemos
    if (value === undefined) continue;
    const actual = kindOf(value);
    if (expected !== "any" && actual !== expected) return null;
    if (key === "promptEngines") {
      const engines = cleanPromptEngines(value as unknown[]);
      if (!engines) return null;
      clean[key] = engines;
      continue;
    }
    if (key === "userCustomCards") {
      const cards = cleanCustomCards(value as unknown[]);
      if (!cards) return null;
      clean[key] = cards;
      continue;
    }
    clean[key] = value;
  }
  return clean;
}
