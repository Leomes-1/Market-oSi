/**
 * POS tile groups: the stored key (Product."grupiArke") and the heading shown.
 * Order here is the order on the POS. Shared by the server (validation) and
 * the UI (grouping, the group selector).
 */
export const TILE_GROUPS = [
  { key: 'buke', label: 'Bukë' },
  { key: 'fruta_perime', label: 'Fruta & Perime' },
  { key: 'mish_pule', label: 'Mish & Pulë' },
  { key: 'djathe_bulmet', label: 'Djathë & Bulmet' },
  { key: 'embelsira', label: 'Ëmbëlsira' },
  { key: 'te_tjera', label: 'Të tjera' },
] as const

export type TileGroupKey = (typeof TILE_GROUPS)[number]['key']

export function isTileGroupKey(value: unknown): value is TileGroupKey {
  return typeof value === 'string' && TILE_GROUPS.some((g) => g.key === value)
}

export function tileGroupLabel(key: TileGroupKey): string {
  return TILE_GROUPS.find((g) => g.key === key)?.label ?? key
}
