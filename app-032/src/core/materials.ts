/**
 * 材料统计与备料单（规格书 §4.6 / §5）
 * 备料按含余量长度；批量 = 单灯 × N × (1 + 损耗率)。
 * 绸布「按花纹周期取料」启用时，各色用布量取自同一份 PatternPlan（蒙面裁片页 /
 * 材料页 / 作坊清单三处同源），不再用面积反推米数。
 */
import type { FrameMember, Lantern, PatternColorRoll, PatternPlan } from './types'
import { bodySurfaceArea, bodyVolume, r1, r3 } from './geometry'
import { buildFrame } from './frame'
import { buildPanels } from './panels'
import { CRAFT, coveringSpec } from './craft'

export interface SingleLightMaterials {
  /** 竹篾/铁丝备料总长（含绑扎余量，m） */
  frameM: number
  /** 全部构件净长（m） */
  frameRawM: number
  /** 蒙面面积（含缝份，m²） */
  coveringM2: number
  /** 蒙面净面积（不含缝份，m²） */
  coveringNetM2: number
  /** 扎线（m） */
  lashM: number
  /** 胶（g） */
  glueG: number
  /** 绑扎处数 */
  lashJoints: number
  /** 灯体体积（L） */
  volumeL: number
  /** LED 建议颗数（不做电气设计，仅数量建议） */
  ledCount: number
  /** 灯体表面积（m²） */
  surfaceM2: number
  /** 按花纹周期取料：各色卷料结算（启用时与裁片页/清单同源） */
  fabricRolls: PatternColorRoll[]
  /** 按花纹周期取料：单灯各色卷长合计（m；未启用为 null） */
  fabricTotalM: number | null
  /** 取料结果签名（三处同源凭据；未启用为 null） */
  fabricSignature: string | null
}

export interface BatchMaterials extends SingleLightMaterials {
  count: number
  wasteRatio: number
}

export function computeMaterials(l: Lantern, pattern?: PatternPlan): SingleLightMaterials {
  const frame = buildFrame(l)
  const panelRes = buildPanels(l)
  const cov = coveringSpec(l.covering)
  const divisions = Math.max(3, Math.round(l.divisions))

  const frameMm = frame.members.reduce((s, m: FrameMember) => s + m.lengthMm * m.qty, 0)
  const frameRawMm = frame.members.reduce((s, m: FrameMember) => s + m.rawLengthMm * m.qty, 0)
  const joints = frame.members.reduce((s, m: FrameMember) => s + m.qty * m.lashJoints, 0)
  const cutArea = panelRes.cutAreaMm2
  const volumeL = bodyVolume(frame.geometry) / 1_000_000
  const led = Math.max(CRAFT.led.min, Math.ceil(volumeL * CRAFT.led.perLiter))

  // 按花纹周期取料启用且有效时，蒙面米数只认同一份取料计划（与裁片页/清单同源）
  const usePattern = !!(pattern && pattern.enabled && pattern.valid)
  const fabricRolls = usePattern
    ? pattern.rolls.map((r) => ({ ...r, shelves: r.shelves.map((s) => ({ ...s })) }))
    : []
  const fabricTotalM = usePattern ? r3(pattern.totalRequiredMm / 1000) : null

  return {
    frameM: r3(frameMm / 1000),
    frameRawM: r3(frameRawMm / 1000),
    coveringM2: usePattern ? pattern.totalRequiredM2 : r3(cutArea / 1_000_000),
    coveringNetM2: r3(panelRes.netAreaMm2 / 1_000_000),
    lashM: r3(joints * CRAFT.lashPerJointM),
    glueG: r1((cutArea / 1_000_000) * cov.gluePerM2),
    lashJoints: joints,
    volumeL: r3(volumeL),
    ledCount: led,
    surfaceM2: r3(bodySurfaceArea(frame.geometry, divisions) / 1_000_000),
    fabricRolls,
    fabricTotalM,
    fabricSignature: usePattern ? pattern.signature : null
  }
}

/** 批量化：单灯 × N × (1 + 损耗率)；LED 按颗数 × N（不参与损耗率） */
export function computeBatch(single: SingleLightMaterials, count: number, wasteRatio: number): BatchMaterials {
  const k = count * (1 + wasteRatio)
  return {
    ...single,
    count,
    wasteRatio,
    frameM: r3(single.frameM * k),
    frameRawM: r3(single.frameRawM * k),
    coveringM2: r3(single.coveringM2 * k),
    coveringNetM2: r3(single.coveringNetM2 * k),
    lashM: r3(single.lashM * k),
    glueG: r1(single.glueG * k),
    volumeL: r3(single.volumeL * count),
    ledCount: single.ledCount * count,
    surfaceM2: r3(single.surfaceM2 * count)
  }
}
