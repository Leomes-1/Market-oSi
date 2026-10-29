'use client'

import { Fragment, memo, useDeferredValue, useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useRole } from '@/contexts/RoleContext'
import AccessDenied from '@/components/AccessDenied'
import toast from 'react-hot-toast'
import Modal from '@/components/ui/Modal'
import { formatCurrency, formatDateTime } from '@/lib/utils'
import { lookupBarcode, patchCatalog, upsertCatalog, useCatalog, type CatalogProduct } from '@/lib/catalog'
import { pendingLabel } from '@/lib/pricing'
import { findProducts, searchIndex } from '@/lib/product-search'
import { tracksStock, weightForAmount } from '@/lib/validation'
import BarcodeField, { type BarcodeFieldHandle } from '@/components/pos/BarcodeField'
import AddTilePicker from '@/components/pos/AddTilePicker'
import { TILE_GROUPS, tileEmoji, tileGroup } from '@/components/pos/tile-look'
import {
  RiAddLine,
  RiSubtractLine,
  RiDeleteBin6Line,
  RiShoppingCartLine,
  RiPrinterLine,
  RiCheckLine,
  RiMenuLine,
  RiCloseLine,
} from 'react-icons/ri'
import { useDesktopSidebar } from '@/components/layout/ClientLayout'

type Product = CatalogProduct

interface CartItem {
  product: Product
  /** For an amount line, derived from `shuma`; 0 until an amount is typed. */
  sasia: number
  /**
   * Untracked (kg) products are sold by the amount: the cashier types the
   * price in Lek and the weight is worked out from it. Null until typed.
   */
  shuma?: number | null
}

/** Weight for an amount line, or 0 when no valid amount has been typed. */
function weightOf(item: CartItem) {
  if (item.shuma == null) return 0
  return weightForAmount(item.shuma, item.product.cmimiShitjes) ?? 0
}

/** What the line charges: the typed amount exactly, or price × quantity. */
function lineTotal(item: CartItem) {
  if (!tracksStock(item.product.njesia)) return item.shuma ?? 0
  return item.product.cmimiShitjes * item.sasia
}

interface CompletedSale {
  id: number
  totali: number
  fitimi: number
  createdAt: string
  items: Array<{
    emriProduktit: string
    sasia: number
    cmimiShitjes: number
    fitimi: number
    /** The product as it stands after this sale. */
    product: {
      id: number
      njesia: string
      sasia: number
      cmimiShitjes: number
      cmimiShitjesRi: number | null
      sasiaVjeter: number | null
      cmimiBlerjes?: number
      cmimiBlerjesRi?: number | null
    } | null
  }>
}

const CART_WIDTH_KEY = 'pos.cartWidth'
const CART_MIN_WIDTH = 300
/** Space always left for the product grid when the cart is dragged wider. */
const PRODUCTS_MIN_WIDTH = 320

function readCartWidth(): number | null {
  try {
    const v = Number(localStorage.getItem(CART_WIDTH_KEY))
    return Number.isFinite(v) && v >= CART_MIN_WIDTH ? v : null
  } catch {
    return null
  }
}

function saveCartWidth(width: number | null) {
  try {
    if (width === null) localStorage.removeItem(CART_WIDTH_KEY)
    else localStorage.setItem(CART_WIDTH_KEY, String(Math.round(width)))
  } catch {
    // Storage blocked — the width just won't be remembered.
  }
}

function isWeighted(njesia: string) {
  return njesia === 'kg' || njesia === 'gram' || njesia === 'litër'
}

// Flags a product whose new prices are waiting for the old stock to sell
// through, e.g. "120 L → 100 L pas 2 copëve".
function pendingFor(p: CatalogProduct) {
  return pendingLabel(
    {
      id: p.id,
      sasia: p.sasia,
      cmimiBlerjes: p.cmimiBlerjes ?? 0,
      cmimiShitjes: p.cmimiShitjes,
      cmimiBlerjesRi: p.cmimiBlerjesRi ?? null,
      cmimiShitjesRi: p.cmimiShitjesRi,
      sasiaVjeter: p.sasiaVjeter,
    },
    p.njesia
  )
}

const TILE_GRID = 'grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-2 sm:gap-3'

/** One run of tiles in the grid, under a small heading (none for search results). */
interface TileSection {
  title: string | null
  products: Product[]
}

/** The POS tiles (neArke) in TILE_GROUPS order, alphabetical inside each group. */
function groupTiles(products: Product[]): TileSection[] {
  const byGroup = new Map<string, Product[]>()
  for (const p of products) {
    if (!p.neArke) continue
    const group = tileGroup(p.emri, p.kategoria)
    const list = byGroup.get(group)
    if (list) list.push(p)
    else byGroup.set(group, [p])
  }
  return TILE_GROUPS.flatMap((title) => {
    const list = byGroup.get(title)
    return list ? [{ title, products: [...list].sort((a, b) => a.emri.localeCompare(b.emri, 'sq')) }] : []
  })
}

interface ProductTileProps {
  product: Product
  /** This product's cart line, if it is in the cart. */
  line: CartItem | undefined
  onAdd: (product: Product) => void
  /** Admin, POS tiles only: shows × to take the product off the tiles. */
  onRemove?: (product: Product) => void
}

/**
 * One product tile. Memoised: a cart change re-renders only the tile whose
 * line changed (unchanged lines keep their object identity), not all of them.
 */
