/**
 * 按花纹周期取料（绸布对花）
 * --------------------------------------------------------------------------
 * 单位约定：长度一律按 mm 计算，下刀位置与偏差保留 1 位小数；花位相位先按
 * mm 累计，再换算成周期比例（相位 mm ÷ repeatMm）。每种颜色各自一把游标，
 * 同色各层的周长余数逐层累加，累加器不取整、不逐层抹零。
 *
 * 周长走「既有轮廓 + 棱长年周长」那一路（geometry.ts）：
 *   - 棱柱/方灯：n × 底边长 polygonEdge（n=棱数），取该层底截面；
 *   - 旋转体：2πR，R 为该层底截面半径（由轮廓采样 g.sections 得到）。
 * 每片净宽 = 该层底周长 ÷ 片数（棱柱片数=棱数，旋转体=母线等分数）。
 *
 * 坐标约定：布长坐标 0 = 该色布卷第一刀刀口；花位偏移 phaseOffset = 刀口 0
 * 相对花纹循环原点的偏移。布上坐标 x 处的印花相位 = (x + phaseOffset) mod 周期。
 * 第一片净样在刀口内 s（缝份）处，故其入口花位 = (phaseOffset + s) mod 周期。
 *
 * 缝份与搭接一起算进下刀位置，不许拿图上量的数凑：
 *   - 每片净宽 w，含缝份刀长 = w + 2×缝份（左右各一道）；
 *   - 每层闭合缝再搭回 overlapMm 一道搭接量；
 *   - 同色各层沿布卷首尾相接排刀；
 *   - 各片净段（净样线之间）首尾接起来 = 该层实际周长，逐片可核对。
 *
 * 「错开半朵」的视觉判定：花纹周期 T 下，错位 e 与 T−e 看起来一样，故
 * 视觉错花量 = min(e, T−e)，超过公差即认下。周期越短半朵花的绝对尺寸越小，
 * 缝份那点固定错位（2×缝份）越容易盖过半朵花——片越多、周期越短，对花余地
 * 越小，这条界线逐层算给你看。
 *
 * 两条路只能取舍一条：
 *   match（先保花纹严丝合缝）：每片净起点都落在接缝所需的印花相位上，片间
 *       不足一个周期的空档让掉（让布）；闭合缝仍受「周长 ÷ 周期 余数」支配。
 *   save（先保布头不浪费）：片与片刀口首尾相接，不跳花；每道内缝固定错
 *       2×缝份，闭合缝错 (周长 + 2×缝份×(片数−1)) mod 周期；代价是返工工。
 */
import type {
  CutSegment,
  FabricRollTally,
  Lantern,
  PatternLayerReport,
  PatternPlanResult,
  PatternIssue
} from './types'
export type { PatternPlanResult, PatternLayerReport, CutSegment, FabricRollTally } from './types'
import { buildGeometry, polygonEdge, r1, segmentInfos, TAU } from './geometry'

/** 每道认下的错花缝折合的返工工时（分钟） */
export const REWORK_MINUTES_PER_SEAM = 15

export function defaultPatternPlan() {
  return {
    enabled: false,
    fabricWidthMm: 1140,
    repeatMm: 260,
    phaseOffsetMm: 0,
    toleranceMm: 3,
    strategy: 'match' as const,
    stockByColor: {} as Record<string, number>,
    version: 1,
    issued: null as PatternIssue | null
  }
}

/** 取料结果的指纹：几何/分层/缝份/搭接/周期/花位/路线任一变动都会变 */
export function patternSignature(l: Lantern): string {
  const g = buildGeometry(l)
  const perimeters = g.sections
    .slice(0, -1)
    .map((s) => {
      const n = g.n
      return r1(g.polygon ? n * polygonEdge(s.radiusMm, n) : TAU * s.radiusMm)
    })
    .join('|')
  const p = l.pattern
  return [
    l.kind,
    perimeters,
    g.polygon ? g.n : Math.max(3, Math.round(l.divisions)),
    r1(l.seamAllowanceMm),
    r1(l.overlapMm),
    r1(p.fabricWidthMm),
    r1(p.repeatMm),
    r1(p.phaseOffsetMm),
    r1(p.toleranceMm),
    p.strategy
  ].join('@')
}

