/** 导出：构件清单 / 裁片清单 / 备料单（CSV，本地生成，无外部请求） */
import type { FrameMember, Lantern, Panel, PatternDiff, PatternPlan } from './types'
import type { BatchMaterials, SingleLightMaterials } from './materials'
import { coveringSpec } from './craft'

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

export function panelsCsv(l: Lantern, panels: Panel[], plan?: PatternPlan | null, diff?: PatternDiff | null): string {
  const changedKeys = new Set((diff?.panels || []).map((d) => d.key))
  const rows: (string | number)[][] = [
    [`蒙面裁片清单 · ${l.name}`],
    plan?.enabled
      ? [`按花纹周期取料：幅宽 ${plan.spec.boltWidthMm}mm / 周期 ${plan.spec.repeatMm}mm / 花位偏移 ${plan.spec.offsetMm}mm / 合围搭接 ${plan.spec.lapMm}mm / 路线 ${plan.spec.priority === 'match' ? '先保花纹' : '先保布头'} / 生成 ${new Date().toLocaleString()}`]
      : [`蒙面 ${coveringSpec(l.covering).name} / 缝份 每边 ${l.seamAllowanceMm}mm（已含在裁片尺寸内）/ 生成 ${new Date().toLocaleString()}`],
    [],
    plan?.enabled
      ? ['裁片编号', '名称', '形状', '颜色', '净上宽(mm)', '净下宽(mm)', '净高(mm)', '下刀段长(mm,含缝份/搭接)', '幅宽排', '卷上起点(mm)', '卷上终点(mm)', '左净边花位(mm)', '花位比例', '右缝偏差下/上(mm)', '数量', '对位标记数', '本版变化']
      : ['裁片编号', '名称', '形状', '净上宽(mm)', '净下宽(mm)', '净高(mm)', '裁切上宽(mm)', '裁切下宽(mm)', '裁切高(mm)', '半径/对边(mm)', '数量', '对位标记数']
  ]
  if (plan?.enabled) {
    for (const ly of plan.layers) {
      for (const p of ly.pieces) {
        rows.push([
          p.panelId,
          p.label,
          '梯形/矩形围片',
          p.color,
          p.netWidthTopMm.toFixed(1),
          p.netWidthBottomMm.toFixed(1),
          ly.netHeightMm.toFixed(1),
          p.cutLengthMm.toFixed(1),
          `第${p.shelfIndex + 1}排`,
          p.rollFromMm.toFixed(1),
          p.rollToMm.toFixed(1),
          p.phaseStartMm.toFixed(1),
          p.phaseStartRatio.toFixed(4),
          `${p.seam.mismatchBottomMm.toFixed(1)}/${p.seam.mismatchTopMm.toFixed(1)}`,
          1,
          p.marksMm.length,
          changedKeys.has(`L${p.layerIndex + 1}-${String(p.pieceIndex + 1).padStart(2, '0')}`) ? '★本版变' : ''
        ])
      }
    }
    for (const c of plan.caps) {
      rows.push([c.panelId, c.label, '盖片', c.color, c.cutLengthMm.toFixed(1), c.cutLengthMm.toFixed(1), c.cutCrossMm.toFixed(1), c.cutLengthMm.toFixed(1), `第${c.shelfIndex + 1}排`, c.rollFromMm.toFixed(1), c.rollToMm.toFixed(1), '—', '—', '不参与对花', 1, 0, ''])
    }
    rows.push([])
    rows.push(['三处同源签名（蒙面裁片页/材料页/作坊清单必须一致）', plan.signature])
    rows.push(['本版变更', diff?.changed ? diff.summary : '与已存档版本一致'])
  } else {
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
  }
  return toCsv(rows)
}

/**
 * 发给作坊的裁片清单（按花纹周期取料版）：每行一片的下刀段 + 花位 + 对位标记。
 * 与蒙面裁片页、材料页共用同一 PatternPlan / 签名。
 */
