/**
 * 自检（对应规格书 §10 验收标准）
 * 每次参数变化都会重算全部几何并跑一遍断言，结果直接显示在界面上。
 */
import type { CheckResult, Lantern, PatternPlan } from './types'
import { bodySurfaceArea, polygonEdge, ringPerimeter, segmentInfos } from './geometry'
import { buildFrame, type FrameResult } from './frame'
import { buildPanels, panelNetArea, type PanelResult } from './panels'
import { computeBatch, computeMaterials, type BatchMaterials, type SingleLightMaterials } from './materials'
import { assertNoPanelSplit, paginate, type LoftOptions, type Sheet } from './paginate'
import { buildPatternPlan, PATTERN_EPS } from './pattern'
import { CRAFT } from './craft'

export interface FullResult {
  frame: FrameResult
  panels: PanelResult
  materials: SingleLightMaterials
  batch: BatchMaterials
  sheets: Sheet[]
  pattern: PatternPlan
  checks: CheckResult[]
  elapsedMs: number
}

const f1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1)
const f3 = (v: number) => (Math.round(v * 1000) / 1000).toFixed(3)

export function computeAll(l: Lantern, loft: LoftOptions): FullResult {
  const t0 = performance.now()
  const frame = buildFrame(l)
  const panels = buildPanels(l)
  const pattern = buildPatternPlan(l)
  const materials = computeMaterials(l, pattern)
  const batch = computeBatch(materials, Math.max(1, Math.round(l.batchCount)), l.wasteRatio)
  const sheets = paginate(l, loft)
  const elapsedMs = performance.now() - t0
  const checks = runChecks(l, frame, panels, materials, batch, sheets, pattern, elapsedMs)
  return { frame, panels, materials, batch, sheets, pattern, checks, elapsedMs }
}

