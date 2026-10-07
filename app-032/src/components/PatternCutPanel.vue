<script setup lang="ts">
/**
 * 按花纹周期取料面板（嵌在蒙面裁片页）
 * 取数全部来自 props.full.pattern（与材料页、作坊 CSV 同一个 PatternPlan / 签名）。
 */
import { computed, ref } from 'vue'
import type { FullResult } from '../core/checks'
import type { Lantern, PatternPlan, PatternVersionRecord } from '../core/types'
import { buildPatternPlan, diffPatternPlans, PATTERN_EPS } from '../core/pattern'
import { archivePatternVersion, syncLayerDiameters, voidLatestPatternVersion } from '../core/store'
import { downloadText, workshopCutsCsv, panelsCsv } from '../core/exporter'

const props = defineProps<{ lantern: Lantern; full: FullResult }>()

const plan = computed(() => props.full.pattern)
const p = computed(() => props.lantern.pattern)
const expanded = ref<Set<number>>(new Set())

function toggleLayer(i: number) {
  const s = new Set(expanded.value)
  if (s.has(i)) s.delete(i)
  else s.add(i)
  expanded.value = s
}

function sealed(v: number) {
  return Math.abs(v) <= PATTERN_EPS
}

const openLayerOptions = computed(() => plan.value.layers.map((ly) => ({ value: ly.layerIndex, text: `${ly.label}（合围偏差 ${ly.closingMismatchBottomMm.toFixed(1)}/${ly.closingMismatchTopMm.toFixed(1)}mm）` })))

/** 以某条存档记录的参数重建当时的取料计划（用于三处变化对照） */
function archivedPlan(rec: PatternVersionRecord): PatternPlan {
  const ghost: Lantern = JSON.parse(JSON.stringify(props.lantern))
  ghost.pattern = {
    ...ghost.pattern,
    repeatMm: rec.repeatMm,
    offsetMm: rec.offsetMm,
    boltWidthMm: rec.boltWidthMm,
    lapMm: rec.lapMm,
    priority: rec.priority,
    acceptLayerIndex: rec.acceptLayerIndex
  }
  return buildPatternPlan(ghost)
}

const latestActive = computed(() => [...props.lantern.patternVersions].reverse().find((v) => !v.voided) || null)
const lastRecord = computed(() => props.lantern.patternVersions[props.lantern.patternVersions.length - 1] || null)
const baseline = computed(() => (latestActive.value ? archivedPlan(latestActive.value) : null))
const diff = computed(() => diffPatternPlans(baseline.value, plan.value))
const dirty = computed(() => !!baseline.value && baseline.value.signature !== plan.value.signature)

const archiveNote = ref('')
const markIssued = ref(false)

function doArchive() {
  archivePatternVersion(props.lantern, plan.value.signature, archiveNote.value || (p.value.priority === 'match' ? '先保花纹严丝合缝' : '先保布头不浪费'), markIssued.value)
  archiveNote.value = ''
  markIssued.value = false
}

function markWorkshop() {
  if (latestActive.value) latestActive.value.issuedToWorkshop = true
}

function doVoid() {
  const d = diff.value
  const reason = p.value.priority === 'match'
    ? '改走「先保花纹严丝合缝」：保布头版连同已导出裁片清单与已发作坊备料单一并作废，旧版下过刀的片重裁，旧对位标记与拼缝次序失效。'
    : '改走「先保布头不浪费」：保花纹版连同已导出裁片清单与已发作坊备料单一并作废，让出对花工与布头，旧版下过刀的片重裁。'
  voidLatestPatternVersion(props.lantern, reason, d.panels.map((x) => x.key))
}

function exportWorkshop() {
  downloadText(`${props.lantern.name}-作坊裁片清单-${plan.value.signature}.csv`, workshopCutsCsv(plan.value, props.lantern, diff.value))
}

function exportPanels() {
  downloadText(`${props.lantern.name}-蒙面裁片清单-${plan.value.signature}.csv`, panelsCsv(props.lantern, props.full.panels.panels, plan.value, diff.value))
}

function applyShift(offset: number) {
  p.value.offsetMm = Math.round(offset * 10) / 10
}

function applyResize(layerIndex: number, h: number) {
  props.lantern.layers[layerIndex].heightMm = Math.round(h * 10) / 10
  syncLayerDiameters(props.lantern)
}

function applyAccept(layerIndex: number) {
  p.value.acceptLayerIndex = p.value.acceptLayerIndex === layerIndex ? -1 : layerIndex
}

