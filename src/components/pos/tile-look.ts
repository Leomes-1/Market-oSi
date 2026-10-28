/**
 * How a POS tile looks: an emoji picked from the product's name, and a soft
 * background per category. Edit the lists below to change either.
 *
 * Lives under components/ (not lib/) because Tailwind only scans components/
 * and app/ for class names — the colour classes must appear here in full.
 */

import { plain } from '@/lib/product-search'

/**
 * Keyword → emoji, matched against the start of any word in the name,
 * accent-free. First match wins, so put the more specific words first
 * ("kruasan" before "buke", "speca" before generic vegetables).
 */
const KEYWORD_EMOJI: Array<[string[], string]> = [
  [['domate'], '🍅'],
  [['kastravec'], '🥒'],
  [['qepe'], '🧅'],
  [['hudher'], '🧄'],
  [['patate'], '🥔'],
  [['karrot'], '🥕'],
  [['speca', 'specat'], '🫑'],
  [['djeges'], '🌶️'],
  [['sallat', 'marule', 'spinaq', 'lakra'], '🥬'],
  [['brokoli'], '🥦'],
  [['patellxhan'], '🍆'],
  [['kungull'], '🎃'],
  [['misr'], '🌽'],
  [['kerpudh'], '🍄'],
  [['molle'], '🍎'],
  [['dardh'], '🍐'],
  [['banane'], '🍌'],
  [['portokall', 'mandarin'], '🍊'],
  [['limon'], '🍋'],
  [['rrush'], '🍇'],
  [['shalqi'], '🍉'],
  [['pjeper'], '🍈'],
  [['luleshtrydh', 'dredhez'], '🍓'],
  [['qershi', 'vishnj'], '🍒'],
  [['pjeshk', 'kajsi'], '🍑'],
  [['ananas'], '🍍'],
  [['kivi'], '🥝'],
  [['avokado'], '🥑'],
  [['arra', 'lajthi', 'bajame', 'kikirik', 'fistik'], '🥜'],
  [['ullinj', 'ulli'], '🫒'],
  [['djathe', 'kackavall'], '🧀'],
  [['veze'], '🥚'],
  [['qumesht', 'kos'], '🥛'],
  [['mish', 'sallam', 'proshute'], '🥩'],
  [['pule'], '🍗'],
  [['peshk'], '🐟'],
  [['kruasan', 'croissant'], '🥐'],
  [['baguette', 'baget'], '🥖'],
  [['simit', 'gjevrek'], '🥯'],
  [['byrek', 'pite'], '🥧'],
  [['buke', 'franxholl'], '🍞'],
  [['oriz'], '🍚'],
  [['makarona', 'spageti'], '🍝'],
  [['sheqer'], '🍬'],
  [['kafe'], '☕'],
  [['caj'], '🍵'],
  [['mjalte'], '🍯'],
  [['akullore'], '🍦'],
  [['cokollat', 'cokolate'], '🍫'],
  [['biskot'], '🍪'],
]

/** Fallback when no keyword matches. Keys are the category names as stored. */
const CATEGORY_EMOJI: Record<string, string> = {
  'Fruta/Perime': '🥗',
  Fresh: '🥛',
  'Të Ëmbla': '🍬',
  'Të Kripura': '🥨',
  'Të Ngrira': '🧊',
  Ushqimore: '🥫',
  'Lëngje': '🧃',
  Higjena: '🧴',
  Pastrimi: '🧽',
  'Të Ndryshme': '🛒',
}

const GENERAL_EMOJI = '🛍️'

/** Soft tile background + border per category (idle state, not in the cart). */
const CATEGORY_TONE: Record<string, string> = {
  'Fruta/Perime': 'bg-green-50 border-green-200 hover:border-green-400',
  Fresh: 'bg-sky-50 border-sky-200 hover:border-sky-400',
  'Të Ëmbla': 'bg-pink-50 border-pink-200 hover:border-pink-400',
  'Të Kripura': 'bg-yellow-50 border-yellow-200 hover:border-yellow-400',
  'Të Ngrira': 'bg-cyan-50 border-cyan-200 hover:border-cyan-400',
  Ushqimore: 'bg-amber-50 border-amber-200 hover:border-amber-400',
  'Lëngje': 'bg-orange-50 border-orange-200 hover:border-orange-400',
  Higjena: 'bg-violet-50 border-violet-200 hover:border-violet-400',
  Pastrimi: 'bg-teal-50 border-teal-200 hover:border-teal-400',
  'Të Ndryshme': 'bg-slate-50 border-slate-200 hover:border-slate-400',
}

const GENERAL_TONE = 'bg-white border-slate-200 hover:border-blue-300'

const KEYWORDS = KEYWORD_EMOJI.map(([words, emoji]) => [words.map(plain), emoji] as const)

export function tileEmoji(emri: string, kategoria: string): string {
  const words = plain(emri).split(/[^a-z0-9]+/).filter(Boolean)
  for (const [keys, emoji] of KEYWORDS) {
    if (keys.some((k) => words.some((w) => w.startsWith(k)))) return emoji
  }
  return CATEGORY_EMOJI[kategoria] ?? GENERAL_EMOJI
}

export function tileTone(kategoria: string): string {
  return CATEGORY_TONE[kategoria] ?? GENERAL_TONE
}