const ProductTile = memo(function ProductTile({ product, line: inCart, onAdd, onRemove }: ProductTileProps) {
  const tracked = tracksStock(product.njesia)
  const outOfStock = tracked && product.sasia <= 0
  const pending = pendingFor(product)
  return (
    <div className="relative">
      <button
        onClick={() => !outOfStock && onAdd(product)}
        disabled={outOfStock}
        className={`w-full h-full text-left p-3 sm:p-4 rounded-xl border-2 transition-all min-h-[5rem] ${
          outOfStock
            ? 'border-slate-100 bg-slate-50 opacity-50 cursor-not-allowed'
            : inCart
            ? 'border-blue-400 bg-blue-50 hover:scale-[1.01] active:scale-[0.98]'
            : 'border-slate-200 bg-white hover:border-blue-300 hover:shadow-sm hover:scale-[1.01] active:scale-[0.98]'
        }`}
      >
        <div className={`flex items-start justify-between mb-1.5 sm:mb-2 ${onRemove ? 'pr-5' : ''}`}>
          <p className="font-medium text-slate-900 text-xs sm:text-sm leading-tight">
            <span className="mr-1" aria-hidden>{tileEmoji(product.emri, product.kategoria)}</span>
            {product.emri}
          </p>
          {inCart && (
            <span className="badge-blue ml-1 flex-shrink-0 text-xs">
              {!tracked
                ? inCart.shuma != null ? formatCurrency(inCart.shuma) : '•'
                : isWeighted(product.njesia) ? inCart.sasia.toFixed(3) : inCart.sasia}
            </span>
          )}
        </div>
        <p className="text-xs text-slate-400 mb-1.5 sm:mb-2 truncate">{product.kategoria}</p>
        {pending && (
          <p className="text-xs text-amber-600 mb-1.5 leading-tight">
            ⏳ {pending}
          </p>
        )}
        <div className="flex items-center justify-between">
          <span className="text-sm sm:text-base font-bold text-slate-900">
            {formatCurrency(product.cmimiShitjes)}
          </span>
          {tracked ? (
            <span className={`text-xs font-medium hidden sm:block ${product.sasia <= product.stokuMinimal ? 'text-red-500' : 'text-slate-400'}`}>
              {isWeighted(product.njesia) ? product.sasia.toFixed(3) : product.sasia} {product.njesia}
            </span>
          ) : (
            <span className="text-xs font-medium hidden sm:block text-slate-400">
              / {product.njesia}
            </span>
          )}
        </div>
      </button>
      {onRemove && (
        // A sibling of the tile, not inside it: a button can't hold a button,
        // and a click here must not add the product to the cart.
        <button
          type="button"
          onClick={() => onRemove(product)}
          aria-label={`Hiq ${product.emri} nga pllakat`}
          title="Hiq nga pllakat (produkti mbetet në bazë)"
          className="absolute top-1.5 right-1.5 w-5 h-5 inline-flex items-center justify-center rounded-full text-slate-300 hover:text-red-600 hover:bg-red-50 transition-colors"
        >
          <RiCloseLine className="text-sm" />
        </button>
      )}
    </div>
  )
})

interface ProductGridProps {
  sections: TileSection[]
  cart: CartItem[]
  onAdd: (product: Product) => void
  /** Admin, POS tiles only: × on every tile and the "+ Shto produkt" tile. */
  onRemove?: (product: Product) => void
  onOpenPicker?: () => void
}

/**
 * The grid: the POS tiles by group, or search results. Memoised on its
 * props, so nothing typed in the barcode field reaches it until the search
 * text settles; a cart change re-renders the grid but only the changed tile
 * (see ProductTile).
 */
const ProductGrid = memo(function ProductGrid({ sections, cart, onAdd, onRemove, onOpenPicker }: ProductGridProps) {
  const lines = useMemo(() => new Map(cart.map((line) => [line.product.id, line])), [cart])
  return (
    <div className={TILE_GRID}>
      {sections.map((section) => (
        <Fragment key={section.title ?? ''}>
          {section.title && (
            <h2 className="col-span-full text-[11px] font-semibold uppercase tracking-wider text-slate-400 pt-2 first:pt-0">
              {section.title}
            </h2>
          )}
          {section.products.map((product) => (
            <ProductTile
              key={product.id}
              product={product}
              line={lines.get(product.id)}
              onAdd={onAdd}
              onRemove={onRemove}
            />
          ))}
        </Fragment>
      ))}
      {onOpenPicker && (
        <button
          type="button"
          onClick={onOpenPicker}
          className="min-h-[5rem] rounded-xl border-2 border-dashed border-slate-300 text-slate-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/50 transition-colors flex items-center justify-center gap-1"
        >
          <RiAddLine className="text-xl" />
          <span className="text-sm font-semibold">Shto produkt</span>
        </button>
      )}
      {sections.length === 0 && !onOpenPicker && (
        <div className="col-span-full text-center py-12 text-slate-400">
          Nuk ka pllaka. Skano barkodin ose kërko produktin lart.
        </div>
      )}
    </div>
  )
})

