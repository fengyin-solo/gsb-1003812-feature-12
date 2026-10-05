<template>
  <section class="page" data-module="human_bone">
    <header class="page-head">
      <div>
        <h2>人骨鉴定管理</h2>
        <p class="page-desc">采集单位登记标本并安排送鉴；鉴定人完成性别、年龄与病理判定；复核人同单位复核确认，确认后自动生成库房入库事项。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openRegister">登记人骨标本</button>
        <button class="btn" type="button" @click="exportRows">导出人骨鉴定清单</button>
      </div>
    </header>

    <!-- 鉴定席位：当前席位决定能取到的动作，跨席位操作在服务端同样会被拦截。 -->
    <div class="seat-bar">
      <label class="seat-pick">
        <span>当前鉴定席位</span>
        <select :value="store.seatKey" @change="switchSeat(($event.target as HTMLSelectElement).value as SeatKey)">
          <option v-for="seat in SEATS" :key="seat.key" :value="seat.key">
            {{ seat.label }}（{{ seat.unit }}）
          </option>
        </select>
      </label>
      <div class="seat-meta">
        <strong>{{ store.seat.label }}</strong>
        <span>{{ store.seat.description }}</span>
      </div>
    </div>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ displayValue(row, column) }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <template v-if="actionsFor(row).length">
              <button
                v-for="action in actionsFor(row)"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
            </template>
            <span v-else class="muted-text">当前席位无操作</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无人骨鉴定数据，可先登记人骨标本</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条人骨鉴定记录</span>
      <span v-if="notice.kind === 'error'" class="error-text">{{ notice.text }}</span>
      <span v-else-if="notice.kind === 'warning'" class="warning-text">{{ notice.text }}</span>
      <span v-else-if="notice.kind === 'ok'" class="ok-text">{{ notice.text }}</span>
    </footer>

    <!-- 采集单位登记标本：鉴定部位允许留空，兼容旧标本。 -->
    <div v-if="showRegister" class="modal-mask" @click.self="closeDialogs">
      <div class="modal-card">
        <h3>登记人骨标本</h3>
        <p class="modal-hint">登记席位：{{ store.seat.label }} · {{ store.seat.unit }}；标本登记后为「待送鉴」。</p>
        <label class="form-item">
          <span>标本编号 *</span>
          <input v-model="registerForm.specimenId" placeholder="如 HUMA-2026-005" />
        </label>
        <label class="form-item">
          <span>出土单位 *</span>
          <input v-model="registerForm.featureUnit" placeholder="如 M23" />
        </label>
        <label class="form-item">
          <span>采集单位</span>
          <input v-model="registerForm.collectorUnit" :placeholder="`默认取当前席位单位：${store.seatUnit}`" />
        </label>
        <label class="form-item">
          <span>鉴定部位（可空）</span>
          <input v-model="registerForm.bodyPart" placeholder="旧标本/部位缺失时留空" />
        </label>
        <p v-if="dialogError" class="error-text">{{ dialogError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeDialogs">取消</button>
          <button class="btn primary" type="button" @click="submitRegister">登记标本</button>
        </div>
      </div>
    </div>

    <!-- 鉴定人填写性别、年龄、病理。 -->
    <div v-if="showExamine" class="modal-mask" @click.self="closeDialogs">
      <div class="modal-card">
        <h3>鉴定判定 · {{ activeRow?.['标本编号'] }}</h3>
        <p class="modal-hint">鉴定人：{{ store.seat.person }}（{{ store.seat.unit }}）；提交后为「已鉴定」，等待复核。</p>
        <label class="form-item">
          <span>性别判定 *</span>
          <select v-model="examineForm.gender">
            <option value="" disabled>请选择</option>
            <option v-for="option in GENDER_OPTIONS" :key="option" :value="option">{{ option }}</option>
          </select>
        </label>
        <label class="form-item">
          <span>年龄范围 *</span>
          <select v-model="examineForm.ageRange">
            <option value="" disabled>请选择</option>
            <option v-for="option in AGE_OPTIONS" :key="option" :value="option">{{ option }}</option>
          </select>
        </label>
        <label class="form-item">
          <span>病理特征</span>
          <textarea v-model="examineForm.pathology" rows="3" placeholder="如 颈椎骨质增生；无病理可留空"></textarea>
        </label>
        <p class="modal-hint">规则：性别明确（男/女）与未成年年龄（0-12岁）冲突时，保留年龄结论，性别自动调整为「性别待定」。</p>
        <p v-if="dialogError" class="error-text">{{ dialogError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeDialogs">取消</button>
          <button class="btn primary" type="button" @click="submitExamine">提交鉴定</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  AGE_OPTIONS,
  GENDER_OPTIONS,
  availableActions,
  confirmReview,
  listSpecimens,
  registerSpecimen,
  sendForExamination,
  submitExamination,
} from '@/api/human-bone-service'
import { downloadEntries, moduleMeta } from '@/api/local-service'
import { SEATS, useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'
import type { SeatKey } from '@/stores/session'

const meta = moduleMeta('human_bone')
const store = useSessionStore()

// 鉴定部位对旧标本兼容为空：表格与取数都不假定该字段一定存在。
const columns = ["标本编号", "出土单位", "采集单位", "鉴定部位", "性别判定", "年龄范围", "病理特征", "鉴定人", "复核人", "鉴定版本"]
const statuses = ["待送鉴", "鉴定中", "已鉴定", "已复核"]
const filterFields = ["标本编号", "出土单位", "采集单位"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const notice = reactive<{ kind: '' | 'ok' | 'warning' | 'error'; text: string }>({ kind: '', text: '' })
const filters = ref<Record<string, string>>({})

const showRegister = ref(false)
const showExamine = ref(false)
const dialogError = ref('')
const activeRow = ref<EntryRow | null>(null)

const registerForm = reactive({ specimenId: '', featureUnit: '', collectorUnit: '', bodyPart: '' })
const examineForm = reactive({ gender: '', ageRange: '', pathology: '' })

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() => [
  { label: '标本总数', value: rows.value.length },
  { label: '待送鉴', value: countByStatus('待送鉴') },
  { label: '鉴定中', value: countByStatus('鉴定中') },
  { label: '待复核', value: countByStatus('已鉴定') },
  { label: '已复核', value: countByStatus('已复核') },
])

function countByStatus(status: string): number {
  return rows.value.filter((row) => String(row.status) === status).length
}

function displayValue(row: EntryRow, column: string): string {
  const value = row[column]
  if (value === undefined || value === null || String(value) === '') {
    return '—'
  }
  if (column === '鉴定版本') {
    return `v${value}`
  }
  return String(value)
}

function actionsFor(row: EntryRow): string[] {
  return availableActions(String(row.status), store.seat)
}

function switchSeat(key: SeatKey) {
  store.setSeat(key)
  flashMessage(`已切换到「${store.seat.label}」席位`)
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openRegister() {
  if (store.seatRole !== 'collector') {
    flashError('只有采集单位席位可以登记标本')
    return
  }
  Object.assign(registerForm, { specimenId: '', featureUnit: '', collectorUnit: '', bodyPart: '' })
  dialogError.value = ''
  showRegister.value = true
}

function openExamine(row: EntryRow) {
  activeRow.value = row
  Object.assign(examineForm, { gender: '', ageRange: '', pathology: '' })
  dialogError.value = ''
  showExamine.value = true
}

function closeDialogs() {
  showRegister.value = false
  showExamine.value = false
  activeRow.value = null
  dialogError.value = ''
}

function submitRegister() {
  const result = registerSpecimen(registerForm, store.seat)
  if (!result.ok) {
    dialogError.value = result.message
    return
  }
  closeDialogs()
  reload()
  flashMessage(result.message)
}

function submitExamine() {
  if (!activeRow.value) {
    return
  }
  const result = submitExamination(Number(activeRow.value.id), { ...examineForm }, store.seat)
  if (!result.ok) {
    dialogError.value = result.message
    return
  }
  closeDialogs()
  reload()
  flashMessage(result.warning ? result.warning : result.message, result.warning ? 'warning' : 'ok')
}

function runAction(action: string, row: EntryRow) {
  if (action === '提交鉴定') {
    openExamine(row)
    return
  }
  if (action === '复核确认') {
    if (!window.confirm(`确认标本 ${row['标本编号']} 的鉴定结论并最终复核？确认后将生成库房入库事项。`)) {
      return
    }
    applyResult(confirmReview(Number(row.id), store.seat))
    return
  }
  if (action === '安排送鉴') {
    applyResult(sendForExamination(Number(row.id), store.seat))
  }
}

function applyResult(result: ReturnType<typeof confirmReview>) {
  if (!result.ok) {
    flashError(result.message)
    return
  }
  reload()
  flashMessage(result.message)
}

function flashError(message: string) {
  notice.kind = 'error'
  notice.text = message
}

function flashMessage(message: string, kind: 'ok' | 'warning' = 'ok') {
  notice.kind = kind
  notice.text = message
}

function reload() {
  notice.kind = ''
  notice.text = ''
  try {
    const pairs = Object.entries(filters.value).filter(([, value]) => value.trim() !== '')
    const matched = listSpecimens().filter((row) =>
      pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
    )
    rows.value = matched
    total.value = matched.length
  } catch (error) {
    flashError(error instanceof Error ? error.message : '人骨鉴定列表读取失败')
  }
}

onMounted(reload)
</script>

<style scoped>
.seat-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  background: #eef4ff;
  border: 1px solid #c7d9f7;
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
}
.seat-pick {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  color: var(--muted);
}
.seat-pick select {
  min-width: 280px;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.seat-meta {
  display: flex;
  flex-direction: column;
  font-size: 12px;
}
.seat-meta span {
  color: var(--muted);
}
.muted-text {
  color: var(--muted);
  font-size: 12px;
}
.warning-text {
  color: #b54708;
}
.ok-text {
  color: #067647;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.modal-card {
  width: 440px;
  background: #fff;
  border-radius: 10px;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.modal-card h3 {
  margin: 0;
}
.modal-hint {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}
.form-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
}
.form-item input,
.form-item select,
.form-item textarea {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font: inherit;
  color: #1f2937;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}
</style>
