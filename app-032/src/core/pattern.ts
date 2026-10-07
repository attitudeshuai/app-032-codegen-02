/**
 * 按花纹周期取料（对花取料）
 * ----------------------------------------------------------------------------
 * 规矩（全部写死、界面上也照此说明）：
 *  1. 每层展开后的实际周长走「轮廓 + 棱长周长」那一路（geometry.sections +
 *     ringPerimeter / polygonEdge），不用图上量出来的数；裁片净宽用 panels.ts
 *     的展开净尺寸，缝份与合围搭接量一起算进下刀段。
 *  2. 相位是本活的难点：每层 (周长 mod 周期) 的余数**逐层累加**，进层相位
 *     P_i = (花位偏移 + Σ 下层余数) mod 周期；花位偏移与缝份先按 mm 算，
 *     再换算成周期上的比例（4 位小数）；累计偏移绝不逐层抹掉。
 *  3. 长度一律 mm，偏差保留 1 位小数，闭合容差 0.05mm；每层各片下刀段首尾
 *     接起来（净宽）= 该层实际周长。
 *  4. 两条路只能取舍一条：
 *     - match 保花纹严丝合缝：每条竖缝两边净边相位相等，缝间要沿卷长空让
 *       m 个周期，产生布头空耗；
 *     - cloth 保布头不浪费：连刀裁、缝间不空让，每条竖缝错 (2×缝份) mod 周期
 *       的相位（合围缝另计累计余数）。
 *  5. 蒙面裁片页 / 材料页 / 作坊裁片清单三处取同一个 PatternPlan（同一签名）。
 */
import type {
  Lantern,
  Panel,
  PatternColorRoll,
  PatternConcession,
  PatternCost,
  PatternCutPiece,
  PatternDiff,
  PatternDiffEntry,
  PatternLayerPlan,
  PatternPlan,
  PatternShelf,
  PatternSpec,
  PatternCapCut,
  PatternPhaseMark,
  PatternSeam
} from './types'
import { buildGeometry, r1, r3, ringPerimeter } from './geometry'
import { buildPanels } from './panels'

/** 闭合判定容差（mm）：偏差绝对值 ≤ 0.05 视为对得上（显示保留 1 位小数） */
export const PATTERN_EPS = 0.05

export function defaultPatternSpec(): PatternSpec {
  return {
    enabled: false,
    boltWidthMm: 900,
    repeatMm: 150,
    offsetMm: 0,
    lapMm: 10,
    priority: 'match',
    acceptLayerIndex: -1,
    stockByColor: {}
  }
}

/** 带符号取模到 (-r/2, r/2]：偏差带方向，正数 = 右片花纹超前 */
function modSigned(v: number, r: number): number {
  const x = v - r * Math.round(v / r)
  return Object.is(x, -0) ? 0 : x
}

/** 取模到 [0, r)；浮点余落在整周期边上（如 600/100）归 0 */
function modPos(v: number, r: number): number {
  let x = v - r * Math.floor(v / r + 1e-9)
  if (x >= r - 1e-7) x = 0
  if (x <= 1e-7) x = 0
  return Object.is(x, -0) ? 0 : x
}

function ratio4(v: number, r: number): number {
  return Math.round((v / r) * 10000) / 10000
}

function f1s(v: number): string {
  return (Math.round(v * 10) / 10).toFixed(1)
}

/** 截面周长：走既有轮廓与棱长周长那一路（圆形 2πR / 多边形 n×棱长） */
function sectionPerimeter(g: ReturnType<typeof buildGeometry>, index: number): number {
  const sec = g.sections[index]
  return ringPerimeter(sec.radiusMm, g.n, g.polygon)
}

interface BuiltLayer {
  plan: PatternLayerPlan
  /** 两条路线下的各片下刀段（与 panels 同源） */
  matchPieces: PatternCutPiece[]
  clothPieces: PatternCutPiece[]
  matchSpan: number
  clothSpan: number
  matchGapWaste: number
  /** cloth 路线下对不上的缝（含内部缝与合围缝） */
  clothBadSeams: PatternSeam[]
}

