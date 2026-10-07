import { computeAll } from '../src/core/checks'
import { DEFAULT_LOFT_OPTIONS } from '../src/core/paginate'
import { defaultPatternPlan } from '../src/core/pattern'
import type { Lantern } from '../src/core/types'

function mk(over: Partial<Lantern['pattern']> = {}): Lantern {
  return {
    id: 't', kind: 'prism', name: 't', maxDiameterMm: 320, totalHeightMm: 400,
    mouthDiameterMm: 140, baseDiameterMm: 140, sides: 6,
    layers: [100, 100, 100, 100].map((h) => ({ heightMm: h, diameterMm: 0 })),
    mouthStyle: 'taper', bottomStyle: 'taper', smoothness: 0.45,
    ctrl1: { x: 0.3, y: 0.3 }, ctrl2: { x: 0.7, y: 0.7 }, divisions: 24,
    covering: 'silk', seamAllowanceMm: 10, lashAllowanceMm: 20,
    layerColors: ['#b3241f', '#c8452c', '#c8452c', '#b3241f'], color: '#b3241f',
    batchCount: 20, wasteRatio: 0.1, pageSize: 'A4', overlapMm: 10,
    pattern: { ...defaultPatternPlan(), enabled: true, repeatMm: 260, phaseOffsetMm: 30, ...over },
    createdAt: '', updatedAt: ''
  }
}

for (const strategy of ['match', 'save'] as const) {
  const r = computeAll(mk({ strategy }), DEFAULT_LOFT_OPTIONS)
  const c9 = r.checks.find((x) => x.id === 'CHK-09')!
  console.log(strategy, 'CHK-09:', c9.pass ? 'PASS' : 'FAIL', c9.value)
  if (!c9.pass) console.log('  ', c9.detail)
}

// 库存不够
const l = mk({ stockByColor: { '#b3241f': 1000 } })
const r = computeAll(l, DEFAULT_LOFT_OPTIONS)
const c9 = r.checks.find((x) => x.id === 'CHK-09')!
console.log('库存不足场景 CHK-09:', c9.pass ? 'PASS(误判)' : 'FAIL(正确识别)', '—', c9.detail.slice(0, 120))

// 整除周期，闭合缝必须对得上
const l2 = mk({ repeatMm: 480 })
const r2 = computeAll(l2, DEFAULT_LOFT_OPTIONS)
const layer1 = r2.pattern.layers[0]
console.log('P=420? T=480 余数:', layer1.remainderMm, '视觉错:', layer1.closureErrorMm)
console.log('全部 checks:', r2.checks.every((c) => c.pass) ? 'ALL PASS' : r2.checks.filter((c) => !c.pass).map((c) => c.id).join(','))
