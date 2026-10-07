import { buildPatternPlan } from '../src/core/pattern'
import { createFromPreset } from '../src/core/store'
import { computeAll } from '../src/core/checks'
import { DEFAULT_LOFT_OPTIONS } from '../src/core/paginate'

for (const id of ['round-lantern', 'lotus', 'tetra-zodiac', 'oct-palace', 'box-revolving']) {
  const l = createFromPreset(id)
  l.pattern.enabled = true
  l.pattern.repeatMm = 135
  l.pattern.offsetMm = 20
  l.pattern.lapMm = 10
  const full = computeAll(l, { ...DEFAULT_LOFT_OPTIONS, paper: 'A4', overlapMm: 10 })
  const p = full.pattern
  const ok9 = full.checks.find((c) => c.id === 'CHK-09')!
  const ok10 = full.checks.find((c) => c.id === 'CHK-10')!
  const ok11 = full.checks.find((c) => c.id === 'CHK-11')!
  console.log(
    id,
    '| 层', p.layers.length,
    '| 片', p.layers.reduce((a, x) => a + x.pieceCount, 0),
    '| 盖片', p.caps.length,
    '| 卷', p.rolls.length,
    '| 合计mm', p.totalRequiredMm,
    '| CHK9/10/11', ok9.pass, ok10.pass, ok11.pass,
    '| 闭合', p.allClosable
  )
  if (!ok9.pass || !ok10.pass || !ok11.pass) {
    console.log(ok9.detail); console.log(ok10.detail); console.log(ok11.detail)
    process.exit(1)
  }
}
console.log('OK')
