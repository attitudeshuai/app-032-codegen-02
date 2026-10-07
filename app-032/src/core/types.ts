/** 花灯放样数据模型（对齐规格书 §7，并补充放样所需的展开参数） */

export type LanternKind = 'prism' | 'revolution' | 'polyhedron' | 'box'
export type MouthStyle = 'flat' | 'taper' | 'gourd'
export type Covering = 'xuan' | 'silk' | 'parchment'
export type PageSize = 'A4' | 'A3'
export type PanelShape = 'trapezoid' | 'rectangle' | 'sector' | 'circle' | 'triangle'
export type MemberKind = 'vertical' | 'ring' | 'mouth_ring' | 'base_ring' | 'rib' | 'spoke'

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
  /** 按花纹周期取料参数（本机灯样存档留这一版的周期与花位） */
  pattern: PatternSpec
  /** 已存档取料版本（最新在末位；选错的那版标记作废） */
  patternVersions: PatternVersionRecord[]
  createdAt: string
  updatedAt: string
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

/* ===================== 按花纹周期取料 ===================== */

/** 取料优先路线：严丝合缝（保花纹）/ 布头不浪费（连刀裁） */
export type PatternPriority = 'match' | 'cloth'

/** 让步办法：挪花位 / 改一层高度 / 认下一处对不上 */
export type PatternConcessionKind = 'shift' | 'resize' | 'accept'

/** 花纹取料参数（随灯样一起存档） */
export interface PatternSpec {
  /** 是否启用按花纹周期取料 */
  enabled: boolean
  /** 布的幅宽（mm，卷料横向可用宽度） */
  boltWidthMm: number
  /** 花纹一个循环（周期）的长度（mm，沿卷长方向） */
  repeatMm: number
  /** 花位偏移（mm，第一片起头相位相对花位原点挪多少） */
  offsetMm: number
  /** 合围缝搭接量（mm，已算进最后一片的下刀段） */
  lapMm: number
  /** 让步路线：先保花纹严丝合缝 / 先保布头不浪费，二选一 */
  priority: PatternPriority
  /** 认下对不上的那一层（-1 = 不认；其余层必须闭合） */
  acceptLayerIndex: number
  /** 各色布库存卷长（mm），键为颜色值；空白表示未填、不判够不够 */
  stockByColor: Record<string, number>
}

/** 花纹对位标记（坐标在裁片下刀框内：x 沿卷长，y 沿幅宽，mm） */
export interface PatternPhaseMark {
  xMm: number
  yMm: number
  label: string
  kind: 'phase' | 'seam' | 'lap' | 'join'
}

/** 拼缝（某一片右边与下一片左边相接处）的对花结果 */
export interface PatternSeam {
  /** 缝的名称，如「L1-③→④」；合围缝标 L?-末→① */
  label: string
  /** 该缝在卷料上的相位差（mm，带符号；0 = 对得上） */
  mismatchBottomMm: number
  /** 梯形层上沿处的相位差（mm；棱柱 = 下沿值） */
  mismatchTopMm: number
  /** 是否合围缝（绕一圈接回起头那一条） */
  closing: boolean
}

/** 一片围向面板在卷料上的下刀段 */
export interface PatternCutPiece {
  /** 层索引（0 起） */
  layerIndex: number
  /** 层内片序（0 起，按围向拼接次序） */
  pieceIndex: number
  /** 对应裁片种类编号（蒙面裁片页的面板 id） */
  panelId: string
  label: string
  color: string
  /** 净宽（下沿，mm；qty 片首尾相接 = 该层实际周长） */
  netWidthBottomMm: number
  /** 净宽（上沿，mm） */
  netWidthTopMm: number
  /** 下刀段沿卷长的长度（mm，含两边缝份；末片另含合围搭接量） */
  cutLengthMm: number
  /** 幅宽方向占用（mm，含上下边缝份） */
  cutHeightMm: number
  /** 本片左边净边相对花位原点的相位（mm，0 ≤ x < repeat） */
  phaseStartMm: number
  /** 相位占周期比例（0~1，4 位小数） */
  phaseStartRatio: number
  /** 本片与下一片之间沿卷长多让掉的布头（mm，仅保花纹路线有） */
  gapBeforeMm: number
  /** 片前的卷料起头空耗（mm；该层第一条下刀段到花位原点） */
  headSkipMm: number
  /** 本片在本层带内的本地起点（mm，未打包幅宽前） */
  bandFromMm: number
  /** 下刀段在卷料上的起点（mm，打包到幅宽后赋值） */
  rollFromMm: number
  /** 下刀段在卷料上的终点（mm） */
  rollToMm: number
  /** 幅宽方向起点（mm） */
  rollCrossFromMm: number
  /** 幅宽方向终点（mm） */
  rollCrossToMm: number
  /** 所在幅宽排（shelf）序号 */
  shelfIndex: number
  /** 是否合围片（每层最后一片，含合围搭接量） */
  closing: boolean
  /** 右边拼缝对花结果 */
  seam: PatternSeam
  /** 对位/花位标记 */
  marksMm: PatternPhaseMark[]
}

