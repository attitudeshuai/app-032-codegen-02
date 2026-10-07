/** 花灯放样数据模型（对齐规格书 §7，并补充放样所需的展开参数） */

export type LanternKind = 'prism' | 'revolution' | 'polyhedron' | 'box'
export type MouthStyle = 'flat' | 'taper' | 'gourd'
export type Covering = 'xuan' | 'silk' | 'parchment'
export type PageSize = 'A4' | 'A3'
export type PanelShape = 'trapezoid' | 'rectangle' | 'sector' | 'circle' | 'triangle'
export type MemberKind = 'vertical' | 'ring' | 'mouth_ring' | 'base_ring' | 'rib' | 'spoke'
/** 按花纹周期取料的两条路：严丝合缝（让布）／ 布头不浪费（让工），只能取舍一条 */
export type PatternStrategy = 'match' | 'save'

export interface Point2 {
  x: number
  y: number
}

/** 分段（层）：高度为准，直径为轮廓派生结果 */
export interface LayerSpec {
  heightMm: number
  diameterMm: number
}

export interface Lantern {
  id: string
  kind: LanternKind
  name: string
  /** 最大直径（灯体最粗处） */
  maxDiameterMm: number
  /** 总高（= 各分段高度之和） */
  totalHeightMm: number
  /** 收口直径（上口） */
  mouthDiameterMm: number
  /** 底口直径（下口） */
  baseDiameterMm: number
  /** 棱数（prism/box）；旋转体时作为竖篾（母线篾）根数 */
  sides: number
  /** 分段高度与直径 */
  layers: LayerSpec[]
  /** 上收口方式 */
  mouthStyle: MouthStyle
  /** 下收口方式 */
  bottomStyle: MouthStyle
  /** 收口曲线强度 0~1 */
  smoothness: number
  /** 葫芦/花瓶形贝塞尔控制点（归一化：x 为半径插值比例，y 为肩部区间比例） */
  ctrl1: Point2
  ctrl2: Point2
  /** 旋转体母线等分数（默认 24，可调） */
  divisions: number
  /** 蒙面类型 */
  covering: Covering
  /** 缝份（mm，四边各加） */
  seamAllowanceMm: number
  /** 绑扎余量（mm，每端） */
  lashAllowanceMm: number
  /** 每层配色（长度 = layers.length，可短于层数则回落到主色） */
  layerColors: string[]
  /** 主色 */
  color: string
  /** 批量制灯数量 */
  batchCount: number
  /** 损耗率 0~0.2 */
  wasteRatio: number
  /** 1:1 打印纸张 */
  pageSize: PageSize
  /** 长条图跨页搭接量（mm） */
  overlapMm: number
  /** 按花纹周期取料参数（绸布对花）；未启用时 enabled=false */
  pattern: PatternPlanInput
  createdAt: string
  updatedAt: string
}

/** 取料输入：布幅宽、花纹一个循环的长度、花位偏移，均按 mm 填 */
export interface PatternPlanInput {
  /** 是否按花纹周期取料 */
  enabled: boolean
  /** 布的幅宽（mm） */
  fabricWidthMm: number
  /** 花纹一个循环（周期）的长度（mm，沿布长方向） */
  repeatMm: number
  /** 花位偏移（mm，第一刀相对花纹循环原点的偏移） */
  phaseOffsetMm: number
  /** 接缝处可接受的对花公差（mm，默认 3mm） */
  toleranceMm: number
  /** 两条路只能选一条：match=先保花纹严丝合缝 / save=先保布头不浪费 */
  strategy: PatternStrategy
  /** 各色布手头库存（按颜色 hex 存 mm），用于判断够不够裁 */
  stockByColor: Record<string, number>
  /** 取料版次：改一次周期/花位/路线就 +1 */
  version: number
  /** 已发给作坊的那一版快照（未发布时为 null）；当前版与之不符即整版作废 */
  issued: PatternIssue | null
}

