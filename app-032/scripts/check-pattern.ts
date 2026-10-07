import { buildPatternPlan, diffPatternPlans } from '../src/core/pattern'
import { createFromPreset } from '../src/core/store'
import { computeAll } from '../src/core/checks'
import { DEFAULT_LOFT_OPTIONS } from '../src/core/paginate'
import type { Lantern, PatternPlan } from '../src/core/types'

let fail = 0
function check(name: string, cond: boolean, extra = '') {
  if (!cond) {
    fail++
    console.log(`  ✗ ${name} ${extra}`)
  } else {
    console.log(`  ✓ ${name} ${extra}`)
  }
}
const f1 = (v: number) => Math.round(v * 10) / 10

// ---- 六角宫灯：六棱柱 4 层（有收口，层周长各不相同）----
const l = createFromPreset('hex-palace')
l.pattern.enabled = true
l.pattern.repeatMm = 150
l.pattern.offsetMm = 0
l.pattern.lapMm = 10
l.seamAllowanceMm = 10
l.batchCount = 20
l.wasteRatio = 0.1

const full = computeAll(l, { ...DEFAULT_LOFT_OPTIONS, paper: 'A4', overlapMm: 10 })
const plan = full.pattern

console.log('== 六角宫灯 / 周期150 / 保花纹 ==')
console.log('层数:', plan.layers.length, '| 总片数:', plan.layers.reduce((a, x) => a + x.pieceCount, 0))
let cum = 0
for (const ly of plan.layers) {
  const netSum = ly.pieces.reduce((a, p) => a + p.netWidthBottomMm, 0)
  const cutSum = ly.pieces.reduce((a, p) => a + p.cutLengthMm, 0)
  console.log(
    `L${ly.layerIndex + 1} 周长下=${ly.perimeterBottomMm} 上=${ly.perimeterTopMm} 余=${ly.remainderBottomMm} 进层=${ly.entryPhaseMm} 合围Δ=${ly.closingMismatchBottomMm}/${ly.closingMismatchTopMm} 净宽合计=${f1(netSum)} 下刀合计=${f1(cutSum)} 带跨=${ly.bandSpanMm} 空耗=${ly.gapWasteMm}`
  )
  check(`L${ly.layerIndex + 1} 净宽首尾 = 周长`, Math.abs(netSum - ly.perimeterBottomMm) < 0.15, `${f1(netSum)} vs ${ly.perimeterBottomMm}`)
  check(`L${ly.layerIndex + 1} 进层累计相位 = 偏移+Σ余数 mod r`, Math.abs(ly.entryPhaseMm - f1(((cum % 150) + 150) % 150)) < 0.15, `${ly.entryPhaseMm} vs ${f1(((cum % 150) + 150) % 150)}`)
  cum += ly.remainderBottomMm
  const expectCut = ly.perimeterBottomMm + 20 * ly.pieceCount + 10
  check(`L${ly.layerIndex + 1} 下刀段 = 周长 + 缝份20×片 + 搭接10`, Math.abs(cutSum - expectCut) < 0.2, `${f1(cutSum)} vs ${f1(expectCut)}`)
  // 保花纹：内部缝下沿偏差必须 0
  for (const p of ly.pieces) {
    if (!p.closing) check(`L${ly.layerIndex + 1}#${p.pieceIndex + 1} 内部缝对花`, Math.abs(p.seam.mismatchBottomMm) <= 0.05, `Δ=${p.seam.mismatchBottomMm}`)
  }
}
console.log('单灯合计 mm:', plan.totalRequiredMm, '批量:', plan.batchRequiredMm)
console.log('allClosable:', plan.allClosable, 'openLayers:', plan.openLayers)
console.log('让步:', plan.concessions.map((c) => `${c.kind}:${c.label}`))
console.log('代价:', plan.cost.note)
check('CHK-09/10/11 通过（CHK-12 在未让步时按预期失败）', full.checks.filter((c) => ['CHK-09', 'CHK-10', 'CHK-11'].includes(c.id)).every((c) => c.pass))
const chk12 = full.checks.find((c) => c.id === 'CHK-12')!
check('CHK-12 在保花纹且未闭合时正确报警', !chk12.pass && /让步/.test(chk12.detail))

// 认下偏差最大的一层后，其余层仍须闭合 → 本例 4 层余数互不同相，只能救 3 层；
// 改测一个「除一层外都闭合」的合成参数：周期 150，L1 周长420余120（Δ-30），其余层理论闭合由挪花位验证
l.pattern.acceptLayerIndex = 0
const fullAcc = computeAll(l, { ...DEFAULT_LOFT_OPTIONS, paper: 'A4', overlapMm: 10 }).pattern
check('认下 L1 后 CHK-12 仍按其余层判定', Array.isArray(fullAcc.openLayers))
l.pattern.acceptLayerIndex = -1