/** 构一层的下刀段（两条路线都算，主算一条、另一条只用于代价对比） */
function buildLayer(
  l: Lantern,
  layerIndex: number,
  bandPanel: Panel,
  g: ReturnType<typeof buildGeometry>,
  entryPhaseMm: number,
  r: number,
  s: number,
  lap: number
): BuiltLayer {
  const perimB = sectionPerimeter(g, layerIndex) // 下沿（进层那一圈）
  const perimT = sectionPerimeter(g, layerIndex + 1) // 上沿
  const q = bandPanel.qty
  const wb0 = perimB / q
  const wt0 = perimT / q
  // 前 q-1 片按 1 位小数下刀，末片吃下舍入差：保证 Σ 片宽 = 实际周长（逐片严格闭合）
  const wbs: number[] = Array.from({ length: q }, (_, k) => (k < q - 1 ? r1(wb0) : r1(perimB - (q - 1) * r1(wb0))))
  const wts: number[] = Array.from({ length: q }, (_, k) => (k < q - 1 ? r1(wt0) : r1(perimT - (q - 1) * r1(wt0))))
  const wb = wb0 // 平均净宽（单宽标记/公式参考用）
  const wt = wt0
  const rawH = bandPanel.rawHeightMm
  const cutH = rawH + 2 * s
  const straight = Math.abs(perimT - perimB) < 0.05

  const remB = modPos(perimB, r)
  const remT = modPos(perimT, r)
  const closeB = modSigned(entryPhaseMm + perimB, r)
  const closeT = modSigned(entryPhaseMm + perimT, r)
  const closeLabel = `L${layerIndex + 1}-末→①（合围缝）`

  const color = l.layerColors[layerIndex] || l.color
  const seamLabel = (k: number, closing: boolean) =>
    closing ? closeLabel : `L${layerIndex + 1}-${k + 1}→${k + 2}`

  /** 一片上的对位/花位标记（下刀框坐标：x 沿卷长，y 沿幅宽） */
  const marksOf = (
    startPhase: number,
    cutLen: number,
    closing: boolean,
    mismatch: number,
    wbK: number,
    wtK: number
  ): PatternPhaseMark[] => {
    const marks: PatternPhaseMark[] = [
      { xMm: r1(s), yMm: r1(s), kind: 'seam', label: `左净边：花位 ${f1s(startPhase)}/${f1s(r)}（${(ratio4(startPhase, r) * 100).toFixed(2)}%）` },
      { xMm: r1(cutLen - s - (closing ? lap : 0)), yMm: r1(s), kind: 'seam', label: `右净边（下沿）` },
      { xMm: r1(s), yMm: r1(cutH - s), kind: 'phase', label: `左净边·上沿 花位 ${f1s(modPos(startPhase + (wtK - wbK), r))}/${f1s(r)}` },
      { xMm: r1(s + wbK / 2), yMm: r1(s), kind: 'phase', label: `下沿中点 花位 ${f1s(modPos(startPhase + wbK / 2, r))}/${f1s(r)}` }
    ]
    // 净宽内每过一个整周期打一朵对花刻点（供铺布时点花）
    const firstTick = r - modPos(startPhase, r)
    for (let t = firstTick + 1e-9; t < wbK - 1e-6; t += r) {
      marks.push({ xMm: r1(s + t), yMm: r1(s), kind: 'phase', label: `对花点 花位 0/${f1s(r)}（x=${f1s(t)}）` })
    }
    if (closing) {
      marks.push({ xMm: r1(cutLen), yMm: r1(cutH / 2), kind: 'lap', label: `合围搭接端：多裁 ${f1s(lap)}mm（折进遮住起头缝，不参与对花）；合围偏差 ${f1s(mismatch)}mm` })
    }
    return marks
  }

  const mkPiece = (
    route: 'match' | 'cloth',
    k: number,
    startPhase: number,
    localFrom: number,
    gapBefore: number,
    headSkip: number,
    closing: boolean,
    seam: PatternSeam,
    wbK: number,
    wtK: number
  ): PatternCutPiece => {
    const cutLen = wbK + 2 * s + (closing ? lap : 0)
    return {
      layerIndex,
      pieceIndex: k,
      panelId: bandPanel.id,
      label: `L${layerIndex + 1} 第 ${k + 1}/${q} 片`,
      color,
      netWidthBottomMm: r1(wbK),
      netWidthTopMm: r1(wtK),
      cutLengthMm: r1(cutLen),
      cutHeightMm: r1(cutH),
      phaseStartMm: r1(modPos(startPhase, r)),
      phaseStartRatio: ratio4(modPos(startPhase, r), r),
      gapBeforeMm: r1(gapBefore),
      headSkipMm: r1(headSkip),
      bandFromMm: r1(localFrom),
      rollFromMm: 0,
      rollToMm: 0,
      rollCrossFromMm: 0,
      rollCrossToMm: 0,
      shelfIndex: 0,
      closing,
      seam,
      marksMm: marksOf(startPhase, cutLen, closing, closing ? (route === 'match' ? closeB : modSigned(entryPhaseMm + perimB, r)) : seam.mismatchBottomMm, wbK, wtK)
    }
  }

  // ---------- 保花纹路线：每条内部竖缝两边净边同相 ----------
  const matchPieces: PatternCutPiece[] = []
  // 首片：花位偏移就是起头；首刀起点 = 起头相位（0 ≤ offset < r 时这一段是幅宽排起头空耗）
  const headSkip = modPos(entryPhaseMm, r)
  let cursor = headSkip // 已用掉的卷长（相对本层带起点）
  // 不变量：phaseCursor = 当片左净边花位。内部缝两边同相要求
  //   下片左净边 = 上片右净边 + gap（mod r），即 gap ≡ 2s (mod r) 的最小非负补
  let phaseCursor = modPos(entryPhaseMm, r)
  const gapNeed = Math.max(0, Math.ceil(2 * s / r - 1e-9) * r - 2 * s)
  for (let k = 0; k < q; k++) {
    const closing = k === q - 1
    const gap = k === 0 ? 0 : gapNeed
    const from = cursor + gap
    // 缝的对花结果（内部缝下沿严格同相；上沿在梯形时随该片上下净宽差漂移）
    let seam: PatternSeam
    if (closing) {
      seam = { label: closeLabel, mismatchBottomMm: r1(closeB), mismatchTopMm: r1(closeT), closing: true }
    } else {
      seam = { label: seamLabel(k, false), mismatchBottomMm: 0, mismatchTopMm: r1(modSigned(wts[k] - wbs[k], r)), closing: false }
    }
    matchPieces.push(mkPiece('match', k, phaseCursor, from, gap, k === 0 ? headSkip : 0, closing, seam, wbs[k], wts[k]))
    cursor = from + matchPieces[matchPieces.length - 1].cutLengthMm
    // 下片左净边相位 = 当片右净边相位 + 空让 gap（保花路线下缝两边同相）
    phaseCursor = modPos(phaseCursor + wbs[k] + 2 * s + gap, r)
  }
  const matchSpan = cursor
  const matchGapWaste = matchPieces.reduce((a, p) => a + p.gapBeforeMm, 0) + headSkip

  // ---------- 保布头路线：连刀裁，缝间不空让 ----------
  const clothPieces: PatternCutPiece[] = []
  const clothBad: PatternSeam[] = []
  // 布头路线首刀即从卷料 0 起，花位仅由片相位读（花位偏移仍作为进层相位参与合围判定）
  let clothCursor = 0
  phaseCursor = modPos(entryPhaseMm, r)
  for (let k = 0; k < q; k++) {
    const closing = k === q - 1
    let seam: PatternSeam
    if (closing) {
      seam = { label: closeLabel, mismatchBottomMm: r1(closeB), mismatchTopMm: r1(closeT), closing: true }
    } else {
      const mb = modSigned(2 * s, r)
      const mt = modSigned(2 * s + (wts[k] - wbs[k]), r)
      seam = { label: seamLabel(k, false), mismatchBottomMm: r1(mb), mismatchTopMm: r1(mt), closing: false }
    }
    if (closing || Math.abs(seam.mismatchBottomMm) > PATTERN_EPS || Math.abs(seam.mismatchTopMm) > PATTERN_EPS) {
      clothBad.push(seam)
    }
    clothPieces.push(mkPiece('cloth', k, phaseCursor, clothCursor, 0, 0, closing, seam, wbs[k], wts[k]))
    clothCursor += clothPieces[clothPieces.length - 1].cutLengthMm
    phaseCursor = modPos(phaseCursor + wbs[k] + 2 * s, r)
  }
  const clothSpan = clothCursor

  const plan: PatternLayerPlan = {
    layerIndex,
    label: `第 ${layerIndex + 1} 层`,
    color,
    perimeterBottomMm: r1(perimB),
    perimeterTopMm: r1(perimT),
    pieceBottomMm: r1(wb),
    pieceTopMm: r1(wt),
    pieceCount: q,
    quotient: Math.floor(perimB / r + 1e-9),
    remainderBottomMm: r1(remB),
    remainderTopMm: r1(remT),
    entryPhaseMm: r1(modPos(entryPhaseMm, r)),
    entryPhaseRatio: ratio4(modPos(entryPhaseMm, r), r),
    closingMismatchBottomMm: r1(closeB),
    closingMismatchTopMm: r1(closeT),
    closingSeamLabel: closeLabel,
    netHeightMm: r1(rawH),
    cutHeightMm: r1(cutH),
    bandSpanMm: r1(matchSpan),
    gapWasteMm: r1(matchGapWaste),
    pieces: [],
    straight
  }

  return { plan, matchPieces, clothPieces, matchSpan, clothSpan, matchGapWaste, clothBadSeams: clothBad }
}