const priorityChanging = computed(() => !!latestActive.value && latestActive.value.priority !== p.value.priority)

function isLayerSealed(ly: { closingMismatchBottomMm: number; closingMismatchTopMm: number }) {
  return sealed(ly.closingMismatchBottomMm) && sealed(ly.closingMismatchTopMm)
}
function openLayerBad(ly: { closingMismatchBottomMm: number; closingMismatchTopMm: number }) {
  return !isLayerSealed(ly)
}
</script>

<template>
  <section class="pat">
    <header class="pat-head">
      <h3>按花纹周期取料 · 绕一圈花纹对得上</h3>
      <label class="enable">
        <input type="checkbox" v-model="p.enabled" />
        <span>启用本活（绸布花布）</span>
      </label>
    </header>

    <p v-if="!p.enabled" class="hint">
      填入布的幅宽、花纹一个循环的长度与花位偏移，按每层展开后的实际周长算每片从布的哪一段下刀，
      使绕一圈接回原处时花纹对得上；周期与周长除不尽时说清偏差落在哪条合围缝、差多少，并给出让步办法。
    </p>

    <template v-else>
      <div class="inputs">
        <div class="f">
          <label>布的幅宽 (mm)</label>
          <input type="number" min="1" step="1" v-model.number="p.boltWidthMm" />
        </div>
        <div class="f">
          <label>花纹周期·一个循环 (mm)</label>
          <input type="number" min="1" step="0.1" v-model.number="p.repeatMm" />
        </div>
        <div class="f">
          <label>花位偏移 (mm，0~周期)</label>
          <input type="number" min="0" step="0.1" v-model.number="p.offsetMm" />
        </div>
        <div class="f">
          <label>合围搭接量 (mm)</label>
          <input type="number" min="0" step="0.5" v-model.number="p.lapMm" />
        </div>
        <div class="f route">
          <label>先保哪头（二选一，选错整版作废重裁）</label>
          <div class="seg">
            <button :class="{ on: p.priority === 'match' }" @click="p.priority = 'match'">先保花纹严丝合缝</button>
            <button :class="{ on: p.priority === 'cloth' }" @click="p.priority = 'cloth'">先保布头不浪费</button>
          </div>
        </div>
        <div class="f" v-if="p.priority === 'match'">
          <label>认下哪一层合围缝对不上（可不让）</label>
          <select v-model.number="p.acceptLayerIndex">
            <option :value="-1">不认，全部层必须闭合</option>
            <option v-for="o in openLayerOptions" :key="o.value" :value="o.value">{{ o.text }}</option>
          </select>
        </div>
      </div>

      <p v-if="!plan.valid" class="invalid">输入有问题：{{ plan.invalidReason }}</p>

      <template v-else>
        <div class="stats">
          <div class="st"><span>路线</span><b :class="p.priority">{{ p.priority === 'match' ? '保花纹' : '保布头' }}</b></div>
          <div class="st"><span>单灯用布合计</span><b>{{ (plan.totalRequiredMm / 1000).toFixed(3) }} m</b></div>
          <div class="st"><span>批量 {{ Math.max(1, Math.round(lantern.batchCount)) }} 个</span><b>{{ (plan.batchRequiredMm / 1000).toFixed(3) }} m</b></div>
          <div class="st"><span>合围闭合</span><b :class="{ bad: !plan.allClosable && p.priority === 'match' }">{{ plan.allClosable || p.priority === 'cloth' ? '成立' : `${plan.openLayers.length} 层未闭合` }}</b></div>
          <div class="st sig"><span>三处同源签名</span><b>{{ plan.signature }}</b></div>
        </div>

        <div v-if="p.priority === 'match' && !plan.allClosable" class="warnbox">
          <b>周期跟周长除不尽，偏差落在这些合围缝上：</b>
          <ul>
            <li v-for="i in plan.openLayers" :key="i">
              第 {{ i + 1 }} 层：{{ plan.layers[i].closingSeamLabel }}，还差
              <b>{{ Math.max(Math.abs(plan.layers[i].closingMismatchBottomMm), Math.abs(plan.layers[i].closingMismatchTopMm)).toFixed(1) }}mm</b>
              （下 {{ plan.layers[i].closingMismatchBottomMm.toFixed(1) }} / 上 {{ plan.layers[i].closingMismatchTopMm.toFixed(1) }}），
              周长 {{ plan.layers[i].perimeterBottomMm.toFixed(1) }} = {{ plan.layers[i].quotient }} 个周期 + 余 {{ plan.layers[i].remainderBottomMm.toFixed(1) }}mm
            </li>
          </ul>
        </div>

        <!-- 让步办法 -->
        <div v-if="plan.concessions.length" class="concessions">
          <h4>让步办法（三选一；改一次整批重算，三处一起换）</h4>
          <div v-for="(c, ci) in plan.concessions" :key="ci" class="conc">
            <div class="conc-t">
              <b>{{ c.label }}</b>
              <button v-if="c.kind === 'shift' && c.shiftMm" @click="applyShift(c.newOffsetMm!)">采用此挪法</button>
              <button v-if="c.kind === 'resize' && c.newLayerHeightMm" @click="applyResize(c.layerIndex, c.newLayerHeightMm!)">改这一层高度并重算</button>
              <button v-if="c.kind === 'accept'" @click="applyAccept(c.layerIndex)">
                {{ p.acceptLayerIndex === c.layerIndex ? '取消认下' : '认下这一处（放背面）' }}
              </button>
            </div>
            <p>{{ c.detail }}</p>
          </div>
        </div>

        <!-- 路线代价 -->
        <div class="cost">
          <h4>两条路的代价（只能选一条）</h4>
          <p>{{ plan.cost.note }}</p>
          <div class="cost-grid">
            <div :class="{ active: p.priority === 'match' }">
              <b>先保花纹</b>
              <span>每灯多吃 {{ (plan.cost.matchExtraFabricMm / 1000).toFixed(3) }}m 布头，换全部竖缝对花</span>
            </div>
            <div :class="{ active: p.priority === 'cloth' }">
              <b>先保布头</b>
              <span>省 {{ (plan.cost.clothSavedFabricMm / 1000).toFixed(3) }}m/灯，{{ plan.cost.clothMismatchSeamCount }} 条缝错开（最大 {{ plan.cost.clothWorstMismatchMm.toFixed(1) }}mm），少 {{ plan.cost.savedAlignSeams }} 道挪刀对花工</span>
            </div>
          </div>
          <div v-if="priorityChanging" class="void-warn">
            你正在从已存档的「{{ latestActive?.priority === 'match' ? '保花纹' : '保布头' }}」版改走另一条路：
            选错的那一版取料结果、已导出的裁片清单与已发给作坊的备料单要一起作废，按旧版已下过刀的片重裁，旧对位标记与拼缝次序失效。
            <button class="danger" @click="doVoid">作废上版并登记重裁（{{ diff.panels.length }} 片）</button>
          </div>
        </div>

        <!-- 每层每片的下刀段与对位标记 -->
        <div class="layers">
          <h4>每层展开周长 · 余数逐层累加 · 每片下刀段与对位标记</h4>
          <article v-for="ly in plan.layers" :key="ly.layerIndex" class="layer" :class="{ open: openLayerBad(ly), sealed: isLayerSealed(ly) }">
            <header @click="toggleLayer(ly.layerIndex)">
              <span class="tri">{{ expanded.has(ly.layerIndex) ? '▼' : '▶' }}</span>
              <b>{{ ly.label }}</b>
              <span class="cbox" :style="{ background: ly.color }" />
              <span class="l-meta">
                实际周长 {{ ly.perimeterBottomMm.toFixed(1) }}mm（上沿 {{ ly.perimeterTopMm.toFixed(1) }}）
                ＝ {{ ly.quotient }}×{{ p.repeatMm }} ＋ 余 <b>{{ ly.remainderBottomMm.toFixed(1) }}</b>mm
                ｜进层累计相位 {{ ly.entryPhaseMm.toFixed(1) }}mm（{{ (ly.entryPhaseRatio * 100).toFixed(2) }}%）
                ｜{{ ly.pieceCount }} 片 × 净宽 {{ ly.pieceBottomMm.toFixed(1) }}mm
                ｜合围缝偏差 <b :class="{ bad: !sealed(ly.closingMismatchBottomMm) || !sealed(ly.closingMismatchTopMm) }">{{ ly.closingMismatchBottomMm.toFixed(1) }}/{{ ly.closingMismatchTopMm.toFixed(1) }}mm</b>
                <em v-if="p.acceptLayerIndex === ly.layerIndex" class="accepted">（本灯认下此缝）</em>
              </span>
            </header>
            <div v-if="expanded.has(ly.layerIndex)" class="pieces">
              <table>
                <thead>
                  <tr>
                    <th>片</th><th>幅宽排</th><th>卷上下刀段 (mm)</th><th>下刀段长</th><th>片高</th>
                    <th>左净边花位 (mm/比例)</th><th>相接的缝 / 偏差 下·上 (mm)</th><th>对位标记（同一份结果）</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="pc in ly.pieces" :key="pc.pieceIndex" :class="{ closing: pc.closing }">
                    <td class="mono">{{ pc.pieceIndex + 1 }}/{{ ly.pieceCount }}</td>
                    <td class="mono">第{{ pc.shelfIndex + 1 }}排<br />幅宽 {{ pc.rollCrossFromMm.toFixed(1) }}~{{ pc.rollCrossToMm.toFixed(1) }}</td>
                    <td class="mono"><b>{{ pc.rollFromMm.toFixed(1) }} ~ {{ pc.rollToMm.toFixed(1) }}</b><span v-if="pc.gapBeforeMm" class="gap">（前空让 {{ pc.gapBeforeMm.toFixed(1) }}）</span><span v-if="pc.headSkipMm" class="gap">（起头 {{ pc.headSkipMm.toFixed(1) }}）</span></td>
                    <td class="mono">{{ pc.cutLengthMm.toFixed(1) }}</td>
                    <td class="mono">{{ pc.cutHeightMm.toFixed(1) }}</td>
                    <td class="mono">{{ pc.phaseStartMm.toFixed(1) }} / {{ (pc.phaseStartRatio * 100).toFixed(2) }}%</td>
                    <td class="mono">
                      {{ pc.seam.label }}
                      <b :class="{ bad: !sealed(pc.seam.mismatchBottomMm) || !sealed(pc.seam.mismatchTopMm) }">
                        {{ pc.seam.mismatchBottomMm.toFixed(1) }} · {{ pc.seam.mismatchTopMm.toFixed(1) }}
                      </b>
                      <span v-if="pc.closing" class="lap-tag">含合围搭接 +{{ p.lapMm }}mm</span>
                    </td>
                    <td class="marks">
                      <ol>
                        <li v-for="(m, mi) in pc.marksMm" :key="mi" :class="m.kind">{{ m.label }}</li>
                      </ol>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </article>
          <p class="boundary">{{ plan.boundaryNote }}</p>
        </div>

        <!-- 盖片 -->
        <div v-if="plan.caps.length" class="caps">
          <h4>顶 / 底盖（不参与围向对花，随同一卷排幅宽）</h4>
          <table>
            <thead><tr><th>盖片</th><th>颜色</th><th>幅宽排</th><th>卷上起点 (mm)</th><th>卷上终点 (mm)</th><th>下刀长 × 幅宽向 (mm)</th></tr></thead>
            <tbody>
              <tr v-for="c in plan.caps" :key="c.panelId">
                <td>{{ c.label }}</td><td><span class="cbox" :style="{ background: c.color }" /></td>
                <td class="mono">第{{ c.shelfIndex + 1 }}排</td>
                <td class="mono">{{ c.rollFromMm.toFixed(1) }}</td><td class="mono">{{ c.rollToMm.toFixed(1) }}</td>
                <td class="mono">{{ c.cutLengthMm.toFixed(1) }} × {{ c.cutCrossMm.toFixed(1) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 存档 / 三处变化 / 导出 -->
        <div class="archive">
          <h4>本机灯样存档 · 这一版的周期与花位</h4>
          <div class="arch-row">
            <input v-model="archiveNote" placeholder="本版备注（如：首批 20 个，花位放正面）" />
            <label class="ck"><input type="checkbox" v-model="markIssued" /> 已导出并发送作坊（作废时要追清单/备料单）</label>
            <button @click="doArchive">存档本版（签名 {{ plan.signature.slice(0, 8) }}）</button>
            <button @click="exportWorkshop">导给作坊：裁片清单 CSV</button>
            <button @click="exportPanels">蒙面裁片清单 CSV</button>
          </div>

          <div v-if="latestActive" class="arch-state">
            <span>当前存档版：v{{ latestActive.version }} / {{ latestActive.repeatMm }}mm 周期 / 偏移 {{ latestActive.offsetMm }}mm / {{ latestActive.priority === 'match' ? '保花纹' : '保布头' }} / {{ latestActive.savedAt.slice(0, 16).replace('T', ' ') }}</span>
            <span :class="{ issued: latestActive.issuedToWorkshop }">{{ latestActive.issuedToWorkshop ? '已发作坊' : '未发作坊' }}</span>
            <button v-if="!latestActive.issuedToWorkshop" @click="markWorkshop">标记已发作坊</button>
            <b v-if="dirty" class="dirty">当前参数已偏离存档版（未存档变化不允许直接发作坊）</b>
          </div>

          <div v-if="lastRecord && lantern.patternVersions.length" class="history">
            <details>
              <summary>历史版本（{{ lantern.patternVersions.length }}）</summary>
              <ol class="hist-list">
                <li v-for="rec in [...lantern.patternVersions].reverse()" :key="rec.version" :class="{ voided: rec.voided }">
                  <b>v{{ rec.version }}</b> {{ rec.repeatMm }}mm / 偏 {{ rec.offsetMm }}mm / {{ rec.priority === 'match' ? '保花纹' : '保布头' }}
                  <span>{{ rec.savedAt.slice(0, 16).replace('T', ' ') }}</span>
                  <em v-if="rec.issuedToWorkshop">已发作坊</em>
                  <em v-if="rec.voided" class="void-tag">已作废：{{ rec.voidReason }}｜重裁 {{ (rec.reCutPieces || []).join('、') || '—' }}</em>
                  <span v-else>{{ rec.note }}</span>
                </li>
              </ol>
            </details>
          </div>

          <div v-if="diff.changed" class="diff">
            <h4>改一次周期/花位：三处各自变了什么（同源签名 {{ diff.signatureBefore.slice(0, 8) }} → {{ diff.signatureAfter.slice(0, 8) }}）</h4>
            <p class="diff-sum">{{ diff.summary }}</p>
            <div class="diff-cols">
              <div>
                <h5>蒙面裁片页（{{ diff.panels.length }} 片下刀段与对位标记变）</h5>
                <ol><li v-for="(d, i) in diff.panels" :key="'a' + i"><b>{{ d.label }}</b>：{{ d.before }} → {{ d.after }}<span>{{ d.detail }}</span></li></ol>
              </div>
              <div>
                <h5>材料页（{{ diff.materials.length }} 项材料与米数变）</h5>
                <ol><li v-for="(d, i) in diff.materials" :key="'b' + i"><b>{{ d.label }}</b>：{{ d.before }} → {{ d.after }}<span>{{ d.detail }}</span></li></ol>
              </div>
              <div>
                <h5>作坊裁片清单（{{ diff.sheets.length }} 行跟着换）</h5>
                <ol><li v-for="(d, i) in diff.sheets" :key="'c' + i"><b>{{ d.label }}</b>：{{ d.before }} → {{ d.after }}<span>{{ d.detail }}</span></li></ol>
              </div>
            </div>
          </div>
        </div>
      </template>
    </template>
  </section>
</template>

<style scoped>
.pat {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 14px 16px;
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pat-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.pat-head h3 {
  margin: 0;
  font-size: 15px;
  color: #8f1c19;
  border-left: 4px solid var(--red);
  padding-left: 10px;
}

.enable {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 13px;
}

.hint {
  margin: 0;
  font-size: 12.5px;
  color: var(--ink-soft);
}

.inputs {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 10px 14px;
}

.f {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.f label {
  font-size: 11.5px;
  color: var(--ink-soft);
}

.f input,
.f select {
  font: inherit;
  font-size: 13px;
  font-family: var(--mono);
  padding: 5px 8px;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
}

.f.route .seg {
  display: flex;
  gap: 6px;
}

.seg button {
  flex: 1;
  font-size: 12px;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid var(--line-strong);
  background: var(--surface-2);
  cursor: pointer;
}

.seg button.on {
  background: var(--red);
  color: #fff;
  border-color: var(--red);
  font-weight: 600;
}

.invalid {
  margin: 0;
  color: #b3241f;
  background: #fbeae6;
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 13px;
}

.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 1px;
  background: var(--line);
  border: 1px solid var(--line);
  border-radius: 8px;
  overflow: hidden;
}

.st {
  background: var(--surface);
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.st span {
  font-size: 11px;
  color: var(--ink-soft);
}

.st b {
  font-family: var(--mono);
  font-size: 14px;
}

.st b.match {
  color: #2f7a63;
}

.st b.cloth {
  color: #b07c18;
}

.st b.bad {
  color: #b3241f;
}

.st.sig b {
  font-size: 12px;
  letter-spacing: 0.5px;
}

.warnbox,
.void-warn {
  background: #fbeae6;
  border: 1px solid #e2b4ad;
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 12.5px;
}

.warnbox ul {
  margin: 6px 0 0;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.concessions,
.cost,
.layers,
.caps,
.archive {
  border-top: 1px dashed var(--line);
  padding-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.concessions h4,
.cost h4,
.layers h4,
.caps h4,
.archive h4,
.diff h4 {
  margin: 0;
  font-size: 13.5px;
}

.conc {
  background: var(--surface-2);
  border-radius: 8px;
  padding: 8px 12px;
}

.conc-t {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 13px;
}

.conc button,
.arch-row button,
.arch-state button,
.void-warn button {
  font: inherit;
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--line-strong);
  background: var(--surface);
  cursor: pointer;
}

.conc button:hover,
.arch-row button:hover,
.arch-state button:hover {
  border-color: var(--red);
  color: var(--red);
}

.conc p {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--ink-soft);
}

.cost-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

@media (max-width: 760px) {
  .cost-grid {
    grid-template-columns: 1fr;
  }
}

.cost-grid > div {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--ink-soft);
}

.cost-grid > div.active {
  border-color: var(--red);
  background: #fff7f5;
}

.cost-grid b {
  font-size: 13px;
  color: #5a3020;
}

.void-warn {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
}

button.danger {
  background: var(--red);
  color: #fff;
  border-color: var(--red);
  font-weight: 600;
}

.layer {
  border: 1px solid var(--line);
  border-radius: 8px;
  overflow: hidden;
}

.layer.sealed {
  border-left: 3px solid #2f7a63;
}

.layer.open {
  border-left: 3px solid #b3241f;
}

.layer > header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  background: var(--surface-2);
  flex-wrap: wrap;
}

.tri {
  font-size: 10px;
  color: var(--ink-soft);
}

.l-meta {
  font-size: 12px;
  color: var(--ink-soft);
  font-family: var(--mono);
}

.l-meta b.bad,
td b.bad {
  color: #b3241f;
}

.accepted {
  color: #b07c18;
  font-style: normal;
}

.cbox {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 3px;
  border: 1px solid var(--line-strong);
}

.pieces {
  padding: 8px 10px;
  overflow-x: auto;
}

.pieces table,
.caps table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.pieces th,
.caps th {
  text-align: left;
  font-size: 11px;
  color: var(--ink-soft);
  font-weight: 500;
  padding: 5px 8px;
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
}

.pieces td,
.caps td {
  padding: 5px 8px;
  border-bottom: 1px dashed var(--line);
  vertical-align: top;
}

tr.closing {
  background: #fff7f5;
}

.mono {
  font-family: var(--mono);
}

.gap,
.lap-tag {
  display: inline-block;
  font-size: 11px;
  color: #b07c18;
  margin-left: 4px;
}

.marks ol {
  margin: 0;
  padding-left: 16px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.marks li {
  font-size: 11.5px;
}

.marks li.lap {
  color: #b3241f;
}

.boundary {
  margin: 0;
  font-size: 12px;
  color: var(--ink-soft);
  background: var(--surface-2);
  border-radius: 6px;
  padding: 8px 12px;
}

.arch-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.arch-row input {
  flex: 1;
  min-width: 220px;
  font: inherit;
  font-size: 12.5px;
  padding: 5px 10px;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
}

.ck {
  font-size: 12px;
  color: var(--ink-soft);
  display: flex;
  gap: 4px;
  align-items: center;
}

.arch-state {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  font-size: 12.5px;
  font-family: var(--mono);
}

.arch-state .issued {
  color: #2f7a63;
}

.arch-state b.dirty {
  color: #b3241f;
}

.hist-list {
  margin: 6px 0 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}

.hist-list li.voided {
  opacity: 0.65;
  text-decoration: line-through;
}

.void-tag {
  display: block;
  text-decoration: none;
  color: #b3241f;
  font-style: normal;
}

.diff-cols {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 10px;
}

@media (max-width: 980px) {
  .diff-cols {
    grid-template-columns: 1fr;
  }
}

.diff-cols > div {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 8px 10px;
}

.diff-cols h5 {
  margin: 0 0 6px;
  font-size: 12px;
  color: #8f1c19;
}

.diff-cols ol {
  margin: 0;
  padding-left: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 11.5px;
}

.diff-cols li span {
  display: block;
  color: var(--ink-soft);
}

.diff-sum {
  margin: 0;
  font-size: 12.5px;
  color: #8f1c19;
}
</style>
