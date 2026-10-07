<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ChecksPanel from '../components/ChecksPanel.vue'
import { getLantern, bumpPatternVersion, issuePatternPlan } from '../core/store'
import { computeAll } from '../core/checks'
import { DEFAULT_LOFT_OPTIONS } from '../core/paginate'
import { diffAgainstIssued, patternSignature, stockStatus } from '../core/pattern'
import { downloadText, panelsCsv, materialsCsv } from '../core/exporter'

const route = useRoute()
const router = useRouter()
const lantern = computed(() => getLantern(route.params.id as string))
const full = computed(() => {
  const l = lantern.value
  if (!l) return null
  return computeAll(l, { ...DEFAULT_LOFT_OPTIONS, paper: l.pageSize, overlapMm: l.overlapMm })
})
const plan = computed(() => full.value?.pattern ?? null)
const p = computed(() => lantern.value?.pattern)

const diff = computed(() => {
  if (!plan.value || !p.value?.issued) return null
  return diffAgainstIssued(plan.value, p.value.issued)
})
const issuedStale = computed(() => !!p.value?.issued && !!diff.value?.invalid)

function onParamChange(fn: () => void) {
  if (!lantern.value) return
  fn()
  bumpPatternVersion(lantern.value)
}

function toggleEnabled(e: Event) {
  if (!lantern.value) return
  const v = (e.target as HTMLInputElement).checked
  lantern.value.pattern.enabled = v
  bumpPatternVersion(lantern.value)
}

function publish() {
  if (!lantern.value) return
  issuePatternPlan(lantern.value)
}

function exportPanelsCsv() {
  if (!lantern.value || !full.value || !plan.value) return
  downloadText(`${lantern.value.name}-裁片清单-对花取料v${plan.value.version}.csv`, panelsCsv(lantern.value, full.value.panels.panels, plan.value))
}
function exportMaterialsCsv() {
  if (!lantern.value || !full.value || !plan.value) return
  downloadText(`${lantern.value.name}-备料单-对花取料v${plan.value.version}.csv`, materialsCsv(lantern.value, full.value.materials, full.value.batch, plan.value))
}

const layerGroups = computed(() => {
  if (!plan.value) return []
  return plan.value.layers.map((L) => ({
    layer: L,
    segs: plan.value!.segments.filter((s) => s.layer === L.layer)
  }))
})

const stockRows = computed(() => {
  if (!plan.value || !lantern.value) return []
  return plan.value.tallies.map((t) => {
    const stock = lantern.value!.pattern.stockByColor[t.color]
    return {
      ...t,
      stockMm: stock ?? null,
      status: stockStatus(t, stock, plan.value!.batchCount, plan.value!.wasteRatio)
    }
  })
})

/**
 * 几何/分层/棱数/等分数（在参数页改）也会改取料指纹：
 * 指纹里与「周期、花位、公差、路线、幅宽」无关的几何部分变了，同样作废一版。
 */
const geometrySig = computed(() => {
  const l = lantern.value
  if (!l) return ''
  // signature = 几何@...@缝份@搭接@幅宽@周期@花位@公差@路线；截到搭接之前 = 纯几何
  return patternSignature(l).split('@').slice(0, 5).join('@')
})
watch(geometrySig, (nv, ov) => {
  const l = lantern.value
  if (l && ov && nv !== ov && l.pattern.enabled) bumpPatternVersion(l)
})
</script>