export function workshopCutsCsv(plan: PatternPlan, l: Lantern, diff?: PatternDiff | null): string {
  const changedKeys = new Set((diff?.sheets || []).map((d) => d.key))
  const rows: (string | number)[][] = [
    [`作坊裁片清单（按花纹周期取料）· ${l.name}`],
    [`幅宽 ${plan.spec.boltWidthMm}mm｜花纹周期 ${plan.spec.repeatMm}mm｜花位偏移 ${plan.spec.offsetMm}mm（${(plan.spec.offsetMm / plan.spec.repeatMm * 100).toFixed(2)}%）｜缝份 每边 ${l.seamAllowanceMm}mm｜合围搭接 ${plan.spec.lapMm}mm｜路线：${plan.spec.priority === 'match' ? '先保花纹严丝合缝' : '先保布头不浪费'}｜批量 ${Math.max(1, Math.round(l.batchCount))} 个`],
    [`单位 mm（偏差保留 1 位小数）｜生成 ${new Date().toLocaleString()}`],
    [],
    ['序号', '定位', '颜色', '幅宽排', '卷上起点', '卷上终点', '下刀段长', '片高(含缝份)', '左净边花位', '花位比例', '接哪条缝', '缝偏差下沿(mm)', '缝偏差上沿(mm)', '合围', '对位标记', '本版']
  ]
  let seq = 1
  for (const ly of plan.layers) {
    for (const p of ly.pieces) {
      const key = `L${p.layerIndex + 1}-${String(p.pieceIndex + 1).padStart(2, '0')}`
      rows.push([
        seq++,
        p.label,
        p.color,
        `${p.shelfIndex + 1}`,
        p.rollFromMm.toFixed(1),
        p.rollToMm.toFixed(1),
        p.cutLengthMm.toFixed(1),
        p.cutHeightMm.toFixed(1),
        p.phaseStartMm.toFixed(1),
        p.phaseStartRatio.toFixed(4),
        p.seam.label,
        p.seam.mismatchBottomMm.toFixed(1),
        p.seam.mismatchTopMm.toFixed(1),
        p.closing ? `合围片（搭接端 +${plan.spec.lapMm}）` : '',
        p.marksMm.map((m) => m.label).join('；'),
        changedKeys.has(key) ? '★换版' : ''
      ])
    }
  }
  for (const c of plan.caps) {
    rows.push([seq++, c.label, c.color, `${c.shelfIndex + 1}`, c.rollFromMm.toFixed(1), c.rollToMm.toFixed(1), c.cutLengthMm.toFixed(1), c.cutCrossMm.toFixed(1), '—', '—', '盖片不围圈', '—', '—', '', '', ''])
  }
  rows.push([])
  rows.push(['每层合围偏差（绕一圈接回起头）'])
  for (const ly of plan.layers) {
    rows.push([ly.label, `周长 ${ly.perimeterBottomMm.toFixed(1)}mm = ${ly.quotient}×${plan.spec.repeatMm} + 余 ${ly.remainderBottomMm.toFixed(1)}`, `进层累计相位 ${ly.entryPhaseMm.toFixed(1)}mm（${(ly.entryPhaseRatio * 100).toFixed(2)}%）`, `合围缝偏差 下 ${ly.closingMismatchBottomMm.toFixed(1)} / 上 ${ly.closingMismatchTopMm.toFixed(1)}`, ly.closingSeamLabel])
  }
  rows.push([])
  rows.push(['同源签名', plan.signature])
  rows.push(['注意', '本清单与蒙面裁片页、备料单同源同签名；改周期或花位即整批作废重出，按旧版下过刀的片重裁，旧对位标记与拼缝次序失效。'])
  return toCsv(rows)
}

export function materialsCsv(
  l: Lantern,
  single: SingleLightMaterials,
  batch: BatchMaterials,
  plan?: PatternPlan | null,
  diff?: PatternDiff | null
): string {
  const cov = coveringSpec(l.covering)
  const changedMat = new Map((diff?.materials || []).map((d) => [d.key, d]))
  const rows: (string | number)[][] = [
    [`备料单 · ${l.name}`],
    [`生成 ${new Date().toLocaleString()} / 单位 mm·m²·m·g${plan?.enabled ? ` / 按花纹周期取料 签名 ${plan.signature}` : ''}`],
    [],
    ['项目', '单灯用量', '单位', `批量 ${batch.count} 个（含 ${(batch.wasteRatio * 100).toFixed(0)}% 损耗）`, '本版变化'],
    ['竹篾/铁丝（含绑扎余量）', single.frameM.toFixed(3), 'm', batch.frameM.toFixed(3), ''],
    ['竹篾构件净长', single.frameRawM.toFixed(3), 'm', batch.frameRawM.toFixed(3), ''],
    [`蒙面（${cov.name}${plan?.enabled ? '，按花纹周期取料同签名' : '，含缝份'}）`, single.coveringM2.toFixed(3), 'm²', batch.coveringM2.toFixed(3), ''],
    ['蒙面净面积（不含缝份）', single.coveringNetM2.toFixed(3), 'm²', batch.coveringNetM2.toFixed(3), ''],
    ['扎线', single.lashM.toFixed(3), 'm', batch.lashM.toFixed(3), ''],
    ['胶', single.glueG.toFixed(1), 'g', batch.glueG.toFixed(1), ''],
    ['LED 灯珠建议', single.ledCount, '颗', batch.ledCount, ''],
    [],
    ['灯体体积', single.volumeL.toFixed(3), 'L', batch.volumeL.toFixed(3), ''],
    ['灯体表面积', single.surfaceM2.toFixed(3), 'm²', batch.surfaceM2.toFixed(3), '']
  ]
  if (plan?.enabled) {
    rows.push([])
    rows.push([
      `按色绸布卷料（幅宽 ${plan.spec.boltWidthMm}mm，路线：${plan.spec.priority === 'match' ? '先保花纹' : '先保布头'}，与裁片页/作坊清单同签名 ${plan.signature}）`
    ])
    rows.push(['颜色', '用在哪', '幅宽排数', '单灯卷长(m)', '其中空耗布头(mm)', `批量卷长(m, ${batch.count}个含损耗)`, '批量面积(m²)', '库存卷长(m)', '够不够裁', '本版变化'])
    for (const r of plan.rolls) {
      rows.push([
        r.color,
        r.usedBy.join('、'),
        r.shelves.length,
        (r.requiredLengthMm / 1000).toFixed(3),
        r.wasteLengthMm.toFixed(1),
        (r.batchRequiredLengthMm / 1000).toFixed(3),
        r.batchRequiredAreaM2.toFixed(3),
        r.stockLengthMm === null ? '未填' : (r.stockLengthMm / 1000).toFixed(3),
        r.enough === null ? '未判（先填库存）' : r.enough ? '够裁' : '不够裁',
        changedMat.has(r.color) ? '★米数变' : ''
      ])
    }
    rows.push(['各色合计', '', '', (plan.totalRequiredMm / 1000).toFixed(3), '', (plan.batchRequiredMm / 1000).toFixed(3), plan.batchRequiredM2.toFixed(3), '', '', changedMat.has('__total__') ? '★合计变' : ''])
    rows.push([])
    rows.push(['路线代价', plan.cost.note])
    rows.push(['本版变更', diff?.changed ? diff.summary : '与已存档版本一致'])
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