/** 一层一圈的对花明细（取料核心中间量，逐层累加不抹掉） */
export interface PatternLayerReport {
  layer: number
  color: string
  /** 该层展开后实际周长（mm，多边形 n×棱长 / 圆 2πR，走既有周长路径，取底圈） */
  perimeterMm: number
  /** 该层顶圈周长（mm，梯形片上口径对花参考） */
  perimeterTopMm: number
  pieces: number
  /** 每片净宽（mm） */
  rawPieceMm: number
  /** 每片含缝份刀长（mm） */
  cutPieceMm: number
  /** 每片含缝份高度（mm） */
  cutHeightMm: number
  /** 片高含缝份能否排进布幅 */
  widthFits: boolean
  /** 缝份两边合计（mm） */
  seamBothMm: number
  /** 闭合缝搭接量（mm） */
  overlapMm: number
  /** 周长 ÷ 周期 的整周期数 */
  fullRepeats: number
  /** 周长 ÷ 周期 的余数（mm，一位小数） */
  remainderMm: number
  /** 进入该层时累计花位（mm，同色各层余数累加后取模，累加器本身不取整） */
  carriedPhaseMm: number
  /** 进入该层前同色各层净弧长累计原值（mm，证明累计偏移没被逐层抹掉） */
  carriedRawMm: number
  /** 累计花位占周期比例（carriedPhaseMm / repeat） */
  carriedPhaseRatio: number
  /** save 路线下每道内缝固定错位（mm，= 缝份两边） */
  innerSeamErrorMm: number
  /** 闭合缝错花量（mm） */
  closureErrorMm: number
  /** save 路线下闭合缝错花量（mm，= (周长 + 2×缝份×(片数−1)) 模周期） */
  saveClosureErrorMm: number
  /** 闭合缝要让到同相需补的布头（mm） */
  closureExtraMm: number
  /** 闭合缝是否在公差内 */
  closureMatched: boolean
  /** 偏差落在哪条缝 */
  errorSeam: string
  /** 改一层高度时周长随高度的变化率（mm/mm，0 表示直筒段改高无用） */
  perimeterSlope: number
  /** 让步办法（逐条） */
  concessions: string[]
}

/** 取料总结果（蒙面裁片页 / 材料页 / 作坊清单三处同源取这一份） */
export interface PatternPlanResult {
  enabled: boolean
  supported: boolean
  unsupportedReason: string
  strategy: PatternStrategy
  fabricWidthMm: number
  repeatMm: number
  phaseOffsetMm: number
  toleranceMm: number
  seamAllowanceMm: number
  signature: string
  version: number
  layers: PatternLayerReport[]
  segments: CutSegment[]
  tallies: FabricRollTally[]
  /** match 路线为对花让出的布头合计（mm） */
  extraClothTotalMm: number
  /** save 路线下认下的错花缝条数 */
  errorSeamCount: number
  /** save 路线下错花缝折合返工工时（分钟） */
  reworkMinutes: number
  /** 两种路线互相放弃时的代价对比文案 */
  tradeoffNote: string
  /** 界线：save 是否还存在对花余地（内缝错位 ≤ 公差） */
  saveFeasible: boolean
  /** 死局：周期短到两条路都不可取 */
  deadEnd: string
  batchCount: number
  wasteRatio: number
}

/** 已发布给作坊的取料版快照（三处同源取这一版时即为生效版） */
export interface PatternIssue {
  version: number
  signature: string
  issuedAt: string
  strategy: PatternStrategy
  repeatMm: number
  phaseOffsetMm: number
  fabricWidthMm: number
  /** 每片下刀段（用于改参数后比对哪几片要重裁） */
  segments: {
    panelId: string
    layer: number
    piece: number
    startMm: number
    endMm: number
    phaseStartMm: number
    isErrorSeam: boolean
  }[]
  /** 各色用布长度（mm，单灯） */
  usedByColor: Record<string, number>
}

/** 接缝处绕一圈接回原处的对花结论 */
export interface PatternSeamInfo {
  /** 层号（1 起） */
  layer: number
  /** 该层展开后的实际周长（mm，走轮廓/棱长年周长路径） */
  perimeterMm: number
  /** 该层裁片种数（棱柱=棱数，旋转体=母线等分数），片越多余地越小 */
  pieces: number
  /** 周长 ÷ 周期：整周期数 */
  fullRepeats: number
  /** 周长 ÷ 周期：余数（mm） */
  remainderMm: number
  /** 余数合到一个接缝上时，该缝错花量（mm） */
  seamErrorMm: number
  /** 末片相对首片需跨过的花纹循环数 */
  cycles: number
  /** 偏差落在哪条缝上（层号+缝号描述） */
  errorSeam: string
  /** 是否在公差内严丝合缝 */
  matched: boolean
}