/** 高度试探：只改一层高，重走轮廓，看这一层周长能否被周期整除（容差内） */
function probeHeight(l: Lantern, layerIndex: number, newHeight: number): { perimB: number; perimT: number } {
  const probe: Lantern = {
    ...l,
    layers: l.layers.map((ly, i) => (i === layerIndex ? { ...ly, heightMm: Math.max(1, newHeight) } : ly))
  }
  const g = buildGeometry(probe)
  // 改动会牵动相邻截面，这里只看本层两圈周长
  return { perimB: sectionPerimeter(g, layerIndex), perimT: sectionPerimeter(g, layerIndex + 1) }
}

function resizeSuggestion(l: Lantern, bl: BuiltLayer, r: number): PatternConcession | null {
  if (bl.plan.straight) return null
  const i = bl.plan.layerIndex
  const oldH = l.layers[i].heightMm
  // 在 ±25mm 内以 0.1mm 步长重走轮廓，找上下沿周长同时落在整周期（±0.1mm）的最小改动
  let best: { dh: number; h: number; pB: number; pT: number } | null = null
  for (let dh = -25; dh <= 25.0001; dh = Math.round((dh + 0.1) * 10) / 10) {
    if (Math.abs(dh) < 0.05) continue
    const h = oldH + dh
    const got = probeHeight(l, i, h)
    const err = Math.max(Math.abs(modSigned(got.perimB, r)), Math.abs(modSigned(got.perimT, r)))
    if (err <= 0.1 && (!best || Math.abs(dh) < Math.abs(best.dh))) {
      best = { dh, h, pB: got.perimB, pT: got.perimT }
    }
  }
  if (!best) return null
  return {
    kind: 'resize',
    layerIndex: i,
    label: `改一层高度：第 ${i + 1} 层 ${f1s(oldH)} → ${f1s(best.h)}mm`,
    detail: `层高 ${f1s(best.dh)}mm 后，该层下沿周长 ${f1s(best.pB)}mm、上沿 ${f1s(best.pT)}mm 均为周期 ${f1s(r)}mm 的整数倍（±0.1mm 内），本层合围缝对得上；改动会重走轮廓并整批重算。`,
    newLayerHeightMm: r1(best.h),
    heightDeltaMm: r1(best.dh),
    newPerimeterMm: r1(best.pB),
    stillOpenLayers: [],
    closesLayers: [i]
  }
}

interface PackItem {
  id: string
  color: string
  label: string
  crossMm: number
  alongMm: number
  kind: 'band' | 'cap'
  band?: { layer: BuiltLayer; pieces: PatternCutPiece[]; span: number }
  cap?: { panel: Panel; cutLen: number; cutCross: number }
}

