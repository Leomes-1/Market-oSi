/**
 * How a POS tile is recognised and sorted: a small emoji and a group, both
 * picked from keywords in the product's name, with the category as fallback.
 * An admin can override the group per product (Product."grupiArke").
 * Edit the lists below to change either.
 */

import { plain } from '@/lib/product-search'
import { isTileGroupKey, type TileGroupKey } from '@/lib/tile-groups'

/**
 * Keyword → emoji (and group, when the word decides it), matched against the
 * start of any word in the name, accent-free. The first entry IN THIS LIST
 * that matches wins — not the first word in the name — so the list is in
 * priority order:
 *
 *   1. bread: "Buke Misri", "Kruasan me cokollate", "Byrek me djathe" are bread;
 *   2. sweets: "Akullore me luleshtrydhe", "Cokollate me lajthi" are sweets;
 *   3. dairy: "Kos me banane", "Djathe me ullinj" are dairy;
 *   4. meat: "Pite"… is already bread; "Sallam pule" is meat either way;
 *   5. drinks: "Leng molle" is a juice, not an apple;
 *   6. fruit & vegetables;
 *   7. the rest (no group of their own — the category decides).
 *
 * Inside a group, put the more specific words first ("kruasan" before "buke").
 */
const KEYWORDS_RAW: Array<[string[], string, TileGroupKey?]> = [
  // 1. Bukë
  [['kruasan', 'croissant'], '🥐', 'buke'],
  [['baguette', 'baget'], '🥖', 'buke'],
  [['simit', 'gjevrek'], '🥯', 'buke'],
  [['byrek', 'pite'], '🥧', 'buke'],
  [['buke', 'franxholl'], '🍞', 'buke'],
  // 2. Ëmbëlsira
  [['akullore'], '🍦', 'embelsira'],
  [['cokollat', 'cokolate'], '🍫', 'embelsira'],
  [['biskot'], '🍪', 'embelsira'],
  [['karamel'], '🍬', 'embelsira'],
  [['kek', 'torte'], '🍰', 'embelsira'],
  // 3. Djathë & Bulmet
  [['djath', 'kackavall'], '🧀', 'djathe_bulmet'],
  [['qumesht', 'kos', 'jogurt'], '🥛', 'djathe_bulmet'],
  // 4. Mish & Pulë
  [['mish', 'sallam', 'proshute'], '🥩', 'mish_pule'],
  [['pule', 'pula', 'krahe', 'kofshe', 'cung', 'fileto'], '🍗', 'mish_pule'],
  [['peshk'], '🐟', 'mish_pule'],
  // 5. Drinks — before fruit, so a juice isn't filed as the fruit it's made of
  [['leng'], '🧃'],
  // 6. Fruta & Perime
  [['domate'], '🍅', 'fruta_perime'],
  [['kastravec'], '🥒', 'fruta_perime'],
  [['qepe'], '🧅', 'fruta_perime'],
  [['hudher'], '🧄', 'fruta_perime'],
  [['patate'], '🥔', 'fruta_perime'],
  [['karrot'], '🥕', 'fruta_perime'],
  [['speca', 'speci', 'specat'], '🫑', 'fruta_perime'],
  [['djeges'], '🌶️', 'fruta_perime'],
  [['sallat', 'salat', 'marule', 'spinaq', 'lakra', 'laker'], '🥬', 'fruta_perime'],
  [['brokoli'], '🥦', 'fruta_perime'],
  [['patellxhan'], '🍆', 'fruta_perime'],
  [['kungull'], '🎃', 'fruta_perime'],
  [['misr'], '🌽', 'fruta_perime'],
  [['kerpudh'], '🍄', 'fruta_perime'],
  [['molle'], '🍎', 'fruta_perime'],
  [['dardh'], '🍐', 'fruta_perime'],
  [['banane'], '🍌', 'fruta_perime'],
  [['portokall', 'mandarin'], '🍊', 'fruta_perime'],
  [['limon'], '🍋', 'fruta_perime'],
  [['rrush'], '🍇', 'fruta_perime'],
  [['shalqi'], '🍉', 'fruta_perime'],
  [['pjeper'], '🍈', 'fruta_perime'],
  [['luleshtrydh', 'dredhez'], '🍓', 'fruta_perime'],
  [['qershi', 'vishnj'], '🍒', 'fruta_perime'],
  [['pjeshk', 'kajsi'], '🍑', 'fruta_perime'],
  [['ananas'], '🍍', 'fruta_perime'],
  [['kivi'], '🥝', 'fruta_perime'],
  [['avokado'], '🥑', 'fruta_perime'],
  // 7. No group of their own
  [['fasule', 'groshe'], '🫘'],
  [['arra', 'lajthi', 'bajame', 'kikirik', 'fistik'], '🥜'],
  [['ullinj', 'ulli'], '🫒'],
  [['veze'], '🥚'],
  [['oriz'], '🍚'],
  [['makarona', 'spageti'], '🍝'],
  [['sheqer'], '🍬'],
  [['kafe'], '☕'],
  [['caj'], '🍵'],
  [['mjalte'], '🍯'],
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
const CATEGORY_GROUP: Record<string, TileGroupKey> = {
  'Fruta/Perime': 'fruta_perime',
  Fresh: 'djathe_bulmet',
  'Të Ëmbla': 'embelsira',
}

const KEYWORDS = KEYWORDS_RAW.map(([words, emoji, group]) => [words.map(plain), emoji, group] as const)

function keywordFor(emri: string) {
  const words = plain(emri).split(/[^a-z0-9]+/).filter(Boolean)
  return KEYWORDS.find(([keys]) => keys.some((k) => words.some((w) => w.startsWith(k))))
}

export function tileEmoji(emri: string, kategoria: string): string {
  return keywordFor(emri)?.[1] ?? CATEGORY_EMOJI[kategoria] ?? GENERAL_EMOJI
}

/** The group the keywords and category give — what "Automatik" means. */
export function autoTileGroup(emri: string, kategoria: string): TileGroupKey {
  return keywordFor(emri)?.[2] ?? CATEGORY_GROUP[kategoria] ?? 'te_tjera'
}

/** The tile's group: the admin's choice if set, otherwise automatic. */
export function tileGroup(p: { emri: string; kategoria: string; grupiArke: string | null }): TileGroupKey {
  return isTileGroupKey(p.grupiArke) ? p.grupiArke : autoTileGroup(p.emri, p.kategoria)
}