<template>
  <div v-if="!lantern || !full || !plan || !p" class="missing">找不到该灯样。<router-link to="/">返回</router-link></div>
  <div v-else class="pv">
    <section class="head">
      <div>
        <h2>按花纹周期取料（绸布对花） · {{ lantern.name }}</h2>
        <p class="sub">
          长度一律 <b>mm</b>、偏差保留 <b>1 位小数</b>；花位偏移先按 mm 算再换算周期比。
          每层展开周长走<b>轮廓 + 棱长年周长</b>那一路（多边形 n×棱长 / 圆 2πR），
          缝份与闭合搭接已一起算进下刀位置，不拿图上量的数凑。
          蒙面裁片页、材料页、作坊裁片清单三处取的是<b>同一份结果</b>。
        </p>
      </div>
      <div class="ops">
        <button @click="exportPanelsCsv">导出作坊裁片清单 CSV</button>
        <button @click="exportMaterialsCsv">导出备料单 CSV</button>
        <button class="primary" @click="router.push(`/panels/${lantern.id}`)">去蒙面裁片页核对</button>
      </div>
    </section>

    <!-- 作废横幅 -->
    <section v-if="issuedStale && diff" class="void-banner">
      <h3>第 v{{ p.issued?.version }} 版已整版作废（当前 v{{ plan.version }}）</h3>
      <p>
        旧版取料结果、已导出的裁片清单与已发给作坊的备料单一并作废；
        按旧版已下过刀的 <b>{{ diff.recutCount }} 片</b>布要重裁
        （<span v-for="(r, i) in diff.recutRows.slice(0, 6)" :key="i">{{ r }}；</span><span v-if="diff.recutRows.length > 6">等 {{ diff.recutRows.length }} 片</span>）；
        旧版对位标记与拼缝次序随之失效。
      </p>
      <ul>
        <li v-if="diff.changedPanels.length">
          裁片页：{{ diff.changedPanels.length }} 片面板的下刀段/对位标记变了
          <details>
            <summary>展开</summary>
            <table class="mini">
              <tr v-for="(c, i) in diff.changedPanels" :key="i">
                <td>第 {{ c.layer }} 层第 {{ c.piece }} 片</td>
                <td class="old">{{ c.oldSeg }}</td>
                <td>→</td>
                <td class="new">{{ c.newSeg }}</td>
              </tr>
            </table>
          </details>
        </li>
        <li v-if="diff.changedMaterials.length">
          材料页：{{ diff.changedMaterials.length }} 项用布量变了
          <span v-for="(m, i) in diff.changedMaterials" :key="i">
            <span class="swatch" :style="{ background: m.color }" />{{ m.color }}：{{ m.oldMm.toFixed(1) }} → {{ m.newMm.toFixed(1) }}mm；
          </span>
        </li>
        <li>清单：跟着换的行 = 上述 {{ diff.changedRows.length }} 行（层-片）。</li>
      </ul>
      <button class="danger" @click="publish">确认重发作坊：发布当前 v{{ plan.version }} 版</button>
    </section>

    <section class="params card">
      <label class="enable">
        <input type="checkbox" :checked="p.enabled" @change="toggleEnabled" />
        <b>启用按花纹周期取料</b>
      </label>
      <template v-if="plan.enabled">
        <div v-if="!plan.supported" class="warn">{{ plan.unsupportedReason }}</div>
        <template v-else>
          <div class="grid">
            <div class="field">
              <label>布幅宽 (mm)</label>
              <input
                type="number"
                min="200"
                step="10"
                :value="p.fabricWidthMm"
                @change="(e) => onParamChange(() => ((lantern!.pattern.fabricWidthMm = Math.max(1, Number((e.target as HTMLInputElement).value) || 0))))"
              />
            </div>
            <div class="field">
              <label>花纹一个循环长度（周期，mm）</label>
              <input
                type="number"
                min="1"
                step="1"
                :value="p.repeatMm"
                @change="(e) => onParamChange(() => ((lantern!.pattern.repeatMm = Math.max(1, Number((e.target as HTMLInputElement).value) || 1))))"
              />
            </div>
            <div class="field">
              <label>花位偏移（刀口0距循环原点，mm）</label>
              <input
                type="number"
                step="1"
                :value="p.phaseOffsetMm"
                @change="(e) => onParamChange(() => ((lantern!.pattern.phaseOffsetMm = Number((e.target as HTMLInputElement).value) || 0)))"
              />
            </div>
            <div class="field">
              <label>对花公差 (mm)</label>
              <input
                type="number"
                min="0"
                step="0.5"
                :value="p.toleranceMm"
                @change="(e) => onParamChange(() => ((lantern!.pattern.toleranceMm = Math.max(0, Number((e.target as HTMLInputElement).value) || 0))))"
              />
            </div>
            <div class="field">
              <label>缝份 / 闭合搭接（mm，随灯样）</label>
              <input :value="`${plan.seamAllowanceMm} / ${lantern.overlapMm}`" readonly />
            </div>
            <div class="field">
              <label>路线（二选一，不可兼得）</label>
              <select
                :value="p.strategy"
                @change="(e) => onParamChange(() => ((lantern!.pattern.strategy = (e.target as HTMLSelectElement).value as 'match' | 'save')))"
              >
                <option value="match">先保花纹严丝合缝（让布）</option>
                <option value="save">先保布头不浪费（让工）</option>
              </select>
            </div>
          </div>

          <div class="ver">
            <span>取料版次 <b>v{{ plan.version }}</b></span>
            <span v-if="p.issued && !issuedStale" class="ok">已发布 v{{ p.issued.version }}（{{ new Date(p.issued.issuedAt).toLocaleString() }}），三处清单同源生效中</span>
            <span v-else-if="p.issued && issuedStale" class="bad">已发布的 v{{ p.issued.version }} 已过期作废</span>
            <span v-else class="muted">尚未发给作坊</span>
            <button class="primary" @click="publish">{{ p.issued && !issuedStale ? '重新发布当前版' : '发布当前版给作坊' }}</button>
          </div>
        </template>
      </template>
    </section>

    <template v-if="plan.enabled && plan.supported">
      <section v-if="plan.deadEnd" class="deadend">{{ plan.deadEnd }}</section>

      <section class="card tradeoff">
        <h3>两条路的代价（这笔账摆明）</h3>
        <p>{{ plan.tradeoffNote }}</p>
        <div class="kv">
          <span>当前路线为对花让出布头：<b>{{ plan.extraClothTotalMm.toFixed(1) }} mm</b></span>
          <span>认下错花缝：<b>{{ plan.errorSeamCount }} 道</b>（折返工 {{ plan.reworkMinutes }} 分钟）</span>
          <span>「布头不浪费」是否还有对花余地：<b :class="plan.saveFeasible ? 'ok' : 'bad'">{{ plan.saveFeasible ? '有' : '无（内缝折边错位已超公差）' }}</b></span>
        </div>
      </section>

      <!-- 逐层余数与让步 -->
      <section class="card">
        <h3>逐层对花账：周长 ÷ 周期 的余数逐层累加</h3>
        <p class="hint">
          「进位原值」是同色各层周长余数的毫米级累计（不取整、不抹零）；「进位花位」是它模周期后的值与周期比。
          半朵花 = 周期/2 = {{ (plan.repeatMm / 2).toFixed(1) }}mm，视觉错位以半朵花为界取 min(余数, 周期−余数)。
        </p>
        <table class="layers">
          <thead>
            <tr>
              <th>层</th>
              <th class="num">实际周长(mm)</th>
              <th class="num">片数</th>
              <th class="num">整周期</th>
              <th class="num">余数(mm)</th>
              <th class="num">进位原值(mm)</th>
              <th class="num">进位花位(mm/比例)</th>
              <th class="num">闭合缝视觉错(mm)</th>
              <th>偏差落在哪条缝</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="L in plan.layers" :key="L.layer">
              <td><span class="swatch" :style="{ background: L.color }" />第 {{ L.layer }} 层</td>
              <td class="num mono">{{ L.perimeterMm.toFixed(1) }}<span class="dim">（顶圈 {{ L.perimeterTopMm.toFixed(1) }}）</span></td>
              <td class="num mono">{{ L.pieces }}</td>
              <td class="num mono">{{ L.fullRepeats }}</td>
              <td class="num mono" :class="{ bad: !L.closureMatched }">{{ L.remainderMm.toFixed(1) }}</td>
              <td class="num mono">{{ L.carriedRawMm.toFixed(1) }}</td>
              <td class="num mono">{{ L.carriedPhaseMm.toFixed(1) }} / {{ L.carriedPhaseRatio.toFixed(3) }}</td>
              <td class="num mono" :class="L.closureMatched ? 'ok' : 'bad'">
                {{ L.closureErrorMm.toFixed(1) }}{{ L.closureMatched ? ' ✓' : '' }}
                <span class="dim">（save {{ L.saveClosureErrorMm.toFixed(1) }}）</span>
              </td>
              <td class="dim">{{ L.errorSeam }}</td>
            </tr>
          </tbody>
        </table>
        <div v-for="L in plan.layers" :key="'c' + L.layer" class="concessions">
          <h4>第 {{ L.layer }} 层的让步办法与界线 <span class="dim">（周长随高度 {{ L.perimeterSlope.toFixed(1) }}mm/mm · 片含缝刀宽 {{ L.cutPieceMm.toFixed(1) }}mm · 片高含缝 {{ L.cutHeightMm.toFixed(1) }}mm <span :class="L.widthFits ? 'ok' : 'bad'">{{ L.widthFits ? '排得进布幅' : '超出布幅！' }}</span>）</span></h4>
          <ol>
            <li v-for="(c, i) in L.concessions" :key="i" :class="{ highlight: i === 0 && !L.closureMatched }">{{ c }}</li>
          </ol>
        </div>
      </section>

      <!-- 每片下刀段 -->
      <section class="card">
        <h3>每片下刀段与对位标记（蒙面裁片页 / 作坊清单同源同数）</h3>
        <div v-for="g in layerGroups" :key="g.layer.layer" class="layer-block">
          <h4>
            第 {{ g.layer.layer }} 层 ·
            周长 {{ g.layer.perimeterMm.toFixed(1) }}mm =
            {{ g.layer.pieces }} 片 × 净宽 {{ g.layer.rawPieceMm.toFixed(1) }}mm
            （刀口宽 {{ g.layer.cutPieceMm.toFixed(1) }}mm = 净宽 + 缝份 {{ plan.seamAllowanceMm.toFixed(1) }}×2，闭合搭接 {{ g.layer.overlapMm.toFixed(1) }}mm 另加）
          </h4>
          <table class="cuts">
            <thead>
              <tr>
                <th class="num">片</th>
                <th class="num">下刀起点(mm)</th>
                <th class="num">下刀终点(mm)</th>
                <th class="num">刀长(mm)</th>
                <th class="num">入口花位(mm)</th>
                <th class="num">周期比</th>
                <th class="num">出口花位(mm)</th>
                <th class="num">视觉错(mm)</th>
                <th>对位标记 / 拼缝次序</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in g.segs" :key="s.piece" :class="{ err: s.isErrorSeam }">
                <td class="num mono">{{ s.piece }}</td>
                <td class="num mono">{{ s.startMm.toFixed(1) }}</td>
                <td class="num mono">{{ s.endMm.toFixed(1) }}</td>
                <td class="num mono">{{ s.lengthMm.toFixed(1) }}</td>
                <td class="num mono">{{ s.phaseStartMm.toFixed(1) }}</td>
                <td class="num mono">{{ s.phaseStartRatio.toFixed(3) }}</td>
                <td class="num mono">{{ s.phaseEndMm.toFixed(1) }}</td>
                <td class="num mono" :class="s.isErrorSeam ? 'bad' : 'ok'">{{ s.seamErrorMm.toFixed(1) }}</td>
                <td class="marks">
                  <span v-for="(m, i) in s.matchMarks" :key="i" class="mark">{{ m }}</span>
                </td>
              </tr>
              <tr class="sum">
                <td colspan="3">净段首尾相接（剥掉缝份）</td>
                <td class="num mono">{{ g.segs.reduce((a, x) => a + (x.lengthMm - plan!.seamAllowanceMm * 2), 0).toFixed(1) }}</td>
                <td colspan="5">应 = 该层实际周长 {{ g.layer.perimeterMm.toFixed(1) }}mm（CHK-09 自动核对）</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- 各色布够不够 -->
      <section class="card">
        <h3>各色绸布用多少、够不够裁（材料页同源）</h3>
        <table class="stock">
          <thead>
            <tr>
              <th>颜色</th>
              <th class="num">涉及层</th>
              <th class="num">幅宽(mm)</th>
              <th class="num">单灯下刀总长(mm)</th>
              <th class="num">其中对花让出(mm)</th>
              <th class="num">用布(m²)</th>
              <th class="num">批量×损耗需(mm)</th>
              <th class="num">手头库存(mm)</th>
              <th class="num">够不够 / 差(mm)</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in stockRows" :key="r.color">
              <td><span class="swatch" :style="{ background: r.color }" />{{ r.color }}</td>
              <td class="num mono">{{ r.layers.join('/') }}</td>
              <td class="num mono">{{ r.fabricWidthMm.toFixed(1) }}</td>
              <td class="num mono strong">{{ r.usedMm.toFixed(1) }}</td>
              <td class="num mono">{{ r.extraForMatchMm.toFixed(1) }}</td>
              <td class="num mono">{{ r.usedM2.toFixed(3) }}</td>
              <td class="num mono">{{ r.status.needMm.toFixed(1) }}</td>
              <td class="num">
                <input
                  type="number"
                  min="0"
                  step="10"
                  placeholder="未填"
                  :value="r.stockMm ?? ''"
                  @change="(e) => { const v = Number((e.target as HTMLInputElement).value) || 0; lantern!.pattern.stockByColor[r.color] = v }"
                />
              </td>
              <td class="num mono" :class="r.stockMm == null ? 'dim' : r.status.enough ? 'ok' : 'bad'">
                {{ r.stockMm == null ? '填库存后判定' : r.status.enough ? '够裁' : `不够，差 ${r.status.shortMm.toFixed(1)}` }}
              </td>
            </tr>
          </tbody>
        </table>
        <p class="hint">批量 {{ plan.batchCount }} 个、损耗 {{ (plan.wasteRatio * 100).toFixed(0) }}%；需 = 单灯下刀总长 × 批量 × (1+损耗)。</p>
      </section>

      <ChecksPanel
        :checks="full.checks.filter((c) => c.id === 'CHK-09')"
        :elapsed-ms="full.elapsedMs"
        title="取料守恒自检（净段闭合 / 相位累加 / 三处同源）"
      />
    </template>
  </div>