/** 幅宽排打包：各色独立，首次适配（同层序），排尾空档计入空耗 */
function packByColor(items: PackItem[], boltWidth: number) {
  const byColor = new Map<string, PackItem[]>()
  for (const it of items) {
    const arr = byColor.get(it.color) || []
    arr.push(it)
    byColor.set(it.color, arr)
  }
  const rolls: PatternColorRoll[] = []
  const pieceAssign = new Map<string, { shelf: number; from: number; to: number; crossFrom: number; crossTo: number }>()
  const capAssign = new Map<string, { shelf: number; from: number; to: number; crossFrom: number; crossTo: number }>()

  for (const [color, arr] of byColor) {
    // 带按层序、盖片排在所有带之后；同一幅宽排内带统一起头 0，盖片排在最长带之后
    const sorted = [...arr].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'band' ? -1 : 1))
    interface ShelfRun {
      crossUsed: number
      width: number
      bandLength: number
      capCursor: number
      length: number
      n: number
      placed: { it: PackItem; from: number; crossFrom: number; len: number }[]
    }
    const shelves: ShelfRun[] = []
    for (const it of sorted) {
      let shelf = shelves.find((sh) => sh.crossUsed + it.crossMm <= boltWidth + 1e-6)
      if (!shelf) {
        shelf = { crossUsed: 0, width: 0, bandLength: 0, capCursor: 0, length: 0, n: 0, placed: [] }
        shelves.push(shelf)
      }
      const crossFrom = shelf.crossUsed
      const from = it.kind === 'band' ? 0 : Math.max(shelf.bandLength, shelf.capCursor)
      shelf.placed.push({ it, from, crossFrom, len: it.alongMm })
      shelf.crossUsed += it.crossMm
      shelf.width = Math.max(shelf.width, shelf.crossUsed)
      shelf.length = Math.max(shelf.length, from + it.alongMm)
      shelf.n += 1
      if (it.kind === 'band') shelf.bandLength = Math.max(shelf.bandLength, it.alongMm)
      else shelf.capCursor = from + it.alongMm
    }
    const shelfPlans: PatternShelf[] = shelves.map((sh, i) => ({
      index: i,
      crossFromMm: r1(sh.placed[0]?.crossFrom ?? 0),
      crossWidthMm: r1(sh.width),
      lengthMm: r1(sh.length),
      itemCount: sh.n
    }))
    const usedBy: string[] = []
    let cutTotal = 0
    for (let si = 0; si < shelves.length; si++) {
      const sh = shelves[si]
      for (const pl of sh.placed) {
        const it = pl.it
        usedBy.push(it.label)
        if (it.kind === 'band' && it.band) {
          // 该带各片的卷上坐标 = 带内本地坐标 + 幅宽排起点
          for (const p of it.band.pieces) {
            const from = pl.from + p.bandFromMm
            const len = p.cutLengthMm
            pieceAssign.set(`${it.color}#${it.id}#${p.pieceIndex}`, {
              shelf: si,
              from: r1(from),
              to: r1(from + len),
              crossFrom: r1(pl.crossFrom),
              crossTo: r1(pl.crossFrom + it.crossMm)
            })
            cutTotal += len
          }
        } else if (it.cap) {
          capAssign.set(it.id, {
            shelf: si,
            from: r1(pl.from),
            to: r1(pl.from + it.alongMm),
            crossFrom: r1(pl.crossFrom),
            crossTo: r1(pl.crossFrom + it.crossMm)
          })
          cutTotal += it.alongMm
        }
      }
    }
    const required = shelves.reduce((a, sh) => a + sh.length, 0)
    rolls.push({
      color,
      usedBy,
      boltWidthMm: r1(boltWidth),
      shelves: shelfPlans,
      requiredLengthMm: r1(required),
      wasteLengthMm: r1(required - cutTotal),
      requiredAreaM2: r3((required * boltWidth) / 1_000_000),
      batchRequiredLengthMm: 0,
      batchRequiredAreaM2: 0,
      stockLengthMm: null,
      enough: null
    })
  }
  return { rolls, pieceAssign, capAssign }
}

/** 结果签名：规范化输入 + 关键结果聚合做 FNV-1a，三处同源同一串数 */
function signatureOf(canonical: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  const a = (h >>> 0).toString(16).padStart(8, '0')
  let h2 = 0x1e35a7bd
  for (let i = 0; i < canonical.length; i++) {
    h2 ^= canonical.charCodeAt(i)
    h2 = Math.imul(h2, 0x01000193)
  }
  return (a + (h2 >>> 0).toString(16).padStart(8, '0')).toUpperCase()
}

