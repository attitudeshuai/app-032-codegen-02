/**
 * 灯样存储（Vue 自带响应式 + localStorage，无 Pinia/Vuex）
 * 灯型库与工艺参数来自本地打包 src/data/lantern-types.json，断网可用。
 */
import { reactive, watch } from 'vue'
import type { Lantern } from './types'
import { CRAFT, coveringSpec, presetById, PRESETS } from './craft'
import { buildGeometry, effectiveHeight, r1 } from './geometry'
import { defaultPatternPlan, makeIssue, planPatternCutting, patternSignature } from './pattern'

const KEY = 'lantern-frame-lofting.v1'

interface StoreState {
  lanterns: Lantern[]
  ready: boolean
  storageError: string
}

export const state = reactive<StoreState>({ lanterns: [], ready: false, storageError: '' })

let suspendPersist = false
let timer: number | undefined

function makeId(): string {
  return 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

function r1v(v: number): number {
  return Math.round(v * 10) / 10
}

/** 依据灯型库预设新建灯样 */
export function createFromPreset(presetId: string): Lantern {
  const preset = presetById(presetId) || PRESETS[0]
  const p = preset.params
  const count = Math.max(1, Math.round(p.layerCount))
  const each = p.totalHeightMm / count
  const layers = Array.from({ length: count }, () => ({ heightMm: r1v(each), diameterMm: 0 }))
  // 保证分段高度之和 = 总高
  const sum = layers.reduce((s, x) => s + x.heightMm, 0)
  layers[layers.length - 1].heightMm = r1v(layers[layers.length - 1].heightMm + (p.totalHeightMm - sum))

  const now = new Date().toISOString()
  const lantern: Lantern = {
    id: makeId(),
    kind: preset.kind,
    name: preset.name,
    maxDiameterMm: p.maxDiameterMm,
    totalHeightMm: p.totalHeightMm,
    mouthDiameterMm: p.mouthDiameterMm,
    baseDiameterMm: p.baseDiameterMm,
    sides: p.sides,
    layers,
    mouthStyle: p.mouthStyle,
    bottomStyle: p.bottomStyle,
    smoothness: p.smoothness,
    ctrl1: p.ctrl1 ? { ...p.ctrl1 } : { x: 0.12, y: 0.3 },
    ctrl2: p.ctrl2 ? { ...p.ctrl2 } : { x: 0.85, y: 0.78 },
    divisions: p.divisions ?? CRAFT.defaultDivisions,
    covering: p.covering,
    seamAllowanceMm: CRAFT.defaultSeamAllowanceMm,
    lashAllowanceMm: CRAFT.defaultLashAllowanceMm,
    layerColors: [...p.layerColors],
    color: p.color,
    batchCount: 20,
    wasteRatio: coveringSpec(p.covering).wasteRatio,
    pageSize: 'A4',
    overlapMm: CRAFT.defaultOverlapMm,
    pattern: defaultPatternPlan(),
    createdAt: now,
    updatedAt: now
  }
  syncLayerDiameters(lantern)
  return lantern
}

/** 把轮廓算出的直径写回分段（数据模型 §7 中 layers[].diameterMm） */
export function syncLayerDiameters(l: Lantern) {
  const g = buildGeometry(l)
  l.layers.forEach((ly, i) => {
    const sec = g.sections[i + 1]
    if (sec) ly.diameterMm = r1(sec.radiusMm * 2)
  })
  l.totalHeightMm = r1(effectiveHeight(l))
}

/** 分段高度均分（改总高/层数时调用） */
export function distributeLayers(l: Lantern) {
  const count = Math.max(1, Math.round(l.layers.length))
  const each = l.totalHeightMm / count
  l.layers = Array.from({ length: count }, () => ({ heightMm: r1v(each), diameterMm: 0 }))
  const sum = l.layers.reduce((s, x) => s + x.heightMm, 0)
  l.layers[count - 1].heightMm = r1v(l.layers[count - 1].heightMm + (l.totalHeightMm - sum))
  while (l.layerColors.length < count) l.layerColors.push(l.color)
  l.layerColors = l.layerColors.slice(0, count)
  syncLayerDiameters(l)
}

/** 旧版灯样（没有 pattern 字段）补齐按花纹周期取料的存档结构 */
function migrateLantern(l: Lantern): Lantern {
  if (!l.pattern) {
    l.pattern = defaultPatternPlan()
  } else {
    const d = defaultPatternPlan()
    const p = l.pattern as unknown as Record<string, unknown>
    if (p.stockByColor === undefined) l.pattern.stockByColor = {}
    if (typeof p.version !== 'number') l.pattern.version = d.version
    if (p.issued === undefined) l.pattern.issued = null
  }
  return l
}

/**
 * 改一次花纹周期 / 花位偏移 / 路线 / 幅宽 / 公差：版次 +1。
 * 已发布的旧版（旧取料结果 + 旧清单 + 旧备料单）即整版作废，由差异表列出。
 */
export function bumpPatternVersion(l: Lantern) {
  l.pattern.version += 1
  l.updatedAt = new Date().toISOString()
}

/** 发布当前版给作坊：把这一版的周期、花位、下刀段与各色用布存进灯样存档 */
export function issuePatternPlan(l: Lantern) {
  const plan = planPatternCutting(l)
  l.pattern.issued = makeIssue(plan)
  l.updatedAt = new Date().toISOString()
  return l.pattern.issued
}

/** 当前取料指纹相对存档（便于不渲染结果时快速判断是否已发布最新版） */
export function patternInSync(l: Lantern): boolean {
  const iss = l.pattern.issued
  return !!iss && iss.signature === patternSignature(l)
}

export function addLantern(l: Lantern) {
  state.lanterns.unshift(l)
  return l
}

export function getLantern(id: string): Lantern | undefined {
  return state.lanterns.find((l) => l.id === id)
}

export function duplicateLantern(id: string): Lantern | undefined {
  const src = getLantern(id)
  if (!src) return undefined
  const copy: Lantern = JSON.parse(JSON.stringify(src))
  migrateLantern(copy)
  copy.id = makeId()
  copy.name = src.name + ' 副本'
  // 副本没有发过作坊，已发布快照作废，版次从 1 重新记
  copy.pattern.issued = null
  copy.pattern.version = 1
  copy.createdAt = copy.updatedAt = new Date().toISOString()
  state.lanterns.unshift(copy)
  return copy
}

export function removeLantern(id: string) {
  const i = state.lanterns.findIndex((l) => l.id === id)
  if (i >= 0) state.lanterns.splice(i, 1)
}

function persistNow() {
  suspendPersist = true
  try {
    for (const l of state.lanterns) {
      migrateLantern(l)
      syncLayerDiameters(l)
    }
    localStorage.setItem(KEY, JSON.stringify({ version: 1, lanterns: state.lanterns }))
    state.storageError = ''
  } catch (e) {
    state.storageError = e instanceof Error ? e.message : String(e)
  } finally {
    suspendPersist = false
  }
}

function schedulePersist() {
  if (timer !== undefined) window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    timer = undefined
    persistNow()
  }, 180)
}

/** 载入本地灯样；首次进入预置一个六角宫灯，便于立即放样 */
export function loadStore() {
  if (state.ready) return
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const data = JSON.parse(raw) as { lanterns?: Lantern[] }
      if (Array.isArray(data.lanterns)) state.lanterns = data.lanterns.map(migrateLantern)
    }
  } catch {
    state.storageError = '本地灯样数据损坏，已重置'
  }
  if (state.lanterns.length === 0) {
    state.lanterns.push(createFromPreset('hex-palace'))
  }
  state.ready = true
  watch(
    () => state.lanterns,
    () => {
      if (suspendPersist) return
      schedulePersist()
    },
    { deep: true }
  )
  persistNow()
}

export function useLanternStore() {
  return {
    state,
    createFromPreset,
    addLantern,
    getLantern,
    duplicateLantern,
    removeLantern,
    distributeLayers,
    syncLayerDiameters,
    bumpPatternVersion,
    issuePatternPlan,
    patternInSync
  }
}