</template>

<style scoped>
.pv { display: flex; flex-direction: column; gap: 16px; }
.head { display: flex; gap: 16px; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; }
h2 { margin: 0 0 6px; font-size: 18px; color: #8f1c19; border-left: 4px solid var(--red); padding-left: 10px; }
.sub { margin: 0; font-size: 12.5px; color: var(--ink-soft); max-width: 980px; }
.ops { display: flex; gap: 8px; flex-wrap: wrap; }
button { font: inherit; cursor: pointer; border-radius: 6px; border: 1px solid var(--line-strong); background: var(--surface-2); padding: 6px 12px; font-size: 12.5px; }
button:hover { border-color: var(--red); color: var(--red); }
button.primary { background: var(--red); border-color: var(--red); color: #fff; font-weight: 600; }
button.primary:hover { background: #9c1f1b; color: #fff; }
button.danger { background: #7a1f1a; border-color: #7a1f1a; color: #fff; font-weight: 600; margin-top: 8px; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 12px 16px; box-shadow: var(--shadow); }
.card h3 { margin: 0 0 8px; font-size: 14px; }
.params .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 10px 16px; margin: 10px 0; }
.field { display: flex; flex-direction: column; gap: 4px; }
.field label { font-size: 12px; color: var(--ink-soft); }
input, select { font: inherit; font-size: 13px; padding: 5px 8px; border: 1px solid var(--line-strong); border-radius: 6px; font-family: var(--mono); }
input[readonly] { background: var(--surface-2); color: var(--ink-soft); }
.enable { display: flex; gap: 8px; align-items: center; font-size: 14px; }
.ver { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; font-size: 12.5px; border-top: 1px dashed var(--line); padding-top: 10px; }
.ver .ok { color: var(--jade); font-weight: 600; }
.ver .bad { color: var(--red); font-weight: 600; }
.ver .muted { color: var(--ink-soft); }
.ok { color: var(--jade); }
.bad { color: var(--red); }
.dim { color: var(--ink-soft); font-weight: 400; }
.warn { background: #fff4e5; border: 1px solid #e0b070; border-radius: 8px; padding: 8px 12px; margin-top: 8px; font-size: 13px; }
.deadend { background: #fbe3df; border: 1px solid var(--red); color: #8f1c19; border-radius: 10px; padding: 12px 16px; font-size: 13.5px; font-weight: 600; }
.tradeoff .kv { display: flex; gap: 20px; flex-wrap: wrap; font-size: 12.5px; }
.tradeoff p { font-size: 12.5px; margin: 4px 0 8px; }
.void-banner { background: #fbe3df; border: 2px solid var(--red); border-radius: 10px; padding: 12px 16px; }
.void-banner h3 { margin: 0 0 6px; color: #8f1c19; font-size: 15px; }
.void-banner p { margin: 0 0 8px; font-size: 13px; }
.void-banner ul { margin: 0; padding-left: 20px; font-size: 12.5px; }
.void-banner details { margin: 4px 0; }
table.mini { border-collapse: collapse; margin: 6px 0; font-size: 11.5px; width: 100%; }
table.mini td { border: 1px solid var(--line); padding: 3px 6px; }
table.mini .old { color: var(--ink-soft); text-decoration: line-through; }
table.layers, table.cuts, table.stock { width: 100%; border-collapse: collapse; font-size: 12px; }
th { text-align: left; color: var(--ink-soft); font-weight: 500; font-size: 11.5px; padding: 6px 8px; border-bottom: 1px solid var(--line); }
td { padding: 5px 8px; border-bottom: 1px dashed var(--line); vertical-align: top; }
.num { text-align: right; }
.mono { font-family: var(--mono); }
.swatch { display: inline-block; width: 11px; height: 11px; border-radius: 2px; border: 1px solid var(--line-strong); margin-right: 5px; vertical-align: -1px; }
.hint { font-size: 11.5px; color: var(--ink-soft); margin: 6px 0 0; }
.concessions { border-top: 1px dashed var(--line); margin-top: 8px; padding-top: 6px; }
.concessions h4 { margin: 4px 0; font-size: 12.5px; }
.concessions ol { margin: 4px 0; padding-left: 20px; font-size: 12px; }
.concessions li.highlight { color: #8f1c19; font-weight: 600; }
.layer-block { border-top: 2px solid var(--line); padding-top: 8px; margin-top: 10px; }
.layer-block h4 { margin: 4px 0; font-size: 12.5px; }
table.cuts tr.err td { background: #fdf0ec; }
table.cuts tr.sum td { background: var(--surface-2); font-size: 11.5px; }
.marks { display: flex; flex-direction: column; gap: 2px; }
.mark { font-size: 11px; color: var(--ink-soft); }
tr.err .mark { color: #8f1c19; }
.strong { font-weight: 700; color: #8f1c19; }
.missing { padding: 40px; text-align: center; }
</style>