function modT(v: number, T: number): number {
  const m = v % T
  return m < 0 ? m + T : m
}

/** 视觉错花量：e 与 T−e 看起来一样，取小的那个（半朵花为界） */
function visual(e: number, T: number): number {
  const m = modT(e, T)
  return Math.min(m, T - m)
}

interface ColorStream {
  color: string
  /** 下一刀口的布长坐标（mm） */
  cursor: number
  /** 已沿灯身走过的净弧长（mm，逐层累加，绝不取整抹零） */
  carryShellMm: number
  layers: number[]
  /** 已占用布长（mm，含全部缝份、搭接与对花让出的空档） */
  usedMm: number
  /** 若走布头不浪费路线本应占用的布长（mm） */
  tightMm: number
  pieces: number
}

/**
 * 按花纹周期取料主计算。同一份结果同时供：
 * 蒙面裁片页（每片下刀段 + 对位标记）、材料页（各色用布/够不够）、
 * 导出作坊的裁片清单（CSV 行）——三处同源，不许各算各的。
 */
export function planPatternCutting(l: Lantern, depth = 0): PatternPlanResult {
  const p = l.pattern
  const g = buildGeometry(l)
  const segs = segmentInfos(g)
  const T = Math.max(1, p.repeatMm)
  const s = Math.max(0, l.seamAllowanceMm)
  const lap = Math.max(0, l.overlapMm)
  const tol = Math.max(0, p.toleranceMm)
  const phase0 = modT(p.phaseOffsetMm, T)
  const supported = l.kind !== 'polyhedron'

  const base: PatternPlanResult = {
    enabled: !!p.enabled,
    supported,
    unsupportedReason: supported ? '' : '多面体灯的三角裁片不绕层围合，不参与按花纹周期取料。',
    strategy: p.strategy,
    fabricWidthMm: Math.max(1, p.fabricWidthMm),
    repeatMm: T,
    phaseOffsetMm: r1(phase0),
    toleranceMm: tol,
    seamAllowanceMm: s,
    signature: patternSignature(l),
    version: p.version,
    layers: [],
    segments: [],
    tallies: [],
    extraClothTotalMm: 0,
    errorSeamCount: 0,
    reworkMinutes: 0,
    tradeoffNote: '',
    saveFeasible: true,
    deadEnd: '',
    batchCount: Math.max(1, Math.round(l.batchCount)),
    wasteRatio: l.wasteRatio
  }
  if (!p.enabled || !supported) return base

  const divisions = Math.max(3, Math.round(l.divisions))
  const streams = new Map<string, ColorStream>()
  const layers: PatternLayerReport[] = []
  const segments: CutSegment[] = []

  const streamOf = (color: string): ColorStream => {
    let st = streams.get(color)
    if (!st) {
      // 每种颜色各从一卷布的 0 坐标开裁；初始净弧长累计为 0，花位由 phase0 定
      st = { color, cursor: 0, carryShellMm: 0, layers: [], usedMm: 0, tightMm: 0, pieces: 0 }
      streams.set(color, st)
    }
    return st
  }

  // 面板种类编号与 panels.ts 一致：每一层一种侧片 P 编号
  let panelSeq = 0
  const panelId = () => `P${String(++panelSeq).padStart(3, '0')}`

  g.sections.slice(0, -1).forEach((secBottom, i) => {
    const color = l.layerColors[i] || l.color
    const st = streamOf(color)
    st.layers.push(i + 1)
    const pieces = g.polygon ? g.n : divisions
    const info = segs[i]

    // —— 周长：既有轮廓 + 棱长年周长路径；不拿图上量的数 ——
    const P = g.polygon ? g.n * polygonEdge(secBottom.radiusMm, g.n) : TAU * secBottom.radiusMm
    const PTop = g.polygon ? g.n * info.edgeTopMm : TAU * secTopRadius(g, i)
    const w = P / pieces
    const cutW = w + 2 * s
    const cutH = (g.polygon ? info.faceHeightMm : info.slantMm) + 2 * s
    const widthFits = cutH <= Math.max(1, p.fabricWidthMm) + 1e-6

    // 周长随层高度的变化率（让步办法「改一层高度」用）
    const slope = g.polygon
      ? g.n * Math.sin(Math.PI / g.n) * (info.drMm / Math.max(1e-6, info.heightMm))
      : TAU * (info.drMm / Math.max(1e-6, info.heightMm))

    const rem = modT(P, T)
    const remTop = modT(PTop, T)
    const fullRepeats = Math.floor(P / T)
    const carriedIn = st.carryShellMm
    const closureExtra = rem <= 1e-6 ? 0 : T - rem
    const closureVisual = visual(rem, T)
    const closureMatched = closureVisual <= tol + 1e-6
    const saveClosureRaw = modT(P + 2 * s * (pieces - 1), T)
    const saveClosureVisual = visual(saveClosureRaw, T)
    const halfFlower = r1(T / 2)

    const concessions: string[] = []
    if (closureMatched) {
      concessions.push(
        `闭合缝余数 ${r1(rem)}mm（视觉错位 ${r1(closureVisual)}mm ≤ 半朵花 ${halfFlower}mm）在 ${r1(tol)}mm 公差内，绕一圈花纹接得回原处，不用让步。`
      )
    } else {
      concessions.push(
        `偏差落在闭合缝（第 ${i + 1} 层第 ${pieces} 片出口接回第 1 片，即背缝）：周长 ${r1(P)}mm ÷ 周期 ${T}mm = ${fullRepeats} 个整周期余 ${r1(rem)}mm，视觉错 ${r1(closureVisual)}mm（半朵花 ${halfFlower}mm 为界），超过 ${r1(tol)}mm 公差。让步三选一：`
      )
      concessions.push(
        `① 挪花位：花位偏移只改接缝落在哪朵花、消不掉余数；余数 ${r1(rem)}mm 只能从闭合缝挪到灯朝墙的背缝（改花位偏移量即可把背缝放到最暗处），花纹仍错 ${r1(closureVisual)}mm。`
      )
      if (Math.abs(slope) > 1e-6) {
        // 让周长增加 closureExtra（补到下一整周期）：slope>0 加高，slope<0 降低
        const dhFix = closureExtra / Math.abs(slope)
        const dir = slope > 0 ? '加高' : '降低'
        concessions.push(
          `② 改一层高度：把第 ${i + 1} 层${dir} ${r1(dhFix)}mm（该层周长随高度 ${r1(slope)}mm/mm，取绝对值 ${r1(Math.abs(slope))}），底周长补 ${r1(closureExtra)}mm 到 ${r1(P + closureExtra)}mm = 整 ${fullRepeats + 1} 个周期，闭合缝余数清零；片数不变、只动片高。`
        )
      } else {
        concessions.push(
          `② 改一层高度：第 ${i + 1} 层是直筒段，周长随高度变化 0mm/mm，加高只增片高、动不了横向余数，此路不通，请改相邻收口层。`
        )
      }
      concessions.push(
        `③ 认下一处：把第 ${i + 1} 层闭合缝明确标为「视觉错 ${r1(closureVisual)}mm 不对花」，放在背缝最后合；其余 ${pieces - 1} 道内缝照常对花，该缝对位标记与拼缝次序单列。`
      )
    }
    // 界线：片越多、周期越短，对花余地越小
    {
      const innerVisual = visual(2 * s, T)
      const verdict =
        cutW >= T
          ? `片含缝份刀宽 ${r1(cutW)}mm ≥ 周期 ${T}mm：每片身上至少带一个完整花循环，无论走哪条路都有对花余地。`
          : `片含缝份刀宽 ${r1(cutW)}mm < 周期 ${T}mm：每片带不下一个完整花循环；` +
            (innerVisual <= tol
              ? `布头不浪费路线内缝错 2×缝份=${r1(2 * s)}mm，视觉错位仅 ${r1(innerVisual)}mm（半朵花 ${halfFlower}mm），在公差内，仍可走。`
              : `布头不浪费路线内缝固定错 2×缝份=${r1(2 * s)}mm，视觉错位 ${r1(innerVisual)}mm 已过半朵花 ${halfFlower}mm、超 ${r1(tol)}mm 公差——此层 save 路线没有对花余地，只剩 match 跳花（费布）或认下错花。`)
      concessions.push(verdict)
    }
    if (g.polygon && Math.abs(remTop - rem) > 0.05) {
      concessions.push(
        `注：该层上口径周长 ${r1(PTop)}mm 的余数为 ${r1(remTop)}mm（底边余数 ${r1(rem)}mm），梯形片上下边错花量不同；对花以下边（底圈）为准，上口最多差 ${r1(Math.abs(remTop - rem))}mm。`
      )
    }
    if (!widthFits) {
      concessions.push(
        `幅宽不够：该层片高含缝份 ${r1(cutH)}mm 大于布幅 ${r1(p.fabricWidthMm)}mm，需换幅宽 ≥ ${r1(cutH)}mm 的布或改横排（横排时花纹方向转 90°，本活不替它对花）。`
      )
    }

    const id = panelId()

    // —— 逐片排刀 ——
    for (let k = 0; k < pieces; k++) {
      // 该片净起点要求的印花相位（沿灯身从入层累计净弧长算起，再加缝份）
      const dPhase = modT(phase0 + s + carriedIn + k * w, T)
      let cutStart: number
      let netStartX: number
      let isErrorSeam: boolean
      let seamErrorMm: number
      const marks: string[] = []

      if (p.strategy === 'match') {
        // 刀口在 x、净起点在 x+s：要求 (x+s+phase0) mod T = dPhase
        // → x mod T = (carriedIn + k·w) mod T；首片 k=0 时 x=0 即满足
        const base = modT(carriedIn + k * w, T)
        const minCut = st.cursor
        let m = Math.floor((minCut - base) / T)
        let x = base + m * T
        if (x < minCut - 1e-9) x += T
        cutStart = x
        netStartX = x + s
        const cutEnd = x + cutW
        if (k === pieces - 1) {
          isErrorSeam = !closureMatched
          seamErrorMm = closureVisual
          marks.push(
            `入口花位 ${r1(dPhase)}mm（周期比 ${(dPhase / T).toFixed(3)}）对第 ${k + 1} 道竖缝`
          )
          marks.push(
            isErrorSeam
              ? `闭合缝认下：绕回首片应回 ${r1(modT(phase0 + s + carriedIn, T))}mm，实际 ${r1(modT(dPhase + w, T))}mm，余数 ${r1(rem)}mm、视觉错 ${r1(closureVisual)}mm；此缝排最后、朝墙，不进对花次序`
              : `出口 ${r1(modT(dPhase + w, T))}mm 与首片入口 ${r1(modT(phase0 + s + carriedIn, T))}mm 同相，闭合缝对得上`
          )
        } else {
          isErrorSeam = false
          seamErrorMm = 0
          marks.push(
            `入口花位 ${r1(dPhase)}mm（周期比 ${(dPhase / T).toFixed(3)}）对第 ${k + 1} 道竖缝`
          )
          marks.push(
            `出口花位 ${r1(modT(dPhase + w, T))}mm（周期比 ${(modT(dPhase + w, T) / T).toFixed(3)}），与第 ${k + 2} 片入口同相`
          )
        }
        st.cursor = cutEnd
      } else {
        // save：刀口首尾相接，不跳花
        cutStart = st.cursor
        netStartX = st.cursor + s
        const cutEnd = st.cursor + cutW
        const atClosure = k === pieces - 1
        seamErrorMm = atClosure ? saveClosureVisual : visual(2 * s, T)
        isErrorSeam = seamErrorMm > tol + 1e-6
        const printedAtNet = modT(netStartX + phase0, T)
        marks.push(`入口花位 ${r1(printedAtNet)}mm（周期比 ${(printedAtNet / T).toFixed(3)}）`)
        if (atClosure) {
          marks.push(
            isErrorSeam
              ? `闭合缝原始余数 ${r1(saveClosureRaw)}mm（周长 ${r1(P)} + 2×缝份×${pieces - 1} 模周期），视觉错 ${r1(saveClosureVisual)}mm；布头不浪费路线认下，最后合、朝墙`
              : `闭合缝视觉错 ${r1(saveClosureVisual)}mm，在 ${r1(tol)}mm 公差内`
          )
        } else {
          marks.push(
            isErrorSeam
              ? `第 ${k + 1} 道内缝两片折边相接，固定错 2×缝份 = ${r1(2 * s)}mm（视觉 ${r1(visual(2 * s, T))}mm，半朵花 ${halfFlower}mm），认下`
              : `第 ${k + 1} 道内缝错 2×缝份=${r1(2 * s)}mm，视觉 ${r1(visual(2 * s, T))}mm，在公差内`
          )
        }
        st.cursor = cutEnd
      }

      const cutEnd = st.cursor
      segments.push({
        panelId: id,
        label: g.polygon ? `侧面（第 ${i + 1} 层）` : `展开片（第 ${i + 1} 层）`,
        layer: i + 1,
        piece: k + 1,
        color,
        startMm: r1(cutStart),
        endMm: r1(cutEnd),
        lengthMm: r1(cutEnd - cutStart),
        heightMm: r1(cutH),
        widthFits,
        phaseStartMm: r1(dPhase),
        phaseEndMm: r1(modT(dPhase + w, T)),
        phaseStartRatio: dPhase / T,
        isErrorSeam,
        seamErrorMm: r1(seamErrorMm),
        matchMarks: marks
      })
      st.pieces++
    }

    // 闭合缝搭接量（绕一圈搭回来的一道）算进该色布占用
    st.cursor += lap
    st.tightMm += pieces * cutW + lap
    // 净弧长按「实际周长」推进：让出的布头不改变灯身花纹相位，余数带入下一层
    st.carryShellMm = carriedIn + P

    layers.push({
      layer: i + 1,
      color,
      perimeterMm: r1(P),
      perimeterTopMm: r1(PTop),
      pieces,
      rawPieceMm: r1(w),
      cutPieceMm: r1(cutW),
      cutHeightMm: r1(cutH),
      widthFits,
      seamBothMm: r1(2 * s),
      overlapMm: r1(lap),
      fullRepeats,
      remainderMm: r1(rem),
      carriedPhaseMm: r1(modT(phase0 + s + carriedIn, T)),
      carriedRawMm: r1(carriedIn),
      carriedPhaseRatio: modT(phase0 + s + carriedIn, T) / T,
      innerSeamErrorMm: r1(visual(2 * s, T)),
      closureErrorMm: r1(closureVisual),
      saveClosureErrorMm: r1(saveClosureVisual),
      closureExtraMm: r1(closureExtra),
      closureMatched,
      errorSeam: closureMatched ? '—（闭合缝对得上）' : `第 ${i + 1} 层第 ${pieces} 片 → 第 1 片（闭合/背缝，视觉错 ${r1(closureVisual)}mm）`,
      perimeterSlope: r1(slope),
      concessions
    })
  })

  streams.forEach((st) => {
    // 用布以「同一份排刀结果」里各段的舍入刀口坐标为准，三处取数完全一致
    const segsOf = segments.filter((x) => x.color === st.color)
    st.usedMm =
      segsOf.reduce((a, x) => Math.max(a, x.endMm), 0) -
      segsOf.reduce((a, x) => Math.min(a, x.startMm), 0) +
      new Set(segsOf.map((x) => x.layer)).size * lap
  })

  // —— 各色用布汇总（数字直接来自上面同一份排刀，不另算）——
  const tallies: FabricRollTally[] = []
  let extraTotal = 0
  streams.forEach((st) => {
    const extra = Math.max(0, st.usedMm - st.tightMm)
    extraTotal += extra
    tallies.push({
      color: st.color,
      layers: st.layers,
      usedMm: r1(st.usedMm),
      tightMm: r1(st.tightMm),
      extraForMatchMm: r1(extra),
      fabricWidthMm: Math.max(1, p.fabricWidthMm),
      usedM2: Math.round(((st.usedMm * Math.max(1, p.fabricWidthMm)) / 1e6) * 1000) / 1000,
      pieces: st.pieces
    })
  })

  const errorSeamCount = segments.filter((x) => x.isErrorSeam).length
  const reworkMinutes = errorSeamCount * REWORK_MINUTES_PER_SEAM
  // 实跑对面路线，把放弃的那条路让出的布头/工摆明（depth 保护，不继续递归）
  const altPlan =
    depth === 0
      ? planPatternCutting(
          { ...l, pattern: { ...p, strategy: p.strategy === 'match' ? 'save' : 'match' } },
          1
        )
      : null
  const tradeoffNote =
    p.strategy === 'match'
      ? `本版选「先保花纹严丝合缝」：为对花让出布头合计 ${r1(extraTotal)}mm；被放弃的「布头不浪费」路线能省回这 ${r1(extraTotal)}mm 布，但每道内缝折边错 ${r1(2 * s)}mm（按周期视觉判错位）、闭合缝另算，共认下 ${altPlan ? altPlan.errorSeamCount : '—'} 道错花缝、折返工 ${altPlan ? altPlan.reworkMinutes : 0} 分钟（每缝 ${REWORK_MINUTES_PER_SEAM} 分钟），旧对位标记与拼缝次序全部失效。`
      : `本版选「先保布头不浪费」：刀口相接不跳花，用布只含净宽、缝份与搭接；共认下 ${errorSeamCount} 道错花缝、折返工 ${reworkMinutes} 分钟（每缝 ${REWORK_MINUTES_PER_SEAM} 分钟），旧对位标记与拼缝次序失效。被放弃的「严丝合缝」路线要让出布头 ${altPlan ? r1(altPlan.extraClothTotalMm) : '0.0'}mm（每片按花循环跳刀的空档合计）。`

  // save 路线的界线：折边固定错位的「视觉错位」已过半朵花/超公差，内缝就没有对花余地
  const saveFeasible = layers.every((x) => x.innerSeamErrorMm <= tol + 1e-6)
  const anyClosureBad = layers.some((x) => !x.closureMatched)
  const deadEnd =
    !saveFeasible && anyClosureBad
      ? `周期 ${T}mm 太短／片数太多：「布头不浪费」每道内缝折边错 ${r1(2 * s)}mm 的视觉错位已超 ${r1(tol)}mm 公差（半朵花 ${r1(T / 2)}mm 都盖不住），对花无余地；「严丝合缝」又有闭合缝余数。只能改周期、改一层高度，或在背缝认下错花。`
      : ''

  return {
    ...base,
    layers,
    segments,
    tallies,
    extraClothTotalMm: r1(extraTotal),
    errorSeamCount,
    reworkMinutes,
    tradeoffNote,
    saveFeasible,
    deadEnd
  }
}