/** 顶/底盖等不参与围向对花的整片下刀件 */
export interface PatternCapCut {
  panelId: string
  label: string
  color: string
  /** 沿卷长下刀尺寸（mm，含缝份） */
  cutLengthMm: number
  /** 幅宽方向尺寸（mm，含缝份） */
  cutCrossMm: number
  rollFromMm: number
  rollToMm: number
  rollCrossFromMm: number
  rollCrossToMm: number
  shelfIndex: number
  note: string
}

/** 一层（一圈）的取料结果 */
export interface PatternLayerPlan {
  layerIndex: number
  label: string
  color: string
  /** 该层展开后实际周长（下沿，走轮廓与棱长周长那一路，mm） */
  perimeterBottomMm: number
  /** 上沿周长（mm） */
  perimeterTopMm: number
  /** 每片净宽（下沿，mm） */
  pieceBottomMm: number
  /** 每片净宽（上沿，mm） */
  pieceTopMm: number
  /** 片数（= 棱数或母线等分数） */
  pieceCount: number
  /** 周长 ÷ 周期 */
  quotient: number
  /** 周长 ÷ 周期 的余数（下沿，mm） */
  remainderBottomMm: number
  /** 余数（上沿，mm） */
  remainderTopMm: number
  /** 进入该层时的累计相位（mm，= 花位偏移 + 各下层余数逐项累加后 mod 周期） */
  entryPhaseMm: number
  /** 累计相位占周期比例 */
  entryPhaseRatio: number
  /** 该层合围缝对花偏差（下沿，mm，带符号） */
  closingMismatchBottomMm: number
  /** 合围缝对花偏差（上沿，mm，带符号） */
  closingMismatchTopMm: number
  /** 合围缝名称（落在末片→首片那条缝上） */
  closingSeamLabel: string
  /** 裁片高（净，mm） */
  netHeightMm: number
  /** 下刀高（含上下边缝份，mm） */
  cutHeightMm: number
  /** 该层整条在卷长方向占用（首刀起 ~ 末刀止，mm） */
  bandSpanMm: number
  /** 保花纹路线下该层缝间空掉的布头合计（mm，不含起头） */
  gapWasteMm: number
  /** 该层各片下刀段（按围向次序） */
  pieces: PatternCutPiece[]
  /** 是否直筒段（上下沿周长相等；改层高无法救闭合） */
  straight: boolean
}

/** 幅宽排（一行可并几条带/几个盖片） */
export interface PatternShelf {
  index: number
  /** 幅宽方向起点（mm） */
  crossFromMm: number
  /** 占用幅宽（mm） */
  crossWidthMm: number
  /** 该行沿卷长占用（mm） */
  lengthMm: number
  itemCount: number
}

/** 一色一卷的用量结算 */
export interface PatternColorRoll {
  color: string
  /** 用在哪（层号/顶盖/底盖） */
  usedBy: string[]
  boltWidthMm: number
  shelves: PatternShelf[]
  /** 单灯所需卷长（mm，含缝间空耗、起头与幅宽排间空档） */
  requiredLengthMm: number
  /** 其中缝间/起头多让的布头（mm） */
  wasteLengthMm: number
  /** 单灯所需面积（m²） */
  requiredAreaM2: number
  /** 批量所需卷长（mm，= 单灯 × 数量 × (1 + 损耗率)） */
  batchRequiredLengthMm: number
  /** 批量所需面积（m²） */
  batchRequiredAreaM2: number
  /** 库存卷长（mm，未填为 null） */
  stockLengthMm: number | null
  /** 库存够不够裁批量 */
  enough: boolean | null
}