export default function ShitjetPage() {
  const { role } = useRole()
  const desktopSidebar = useDesktopSidebar()
  const {
    products,
    loading: productsLoading,
    error: productsError,
    findByBarcode,
  } = useCatalog()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [cart, setCart] = useState<CartItem[]>([])
  const [loading, setLoading] = useState(false)
  const [receiptModal, setReceiptModal] = useState<CompletedSale | null>(null)
  const [rawValues, setRawValues] = useState<Record<number, string>>({})
  const [mobileTab, setMobileTab] = useState<'products' | 'cart'>('products')
  // The barcode field owns its value, colour and message (BarcodeField).
  const barcodeRef = useRef<BarcodeFieldHandle>(null)
  const amountRefs = useRef<Map<number, HTMLInputElement>>(new Map())
  const contentRef = useRef<HTMLDivElement>(null)
  const lineRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  // The line just scanned or added; `n` changes on every add so scanning the
  // same product twice re-triggers the scroll and the flash.
  const [lastAdded, setLastAdded] = useState<{ id: number; n: number } | null>(null)
  const [highlightId, setHighlightId] = useState<number | null>(null)

  function markAdded(productId: number) {
    setLastAdded((prev) => ({ id: productId, n: (prev?.n ?? 0) + 1 }))
    // A successful add ends the search: the grid goes back to the POS tiles.
    barcodeRef.current?.clear()
  }

  // Bring the last added line into view and flash it briefly, so with a long
  // cart the latest scan is always visible.
  useEffect(() => {
    if (!lastAdded) return
    lineRefs.current.get(lastAdded.id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    setHighlightId(lastAdded.id)
    const t = setTimeout(() => setHighlightId(null), 1200)
    return () => clearTimeout(t)
  }, [lastAdded])
  // Null until the cashier drags the edge: the responsive default applies.
  const [cartWidth, setCartWidth] = useState<number | null>(null)

  useEffect(() => { setCartWidth(readCartWidth()) }, [])

  // Drag the cart's left edge. Width is measured from the content area's right
  // edge, clamped so neither column can be squeezed to nothing.
  function startCartResize(e: React.PointerEvent<HTMLDivElement>) {
    const container = contentRef.current
    if (!container) return
    e.preventDefault()
    const rect = container.getBoundingClientRect()
    const max = Math.max(CART_MIN_WIDTH, rect.width - PRODUCTS_MIN_WIDTH)
    let latest: number | null = null

    function onMove(ev: PointerEvent) {
      latest = Math.min(max, Math.max(CART_MIN_WIDTH, rect.right - ev.clientX))
      setCartWidth(latest)
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.removeProperty('cursor')
      document.body.style.removeProperty('user-select')
      if (latest !== null) saveCartWidth(latest)
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  function resetCartWidth() {
    setCartWidth(null)
    saveCartWidth(null)
  }
  const audioCtxRef = useRef<AudioContext | null>(null)
  const receiptModalRef = useRef<CompletedSale | null>(null)

  // Keep receiptModalRef in sync for the document click handler (avoids stale closure)
  useEffect(() => { receiptModalRef.current = receiptModal }, [receiptModal])
  // Same for the "+ Shto produkt" picker: clicks inside it must not pull
  // focus back to the field behind it.
  const pickerOpenRef = useRef(false)
  useEffect(() => { pickerOpenRef.current = pickerOpen }, [pickerOpen])

  // Refocus barcode when receipt modal is dismissed
  useEffect(() => {
    if (!receiptModal) {
      setTimeout(() => barcodeRef.current?.focus(), 100)
    }
  }, [receiptModal])

  // Return focus to barcode after any click that doesn't land on a real input
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (receiptModalRef.current || pickerOpenRef.current) return
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select')) return
      setTimeout(() => {
        const active = document.activeElement
        if (!active || !['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) {
          barcodeRef.current?.focus()
        }
      }, 50)
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [])

  // dropdown still reach every product.
  // The search text from the field, set only after typing pauses (see
  // BarcodeField), and deferred so filtering never delays a keystroke or a
  // scan. Empty → the POS tiles by group; otherwise every matching product.
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const searching = deferredQuery.trim() !== ''
  const index = useMemo(() => searchIndex(products), [products])
  const tileSections = useMemo(() => groupTiles(products), [products])
  const results = useMemo(
    () => (searching ? findProducts(index, deferredQuery) : []),
    [index, deferredQuery, searching]
  )
  const resultSections = useMemo<TileSection[]>(
    () => (results.length ? [{ title: null, products: results }] : []),
    [results]
  )

  function playBeep(type: 'success' | 'error') {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      }
      const ctx = audioCtxRef.current
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      if (type === 'success') {
        osc.type = 'sine'
        osc.frequency.value = 1480
        gain.gain.setValueAtTime(0.07, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12)
        osc.start(ctx.currentTime)
        osc.stop(ctx.currentTime + 0.12)
      } else {
        osc.type = 'sawtooth'
        osc.frequency.value = 320
        gain.gain.setValueAtTime(0.07, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28)
        osc.start(ctx.currentTime)
        osc.stop(ctx.currentTime + 0.28)
      }
    } catch {
      // Audio API blocked or unavailable — silent fallback
    }
  }

  function vibrateDevice(pattern: number | number[]) {
    try {
      navigator.vibrate?.(pattern)
    } catch {
      // Vibration API not supported — ignore
    }
  }

  function triggerFlash(type: 'success' | 'error', message: string, duration = 1000) {
    barcodeRef.current?.flash(type, message, duration)
    playBeep(type)
    vibrateDevice(type === 'success' ? 50 : [80, 50, 80])
  }

  // The cart as last rendered, for a scan that resolves after a server lookup:
  // by then the closure's `cart` may be several scans old.
  const cartRef = useRef(cart)
  cartRef.current = cart

  function handleBarcodeSubmit(code: string) {
    // BarcodeField has already cleared itself for the next scan.

    // Normal path: the cached catalogue, in memory — no request.
    const product = findByBarcode(code)
    if (product) {
      addScanned(product)
      return
    }

    // Not in the cache: possibly a product added on another device since this
    // page loaded. One lookup on the server before calling it unknown.
    barcodeRef.current?.notice('Duke kërkuar...')
    lookupBarcode(code).then(
      (found) => {
        if (found) {
          addScanned(found)
        } else {
          triggerFlash('error', 'Produkti nuk u gjet', 1500)
          barcodeRef.current?.focus()
        }
      },
      () => {
        triggerFlash('error', 'Gabim gjatë kërkimit të barkodit', 1500)
        barcodeRef.current?.focus()
      }
    )
  }

  function addScanned(product: Product) {
    if (!tracksStock(product.njesia)) {
      addAmountLine(product)
      triggerFlash('success', `${product.emri} — shkruaj shumën`, 900)
      return
    }

    if (product.sasia <= 0) {
      toast.error(`${product.emri} — Stoku i mbaruar`)
      triggerFlash('error', 'Stoku i mbaruar', 1500)
      barcodeRef.current?.focus()
      return
    }

    const step = isWeighted(product.njesia) ? 1.0 : 1
    const currentInCart = cartRef.current.find((i) => i.product.id === product.id)
    const newSasia = currentInCart
      ? parseFloat((currentInCart.sasia + step).toFixed(3))
      : isWeighted(product.njesia)
        ? parseFloat(Math.min(1.0, product.sasia).toFixed(3))
        : 1

    if (newSasia > product.sasia) {
      toast.error(`Stoku i pamjaftueshëm: ${product.sasia} ${product.njesia}`)
      triggerFlash('error', `Stoku maks: ${product.sasia} ${product.njesia}`, 1500)
      barcodeRef.current?.focus()
      return
    }

    setCart((prev) => {
      const existing = prev.find((i) => i.product.id === product.id)
      if (existing) {
        return prev.map((i) =>
          i.product.id === product.id ? { ...i, sasia: newSasia } : i
        )
      }
      return [...prev, { product, sasia: newSasia }]
    })
    setRawValues((prev) => {
      const next = { ...prev }
      delete next[product.id]
      return next
    })

    markAdded(product.id)
    triggerFlash('success', `${product.emri} u shtua`, 900)
    barcodeRef.current?.focus()
  }

  /**
   * Untracked (kg) products: put the line in the cart with no amount yet and
   * move the cursor to its amount field. Scanning it again just returns there.
   */
  function addAmountLine(product: Product) {
    setCart((prev) =>
      prev.some((i) => i.product.id === product.id)
        ? prev
        : [...prev, { product, sasia: 0, shuma: null }]
    )
    markAdded(product.id)
    // After the line has rendered, so its input exists.
    setTimeout(() => {
      const el = amountRefs.current.get(product.id)
      el?.focus()
      el?.select()
    }, 0)
  }

  function addToCart(product: Product) {
    if (!tracksStock(product.njesia)) {
      addAmountLine(product)
      return
    }
    if (product.sasia <= 0) {
      toast.error(`${product.emri} - Stoku i mbaruar`)
      return
    }
    const step = isWeighted(product.njesia) ? 0.250 : 1
    // Checked against the rendered cart so a refusal doesn't highlight a line.
    const inCart = cart.find((i) => i.product.id === product.id)
    if (inCart && parseFloat((inCart.sasia + step).toFixed(3)) > product.sasia) {
      toast.error(`Stoku i pamjaftueshëm: ${product.sasia} ${product.njesia}`)
      barcodeRef.current?.focus()
      return
    }
    setCart((prev) => {
      const existing = prev.find((i) => i.product.id === product.id)
      if (existing) {
        const newSasia = parseFloat((existing.sasia + step).toFixed(3))
        if (newSasia > product.sasia) return prev
        return prev.map((i) =>
          i.product.id === product.id ? { ...i, sasia: newSasia } : i
        )
      }
      const initialSasia = isWeighted(product.njesia)
        ? parseFloat(Math.min(1.0, product.sasia).toFixed(3))
        : 1
      return [...prev, { product, sasia: initialSasia }]
    })
    setRawValues((prev) => {
      const next = { ...prev }
      delete next[product.id]
      return next
    })
    markAdded(product.id)
    barcodeRef.current?.focus()
  }

  // Stable identity for the memoised barcode field; always the current handler.
  const handleBarcodeSubmitRef = useRef(handleBarcodeSubmit)
  handleBarcodeSubmitRef.current = handleBarcodeSubmit
  const onBarcodeScan = useCallback((code: string) => handleBarcodeSubmitRef.current(code), [])

  // A product picked from the field's dropdown counts as a scan of it.
  const addScannedRef = useRef(addScanned)
  addScannedRef.current = addScanned
  const onPickProduct = useCallback((product: Product) => addScannedRef.current(product), [])
  const onQuery = useCallback((q: string) => setQuery(q), [])

  /** Puts a product on the tiles or takes it off. Admin only (server-checked). */
  async function setTile(product: Product, neArke: boolean) {
    try {
      const res = await fetch(`/api/products/${product.id}/tile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ neArke }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        toast.error(err?.error || 'Pllaka nuk u ruajt')
        return
      }
      upsertCatalog([(await res.json()) as Product])
      toast.success(neArke ? `${product.emri} u shtua te pllakat` : `${product.emri} u hoq nga pllakat`)
    } catch {
      toast.error('Pllaka nuk u ruajt — kontrollo lidhjen')
    }
  }

  const setTileRef = useRef(setTile)
  setTileRef.current = setTile
  const onRemoveTile = useCallback((product: Product) => { void setTileRef.current(product, false) }, [])
  const onAddTile = useCallback((product: Product) => setTileRef.current(product, true), [])
  const onOpenPicker = useCallback(() => setPickerOpen(true), [])
  const onClosePicker = useCallback(() => {
    setPickerOpen(false)
    setTimeout(() => barcodeRef.current?.focus(), 100)
  }, [])

  // Stable identity for the memoised grid; always calls the current addToCart.
  const addToCartRef = useRef(addToCart)
  addToCartRef.current = addToCart
  const onAddProduct = useCallback((product: Product) => addToCartRef.current(product), [])

  function updateSasia(productId: number, delta: number) {
    setRawValues((prev) => {
      const next = { ...prev }
      delete next[productId]
      return next
    })
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.product.id !== productId) return item
          const newSasia = parseFloat((item.sasia + delta).toFixed(3))
          if (newSasia <= 0) return null
          if (newSasia > item.product.sasia) {
            toast.error(`Stoku maksimal: ${item.product.sasia} ${item.product.njesia}`)
            return item
          }
          return { ...item, sasia: newSasia }
        })
        .filter(Boolean) as CartItem[]
    )
  }

  function removeFromCart(productId: number) {
    setRawValues((prev) => {
      const next = { ...prev }
      delete next[productId]
      return next
    })
    setCart((prev) => prev.filter((i) => i.product.id !== productId))
  }

  function handleQuantityInput(item: CartItem, inputStr: string) {
    if (isWeighted(item.product.njesia)) {
      if (!/^(\d*\.?\d{0,3})?$/.test(inputStr)) return
    } else {
      if (!/^\d*$/.test(inputStr)) return
    }
    setRawValues((prev) => ({ ...prev, [item.product.id]: inputStr }))
    const parsed = parseFloat(inputStr)
    if (isNaN(parsed) || parsed <= 0) return
    if (isWeighted(item.product.njesia)) {
      if (parsed > item.product.sasia) {
        toast.error(`Stoku maksimal: ${item.product.sasia} ${item.product.njesia}`)
      }
      const val = parseFloat(Math.min(parsed, item.product.sasia).toFixed(3))
      setCart((prev) => prev.map((i) => i.product.id === item.product.id ? { ...i, sasia: val } : i))
    } else {
      const val = Math.max(1, Math.min(Math.floor(parsed), item.product.sasia))
      if (Math.floor(parsed) > item.product.sasia) {
        toast.error(`Stoku maksimal: ${item.product.sasia}`)
      }
      setCart((prev) => prev.map((i) => i.product.id === item.product.id ? { ...i, sasia: val } : i))
    }
  }

  function handleQuantityBlur(item: CartItem) {
    const raw = rawValues[item.product.id]
    if (raw === undefined) return
    const parsed = parseFloat(raw)
    if (isWeighted(item.product.njesia)) {
      const val = (isNaN(parsed) || parsed <= 0)
        ? 0.001
        : parseFloat(Math.min(parsed, item.product.sasia).toFixed(3))
      setCart((prev) => prev.map((i) => i.product.id === item.product.id ? { ...i, sasia: val } : i))
      setRawValues((prev) => ({ ...prev, [item.product.id]: val.toFixed(3) }))
    } else {
      const val = (isNaN(parsed) || parsed < 1)
        ? 1
        : Math.max(1, Math.min(Math.floor(parsed), item.product.sasia))
      setCart((prev) => prev.map((i) => i.product.id === item.product.id ? { ...i, sasia: val } : i))
      setRawValues((prev) => {
        const next = { ...prev }
        delete next[item.product.id]
        return next
      })
    }
  }

  // Amount in Lek for an untracked line; up to 2 decimals.
  function handleAmountInput(item: CartItem, inputStr: string) {
    if (!/^(\d*\.?\d{0,2})?$/.test(inputStr)) return
    setRawValues((prev) => ({ ...prev, [item.product.id]: inputStr }))
    const parsed = parseFloat(inputStr)
    const shuma = isNaN(parsed) || parsed <= 0 ? null : parsed
    setCart((prev) =>
      prev.map((i) => {
        if (i.product.id !== item.product.id) return i
        const next = { ...i, shuma }
        return { ...next, sasia: weightOf(next) }
      })
    )
  }

  function handleAmountBlur(item: CartItem) {
    setRawValues((prev) => {
      const next = { ...prev }
      delete next[item.product.id]
      return next
    })
  }

  function getDisplayValue(item: CartItem): string {
    const raw = rawValues[item.product.id]
    if (raw !== undefined) return raw
    if (!tracksStock(item.product.njesia)) return item.shuma == null ? '' : String(item.shuma)
    return isWeighted(item.product.njesia) ? item.sasia.toFixed(3) : item.sasia.toString()
  }

  const totali = cart.reduce((sum, i) => sum + lineTotal(i), 0)
  // cmimiBlerjes is withheld from cashier sessions by the API, so this only
  // ever resolves for admins — who are the only ones shown the figure.
  // Amount lines: profit = amount − weight × cost per kg.
  const fitimi = cart.reduce(
    (sum, i) => sum + lineTotal(i) - (i.product.cmimiBlerjes ?? 0) * i.sasia,
    0
  )

  async function completeSale() {
    if (cart.length === 0) {
      toast.error('Shporta është bosh')
      return
    }
    const missing = cart.find((i) => !tracksStock(i.product.njesia) && weightOf(i) <= 0)
    if (missing) {
      toast.error(`Shkruaj shumën për: ${missing.product.emri}`)
      amountRefs.current.get(missing.product.id)?.focus()
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Amount lines send the amount; the server works out the weight.
          items: cart.map((i) =>
            tracksStock(i.product.njesia)
              ? { productId: i.product.id, sasia: i.sasia }
              : { productId: i.product.id, shuma: i.shuma }
          ),
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        toast.error(err.error || 'Gabim gjatë shitjes')
        return
      }

      const sale = (await res.json()) as CompletedSale
      setReceiptModal(sale)
      setCart([])
      // The response carries every sold product as it now stands (stock,
      // and prices if a pending change was promoted): update just those rows
      // in the cached catalogue instead of downloading all of it again.
      patchCatalog(
        sale.items.flatMap((item) =>
          item.product
            ? [{
                id: item.product.id,
                sasia: item.product.sasia,
                cmimiShitjes: item.product.cmimiShitjes,
                cmimiShitjesRi: item.product.cmimiShitjesRi,
                sasiaVjeter: item.product.sasiaVjeter,
                cmimiBlerjes: item.product.cmimiBlerjes,
                cmimiBlerjesRi: item.product.cmimiBlerjesRi,
              }]
            : []
        )
      )
      toast.success('Shitja u regjistrua me sukses!')
    } finally {
      setLoading(false)
    }
  }

  function printReceipt() {
    window.print()
  }

  if (!role || !['admin', 'cashier'].includes(role)) return <AccessDenied />

  const isAdmin = role === 'admin'

  return (
    <div className="flex flex-col h-full">
      {/* ── Mobile tab bar ── */}
      <div className="lg:hidden flex items-center border-b border-slate-200 bg-white flex-shrink-0">
        <button
          onClick={() => setMobileTab('products')}
          className={`flex-1 py-3.5 text-sm font-semibold transition-colors border-b-2 -mb-px ${
            mobileTab === 'products'
              ? 'text-blue-600 border-blue-600'
              : 'text-slate-500 border-transparent'
          }`}
        >
          Produktet
        </button>
        <button
          onClick={() => setMobileTab('cart')}
          className={`flex-1 py-3.5 text-sm font-semibold transition-colors border-b-2 -mb-px flex items-center justify-center gap-2 ${
            mobileTab === 'cart'
              ? 'text-blue-600 border-blue-600'
              : 'text-slate-500 border-transparent'
          }`}
        >
          Shporta
          {cart.length > 0 && (
            <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 bg-blue-600 text-white text-xs font-bold rounded-full">
              {cart.length}
            </span>
          )}
        </button>
      </div>

      {/* ── Content area ── */}
      <div
        ref={contentRef}
        className="flex-1 min-h-0 overflow-hidden flex lg:grid lg:grid-cols-[minmax(0,1fr)_var(--cart-w,400px)] xl:grid-cols-[minmax(0,1fr)_var(--cart-w,500px)]"
        // min() keeps a saved width from crowding out the products if the
        // window is later made narrower.
        style={
          cartWidth
            ? ({ '--cart-w': `min(${cartWidth}px, calc(100% - ${PRODUCTS_MIN_WIDTH}px))` } as React.CSSProperties)
            : undefined
        }
      >

        {/* ── Left: Product Search ── */}
        <div
          className={`flex-col overflow-hidden border-r border-slate-200 w-full lg:w-auto ${
            mobileTab === 'cart' ? 'hidden lg:flex' : 'flex'
          }`}
        >
          <div className="p-4 sm:p-5 border-b border-slate-100 space-y-3">
            <div className="flex items-center gap-2">
              {/* Desktop only — phones already have the top-bar menu button. */}
              {desktopSidebar.collapsible && (
                <button
                  onClick={desktopSidebar.toggle}
                  className="hidden lg:inline-flex p-1.5 -ml-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
                  aria-label={desktopSidebar.open ? 'Mbyll menunë' : 'Hap menunë'}
                  aria-expanded={desktopSidebar.open}
                  title={desktopSidebar.open ? 'Mbyll menunë' : 'Hap menunë'}
                >
                  <RiMenuLine className="text-xl" />
                </button>
              )}
              <h1 className="text-lg sm:text-xl font-bold text-slate-900">Shitjet — POS</h1>
            </div>

            {/* Scan or search in one field — its own component, so typing re-renders only it */}
            <BarcodeField
              ref={barcodeRef}
              onScan={onBarcodeScan}
              onPick={onPickProduct}
              onQuery={onQuery}
              products={products}
              findByBarcode={findByBarcode}
            />
          </div>

          {/*
            contain: strict makes this scroller a layout boundary. Without it,
            every character typed in the barcode field above made the browser
            lay out all ~600 tiles again (15-50 ms per keystroke). Its size
            comes from the flex column, never from its content, so size
            containment changes nothing on screen.
          */}
          <div className="flex-1 overflow-y-auto p-3 sm:p-4 [contain:strict]">
            {productsLoading ? (
              <div className={`${TILE_GRID} animate-pulse`}>
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-36 bg-slate-100 rounded-2xl" />
                ))}
              </div>
            ) : productsError ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 py-12 gap-3">
                <p className="text-sm font-medium text-slate-500">Gabim gjatë ngarkimit</p>
                <button
                  onClick={() => window.location.reload()}
                  className="btn-secondary text-xs"
                >
                  Provo Sërish
                </button>
              </div>
            ) : (
              <>
                {searching && (
                  <p className="text-xs text-slate-500 mb-2 sm:mb-3 px-0.5">
                    {results.length > 0
                      ? `Rezultatet për '${deferredQuery.trim()}' (${results.length})`
                      : 'Asnjë produkt'}
                  </p>
                )}
                <ProductGrid
                  sections={searching ? resultSections : tileSections}
                  cart={cart}
                  onAdd={onAddProduct}
                  onRemove={isAdmin && !searching ? onRemoveTile : undefined}
                  onOpenPicker={isAdmin && !searching ? onOpenPicker : undefined}
                />
              </>
            )}
          </div>
        </div>

        {/* ── Right: Cart ── */}
        <div
          className={`relative flex-col bg-white overflow-hidden w-full lg:w-auto ${
            mobileTab === 'products' ? 'hidden lg:flex' : 'flex'
          }`}
        >
          {/* Drag to resize; double-click restores the default width. */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Ndrysho gjerësinë e shportës"
            title="Tërhiq për të ndryshuar gjerësinë · dy klikime për ta rikthyer"
            onPointerDown={startCartResize}
            onDoubleClick={resetCartWidth}
            className="hidden lg:block absolute left-0 top-0 bottom-0 w-1.5 z-20 cursor-col-resize hover:bg-blue-300/60 active:bg-blue-400/60 transition-colors"
          />
          <div className="px-4 sm:px-5 py-4 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <RiShoppingCartLine className="text-xl text-slate-600" />
              <h2 className="font-semibold text-slate-900">Shporta</h2>
              {cart.length > 0 && (
                <span className="badge-blue ml-auto">{cart.length} produkte</span>
              )}
            </div>
          </div>

          {/* Layout boundary for the cart lines, as for the product grid. */}
          <div className="flex-1 overflow-y-auto min-h-0 [contain:strict]">
            {cart.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 py-16">
                  <RiShoppingCartLine className="text-5xl mb-3 text-slate-200" />
                  <p className="text-sm">Shporta është bosh</p>
                  <p className="text-xs mt-1">Skanoni barkod ose klikoni mbi produkt</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {cart.map((item) => (
                    <div
                      key={item.product.id}
                      ref={(el: HTMLDivElement | null) => {
                        if (el) lineRefs.current.set(item.product.id, el)
                        else lineRefs.current.delete(item.product.id)
                      }}
                      className={`px-4 py-3 sm:px-4 scroll-my-2 transition-colors duration-500 anim-slide-in-right ${
                        highlightId === item.product.id ? 'bg-blue-100' : 'bg-white'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <p className="text-sm font-medium text-slate-800 leading-tight flex-1 pr-2">
                          {item.product.emri}
                        </p>
                        <button
                          onClick={() => removeFromCart(item.product.id)}
                          className="text-slate-300 hover:text-red-500 transition-colors p-1 -m-1"
                        >
                          <RiDeleteBin6Line className="text-lg" />
                        </button>
                      </div>
                      {!tracksStock(item.product.njesia) ? (
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-1.5">
                            <input
                              ref={(el) => {
                                if (el) amountRefs.current.set(item.product.id, el)
                                else amountRefs.current.delete(item.product.id)
                              }}
                              type="text"
                              inputMode="decimal"
                              value={getDisplayValue(item)}
                              placeholder="Shuma"
                              onChange={(e) => handleAmountInput(item, e.target.value)}
                              onFocus={(e) => e.target.select()}
                              onBlur={() => handleAmountBlur(item)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  barcodeRef.current?.focus()
                                }
                              }}
                              className={`w-24 h-9 lg:h-7 text-center text-sm font-semibold border rounded-md focus:outline-none focus:border-blue-400 ${
                                item.shuma != null && weightOf(item) <= 0
                                  ? 'border-red-300'
                                  : 'border-slate-200'
                              }`}
                            />
                            <span className="text-xs text-slate-400">L</span>
                            <span className="text-xs text-slate-500 tabular-nums ml-1">
                              {weightOf(item) > 0
                                ? `= ${weightOf(item).toFixed(3)} ${item.product.njesia}`
                                : `${formatCurrency(item.product.cmimiShitjes)} / ${item.product.njesia}`}
                            </span>
                          </div>
                          <span className="text-sm font-bold text-slate-900">
                            {formatCurrency(lineTotal(item))}
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => updateSasia(item.product.id, isWeighted(item.product.njesia) ? -0.250 : -1)}
                              className="w-9 h-9 lg:w-8 lg:h-8 rounded-lg bg-slate-100 hover:bg-slate-200 active:bg-slate-300 flex items-center justify-center transition-colors flex-shrink-0"
                            >
                              <RiSubtractLine className="text-sm" />
                            </button>
                            <input
                              type="text"
                              inputMode={isWeighted(item.product.njesia) ? 'decimal' : 'numeric'}
                              value={getDisplayValue(item)}
                              onChange={(e) => handleQuantityInput(item, e.target.value)}
                              onFocus={(e) => {
                                setRawValues((prev) => ({
                                  ...prev,
                                  [item.product.id]: isWeighted(item.product.njesia)
                                    ? item.sasia.toFixed(3)
                                    : item.sasia.toString(),
                                }))
                                e.target.select()
                              }}
                              onBlur={() => handleQuantityBlur(item)}
                              className="w-20 h-9 lg:h-7 text-center text-sm font-semibold border border-slate-200 rounded-md focus:outline-none focus:border-blue-400"
                            />
                            <span className="text-xs text-slate-400 min-w-[2rem]">{item.product.njesia}</span>
                            <button
                              onClick={() => updateSasia(item.product.id, isWeighted(item.product.njesia) ? 0.250 : 1)}
                              className="w-9 h-9 lg:w-8 lg:h-8 rounded-lg bg-slate-100 hover:bg-slate-200 active:bg-slate-300 flex items-center justify-center transition-colors flex-shrink-0"
                            >
                              <RiAddLine className="text-sm" />
                            </button>
                          </div>
                          <span className="text-sm font-bold text-slate-900">
                            {formatCurrency(lineTotal(item))}
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
          </div>

          {/* Cart Summary */}
          <div className="border-t border-slate-200 p-4 sm:p-5 space-y-3 bg-white">
            <div className="flex justify-between text-sm text-slate-500">
              <span>Nën-totali</span>
              <span>{formatCurrency(totali)}</span>
            </div>
            {isAdmin && (
              <div className="flex justify-between text-sm text-green-600 font-medium">
                <span>Fitimi</span>
                <span>{formatCurrency(fitimi)}</span>
              </div>
            )}
            <div className="flex justify-between text-lg font-bold text-slate-900 pt-2 border-t border-slate-100">
              <span>TOTALI</span>
              <span>{formatCurrency(totali)}</span>
            </div>
            <button
              onClick={completeSale}
              disabled={loading || cart.length === 0}
              className={`w-full py-4 rounded-xl font-semibold text-base flex items-center justify-center gap-2 transition-all ${
                cart.length === 0
                  ? 'bg-slate-100 text-slate-300 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white shadow-sm'
              }`}
            >
              <RiCheckLine className="text-xl" />
              {loading ? 'Duke procesuar...' : 'Përfundo Shitjen'}
            </button>
            {cart.length > 0 && (
              <button
                onClick={() => setCart([])}
                className="w-full text-xs text-slate-400 hover:text-red-500 transition-colors py-1"
              >
                Pastro shportën
              </button>
            )}
          </div>
        </div>

      </div>{/* ── end content area ── */}

      {isAdmin && (
        <AddTilePicker
          isOpen={pickerOpen}
          onClose={onClosePicker}
          products={products}
          onAdd={onAddTile}
        />
      )}

      {/* Receipt Modal */}
      <Modal
        isOpen={!!receiptModal}
        onClose={() => setReceiptModal(null)}
        title="Fatura e Shitjes"
        size="sm"
      >
        {receiptModal && (
          <div>
            {/* Printable Receipt */}
            <div id="receipt" className="font-mono">
              <div className="text-center mb-4">
                <h2 className="text-lg font-bold">MARKET OS</h2>
                <p className="text-xs text-slate-500">Sistemi i Marketit</p>
                <p className="text-xs text-slate-400 mt-1">{formatDateTime(receiptModal.createdAt)}</p>
                <p className="text-xs text-slate-400">Fatura #{receiptModal.id}</p>
              </div>
              <div className="border-t border-dashed border-slate-300 my-3" />
              <div className="space-y-1.5 mb-3">
                {receiptModal.items.map((item, idx) => (
                  <div key={idx} className="flex justify-between text-sm">
                    <div className="flex-1">
                      <span className="font-medium">{item.emriProduktit}</span>
                      <span className="text-slate-400 text-xs ml-2">
                        {isWeighted(item.product?.njesia || '')
                          ? item.sasia.toFixed(3)
                          : item.sasia}{' '}
                        {item.product?.njesia || ''}
                      </span>
                    </div>
                    <span className="font-medium">{formatCurrency(item.cmimiShitjes * item.sasia)}</span>
                  </div>
                ))}
              </div>
              <div className="border-t border-dashed border-slate-300 my-3" />
              <div className="flex justify-between font-bold text-base">
                <span>TOTALI</span>
                <span>{formatCurrency(receiptModal.totali)}</span>
              </div>
              <div className="text-center mt-4 text-xs text-slate-400">
                <p>Faleminderit për blerjen!</p>
              </div>
            </div>

            <div className="flex gap-3 mt-5 no-print">
              <button
                onClick={printReceipt}
                className="btn-secondary flex-1 flex items-center justify-center gap-2"
              >
                <RiPrinterLine />
                Printo Faturën
              </button>
              <button
                onClick={() => setReceiptModal(null)}
                className="btn-primary flex-1"
              >
                Mbyll
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