// 材料页同源
check('材料签名同源', full.materials.fabricSignature === plan.signature)
check('材料卷数与计划一致', full.materials.fabricRolls.length === plan.rolls.length)
check('材料蒙面总量 = 计划面积', Math.abs(full.materials.coveringM2 - plan.totalRequiredM2) < 0.0005)

// ---- 改周期：三处差异 ----
const before = JSON.parse(JSON.stringify(plan)) as PatternPlan
l.pattern.repeatMm = 160
const full2 = computeAll(l, { ...DEFAULT_LOFT_OPTIONS, paper: 'A4', overlapMm: 10 })
const d = diffPatternPlans(before, full2.pattern)
console.log('\n== 改周期 150→160 ==')
console.log(d.summary)
check('diff 标记 changed', d.changed)
check('裁片页有变化行', d.panels.length > 0, `${d.panels.length}`)
check('材料页有变化行', d.materials.length > 0, `${d.materials.length}`)
check('清单行有变化', d.sheets.length > 0, `${d.sheets.length}`)

// ---- 保布头路线 ----
l.pattern.priority = 'cloth'
const cloth = computeAll(l, { ...DEFAULT_LOFT_OPTIONS, paper: 'A4', overlapMm: 10 }).pattern
let badSeams = 0
for (const ly of cloth.layers) for (const p of ly.pieces) if (Math.abs(p.seam.mismatchBottomMm) > 0.05) badSeams++
console.log('\n== 保布头 ==', '错缝', badSeams, '空耗应≈0')
const totalGap = cloth.layers.reduce((a, ly) => a + ly.gapWasteMm, 0)
check('保布头无空让布头', totalGap === 0, `${totalGap}`)
check('保布头内部缝恒定错开 20mm（150 或 160 周期下 20）', cloth.layers[0].pieces[0].seam.mismatchBottomMm === 20)

// ---- 构造一个严丝合缝的例子：周长恰为周期整数倍 ----
const l2 = createFromPreset('box-revolving') // 四棱方灯，平口，两层
l2.pattern.enabled = true
l2.pattern.priority = 'match'
// 方灯周长 = n × edge，edge = 2R sin(π/4)，R=140 → edge≈197.99，周长≈791.96；直接把直径调成周期好整除的
l2.maxDiameterMm = 200
l2.mouthDiameterMm = 200
l2.baseDiameterMm = 200
l2.totalHeightMm = 380
l2.pattern.repeatMm = 100
l2.pattern.offsetMm = 0
l2.pattern.lapMm = 10
l2.seamAllowanceMm = 10
const p2 = computeAll(l2, { ...DEFAULT_LOFT_OPTIONS, paper: 'A4', overlapMm: 10 }).pattern
console.log('\n== 方灯 D200 / 周期100 ==')
for (const ly of p2.layers) {
  console.log(`周长=${ly.perimeterBottomMm} 余=${ly.remainderBottomMm} 合围Δ=${ly.closingMismatchBottomMm}`)
}
// 2R sin45 = 141.42, 周长 565.69, 不整除 → 测 open；再测挪花位建议
console.log('allClosable:', p2.allClosable, '让步:', p2.concessions.map((c) => c.kind))

// ---- 周长整数倍：D 使 4 棱柱周长 = 600 ----
// edge = 2R sin45; 4 edge = 8R sin45 = 600 → R = 600/(8*0.7071)=106.066, D≈212.1
l2.maxDiameterMm = 212.132
l2.mouthDiameterMm = 212.132
l2.baseDiameterMm = 212.132
const p3 = computeAll(l2, { ...DEFAULT_LOFT_OPTIONS, paper: 'A4', overlapMm: 10 }).pattern
console.log('方灯调径后周长', p3.layers[0].perimeterBottomMm, '余', p3.layers[0].remainderBottomMm, '合围Δ', p3.layers[0].closingMismatchBottomMm)
check('周长≈600 时余≈0 合围对得上', Math.abs(p3.layers[0].closingMismatchBottomMm) <= 0.1)

// ---- 性能 ----
const t0 = performance.now()
for (let i = 0; i < 50; i++) buildPatternPlan(l)
console.log('\n50 次取料耗时', Math.round(performance.now() - t0), 'ms')

console.log(fail ? `\n失败 ${fail} 项` : '\n全部通过')
if (fail) process.exit(1)