/** 让步办法（一条） */
export interface PatternConcession {
  kind: PatternConcessionKind
  /** 针对的层 */
  layerIndex: number
  label: string
  detail: string
  /** 挪花位：建议新花位偏移（mm） */
  newOffsetMm?: number
  /** 挪花位：需要挪动的量（mm，带符号） */
  shiftMm?: number
  /** 改层高：建议层高改为（mm） */
  newLayerHeightMm?: number
  /** 改层高：层高调整量（mm，带符号） */
  heightDeltaMm?: number
  /** 改层高：调整后该层周长（mm） */
  newPerimeterMm?: number
  /** 该让步之后仍闭合不上的层 */
  stillOpenLayers: number[]
  /** 该让步能救回的层 */
  closesLayers: number[]
}

/** 两条路线的代价对比（摆明让出多少布头或多少工） */
export interface PatternCost {
  /** 保花纹比保布头多吃的卷长（mm/灯） */
  matchExtraFabricMm: number
  /** 保布头比保花纹省下的卷长（mm/灯） */
  clothSavedFabricMm: number
  /** 保布头路线下对不上的缝条数 */
  clothMismatchSeamCount: number
  /** 对不上的缝里最大偏差（mm） */
  clothWorstMismatchMm: number
  /** 保布头路线省下的拼缝对花工：每条缝少一次挪刀对花 */
  savedAlignSeams: number
  note: string
}

/** 一版按花纹周期取料的完整结果（蒙面裁片页 / 材料页 / 作坊清单三处同源） */
export interface PatternPlan {
  enabled: boolean
  /** 输入快照（mm；相位比例 4 位；本版周期与花位随灯样存档） */
  spec: PatternSpec
  valid: boolean
  invalidReason: string
  seamAllowanceMm: number
  layers: PatternLayerPlan[]
  caps: PatternCapCut[]
  rolls: PatternColorRoll[]
  /** 单灯所需各色卷长合计（mm） */
  totalRequiredMm: number
  /** 单灯所需各色面积合计（m²） */
  totalRequiredM2: number
  /** 批量卷长合计（mm） */
  batchRequiredMm: number
  /** 批量面积合计（m²） */
  batchRequiredM2: number
  /** 所有层合围缝能否对得上（不认步情况下） */
  allClosable: boolean
  /** 仍对不上的层（含被认下的层） */
  openLayers: number[]
  concessions: PatternConcession[]
  cost: PatternCost
  /** 对花余地界线说明（层片越多 / 周期越短，余地越小） */
  boundaryNote: string
  /** 三处同源的结果签名（同一串数） */
  signature: string
  generatedAt: string
}

/** 改一次周期/花位后，三处各自变了什么（一条变更） */
export interface PatternDiffEntry {
  /** 定位键（层-片 / 颜色 / 清单行） */
  key: string
  label: string
  before: string
  after: string
  detail: string
}

export interface PatternDiff {
  signatureBefore: string
  signatureAfter: string
  changed: boolean
  /** 蒙面裁片页：哪几片面板的下刀段与对位标记变了 */
  panels: PatternDiffEntry[]
  /** 材料页：哪几项材料与米数变了 */
  materials: PatternDiffEntry[]
  /** 作坊裁片清单：哪几行跟着换了 */
  sheets: PatternDiffEntry[]
  summary: string
}

/** 本机灯样存档里的一版取料 */
export interface PatternVersionRecord {
  version: number
  signature: string
  savedAt: string
  note: string
  repeatMm: number
  offsetMm: number
  boltWidthMm: number
  lapMm: number
  priority: PatternPriority
  acceptLayerIndex: number
  /** 存档时是否已导出裁片清单 / 备料单并发给作坊（作废时要一起追） */
  issuedToWorkshop: boolean
  /** 作废信息 */
  voided: boolean
  voidedAt?: string
  voidReason?: string
  /** 作废时相对新版需要重裁的片（层-片定位） */
  reCutPieces?: string[]
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