function runChecks(
  l: Lantern,
  frame: FrameResult,
  panels: PanelResult,
  materials: SingleLightMaterials,
  batch: BatchMaterials,
  sheets: Sheet[],
  pattern: PatternPlan,
  elapsedMs: number
): CheckResult[] {
  const out: CheckResult[] = []
  const g = frame.geometry
  const lash = Math.max(0, l.lashAllowanceMm)

  // ---- CHK-01 几何：棱长/周长与手算一致 ----
  {
    const cases = [
      { name: '正六棱柱底边（D200）', got: polygonEdge(100, 6), expect: 100, tol: 1 },
      { name: '正八棱柱底边（D200）', got: polygonEdge(100, 8), expect: 76.5367, tol: 1 },
      { name: '圆形横篾圈周长（D200）', got: ringPerimeter(100, 0, false), expect: 628.3185, tol: 1 },
      { name: '六边形周长（D200）', got: ringPerimeter(100, 6, true), expect: 600, tol: 1 }
    ]
    const bad = cases.filter((c) => Math.abs(c.got - c.expect) > c.tol)
    out.push({
      id: 'CHK-01',
      title: '几何手算核对（棱长 / 周长，误差 ≤ 1mm）',
      pass: bad.length === 0,
      value: bad.length === 0 ? '4/4 项通过' : `${bad.length} 项超差`,
      detail: cases
        .map((c) => `${c.name}：算得 ${f3(c.got)} / 手算 ${f3(c.expect)}（Δ${f3(Math.abs(c.got - c.expect))}）`)
        .join('；')
    })
  }

  // ---- CHK-02 竖篾长度与分段高度累计 ----
  {
    const segs = segmentInfos(g)
    const sumH = segs.reduce((s, x) => s + x.heightMm, 0)
    const sumSlant = segs.reduce((s, x) => s + x.slantMm, 0)
    const vertical = frame.members.find((m) => m.kind === 'vertical' || m.kind === 'rib')
    const raw = vertical ? vertical.rawLengthMm : 0
    const allStraight = segs.every((s) => Math.abs(s.drMm) < 0.05)
    const pass = Math.abs(raw - sumSlant) <= 0.1 && (!allStraight || Math.abs(raw - sumH) <= 0.1)
    out.push({
      id: 'CHK-02',
      title: '竖篾净长 = 分段母线折线长累计',
      pass,
      value: `Δ折线 ${f1(Math.abs(raw - sumSlant))}mm`,
      detail: allStraight
        ? `竖篾净长 ${f1(raw)}mm，分段高累计 ${f1(sumH)}mm，平口直柱两者一致（Δ${f1(Math.abs(raw - sumH))}mm）`
        : `竖篾净长 ${f1(raw)}mm，分段高累计 ${f1(sumH)}mm，折线长累计 ${f1(sumSlant)}mm（收口段横向偏移 ${f1(sumSlant - sumH)}mm）`
    })
  }

  // ---- CHK-03 缝份 ----
  {
    const s = Math.max(0, l.seamAllowanceMm)
    const bad = panels.panels.filter(
      (p) =>
        Math.abs(p.widthTopMm - (p.rawWidthTopMm + 2 * s)) > 0.06 ||
        Math.abs(p.widthBottomMm - (p.rawWidthBottomMm + 2 * s)) > 0.06 ||
        Math.abs(p.heightMm - (p.rawHeightMm + 2 * s)) > 0.06
    )
    out.push({
      id: 'CHK-03',
      title: '裁片尺寸 = 展开净尺寸 + 缝份 × 2（每边）',
      pass: bad.length === 0,
      value: `${panels.panels.length - bad.length}/${panels.panels.length} 种裁片通过`,
      detail:
        bad.length === 0
          ? `全部 ${panels.panels.length} 种裁片上/下/高三个尺寸均等于净尺寸 + ${f1(s)}×2mm；裁片图以红色虚线绘制缝份折线`
          : `超差裁片：${bad.map((p) => p.label).join('、')}`
    })
  }

  // ---- CHK-04 备料守恒 ----
  {
    const stock = frame.members.reduce((a, m) => a + m.lengthMm * m.qty, 0)
    const rawTotal = frame.members.reduce((a, m) => a + m.rawLengthMm * m.qty, 0)
    const lashTotal = frame.members.reduce((a, m) => a + m.qty * m.lashJoints * lash, 0)
    const diff = stock - rawTotal
    const pass = stock >= rawTotal - 1e-6 && Math.abs(diff - lashTotal) <= 0.5
    out.push({
      id: 'CHK-04',
      title: '备料守恒：Σ备料长度 ≥ Σ净长，且差值 = 余量总和',
      pass,
      value: `Σ备料 ${f1(stock)}mm / Σ净长 ${f1(rawTotal)}mm`,
      detail: `差值 ${f1(diff)}mm，应等于余量总和 ${f1(lashTotal)}mm（竖篾两端、横篾圈接头各计 ${f1(lash)}mm）`
    })
  }

  // ---- CHK-05 面积核对 ----
  {
    const netArea = panels.panels.reduce((a, p) => a + panelNetArea(p) * p.qty, 0)
    const refArea = bodySurfaceArea(g, Math.max(3, Math.round(l.divisions)))
    const ratio = refArea > 0 ? netArea / refArea : 0
    const pass = ratio >= 0.97 && ratio <= 1.03
    let advice = ''
    if (!pass && !g.polygon) {
      const need = suggestDivisions(l, netArea, ratio)
      advice = need ? `；建议把母线等分数提高到 ${need}（当前 ${l.divisions}）` : ''
    } else if (!pass) {
      advice = '；请检查缝份/分层参数，棱柱类侧面积应与裁片面积完全一致'
    }
    out.push({
      id: 'CHK-05',
      title: '面积核对：Σ裁片净面积 / 灯体表面积 ∈ [0.97, 1.03]',
      pass,
      value: `比值 ${(ratio * 100).toFixed(2)}%`,
      detail: `裁片净面积 ${f3(netArea / 1_000_000)}m²，灯体表面积（含顶底盖）${f3(refArea / 1_000_000)}m²${advice}`
    })
  }

  // ---- CHK-06 分页：裁片不跨页 ----
  {
    const r = assertNoPanelSplit(sheets)
    out.push({
      id: 'CHK-06',
      title: '分页：任一裁片不跨页（长条跨页带对位十字与搭接量）',
      pass: r.pass,
      value: r.pass ? '通过' : '失败',
      detail: `${r.detail}；跨页仅出现在骨架长条上，接缝处绘制对位十字并标注搭接 ${f1(loftOverlap(sheets))}mm 与拼接编号`
    })
  }

  // ---- CHK-07 批量 ----
  {
    const n = Math.max(1, Math.round(l.batchCount))
    const k = n * (1 + l.wasteRatio)
    // 与单灯值的偏差只来自展示精度（长度 3 位小数 / 胶 1 位小数）
    const errs = [
      Math.abs(batch.frameM - materials.frameM * k),
      Math.abs(batch.coveringM2 - materials.coveringM2 * k),
      Math.abs(batch.lashM - materials.lashM * k)
    ]
    const pass = errs.every((e) => e <= 0.0011) && Math.abs(batch.glueG - materials.glueG * k) <= 0.051
    out.push({
      id: 'CHK-07',
      title: `批量制灯：${n} 个材料总量 = 单灯 × ${n} × (1 + ${(l.wasteRatio * 100).toFixed(0)}%)`,
      pass,
      value: `竹篾 ${f3(batch.frameM)}m / 蒙面 ${f3(batch.coveringM2)}m²`,
      detail: `单灯竹篾 ${f3(materials.frameM)}m × ${n} × ${(1 + l.wasteRatio).toFixed(2)} = ${f3(materials.frameM * k)}m = 批量值；蒙面、扎线、胶同理（LED 按颗数 × ${n} 计，不参与损耗）`
    })
  }

  // ---- CHK-08 性能 ----
  {
    const pass = elapsedMs < 100
    out.push({
      id: 'CHK-08',
      title: '放样计算 < 100ms',
      pass,
      value: `${elapsedMs.toFixed(1)}ms`,
      detail: `${l.divisions} 等分 × ${l.layers.length} 层：构件 ${frame.totalQty} 根、裁片 ${panels.totalQty} 块、图纸 ${sheets.length} 页，全流程耗时 ${elapsedMs.toFixed(1)}ms（含分页）`
    })
  }

  // ---- CHK-09 取料周长与下刀段：首尾接起来 = 该层实际周长 ----
  {
    if (!pattern.enabled) {
      out.push({
        id: 'CHK-09',
        title: '按花纹周期取料：周长/余数/下刀段（未启用）',
        pass: true,
        value: '未启用',
        detail: '在蒙面裁片页填入布幅宽、花纹周期与花位偏移后，按层实际周长（轮廓+棱长周长那一路）给出每片下刀段'
      })
    } else if (!pattern.valid) {
      out.push({ id: 'CHK-09', title: '按花纹周期取料：周长/余数/下刀段', pass: false, value: '输入无效', detail: pattern.invalidReason })
    } else {
      const bad: string[] = []
      for (const ly of pattern.layers) {
        const netSum = ly.pieces.reduce((a, p) => a + p.netWidthBottomMm, 0)
        if (Math.abs(netSum - ly.perimeterBottomMm) > 0.15) bad.push(`${ly.label}净宽合计 ${f1(netSum)} ≠ 周长 ${f1(ly.perimeterBottomMm)}`)
        // 下刀段首尾（含缝份/搭接）：Σ 净宽 + 2s×片数 + 搭接 1 道
        const cutSum = ly.pieces.reduce((a, p) => a + p.cutLengthMm, 0)
        const expect = ly.perimeterBottomMm + 2 * l.seamAllowanceMm * ly.pieceCount + l.pattern.lapMm
        if (Math.abs(cutSum - expect) > 0.15) bad.push(`${ly.label}下刀段合计 ${f1(cutSum)} ≠ ${f1(expect)}`)
        // 与既有周长路核对（多边形 n×棱长 / 圆 2πR）
        const sec = frame.geometry.sections[ly.layerIndex]
        const ref = ringPerimeter(sec.radiusMm, frame.geometry.n, frame.geometry.polygon)
        if (Math.abs(ref - ly.perimeterBottomMm) > 0.15) bad.push(`${ly.label}周长 ${f1(ly.perimeterBottomMm)} 与轮廓/棱长周长 ${f1(ref)} 不一致`)
      }
      out.push({
        id: 'CHK-09',
        title: '取料：每层各片净宽首尾相接 = 该层实际周长（下刀段含缝份与合围搭接）',
        pass: bad.length === 0,
        value: bad.length === 0 ? `${pattern.layers.length}/${pattern.layers.length} 层一致` : `${bad.length} 层不一致`,
        detail:
          bad.length === 0
            ? `全部层净宽合计 = 实际周长（走轮廓+棱长周长，非图上量取）；下刀段合计 = 周长 + 缝份 ${f1(l.seamAllowanceMm)}×2×片数 + 合围搭接 ${f1(l.pattern.lapMm)}mm；长度 mm、偏差 1 位小数、闭合容差 ${PATTERN_EPS}mm`
            : bad.join('；')
      })
    }
  }

  // ---- CHK-10 三处同源：裁片页 / 材料页 / 作坊清单同一签名 ----
  {
    if (pattern.enabled && pattern.valid) {
      // 材料页各色米数回算（模拟材料页/清单的独立取数）必须等于计划里的米数
      const rollSum = pattern.rolls.reduce((a, r) => a + r.requiredLengthMm, 0)
      const batchSum = pattern.rolls.reduce((a, r) => a + r.batchRequiredLengthMm, 0)
      const sameTotal =
        Math.abs(rollSum - pattern.totalRequiredMm) < 0.15 &&
        Math.abs(batchSum - pattern.batchRequiredMm) < 0.3
      // 每片都要有卷坐标且唯一（三处照同一串数下刀）
      const coords = pattern.layers.flatMap((ly) => ly.pieces.map((p) => `${p.color}#${p.shelfIndex}#${f1(p.rollFromMm)}#${p.pieceIndex}`))
      const dup = coords.length - new Set(coords).size
      out.push({
        id: 'CHK-10',
        title: '三处同源：蒙面裁片页 / 材料页 / 作坊裁片清单同一取料结果（同一签名）',
        pass: sameTotal && dup === 0,
        value: `签名 ${pattern.signature}`,
        detail:
          sameTotal && dup === 0
            ? `裁片页每片下刀段、材料页各色米数（单灯 ${f1(pattern.totalRequiredMm / 1000)}m / 批量 ${f1(pattern.batchRequiredMm / 1000)}m）、作坊清单行均取自本计划签名 ${pattern.signature}，同一片布三处下刀段与用布量一致`
            : `三处取数出现分叉（合计差 ${f1(rollSum - pattern.totalRequiredMm)}mm，重复卷坐标 ${dup} 处），不允许导出`
      })
    } else {
      out.push({ id: 'CHK-10', title: '三处同源：裁片页 / 材料页 / 作坊清单同一签名', pass: true, value: '未启用', detail: '启用按花纹周期取料后，三处共享同一 PatternPlan 与签名' })
    }
  }

  // ---- CHK-11 相位：余数逐层累加，进层相位不被抹掉 ----
  {
    if (pattern.enabled && pattern.valid) {
      const r = pattern.spec.repeatMm
      let cum = ((pattern.spec.offsetMm % r) + r) % r
      let bad = false
      const trail: string[] = []
      for (const ly of pattern.layers) {
        if (Math.abs(ly.entryPhaseMm - (Math.round(cum * 10) / 10)) > 0.15) bad = true
        trail.push(`L${ly.layerIndex + 1}余${f1(ly.remainderBottomMm)}→入${f1(ly.entryPhaseMm)}`)
        cum = ((cum + ly.remainderBottomMm) % r + r) % r
      }
      out.push({
        id: 'CHK-11',
        title: '相位：每层周长÷周期的余数逐层累加，花位偏移/缝份先按 mm 再换算比例',
        pass: !bad,
        value: `花位 ${f1(pattern.spec.offsetMm)}mm（${(((pattern.spec.offsetMm % r) + r) % r / r) * 100}%）`,
        detail:
          `${trail.join('，')}；进层相位 = (花位偏移 + Σ下层余数) mod 周期；偏移与缝份先按 mm 算再除周期得比例（片上花位比例 4 位小数）；累计偏移未逐层归零${bad ? '；发现某层累计被抹掉！' : ''}`
      })
    } else {
      out.push({ id: 'CHK-11', title: '相位：余数逐层累加 / 偏移不抹掉', pass: true, value: '未启用', detail: '启用后校验累计余数链' })
    }
  }

  // ---- CHK-12 路线取舍与闭合：选错作废重裁的代价 ----
  {
    if (pattern.enabled && pattern.valid) {
      const pass = pattern.spec.priority === 'cloth' || pattern.allClosable
      out.push({
        id: 'CHK-12',
        title: `路线取舍：${pattern.spec.priority === 'match' ? '先保花纹严丝合缝' : '先保布头不浪费'}（二选一）`,
        pass,
        value:
          pattern.spec.priority === 'match'
            ? pattern.allClosable
              ? `闭合成立（多吃布 ${f1(pattern.cost.matchExtraFabricMm / 1000)}m/灯）`
              : `${pattern.openLayers.length} 层合围缝未闭合，须先选让步`
            : `${pattern.cost.clothMismatchSeamCount} 条缝错开（最大 ${f1(pattern.cost.clothWorstMismatchMm)}mm），省布 ${f1(pattern.cost.clothSavedFabricMm / 1000)}m/灯`,
        detail:
          pattern.cost.note +
          (pass
            ? ''
            : `；未闭合层：${pattern.openLayers.map((i) => i + 1).join('、')}。让步三选一：挪花位 / 改一层高度 / 认下背面一条缝。改路线即旧版连同已导出清单、已发作坊备料单一并作废，已下刀的片重裁、旧对位标记与拼缝次序失效。`)
      })
    } else {
      out.push({ id: 'CHK-12', title: '路线取舍与闭合（未启用）', pass: true, value: '未启用', detail: '保花纹 / 保布头两条路只能选一条；选错的版本连同导出件作废重裁' })
    }
  }

  return out
}

