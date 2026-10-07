import { planPatternCutting, diffAgainstIssued, makeIssue, defaultPatternPlan } from '../src/core/pattern'
import type { Lantern } from '../src/core/types'

function hexLantern(overrides: Partial<Lantern['pattern']> & { seam?: number; flat?: boolean } = {}): Lantern {
  const p = { ...defaultPatternPlan(), enabled: true, repeatMm: 260, phaseOffsetMm: 30, ...overrides }
  return {
    id: 't',
    kind: 'prism',
    name: '六角宫灯',
    maxDiameterMm: 320,
    totalHeightMm: 400,
    mouthDiameterMm: overrides.flat ? 320 : 140,
    baseDiameterMm: overrides.flat ? 320 : 140,
    sides: 6,
    layers: [
      { heightMm: 100, diameterMm: 0 },
      { heightMm: 100, diameterMm: 0 },
      { heightMm: 100, diameterMm: 0 },
      { heightMm: 100, diameterMm: 0 }
    ],
    mouthStyle: overrides.flat ? 'flat' : 'taper',
    bottomStyle: overrides.flat ? 'flat' : 'taper',
    smoothness: 0.45,
    ctrl1: { x: 0.3, y: 0.3 },
    ctrl2: { x: 0.7, y: 0.7 },
    divisions: 24,
    covering: 'silk',
    seamAllowanceMm: overrides.seam ?? 10,
    lashAllowanceMm: 20,
    layerColors: ['#b3241f', '#c8452c', '#c8452c', '#b3241f'],
    color: '#b3241f',
    batchCount: 20,
    wasteRatio: 0.1,
    pageSize: 'A4',
    overlapMm: 10,
    pattern: p,
    createdAt: '',
    updatedAt: ''
  }
}

function show(title: string, r: ReturnType<typeof planPatternCutting>) {
  console.log('\n===', title, '===')
  for (const L of r.layers) {
    console.log(
      `层${L.layer} P=${L.perimeterMm} n=${L.pieces} 净宽=${L.rawPieceMm} 刀宽=${L.cutPieceMm} 整周期=${L.fullRepeats} 余=${L.remainderMm} 进位原值=${L.carriedRawMm} 进位相位=${L.carriedPhaseMm} 闭合错=${L.closureErrorMm} save闭合错=${L.saveClosureErrorMm} 斜率=${L.perimeterSlope}`
    )
  }
  for (const t of r.tallies) {
    console.log(`色 ${t.color} 用布=${t.usedMm} 紧排布=${t.tightMm} 让出=${t.extraForMatchMm} 片=${t.pieces} m²=${t.usedM2}`)
  }
  let ok = true
  for (const L of r.layers) {
    const segs = r.segments.filter((x) => x.layer === L.layer)
    const raw = segs.reduce((a, x) => a + (x.lengthMm - 2 * r.seamAllowanceMm), 0)
    const good = Math.abs(raw - L.perimeterMm) < 0.15
    ok = ok && good
    console.log(`  层${L.layer} 净段和=${raw.toFixed(2)} vs 周长=${L.perimeterMm} ${good ? 'OK' : 'FAIL'}`)
    console.log(`  首3刀:`, segs.slice(0, 3).map((x) => `${x.startMm}~${x.endMm} 花${x.phaseStartMm}${x.isErrorSeam ? ' 错缝' : ''}`).join(' | '))
    const last = segs[segs.length - 1]
    console.log(`  末刀: ${last.startMm}~${last.endMm} 错缝=${last.isErrorSeam} 错量=${last.seamErrorMm}`)
  }
  console.log('净段闭合:', ok ? 'ALL OK' : 'FAIL')
  console.log('代价:', r.tradeoffNote)
}

const l1 = hexLantern()
const rm = planPatternCutting(l1)
show('match T=260 花位30', rm)
show('save', planPatternCutting(hexLantern({ strategy: 'save' })))
show('平口直筒', planPatternCutting(hexLantern({ flat: true })))

const l2 = hexLantern()
const before = planPatternCutting(l2)
l2.pattern.issued = makeIssue(before)
l2.pattern.repeatMm = 300
l2.pattern.version += 1
const after = planPatternCutting(l2)
const d = diffAgainstIssued(after, l2.pattern.issued)
console.log('\n改版 T260→300：invalid=', d.invalid, '重裁片数=', d.recutCount, '材料变化=', d.changedMaterials)
console.log('示例变化行:', d.changedPanels[0])
