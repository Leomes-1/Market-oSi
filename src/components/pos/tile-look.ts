/**
 * How a POS tile is recognised and sorted: a small emoji and a group, both
 * picked from keywords in the product's name, with the category as fallback.
 * Edit the lists below to change either.
 */

import { plain } from '@/lib/product-search'

/** Tile groups, in the order they appear on the POS. */
export const TILE_GROUPS = ['Bukë', 'Fruta & Perime', 'Mish & Pulë', 'Djathë & Bulmet', 'Ëmbëlsira', 'Të tjera'] as const
export type TileGroup = (typeof TILE_GROUPS)[number]

const BUKE: TileGroup = 'Bukë'
const FRUTA: TileGroup = 'Fruta & Perime'
const MISH: TileGroup = 'Mish & Pulë'
const BULMET: TileGroup = 'Djathë & Bulmet'
const EMBEL: TileGroup = 'Ëmbëlsira'

/**
 * Keyword → emoji (and group, when the word decides it), matched against the
 * start of any word in the name, accent-free. First match wins, so put the
 * more specific words first ("kruasan" before "buke", "karamel" before
 * "kafe"). No group → the category decides (CATEGORY_GROUP).
 */
const KEYWORDS_RAW: Array<[string[], string, TileGroup?]> = [
  [['domate'], '🍅', FRUTA],
  [['kastravec'], '🥒', FRUTA],
  [['qepe'], '🧅', FRUTA],
  [['hudher'], '🧄', FRUTA],
  [['patate'], '🥔', FRUTA],
  [['karrot'], '🥕', FRUTA],
  [['speca', 'speci', 'specat'], '🫑', FRUTA],
  [['djeges'], '🌶️', FRUTA],
  [['sallat', 'salat', 'marule', 'spinaq', 'lakra', 'laker'], '🥬', FRUTA],
  [['brokoli'], '🥦', FRUTA],
  [['patellxhan'], '🍆', FRUTA],
  [['kungull'], '🎃', FRUTA],
  [['misr'], '🌽', FRUTA],
  [['kerpudh'], '🍄', FRUTA],
  [['fasule', 'groshe'], '🫘'],
  [['molle'], '🍎', FRUTA],
  [['dardh'], '🍐', FRUTA],
  [['banane'], '🍌', FRUTA],
  [['portokall', 'mandarin'], '🍊', FRUTA],
  [['limon'], '🍋', FRUTA],
  [['rrush'], '🍇', FRUTA],
  [['shalqi'], '🍉', FRUTA],
  [['pjeper'], '🍈', FRUTA],
  [['luleshtrydh', 'dredhez'], '🍓', FRUTA],
  [['qershi', 'vishnj'], '🍒', FRUTA],
  [['pjeshk', 'kajsi'], '🍑', FRUTA],
  [['ananas'], '🍍', FRUTA],
  [['kivi'], '🥝', FRUTA],
  [['avokado'], '🥑', FRUTA],
  [['arra', 'lajthi', 'bajame', 'kikirik', 'fistik'], '🥜'],
  [['ullinj', 'ulli'], '🫒'],
  [['djath', 'kackavall'], '🧀', BULMET],
  [['veze'], '🥚'],
  [['qumesht', 'kos'], '🥛', BULMET],
  [['mish', 'sallam', 'proshute'], '🥩', MISH],
  [['pule', 'pula', 'krahe', 'kofshe', 'cung', 'fileto'], '🍗', MISH],
  [['peshk'], '🐟', MISH],
  [['kruasan', 'croissant'], '🥐', BUKE],
  [['baguette', 'baget'], '🥖', BUKE],
  [['simit', 'gjevrek'], '🥯', BUKE],
  [['byrek', 'pite'], '🥧', BUKE],
  [['buke', 'franxholl'], '🍞', BUKE],
  [['karamel'], '🍬', EMBEL],
  [['oriz'], '🍚'],
  [['makarona', 'spageti'], '🍝'],
  [['sheqer'], '🍬'],
  [['kafe'], '☕'],
  [['caj'], '🍵'],
  [['mjalte'], '🍯'],
  [['akullore'], '🍦', EMBEL],
  [['cokollat', 'cokolate'], '🍫', EMBEL],
  [['biskot'], '🍪', EMBEL],
]

/** Emoji when no keyword matches. Keys are the category names as stored. */
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

/** Group when no keyword decides it. Unlisted categories go to "Të tjera". */
const CATEGORY_GROUP: Record<string, TileGroup> = {
  'Fruta/Perime': FRUTA,
  Fresh: BULMET,
  'Të Ëmbla': EMBEL,
}

const KEYWORDS = KEYWORDS_RAW.map(([words, emoji, group]) => [words.map(plain), emoji, group] as const)

function keywordFor(emri: string) {
  const words = plain(emri).split(/[^a-z0-9]+/).filter(Boolean)
  return KEYWORDS.find(([keys]) => keys.some((k) => words.some((w) => w.startsWith(k))))
}

export function tileEmoji(emri: string, kategoria: string): string {
  return keywordFor(emri)?.[1] ?? CATEGORY_EMOJI[kategoria] ?? GENERAL_EMOJI
}

export function tileGroup(emri: string, kategoria: string): TileGroup {
  return keywordFor(emri)?.[2] ?? CATEGORY_GROUP[kategoria] ?? 'Të tjera'
}
