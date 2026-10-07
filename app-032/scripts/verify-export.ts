import { computeAll } from '../src/core/checks'
import { DEFAULT_LOFT_OPTIONS } from '../src/core/paginate'
import { defaultPatternPlan } from '../src/core/pattern'
import { panelsCsv, materialsCsv } from '../src/core/exporter'
import type { Lantern } from '../src/core/types'

const l: Lantern = {
  id: 't', kind: 'prism', name: '手算灯', maxDiameterMm: 320, totalHeightMm: 400,
  mouthDiameterMm: 140, baseDiameterMm: 140, sides: 6,
  layers: [100, 100, 100, 100].map((h) => ({ heightMm: h, diameterMm: 0 })),
  mouthStyle: 'taper', bottomStyle: 'taper', smoothness: 0.45,
  ctrl1: { x: 0.3, y: 0.3 }, ctrl2: { x: 0.7, y: 0.7 }, divisions: 24,
  covering: 'silk', seamAllowanceMm: 10, lashAllowanceMm: 20,
  layerColors: ['#b3241f', '#c8452c', '#c8452c', '#b3241f'], color: '#b3241f',
  batchCount: 20, wasteRatio: 0.1, pageSize: 'A4', overlapMm: 10,
  pattern: { ...defaultPatternPlan(), enabled: true, repeatMm: 260, phaseOffsetMm: 30, strategy: 'match' },
  createdAt: '', updatedAt: ''
}

const r = computeAll(l, DEFAULT_LOFT_OPTIONS)
const pc = panelsCsv(l, r.panels.panels, r.pattern)
const mc = materialsCsv(l, r.materials, r.batch, r.pattern)

// 从两个 CSV 里抓同一片（层1片1）和同色用布，比对
const panelRow = pc.split('\n').find((line) => line.startsWith('1,1,#b3241f'))
const matRow = mc.split('\n').find((line) => line.startsWith('#b3241f'))
console.log('裁片清单 行:', panelRow)
console.log('备料单 行  :', matRow)

const seg = r.pattern.segments.find((x) => x.layer === 1 && x.piece === 1)!
const tally = r.pattern.tallies.find((t) => t.color === '#b3241f')!
const csvStart = panelRow!.split(',')[3]
const csvUsed = matRow!.split(',')[3]
console.log('段起点 同源:', csvStart === seg.startMm.toFixed(1) ? 'OK' : `FAIL ${csvStart} vs ${seg.startMm}`)
console.log('色用布 同源:', csvUsed === tally.usedMm.toFixed(1) ? 'OK' : `FAIL ${csvUsed} vs ${tally.usedMm}`)
console.log('版次头:', mc.split('\n').slice(2, 4).join(' | '))