function secTopRadius(g: ReturnType<typeof buildGeometry>, i: number): number {
  return g.sections[i + 1].radiusMm
}

/** 某色布手头库存够不够裁（含批量与损耗） */
export function stockStatus(tally: FabricRollTally, stockMm: number | undefined, batch: number, waste: number) {
  const need = tally.usedMm * batch * (1 + waste)
  const have = stockMm ?? 0
  return {
    haveMm: r1(have),
    needMm: r1(need),
    enough: have + 1e-6 >= need,
    shortMm: r1(Math.max(0, need - have))
  }
}

/** 把当前结果发布成「已发给作坊」的一版快照 */
export function makeIssue(plan: PatternPlanResult): PatternIssue {
  return {
    version: plan.version,
    signature: plan.signature,
    issuedAt: new Date().toISOString(),
    strategy: plan.strategy,
    repeatMm: plan.repeatMm,
    phaseOffsetMm: plan.phaseOffsetMm,
    fabricWidthMm: plan.fabricWidthMm,
    segments: plan.segments.map((x) => ({
      panelId: x.panelId,
      layer: x.layer,
      piece: x.piece,
      startMm: x.startMm,
      endMm: x.endMm,
      phaseStartMm: x.phaseStartMm,
      isErrorSeam: x.isErrorSeam
    })),
    usedByColor: Object.fromEntries(plan.tallies.map((t) => [t.color, t.usedMm]))
  }
}

