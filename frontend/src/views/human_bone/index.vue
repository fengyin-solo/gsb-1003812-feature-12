<template>
  <section class="page" data-module="human_bone">
    <header class="page-head">
      <div>
        <h2>人骨鉴定管理</h2>
        <p class="page-desc">鉴定席位分权：采集单位登记标本并安排送鉴，鉴定人完成性别、年龄与病理判定，复核人最终确认；确认后库房管理自动生成标本入库事项。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openRegister">登记人骨标本</button>
        <button class="btn" type="button" @click="exportRows">导出人骨鉴定清单</button>
      </div>
    </header>

    <div class="seat-bar">
      <span class="seat-label">当前鉴定席位：</span>
      <button
        v-for="option in seatOptions"
        :key="option.role"
        class="btn"
        :class="{ primary: session.seat === option.role }"
        type="button"
        @click="session.setSeat(option.role)"
      >
        {{ option.label }}
      </button>
      <label class="seat-field">
        <span>席位人</span>
        <input v-model="session.activeSeatProfile.name" placeholder="席位人姓名" />
      </label>
      <label class="seat-field">
        <span>所属单位</span>
        <input v-model="session.activeSeatProfile.unit" placeholder="席位所属单位" />
      </label>
      <span class="seat-hint">{{ seatHint }}</span>
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
          <td v-for="column in columns" :key="column">{{ cellText(row, column) }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <template v-if="rowActions(row).length">
              <button
                v-for="action in rowActions(row)"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
            </template>
            <span v-else>—</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无人骨鉴定数据，可由采集单位席位登记人骨标本</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条人骨鉴定记录</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="registerOpen" class="modal-mask" @click.self="registerOpen = false">
      <div class="modal-card">
        <h3>登记人骨标本</h3>
        <p class="modal-desc">采集单位席位登记新标本，标本编号自动生成，采集单位取当前席位所属单位。</p>
        <label class="modal-field">
          <span>出土单位 *</span>
          <input v-model="registerForm.出土单位" placeholder="如 T0101探方 / M3墓葬" />
        </label>
        <label class="modal-field">
          <span>鉴定部位（可留空）</span>
          <input v-model="registerForm.鉴定部位" placeholder="旧标本可留空，鉴定环节再补录" />
        </label>
        <p class="modal-desc">采集单位：{{ session.activeSeatProfile.unit || '（未填写）' }}</p>
        <p v-if="modalError" class="error-text">{{ modalError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="registerOpen = false">取消</button>
          <button class="btn primary" type="button" @click="submitRegister">确认登记</button>
        </div>
      </div>
    </div>

    <div v-if="identifyTarget" class="modal-mask" @click.self="identifyTarget = null">
      <div class="modal-card">
        <h3>提交鉴定 · {{ identifyTarget.标本编号 }}</h3>
        <p class="modal-desc">鉴定人席位填写判定结论；性别判定与年龄范围冲突时保留年龄范围结论。</p>
        <label class="modal-field">
          <span>性别判定 *</span>
          <select v-model="identifyForm.性别判定">
            <option value="" disabled>请选择</option>
            <option v-for="option in sexOptions" :key="option" :value="option">{{ option }}</option>
          </select>
        </label>
        <label class="modal-field">
          <span>年龄范围 *</span>
          <select v-model="identifyForm.年龄范围">
            <option value="" disabled>请选择</option>
            <option v-for="option in ageOptions" :key="option" :value="option">{{ option }}</option>
          </select>
        </label>
        <label class="modal-field">
          <span>病理特征 *</span>
          <input v-model="identifyForm.病理特征" placeholder="无病变可填「未见明显病理」" />
        </label>
        <label class="modal-field">
          <span>鉴定部位（旧标本可留空）</span>
          <input v-model="identifyForm.鉴定部位" placeholder="缺少鉴定部位的旧标本兼容为空" />
        </label>
        <p v-if="modalError" class="error-text">{{ modalError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="identifyTarget = null">取消</button>
          <button class="btn primary" type="button" @click="submitIdentify">提交鉴定</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  AGE_OPTIONS,
  SEAT_OPTIONS,
  SEX_OPTIONS,
  actionsFor,
  registerSpecimen,
  runIdentificationAction,
} from '@/api/identification'
import { downloadEntries, listEntries, moduleMeta } from '@/api/local-service'
import type { EntryRow, SeatContext } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('human_bone')
const session = useSessionStore()

const columns = ["标本编号", "出土单位", "采集单位", "鉴定部位", "性别判定", "年龄范围", "病理特征", "鉴定人", "复核人"]
const statuses = meta.statuses
const filterFields = ["标本编号", "出土单位", "采集单位"]
const seatOptions = SEAT_OPTIONS
const sexOptions = SEX_OPTIONS
const ageOptions = AGE_OPTIONS

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const modalError = ref('')
const filters = ref<Record<string, string>>({})

const registerOpen = ref(false)
const registerForm = reactive({ 出土单位: '', 鉴定部位: '' })
const identifyTarget = ref<EntryRow | null>(null)
const identifyForm = reactive({ 性别判定: '', 年龄范围: '', 病理特征: '', 鉴定部位: '' })

const stats = computed(() => [
  { label: '标本总数', value: rows.value.length },
  { label: '待鉴定数', value: rows.value.filter((row) => ['已采集', '已送鉴', '鉴定中'].includes(String(row.status))).length },
  { label: '待复核数', value: rows.value.filter((row) => String(row.status) === '已鉴定').length },
  { label: '已复核数', value: rows.value.filter((row) => ['已复核', '已归档'].includes(String(row.status))).length },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const seatHint = computed(
  () => seatOptions.find((item) => item.role === session.seat)?.hint ?? '',
)

function seatContext(): SeatContext {
  return {
    role: session.seat,
    name: session.activeSeatProfile.name,
    unit: session.activeSeatProfile.unit,
  }
}

function cellText(row: EntryRow, column: string) {
  const value = row[column]
  return value === undefined || value === '' ? '—' : value
}

function rowActions(row: EntryRow) {
  return actionsFor(row, session.seat)
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openRegister() {
  registerForm.出土单位 = ''
  registerForm.鉴定部位 = ''
  modalError.value = ''
  registerOpen.value = true
}

function submitRegister() {
  const result = registerSpecimen({ ...registerForm }, seatContext())
  if (!result.ok) {
    modalError.value = result.message
    return
  }
  registerOpen.value = false
  noticeMessage.value = result.message
  errorMessage.value = ''
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  if (action === '提交鉴定') {
    identifyForm.性别判定 = String(row.性别判定 ?? '')
    identifyForm.年龄范围 = String(row.年龄范围 ?? '')
    identifyForm.病理特征 = String(row.病理特征 ?? '')
    identifyForm.鉴定部位 = String(row.鉴定部位 ?? '')
    modalError.value = ''
    identifyTarget.value = row
    return
  }
  const result = runIdentificationAction(action, Number(row.id), seatContext())
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
}

function submitIdentify() {
  if (!identifyTarget.value) {
    return
  }
  const result = runIdentificationAction(
    '提交鉴定',
    Number(identifyTarget.value.id),
    seatContext(),
    { ...identifyForm },
  )
  if (!result.ok) {
    modalError.value = result.message
    return
  }
  identifyTarget.value = null
  noticeMessage.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '人骨鉴定列表读取失败'
  }
}

onMounted(reload)
</script>