export function buildPatternPlan(l: Lantern): PatternPlan {
  const spec: PatternSpec = {
    enabled: !!l.pattern?.enabled,
    boltWidthMm: Math.max(1, Number(l.pattern?.boltWidthMm) || 0),
    repeatMm: Math.max(1, Number(l.pattern?.repeatMm) || 1),
    offsetMm: Math.max(0, Number(l.pattern?.offsetMm) || 0),
    lapMm: Math.max(0, Number(l.pattern?.lapMm) || 0),
    priority: l.pattern?.priority === 'cloth' ? 'cloth' : 'match',
    acceptLayerIndex: Number.isInteger(l.pattern?.acceptLayerIndex) ? (l.pattern as PatternSpec).acceptLayerIndex : -1,
    stockByColor: { ...(l.pattern?.stockByColor || {}) }
  }
  const invalidReason = validateSpec(spec)
  const valid = !invalidReason
  const g = buildGeometry(l)
  const panelRes = buildPanels(l)
  const r = spec.repeatMm
  const s = Math.max(0, l.seamAllowanceMm)
  const lap = spec.lapMm
  const route = spec.priority

  // 围向面板（每层一种）；顶/底盖/三角片走 cap 件
  const bandPanels = new Map<number, Panel>()
  const capPanels: Panel[] = []
  for (const p of panelRes.panels) {
    if (p.layerIndex >= 0) bandPanels.set(p.layerIndex, p)
    else capPanels.push(p)
  }

  // 逐层：余数逐层累加，进层相位 = 花位偏移 + Σ下层余数
  const built: BuiltLayer[] = []
  let cum = modPos(spec.offsetMm, r)
  l.layers.forEach((_, i) => {
    const bp = bandPanels.get(i)
    if (!bp) return
    const bl = buildLayer(l, i, bp, g, cum, r, s, lap)
    built.push(bl)
    // 余数累加：以进层那一圈（下沿）周长的余数往下带
    cum = modPos(cum + modPos(bl.plan.perimeterBottomMm, r), r)
  })

  // 打包物件
  const items: PackItem[] = []
  for (const bl of built) {
    const pieces = route === 'match' ? bl.matchPieces : bl.clothPieces
    const span = route === 'match' ? bl.matchSpan : bl.clothSpan
    items.push({
      id: `L${bl.plan.layerIndex}`,
      color: bl.plan.color,
      label: bl.plan.label,
      crossMm: bl.plan.cutHeightMm,
      alongMm: span,
      kind: 'band',
      band: { layer: bl, pieces, span }
    })
  }
  for (const p of capPanels) {
    const cutLen = Math.max(p.widthTopMm, p.widthBottomMm)
    const cutCross = p.shape === 'triangle' ? p.heightMm : Math.max(p.widthTopMm, p.heightMm)
    items.push({
      id: p.id,
      color: p.color,
      label: p.label,
      crossMm: cutCross,
      alongMm: cutLen,
      kind: 'cap',
      cap: { panel: p, cutLen, cutCross }
    })
  }

  const packed = packByColor(items, spec.boltWidthMm)

  // 回写卷上坐标 & 选出主路线 pieces 挂到 layer plan
  const layers: PatternLayerPlan[] = built.map((bl) => {
    const pieces = route === 'match' ? bl.matchPieces : bl.clothPieces
    const span = route === 'match' ? bl.matchSpan : bl.clothSpan
    for (const p of pieces) {
      const a = packed.pieceAssign.get(`${bl.plan.color}#L${bl.plan.layerIndex}#${p.pieceIndex}`)
      if (a) {
        p.shelfIndex = a.shelf
        p.rollFromMm = a.from
        p.rollToMm = a.to
        p.rollCrossFromMm = a.crossFrom
        p.rollCrossToMm = a.crossTo
      }
    }
    // 保布头路线连刀裁：缝间不起头空让（首刀即卷料 0）
    const gapWaste = route === 'match' ? bl.matchGapWaste : 0
    return { ...bl.plan, pieces, bandSpanMm: r1(span), gapWasteMm: r1(gapWaste) }
  })

  const caps: PatternCapCut[] = []
  for (const p of capPanels) {
    const cutLen = Math.max(p.widthTopMm, p.widthBottomMm)
    const cutCross = p.shape === 'triangle' ? p.heightMm : Math.max(p.widthTopMm, p.heightMm)
    const a = packed.capAssign.get(p.id)
    caps.push({
      panelId: p.id,
      label: p.label,
      color: p.color,
      cutLengthMm: r1(cutLen),
      cutCrossMm: r1(cutCross),
      rollFromMm: a?.from ?? 0,
      rollToMm: a?.to ?? 0,
      rollCrossFromMm: a?.crossFrom ?? 0,
      rollCrossToMm: a?.crossTo ?? 0,
      shelfIndex: a?.shelf ?? 0,
      note: p.note || ''
    })
  }

  // 库存与批量
  const count = Math.max(1, Math.round(l.batchCount))
  const k = count * (1 + l.wasteRatio)
  const rolls: PatternColorRoll[] = packed.rolls.map((roll) => {
    const stock = spec.stockByColor[roll.color]
    const stockMm = typeof stock === 'number' && isFinite(stock) && stock > 0 ? stock : null
    const batchLen = roll.requiredLengthMm * k
    const batchArea = (roll.requiredAreaM2 * k)
    return {
      ...roll,
      batchRequiredLengthMm: r1(batchLen),
      batchRequiredAreaM2: r3(batchArea),
      stockLengthMm: stockMm,
      enough: stockMm === null ? null : stockMm >= batchLen - 0.05
    }
  })

  const totalRequiredMm = rolls.reduce((a, x) => a + x.requiredLengthMm, 0)
  const totalRequiredM2 = r3(rolls.reduce((a, x) => a + x.requiredAreaM2, 0))
  const batchRequiredMm = rolls.reduce((a, x) => a + x.batchRequiredLengthMm, 0)
  const batchRequiredM2 = r3(rolls.reduce((a, x) => a + x.batchRequiredAreaM2, 0))

  // 闭合判定 & 让步
  const openLayers = built
    .filter((bl) => Math.max(Math.abs(bl.plan.closingMismatchBottomMm), Math.abs(bl.plan.closingMismatchTopMm)) > PATTERN_EPS)
    .map((bl) => bl.plan.layerIndex)
  const acceptIdx = spec.acceptLayerIndex
  const allClosable = openLayers.length === 0 || (route === 'match' && openLayers.length === 1 && openLayers[0] === acceptIdx)
  const concessions = buildConcessions(l, built, r, openLayers)

  // 路线代价（另一条路也要算出来摆代价）
  const cost = buildCost(l, built, packed, items, spec, s)

  // 界线
  const totalPieces = built.reduce((a, bl) => a + bl.plan.pieceCount, 0)
  const gapCycles = Math.max(0, Math.ceil((2 * s) / r - 1e-9))
  const tapered = built.filter((bl) => !bl.plan.straight)
  const taperNote =
    tapered.length > 0
      ? `梯形片（第 ${tapered.map((bl) => bl.plan.layerIndex + 1).join('、')} 层）左右竖缝是斜的：花型沿卷长走，一条斜缝不可能上沿下沿同时对齐，本活以每片下沿净边为对花基准（灯体最粗处的主视线），上沿偏差随上下净宽差走，表里「上」列逐缝给出；直筒层无此问题。`
      : ''
  const shortNote =
    r < 2 * s - 1e-6
      ? `周期 ${f1s(r)}mm 小于两道竖缝份之和 ${f1s(2 * s)}mm：对花空让至少 ${gapCycles} 个周期/${f1s(gapCycles * r)}mm 一条缝，几乎不划算；`
      : ''
  const boundaryNote =
    `${shortNote}一层里片数越多（本灯围向 ${totalPieces} 片/共 ${built.length} 层）、周期越短，每条缝可挪的空让越固定、合围余数能被花位吸收的余地越小：` +
    `花位只能在一个周期 ${f1s(r)}mm 内整体平移，最多救回「合围余数同相」的层；救不回的层只能改那一层的高度或认下那一条合围缝。` +
    `${taperNote}保布头路线下每条内部竖缝恒定错开 ${f1s(modSigned(2 * s, r))}mm（下沿），片越多错开的缝越多。`

  const canonical = JSON.stringify({
    id: l.id,
    geom: built.map((bl) => [bl.plan.perimeterBottomMm, bl.plan.perimeterTopMm, bl.plan.pieceCount]),
    caps: capPanels.map((p) => [p.id, Math.max(p.widthTopMm, p.widthBottomMm), p.heightMm, p.color]),
    spec: [spec.boltWidthMm, spec.repeatMm, Math.round(spec.offsetMm * 10) / 10, spec.lapMm, route, acceptIdx],
    seam: Math.round(s * 10) / 10,
    batch: [count, Math.round(l.wasteRatio * 1000) / 1000],
    agg: [
      Math.round(totalRequiredMm * 10) / 10,
      Math.round(batchRequiredMm * 10) / 10,
      rolls.map((x) => [x.color, Math.round(x.requiredLengthMm * 10) / 10])
    ]
  })

  return {
    enabled: spec.enabled,
    spec,
    valid,
    invalidReason,
    seamAllowanceMm: s,
    layers,
    caps,
    rolls,
    totalRequiredMm: r1(totalRequiredMm),
    totalRequiredM2,
    batchRequiredMm: r1(batchRequiredMm),
    batchRequiredM2,
    allClosable: valid ? allClosable : false,
    openLayers,
    concessions,
    cost,
    boundaryNote,
    signature: signatureOf(canonical),
    generatedAt: new Date().toISOString()
  }
}

