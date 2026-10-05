<template>
  <section class="page" data-module="storage">
    <header class="page-head">
      <div>
        <h2>库房管理管理</h2>
        <p class="page-desc">维护库房架位，围绕架位编号、库房名称、存放器物类别、架位层数做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记库房架位</button>
        <button class="btn" type="button" @click="exportRows">导出库房管理清单</button>
      </div>
    </header>

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
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无库房管理数据，可先登记库房架位</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条库房管理记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 跨模块事项：人骨鉴定复核确认后自动生成，待入库的标本在此落实架位。 -->
    <section class="inbound-block">
      <header class="inbound-head">
        <h3>标本入库事项</h3>
        <span class="page-desc">来源：人骨鉴定复核确认；重复确认只保留一条，待入库 {{ inboundStats.waiting }} 件、已入库 {{ inboundStats.done }} 件。</span>
      </header>
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in inboundColumns" :key="column">{{ column }}</th>
            <th>事项状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in inboundRows" :key="String(item.id)">
            <td v-for="column in inboundColumns" :key="column">{{ item[column] || '—' }}</td>
            <td>{{ item.status }}</td>
            <td class="row-actions">
              <button v-if="item.status === '待入库'" class="link" type="button" @click="openInbound(item)">
                办理入库
              </button>
              <span v-else class="muted-text">已完成</span>
            </td>
          </tr>
          <tr v-if="!inboundRows.length">
            <td :colspan="inboundColumns.length + 2" class="empty-state">暂无标本入库事项</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- 入库办理：指定架位与管理人后事项转为「已入库」。 -->
    <div v-if="showInbound" class="modal-mask" @click.self="showInbound = false">
      <div class="modal-card">
        <h3>标本入库 · {{ inboundTarget?.['标本编号'] }}</h3>
        <p class="modal-hint">鉴定结论：{{ inboundTarget?.['鉴定结论'] }}；采集单位：{{ inboundTarget?.['采集单位'] }}</p>
        <label class="form-item">
          <span>架位编号 *</span>
          <input v-model="inboundForm.shelf" placeholder="如 STOR-0001-A3" />
        </label>
        <label class="form-item">
          <span>管理人</span>
          <input v-model="inboundForm.keeper" placeholder="库房经手人，可留空" />
        </label>
        <p v-if="inboundError" class="error-text">{{ inboundError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="showInbound = false">取消</button>
          <button class="btn primary" type="button" @click="submitInbound">确认入库</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  completeInbound,
  listInboundItems,
} from '@/api/storage-service'
import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('storage')
const columns = ["架位编号", "库房名称", "存放器物类别", "架位层数", "容纳件数", "当前件数", "管理人", "架位状态"]
const actions = ["存放器物", "调整整理", "临时封存"]
const statuses = ["正常使用", "已满", "待整理", "临时封存"]
const stats = [{"label": "架位总数", "value": 0}, {"label": "已满架位", "value": 0}, {"label": "可用架位", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 跨模块入库事项
const inboundColumns = ["标本编号", "采集单位", "复核人", "鉴定结论", "架位编号", "管理人", "入库时间"]
const inboundRows = ref<EntryRow[]>([])
const showInbound = ref(false)
const inboundError = ref('')
const inboundTarget = ref<EntryRow | null>(null)
const inboundForm = reactive({ shelf: '', keeper: '' })

const inboundStats = computed(() => ({
  waiting: inboundRows.value.filter((row) => String(row.status) === '待入库').length,
  done: inboundRows.value.filter((row) => String(row.status) === '已入库').length,
}))

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '库房架位登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function openInbound(row: EntryRow) {
  inboundTarget.value = row
  inboundForm.shelf = ''
  inboundForm.keeper = ''
  inboundError.value = ''
  showInbound.value = true
}

function submitInbound() {
  if (!inboundTarget.value) {
    return
  }
  const result = completeInbound(Number(inboundTarget.value.id), inboundForm.shelf, inboundForm.keeper)
  if (!result.ok) {
    inboundError.value = result.message
    return
  }
  showInbound.value = false
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    inboundRows.value = listInboundItems()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '库房管理列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.inbound-block {
  margin-top: 24px;
}
.inbound-head {
  margin-bottom: 8px;
}
.inbound-head h3 {
  margin: 0 0 2px;
}
.muted-text {
  color: var(--muted);
  font-size: 12px;
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
.form-item input {
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
