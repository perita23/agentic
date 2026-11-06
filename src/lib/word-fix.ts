/**
 * Word by word: which words of a text are worth sending to the local model (the ones just typed, in plain language),
 * and the instant fixes that need no model at all (chat abbreviations).
 */
export interface Token {
  start: number;
  end: number;
  word: string;
  /** The (up to 6) words before it, for context. */
  before: string;
}

const WORD = /[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*/gu;

/** Words that are right and so common that asking the model about them is a waste. */
const COMMON = new Set(
  (
    "el la los las un una unos unas de del al a en y o u e ni que qué se su sus mi mis tu tus lo le les me te nos os no sí si por para con sin sobre entre hasta desde hacia como cómo cuando cuándo donde dónde quien quién cual cuál " +
    "es son era fue ser está están estar ha han he hay había habrá hacer hace haz hizo puede pueden poder puedo quiero quiere querer tengo tiene tener voy va van ir vamos dice decir dime dame ver mira hacer " +
    "este esta esto estos estas ese esa eso esos esas aquel aquella aquello otro otra otros otras mismo misma todo toda todos todas algo alguien nada nadie cada mucho mucha muy más menos tan tanto poco bastante " +
    "ya aún todavía ahora luego antes después siempre nunca también tampoco aquí ahí allí así bien mal mejor peor solo sólo pero aunque porque pues entonces además " +
    "uno dos tres cuatro cinco seis siete ocho nueve diez primero segundo tercero año años día días vez veces cosa cosas parte forma tipo caso " +
    "archivo archivos código función error errores fichero carpeta proyecto texto mensaje prompt " +
    "the a an and or but if then of to in on at by for with from as is are was were be been it this that these those i you he she we they me my your our their not no yes do does did have has had will would can could should please " +
    "what when where which who how why all any some one two more most other new just only also very"
  ).split(/\s+/),
);

/** Chat shorthand with one sure meaning: fixed on the spot. */
const SHORTHAND: Record<string, string> = {
  q: "que",
  k: "que",
  ke: "que",
  xq: "porque",
  pq: "porque",
  porq: "porque",
  tb: "también",
  tmb: "también",
  tmbn: "también",
  bn: "bien",
  msj: "mensaje",
  dnd: "dónde",
  cmo: "cómo",
  xfa: "por favor",
  xfavor: "por favor",
  porfa: "por favor",
  porfavor: "por favor",
  pls: "por favor",
};

/**
 * Frequent misspellings in Spanish with one sure correction: fixed on the spot, the same every time (a small model is
 * unreliable on exactly these). Only forms that are not words of their own, or of English/other languages.
 */
const MISSPELT: Record<string, string> = {
  // verbs and common words
  corrije: "corrige", corrijes: "corriges", escrivir: "escribir", escrivo: "escribo", escrive: "escribe", eskribir: "escribir",
  aora: "ahora", haora: "ahora", agradesco: "agradezco", entonses: "entonces", entonzes: "entonces",
  nesesito: "necesito", nesecito: "necesito", nesesitas: "necesitas", nesecitas: "necesitas", nesesitamos: "necesitamos", nesecitamos: "necesitamos", nesesario: "necesario", nesecario: "necesario",
  probrema: "problema", porblema: "problema", probelma: "problema", probremas: "problemas", porblemas: "problemas",
  exelente: "excelente", exepcion: "excepción", excepcion: "excepción", exixtir: "existir",
  desir: "decir", dise: "dice", disen: "dicen", dijistes: "dijiste", fuistes: "fuiste", vistes: "viste", hicistes: "hiciste",
  haver: "haber", abeces: "a veces", aveces: "a veces", osea: "o sea", talvez: "tal vez", sinembargo: "sin embargo", porfabor: "por favor",
  ise: "hice", hize: "hice", prueva: "prueba", pruevas: "pruebas", boluntad: "voluntad", bolver: "volver", bamos: "vamos",
  imbitar: "invitar", inbitar: "invitar", enbiar: "enviar", embiar: "enviar", ablar: "hablar", ablo: "hablo", abla: "habla", aser: "hacer", asemos: "hacemos", azer: "hacer",
  // missing accents (only forms that are no word of their own)
  tambien: "también", asi: "así", ademas: "además", despues: "después", aqui: "aquí", alli: "allí", ahi: "ahí", detras: "detrás", atras: "atrás",
  facil: "fácil", dificil: "difícil", rapido: "rápido", manana: "mañana", espanol: "español", contrasena: "contraseña", diseno: "diseño",
  codigo: "código", funcion: "función", informacion: "información", configuracion: "configuración", aplicacion: "aplicación", sesion: "sesión", direccion: "dirección", pagina: "página",
  telefono: "teléfono", numero: "número", musica: "música", ejecucion: "ejecución", conexion: "conexión", descripcion: "descripción", opcion: "opción",
  instalacion: "instalación", actualizacion: "actualización", organizacion: "organización", relacion: "relación", solucion: "solución", ubicacion: "ubicación",
  operacion: "operación", decision: "decisión", desision: "decisión", revision: "revisión", razon: "razón", corazon: "corazón",
};

/** The words of a text with their place. Code blocks are not text: nothing inside them is a word. */
export function wordsOf(text: string): Token[] {
  const out: Token[] = [];
  const spans: [number, number][] = [];
  for (const m of text.matchAll(/```[\s\S]*?(?:```|$)|`[^`\n]*`?/g)) spans.push([m.index!, m.index! + m[0].length]);
  const inCode = (i: number) => spans.some(([a, b]) => i >= a && i < b);
  const words: Token[] = [];
  for (const m of text.matchAll(WORD)) {
    if (inCode(m.index!)) continue;
    words.push({ start: m.index!, end: m.index! + m[0].length, word: m[0], before: "" });
  }
  words.forEach((w, i) => {
    w.before = words
      .slice(Math.max(0, i - 6), i)
      .map((x) => x.word)
      .join(" ");
    out.push(w);
  });
  return out;
}

/** Is it a plain word of the person's language, finished (something other than a letter follows) and worth checking? */
export function checkable(text: string, t: Token): boolean {
  if (t.end >= text.length) return false; // still being typed
  if (t.word.length < 2 && !(t.word.toLowerCase() in SHORTHAND)) return false;
  if (/[A-Z]/.test(t.word.slice(1))) return false; // CamelCase, ALLCAPS, McDonald…
  // The whitespace-delimited chunk it sits in: paths, URLs, e-mails, identifiers and numbers are not prose.
  let a = t.start;
  while (a > 0 && !/\s/.test(text[a - 1]!)) a--;
  let b = t.end;
  while (b < text.length && !/\s/.test(text[b]!)) b++;
  const chunk = text.slice(a, b);
  if (/[/\\@#_$%=<>{}[\]()0-9]|:\/\/|\w\.\w|\w-\w/.test(chunk) && chunk !== t.word) {
    // «(hola)» or «hola,» are fine: only chunks with those symbols *inside* a word are code-like.
    if (/[\p{L}\p{N}][/\\@#_$%=<>{}[\]][\p{L}\p{N}]|\w\.\w|:\/\/|[0-9]/u.test(chunk)) return false;
  }
  if (text.startsWith("/") && t.start < text.indexOf(" ") + 1) return false; // a /command
  if (shorthandFix(t.word)) return true; // a known misspelling is always worth fixing
  if (COMMON.has(t.word.toLowerCase())) return false;
  return true;
}

/** The fix that needs no model (chat shorthand and frequent misspellings), keeping a capital letter if it had one. */
export function shorthandFix(word: string): string | null {
  const w = word.toLowerCase();
  const fix = SHORTHAND[w] ?? (Object.hasOwn(MISSPELT, w) ? MISSPELT[w] : undefined);
  if (!fix) return null;
  return /^[A-ZÁÉÍÓÚÑ]/.test(word) ? fix[0]!.toUpperCase() + fix.slice(1) : fix;
}