function validateSpec(spec: PatternSpec): string {
  if (!(spec.boltWidthMm > 0)) return '布的幅宽未填或不是正数（mm）'
  if (!(spec.repeatMm > 0)) return '花纹一个循环的长度未填或不是正数（mm）'
  if (spec.offsetMm < 0) return '花位偏移不能为负（mm）'
  if (spec.lapMm < 0) return '合围搭接量不能为负（mm）'
  if (spec.offsetMm >= spec.repeatMm) return `花位偏移 ${f1s(spec.offsetMm)}mm 已达到/超过周期 ${f1s(spec.repeatMm)}mm：偏移应取 0~周期之间的等效值（多出的整周期不起作用）`
  return ''
}

function buildConcessions(l: Lantern, built: BuiltLayer[], r: number, openLayers: number[]): PatternConcession[] {
  if (openLayers.length === 0) return []
  const out: PatternConcession[] = []
  const worst = [...built].sort(
    (a, b) =>
      Math.max(Math.abs(b.plan.closingMismatchBottomMm), Math.abs(b.plan.closingMismatchTopMm)) -
      Math.max(Math.abs(a.plan.closingMismatchBottomMm), Math.abs(a.plan.closingMismatchTopMm))
  )[0]

  // 挪花位：在一个周期内扫，找出一次性能救回最多层的偏移（步长 0.1mm）
  let bestShift = 0
  let bestClose: number[] = []
  const SHIFT_TOL = 0.1
  for (let d = 0; d < r - 1e-9; d = Math.round((d + 0.1) * 10) / 10) {
    const closes = built
      .filter((bl) => {
        const b = Math.abs(modSigned(bl.plan.closingMismatchBottomMm + d, r))
        const t = Math.abs(modSigned(bl.plan.closingMismatchTopMm + d, r))
        return b <= SHIFT_TOL && t <= SHIFT_TOL
      })
      .map((bl) => bl.plan.layerIndex)
    if (closes.length > bestClose.length) {
      bestClose = closes
      bestShift = d
    }
  }
  const newOffset = modPos(l.pattern?.offsetMm ?? 0, r) === modPos((l.pattern?.offsetMm ?? 0) + bestShift, r) ? (l.pattern?.offsetMm ?? 0) : modPos((l.pattern?.offsetMm ?? 0) + bestShift, r)
  const stillOpen = built.map((bl) => bl.plan.layerIndex).filter((i) => !bestClose.includes(i))
  out.push({
    kind: 'shift',
    layerIndex: worst.plan.layerIndex,
    label: `挪花位：偏移 +${f1s(bestShift)}mm（新花位 ${f1s(newOffset)}mm）`,
    detail:
      `花位只能在一个周期 ${f1s(r)}mm 内整体平移。此挪法可救回第 ${bestClose.map((i) => i + 1).join('、') || '—'} 层的合围缝；` +
      (stillOpen.length ? `仍对不上：第 ${stillOpen.map((i) => i + 1).join('、')} 层——这些层余数不同相，一次挪花位救不回来。` : '全部层合围缝都对得上。'),
    newOffsetMm: r1(newOffset),
    shiftMm: r1(bestShift),
    stillOpenLayers: stillOpen,
    closesLayers: bestClose
  })

  // 改一层高度（救偏差最大的那一层）
  const rs = resizeSuggestion(l, worst, r)
  if (rs) out.push(rs)

  // 认下一处
  out.push({
    kind: 'accept',
    layerIndex: worst.plan.layerIndex,
    label: `认下 ${worst.plan.closingSeamLabel}（偏差 ${f1s(Math.max(Math.abs(worst.plan.closingMismatchBottomMm), Math.abs(worst.plan.closingMismatchTopMm)))}mm）`,
    detail: `把这一条合围缝安排到灯的背面/上口视线外，其余 ${built.length - 1} 层照常严丝合缝；裁片清单与对位标记会注明「此缝不对花」。`,
    stillOpenLayers: openLayers.filter((i) => i !== worst.plan.layerIndex),
    closesLayers: built.map((bl) => bl.plan.layerIndex).filter((i) => i !== worst.plan.layerIndex && !openLayers.includes(i))
  })
  return out
}