/** 单片裁片的下刀段（沿布长方向，mm，已含缝份与搭接量） */
export interface CutSegment {
  /** 裁片种类编号 P001… */
  panelId: string
  label: string
  layer: number
  /** 第几片（该层 1 起） */
  piece: number
  color: string
  /** 下刀起点（布长坐标，mm，含缝份） */
  startMm: number
  /** 下刀终点（mm） */
  endMm: number
  /** 净下刀长度（mm，= 缝与缝之间含缝份的长度） */
  lengthMm: number
  /** 该片含缝份高度（mm，用于核对幅宽够不够排） */
  heightMm: number
  /** 含缝份高度是否在布幅内 */
  widthFits: boolean
  /** 入口处花位相位（相对花纹循环原点，mm） */
  phaseStartMm: number
  /** 出口处花位相位（mm） */
  phaseEndMm: number
  /** 入口处花位相位（周期比例 0~1，由毫米换算） */
  phaseStartRatio: number
  /** 该缝错花量（mm，0 = 对得上） */
  seamErrorMm: number
  /** 该缝是否为认下的错花缝 */
  isErrorSeam: boolean
  /** 对位标记说明（首尾花位/相位对齐） */
  matchMarks: string[]
}

/** 某色布的取料汇总（材料页与作坊清单同源取此数） */
export interface FabricRollTally {
  color: string
  /** 涉及层号 */
  layers: number[]
  /** 下刀总长度（mm，含缝份、搭接与对花让步） */
  usedMm: number
  /** 若布头不浪费路线：长度（mm，= 净段相接） */
  tightMm: number
  /** 对花多让出的布头（mm，= used - tight） */
  extraForMatchMm: number
  /** 幅宽（mm） */
  fabricWidthMm: number
  /** 用布面积（m²，= 下刀总长 × 幅宽） */
  usedM2: number
  /** 裁片块数 */
  pieces: number
}

export interface FrameMember {
  id: string
  kind: MemberKind
  /** 名称，如「竖篾」「第 3 层横篾」「收口圈」 */
  label: string
  /** 截取长度（已含绑扎余量） */
  lengthMm: number
  /** 净长（不含余量） */
  rawLengthMm: number
  /** 建议弯曲半径（圆形圈 / 收口段） */
  bendRadiusMm?: number
  /** 折角（多边形圈的转角，度） */
  bendAngleDeg?: number
  /** 数量 */
  qty: number
  /** 分组：所属层或类别 */
  group: string
  /** 每根含几处绑扎余量 */
  lashJoints: number
  note?: string
}

export interface PanelMark {
  x: number
  y: number
  label: string
}

export interface Panel {
  id: string
  label: string
  shape: PanelShape
  /** 裁片下宽（已含缝份） */
  widthBottomMm: number
  /** 裁片上宽（已含缝份） */
  widthTopMm: number
  /** 裁片高（已含缝份） */
  heightMm: number
  seamAllowanceMm: number
  marksMm: PanelMark[]
  qty: number
  /** 展开净尺寸（不含缝份） */
  rawWidthTopMm: number
  rawWidthBottomMm: number
  rawHeightMm: number
  /** 圆形/正多边形裁片半径（净，不含缝份） */
  radiusMm?: number
  /** 正多边形边数（顶/底盖为多边形时） */
  polySides?: number
  /** 对应灯体层的索引（-1 表示顶/底盖） */
  layerIndex: number
  color: string
  note?: string
}

export interface MaterialTally {
  /** 备料竹篾/铁丝总长（m，含绑扎余量与损耗） */
  frameM: number
  /** 蒙面面积（m²，含缝份与损耗） */
  coveringM2: number
  /** 损耗率 */
  wasteRatio: number
  /** 扎线（m） */
  lashM: number
  /** 胶（g） */
  glueG: number
  /** LED 灯珠建议数量 */
  ledCount?: number
}

/** 构件与裁片的自检结果（对应规格书 §10） */
export interface CheckResult {
  id: string
  title: string
  pass: boolean
  detail: string
  /** 相关数值，便于界面展示 */
  value?: string
}