/** 当前版相对已发布版的作废与重裁差异（三处各自变了什么） */
export interface PatternDiff {
  invalid: boolean
  changedPanels: { layer: number; piece: number; oldSeg: string; newSeg: string }[]
  changedMaterials: { color: string; oldMm: number; newMm: number }[]
  changedRows: string[]
  recutCount: number
  recutRows: string[]
}

export function diffAgainstIssued(plan: PatternPlanResult, issued: PatternIssue | null): PatternDiff {
  const empty: PatternDiff = { invalid: false, changedPanels: [], changedMaterials: [], changedRows: [], recutCount: 0, recutRows: [] }
  if (!issued || issued.signature === plan.signature) return empty

  const oldById = new Map(issued.segments.map((s) => [`${s.layer}-${s.piece}`, s]))
  const changedPanels: PatternDiff['changedPanels'] = []
  for (const n of plan.segments) {
    const o = oldById.get(`${n.layer}-${n.piece}`)
    const newSeg = `${n.startMm.toFixed(1)}~${n.endMm.toFixed(1)}mm，花位 ${n.phaseStartMm.toFixed(1)}mm${n.isErrorSeam ? '（错花缝）' : ''}`
    if (!o) {
      changedPanels.push({ layer: n.layer, piece: n.piece, oldSeg: '—（新增）', newSeg })
    } else {
      const oldSeg = `${o.startMm.toFixed(1)}~${o.endMm.toFixed(1)}mm，花位 ${o.phaseStartMm.toFixed(1)}mm${o.isErrorSeam ? '（错花缝）' : ''}`
      if (
        Math.abs(o.startMm - n.startMm) > 0.05 ||
        Math.abs(o.endMm - n.endMm) > 0.05 ||
        Math.abs(o.phaseStartMm - n.phaseStartMm) > 0.05 ||
        o.isErrorSeam !== n.isErrorSeam
      ) {
        changedPanels.push({ layer: n.layer, piece: n.piece, oldSeg, newSeg })
      }
    }
  }
  const changedMaterials: PatternDiff['changedMaterials'] = []
  for (const [color, mm] of Object.entries(issued.usedByColor)) {
    const t = plan.tallies.find((x) => x.color === color)
    if (!t) changedMaterials.push({ color, oldMm: r1(mm), newMm: 0 })
    else if (Math.abs(t.usedMm - mm) > 0.05) changedMaterials.push({ color, oldMm: r1(mm), newMm: t.usedMm })
  }
  for (const t of plan.tallies) {
    if (!(t.color in issued.usedByColor)) changedMaterials.push({ color: t.color, oldMm: 0, newMm: t.usedMm })
  }
  const rows = changedPanels.map((c) => `第 ${c.layer} 层第 ${c.piece} 片`)
  return { invalid: true, changedPanels, changedMaterials, changedRows: rows, recutCount: changedPanels.length, recutRows: rows }
}