function buildCost(
  l: Lantern,
  built: BuiltLayer[],
  packed: { rolls: PatternColorRoll[] },
  items: PackItem[],
  spec: PatternSpec,
  s: number
): PatternCost {
  // 用同一份打包逻辑另算 cloth 路线的总长（盖片两路线相同）
  const clothItems: PackItem[] = items.map((it) => {
    if (it.kind === 'band' && it.band) {
      const bl = it.band.layer
      return { ...it, alongMm: bl.clothSpan, band: { ...it.band, pieces: bl.clothPieces, span: bl.clothSpan } }
    }
    return it
  })
  const clothPacked = packByColor(clothItems, spec.boltWidthMm)
  const matchTotal = packed.rolls.reduce((a, x) => a + x.requiredLengthMm, 0)
  const clothTotal = clothPacked.rolls.reduce((a, x) => a + x.requiredLengthMm, 0)

  let badCount = 0
  let worst = 0
  let alignSeams = 0
  for (const bl of built) {
    alignSeams += bl.plan.pieceCount
    badCount += bl.clothBadSeams.length
    for (const sm of bl.clothBadSeams) worst = Math.max(worst, Math.abs(sm.mismatchBottomMm), Math.abs(sm.mismatchTopMm))
  }
  const extra = Math.max(0, matchTotal - clothTotal)
  return {
    matchExtraFabricMm: r1(extra),
    clothSavedFabricMm: r1(extra),
    clothMismatchSeamCount: badCount,
    clothWorstMismatchMm: r1(worst),
    savedAlignSeams: alignSeams,
    note:
      `选「保花纹」：每灯多吃 ${f1s(extra)}mm 卷长（缝间空让 + 幅宽排尾），换全部竖缝对花；` +
      `选「保布头」：省下这 ${f1s(extra)}mm（批量 ${Math.max(1, Math.round(l.batchCount))} 个合 ${f1s(extra * Math.max(1, Math.round(l.batchCount)) * (1 + l.wasteRatio) / 1000)}m），` +
      `但有 ${badCount} 条缝错开（最大 ${f1s(worst)}mm），并少 ${alignSeams} 道挪刀对花工。缝份 ${f1s(s)}mm/边。`
  }
}

/* ===================== 改一次周期/花位：三处各变了什么 ===================== */

function pieceKey(p: PatternCutPiece): string {
  return `L${p.layerIndex + 1}-${String(p.pieceIndex + 1).padStart(2, '0')}`
}

function pieceVal(p: PatternCutPiece): string {
  return [
    f1s(p.cutLengthMm),
    f1s(p.rollFromMm),
    f1s(p.rollToMm),
    f1s(p.phaseStartMm),
    p.phaseStartRatio.toFixed(4),
    f1s(p.seam.mismatchBottomMm),
    `#${p.shelfIndex + 1}`
  ].join('|')
}

/**
 * 同源比较：新老两版 PatternPlan 各自列出
 *  - panels：裁片页哪几片面板的下刀段与对位标记变了
 *  - materials：材料页哪几项材料与米数变了
 *  - sheets：作坊清单哪几行跟着换了（与 panels 同片同源，额外追盖片行与签名行）
 */
