/** 导出：构件清单 / 裁片清单 / 备料单（CSV，本地生成，无外部请求） */
import type { FrameMember, Lantern, Panel } from './types'
import type { BatchMaterials, SingleLightMaterials } from './materials'
import type { PatternPlanResult } from './pattern'
import { coveringSpec } from './craft'

/** 取料版次行（三处清单同源标记：版次 + 指纹 + 路线） */
function planHeaderRows(plan: PatternPlanResult | undefined): (string | number)[][] {
  if (!plan || !plan.enabled || !plan.supported) return []
  return [
    [`取料版次 v${plan.version} / 指纹 ${plan.signature} / 路线 ${plan.strategy === 'match' ? '先保花纹严丝合缝' : '先保布头不浪费'} / 周期 ${plan.repeatMm.toFixed(1)}mm / 花位偏移 ${plan.phaseOffsetMm.toFixed(1)}mm / 缝份 ${plan.seamAllowanceMm.toFixed(1)}mm`],
    []
  ]
}

function csvCell(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows: (string | number)[][]): string {
  return '\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n')
}

export function downloadText(filename: string, content: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function membersCsv(l: Lantern, members: FrameMember[]): string {
  const rows: (string | number)[][] = [
    [`花灯构件清单 · ${l.name}`],
    [`最大直径 ${l.maxDiameterMm}mm / 总高 ${l.totalHeightMm}mm / 绑扎余量 每端 ${l.lashAllowanceMm}mm / 生成 ${new Date().toLocaleString()}`],
    [],
    ['构件名称', '类别', '分组', '净长(mm)', '截取长度(mm,含余量)', '余量处数', '数量', '总截取长度(mm)', '弯曲半径(mm)', '折角(°)', '备注']
  ]
  for (const m of members) {
    rows.push([
      m.label,
      kindName(m.kind),
      m.group,
      m.rawLengthMm.toFixed(1),
      m.lengthMm.toFixed(1),
      m.lashJoints,
      m.qty,
      (m.lengthMm * m.qty).toFixed(1),
      m.bendRadiusMm ? m.bendRadiusMm.toFixed(1) : '—',
      m.bendAngleDeg ? m.bendAngleDeg.toFixed(1) : '—',
      m.note || ''
    ])
  }
  const stock = members.reduce((s, m) => s + m.lengthMm * m.qty, 0)
  const raw = members.reduce((s, m) => s + m.rawLengthMm * m.qty, 0)
  rows.push([])
  rows.push(['合计', '', '', raw.toFixed(1), '', '', members.reduce((s, m) => s + m.qty, 0), stock.toFixed(1), '', '', `备料 ${(stock / 1000).toFixed(3)}m`])
  return toCsv(rows)
}

export function panelsCsv(l: Lantern, panels: Panel[], plan?: PatternPlanResult): string {
  const rows: (string | number)[][] = [
    [`蒙面裁片清单 · ${l.name}`],
    [`蒙面 ${coveringSpec(l.covering).name} / 缝份 每边 ${l.seamAllowanceMm}mm（已含在裁片尺寸内）/ 生成 ${new Date().toLocaleString()}`],
    ...planHeaderRows(plan),
    ['裁片编号', '名称', '形状', '净上宽(mm)', '净下宽(mm)', '净高(mm)', '裁切上宽(mm)', '裁切下宽(mm)', '裁切高(mm)', '半径/对边(mm)', '数量', '对位标记数']
  ]
  for (const p of panels) {
    rows.push([
      p.id,
      p.label,
      shapeName(p.shape),
      p.rawWidthTopMm.toFixed(1),
      p.rawWidthBottomMm.toFixed(1),
      p.rawHeightMm.toFixed(1),
      p.widthTopMm.toFixed(1),
      p.widthBottomMm.toFixed(1),
      p.heightMm.toFixed(1),
      p.radiusMm ? p.radiusMm.toFixed(1) : '—',
      p.qty,
      p.marksMm.length
    ])
  }
  if (plan && plan.enabled && plan.supported) {
    rows.push([])
    rows.push([
      `按花纹周期取料 · 每片下刀段（与裁片页、备料单同一份结果；单位 mm，偏差 1 位小数）`
    ])
    rows.push([
      '层', '片', '颜色', '下刀起点(mm)', '下刀终点(mm)', '刀长(mm)', '入口花位(mm)', '周期比', '出口花位(mm)', '错花量(mm)', '是否认下错花缝', '对位标记'
    ])
    for (const s of plan.segments) {
      rows.push([
        s.layer,
        s.piece,
        s.color,
        s.startMm.toFixed(1),
        s.endMm.toFixed(1),
        s.lengthMm.toFixed(1),
        s.phaseStartMm.toFixed(1),
        s.phaseStartRatio.toFixed(3),
        s.phaseEndMm.toFixed(1),
        s.seamErrorMm.toFixed(1),
        s.isErrorSeam ? '是（最后合、朝墙）' : '否',
        s.matchMarks.join('；')
      ])
    }
    rows.push([])
    for (const lr of plan.layers) {
      rows.push([
        `第 ${lr.layer} 层`,
        `实际周长 ${lr.perimeterMm.toFixed(1)}mm = 片数 ${lr.pieces} × 净宽 ${lr.rawPieceMm.toFixed(1)}mm；周期 ${plan.repeatMm.toFixed(1)}mm 得 ${lr.fullRepeats} 整周期余 ${lr.remainderMm.toFixed(1)}mm；偏差落：${lr.errorSeam}`
      ])
    }
  }
  return toCsv(rows)
}

export function materialsCsv(
  l: Lantern,
  single: SingleLightMaterials,
  batch: BatchMaterials,
  plan?: PatternPlanResult
): string {
  const cov = coveringSpec(l.covering)
  const rows: (string | number)[][] = [
    [`备料单 · ${l.name}`],
    [`生成 ${new Date().toLocaleString()} / 单位 mm·m²·m·g`],
    ...planHeaderRows(plan),
    ['项目', '单灯用量', '单位', `批量 ${batch.count} 个（含 ${(batch.wasteRatio * 100).toFixed(0)}% 损耗）`],
    ['竹篾/铁丝（含绑扎余量）', single.frameM.toFixed(3), 'm', batch.frameM.toFixed(3)],
    ['竹篾构件净长', single.frameRawM.toFixed(3), 'm', batch.frameRawM.toFixed(3)],
    [`蒙面（${cov.name}，含缝份）`, single.coveringM2.toFixed(3), 'm²', batch.coveringM2.toFixed(3)],
    ['蒙面净面积（不含缝份）', single.coveringNetM2.toFixed(3), 'm²', batch.coveringNetM2.toFixed(3)],
    ['扎线', single.lashM.toFixed(3), 'm', batch.lashM.toFixed(3)],
    ['胶', single.glueG.toFixed(1), 'g', batch.glueG.toFixed(1)],
    ['LED 灯珠建议', single.ledCount, '颗', batch.ledCount],
    [],
    ['灯体体积', single.volumeL.toFixed(3), 'L', batch.volumeL.toFixed(3)],
    ['灯体表面积', single.surfaceM2.toFixed(3), 'm²', batch.surfaceM2.toFixed(3)]
  ]
  if (plan && plan.enabled && plan.supported) {
    rows.push([])
    rows.push(['按花纹周期取料 · 各色绸布用布（与裁片清单同一份结果）'])
    rows.push([
      '颜色', '涉及层', '幅宽(mm)', '单灯下刀总长(mm)', '其中对花让出(mm)', '单灯用布(m²)',
      `批量 ${batch.count} 个含损耗需(mm)`, '手头库存(mm)', '够不够', '差额(mm)'
    ])
    for (const t of plan.tallies) {
      const stock = l.pattern.stockByColor[t.color]
      const have = stock ?? 0
      const need = t.usedMm * batch.count * (1 + batch.wasteRatio)
      rows.push([
        t.color,
        t.layers.join('/'),
        t.fabricWidthMm.toFixed(1),
        t.usedMm.toFixed(1),
        t.extraForMatchMm.toFixed(1),
        t.usedM2.toFixed(3),
        need.toFixed(1),
        have ? have.toFixed(1) : '—',
        have ? (have >= need ? '够' : '不够') : '未填库存',
        have ? Math.max(0, need - have).toFixed(1) : need.toFixed(1)
      ])
    }
    rows.push([])
    rows.push([plan.tradeoffNote])
  }
  return toCsv(rows)
}

export function kindName(k: FrameMember['kind']): string {
  const map: Record<FrameMember['kind'], string> = {
    vertical: '竖篾',
    ring: '横篾',
    mouth_ring: '收口圈',
    base_ring: '底盘圈',
    rib: '母线篾',
    spoke: '辐条/中轴'
  }
  return map[k]
}

export function shapeName(s: Panel['shape']): string {
  const map: Record<Panel['shape'], string> = {
    trapezoid: '梯形',
    rectangle: '矩形',
    sector: '扇形',
    circle: '圆形/正多边形',
    triangle: '三角形'
  }
  return map[s]
}