function suggestDivisions(l: Lantern, netArea: number, ratio: number): number | null {
  if (ratio <= 1.0005) return null
  for (let d = Math.max(3, Math.round(l.divisions)) + 1; d <= CRAFT.divMax; d++) {
    const ref = bodySurfaceArea(frameGeometryOf(l), d)
    const r = ref > 0 ? netArea / ref : 0
    if (r <= 1.03) return d
  }
  return CRAFT.divMax
}

function loftOverlap(sheets: Sheet[]): number {
  for (const s of sheets) {
    for (const it of s.items) {
      if (it.type === 'strip' && it.overlapMm > 0) return it.overlapMm
    }
  }
  return 0
}

/** 校验尺标称长度（mm）：1:1 打印用 */
export const CALIBRATION_RULER_MM = 100
export const CALIBRATION_CIRCLE_MM = 100

function frameGeometryOf(l: Lantern) {
  return buildFrame(l).geometry
}

/** 由圆周长反推直径（尺寸反推工具用） */
export function diameterFromPerimeter(lengthMm: number, n: number, polygon: boolean, lashMm: number): number {
  const net = Math.max(0, lengthMm - lashMm)
  if (polygon) {
    const s = Math.max(3, Math.round(n))
    return net / (s * Math.sin(Math.PI / s))
  }
  return net / Math.PI
}

/** 由母线（竖篾）长度反推可用最大直径：保持收口比例与总高，二分求解 */
export function diameterFromRib(l: Lantern, ribLengthMm: number): number {
  const target = Math.max(10, ribLengthMm - 2 * l.lashAllowanceMm)
  let lo = 20
  let hi = 3000
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2
    const test: Lantern = { ...l, maxDiameterMm: mid, mouthDiameterMm: (mid * l.mouthDiameterMm) / Math.max(1, l.maxDiameterMm), baseDiameterMm: (mid * l.baseDiameterMm) / Math.max(1, l.maxDiameterMm) }
    const segs = segmentInfos(buildFrame(test).geometry)
    const len = segs.reduce((a, s) => a + s.slantMm, 0)
    if (len < target) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}