export function diffPatternPlans(before: PatternPlan | null, after: PatternPlan): PatternDiff {
  const empty: PatternDiff = {
    signatureBefore: before?.signature || '—',
    signatureAfter: after.signature,
    changed: !!before && before.signature !== after.signature,
    panels: [],
    materials: [],
    sheets: [],
    summary: before ? '取料结果无变化（同一签名）' : '尚无已存档版本，当前为首版取料结果。'
  }
  if (!before) return empty
  if (before.signature === after.signature) return empty

  const panels: PatternDiffEntry[] = []
  const sheets: PatternDiffEntry[] = []
  const beforePieces = new Map<string, PatternCutPiece>()
  for (const ly of before.layers) for (const p of ly.pieces) beforePieces.set(pieceKey(p), p)
  const afterKeys = new Set<string>()
  for (const ly of after.layers) {
    for (const p of ly.pieces) {
      const key = pieceKey(p)
      afterKeys.add(key)
      const old = beforePieces.get(key)
      if (!old || pieceVal(old) !== pieceVal(p)) {
        const entry: PatternDiffEntry = {
          key,
          label: `${ly.label} 第 ${p.pieceIndex + 1}/${ly.pieceCount} 片（面板 ${p.panelId}）`,
          before: old ? `${f1s(old.rollFromMm)}~${f1s(old.rollToMm)}mm，花位 ${f1s(old.phaseStartMm)}，${old.shelfIndex + 1} 排` : '（旧版无此片）',
          after: `${f1s(p.rollFromMm)}~${f1s(p.rollToMm)}mm，花位 ${f1s(p.phaseStartMm)}，${p.shelfIndex + 1} 排`,
          detail: `下刀段长 ${old ? f1s(old.cutLengthMm) : '—'} → ${f1s(p.cutLengthMm)}mm；左净边花位 ${old ? f1s(old.phaseStartMm) : '—'} → ${f1s(p.phaseStartMm)}mm（${(p.phaseStartRatio * 100).toFixed(2)}%）；缝偏差 ${old ? f1s(old.seam.mismatchBottomMm) : '—'} → ${f1s(p.seam.mismatchBottomMm)}mm；对位标记随新相位重排${old && old.phaseStartRatio === p.phaseStartRatio ? '' : '（花位刻点位置变）'}`
        }
        panels.push(entry)
        sheets.push({ ...entry, detail: `清单行：${entry.label} 下刀段/花位/缝偏差/对位标记整行换版` })
      }
    }
  }
  for (const [key, old] of beforePieces) {
    if (!afterKeys.has(key)) {
      panels.push({ key, label: key, before: `${f1s(old.rollFromMm)}~${f1s(old.rollToMm)}mm`, after: '（新版无此片，行删除）', detail: '片数或层数变化导致该片取消' })
    }
  }

  // 盖片行
  const capBefore = new Map(before.caps.map((c) => [c.panelId, c]))
  for (const c of after.caps) {
    const old = capBefore.get(c.panelId)
    if (!old || old.rollFromMm !== c.rollFromMm || old.rollToMm !== c.rollToMm || old.shelfIndex !== c.shelfIndex) {
      sheets.push({
        key: c.panelId,
        label: `${c.label}（${c.panelId}）`,
        before: old ? `${f1s(old.rollFromMm)}~${f1s(old.rollToMm)}mm，${old.shelfIndex + 1} 排` : '—',
        after: `${f1s(c.rollFromMm)}~${f1s(c.rollToMm)}mm，${c.shelfIndex + 1} 排`,
        detail: '盖片不参与对花，但幅宽排随围向片重排，下刀坐标换版'
      })
    }
  }

  // 材料页：按色卷的米数 + 合计
  const materials: PatternDiffEntry[] = []
  const rollBefore = new Map(before.rolls.map((r) => [r.color, r]))
  for (const r of after.rolls) {
    const old = rollBefore.get(r.color)
    if (!old || old.requiredLengthMm !== r.requiredLengthMm || old.batchRequiredLengthMm !== r.batchRequiredLengthMm) {
      materials.push({
        key: r.color,
        label: `绸布 ${r.color}（${r.usedBy.join('、')}）`,
        before: old ? `单灯 ${f1s(old.requiredLengthMm / 1000)}m / 批量 ${f1s(old.batchRequiredLengthMm / 1000)}m` : '（旧版无此色）',
        after: `单灯 ${f1s(r.requiredLengthMm / 1000)}m / 批量 ${f1s(r.batchRequiredLengthMm / 1000)}m`,
        detail: `空耗布头 ${old ? f1s(old.wasteLengthMm) : '—'} → ${f1s(r.wasteLengthMm)}mm；库存 ${r.stockLengthMm === null ? '未填' : `${f1s(r.stockLengthMm / 1000)}m（${r.enough === false ? '不够裁' : r.enough ? '够裁' : '—'}）`}`
      })
    }
  }
  if (before.totalRequiredMm !== after.totalRequiredMm) {
    materials.push({
      key: '__total__',
      label: '各色布合计',
      before: `单灯 ${f1s(before.totalRequiredMm / 1000)}m / 批量 ${f1s(before.batchRequiredMm / 1000)}m`,
      after: `单灯 ${f1s(after.totalRequiredMm / 1000)}m / 批量 ${f1s(after.batchRequiredMm / 1000)}m`,
      detail: `合计米数变化 Δ${f1s((after.totalRequiredMm - before.totalRequiredMm) / 1000)}m/灯`
    })
  }

  const summary =
    `签名 ${before.signature} → ${after.signature}：裁片页 ${panels.length} 片下刀段/对位标记变，` +
    `材料页 ${materials.length} 项米数变，作坊清单 ${sheets.length} 行换版。`
  return { signatureBefore: before.signature, signatureAfter: after.signature, changed: true, panels, materials, sheets, summary }
}
