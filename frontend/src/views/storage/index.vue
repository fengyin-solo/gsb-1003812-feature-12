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

    <section class="inbound-section">
      <h3 class="section-title">标本入库事项</h3>
      <p class="section-desc">人骨鉴定复核确认后跨模块生成的入库事项，同一标本只保留一条，办理入库后事项闭环。</p>
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in inboundColumns" :key="column">{{ column }}</th>
            <th>状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in inboundRows" :key="String(item.id)">
            <td v-for="column in inboundColumns" :key="column">{{ item[column] ?? '—' }}</td>
            <td>{{ item.status }}</td>
            <td class="row-actions">
              <button
                v-if="item.status === '待入库'"
                class="link"
                type="button"
                @click="runInbound(Number(item.id))"
              >
                办理入库
              </button>
              <span v-else>—</span>
            </td>
          </tr>
          <tr v-if="!inboundRows.length">
            <td :colspan="inboundColumns.length + 2" class="empty-state">暂无入库事项，人骨鉴定复核确认后自动生成</td>
          </tr>
        </tbody>
      </table>
      <footer class="page-foot">
        <span>共 {{ inboundRows.length }} 条标本入库事项</span>
        <span v-if="inboundMessage" class="notice-text">{{ inboundMessage }}</span>
      </footer>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { completeInboundItem, listInboundItems } from '@/api/inbound'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('storage')
const columns = ["架位编号", "库房名称", "存放器物类别", "架位层数", "容纳件数", "当前件数", "管理人", "架位状态"]
const actions = ["存放器物", "调整整理", "临时封存"]
const statuses = ["正常使用", "已满", "待整理", "临时封存"]
const stats = [{"label": "架位总数", "value": 0}, {"label": "已满架位", "value": 0}, {"label": "可用架位", "value": 0}]
const inboundColumns = ["事项编号", "标本编号", "标本类别", "出土单位", "采集单位", "复核人", "生成时间"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const inboundRows = ref<EntryRow[]>([])
const inboundMessage = ref('')
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

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

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '库房管理列表读取失败'
  }
}

function loadInbound() {
  inboundRows.value = listInboundItems()
}

function runInbound(id: number) {
  const result = completeInboundItem(id)
  inboundMessage.value = result.message
  loadInbound()
}

onMounted(() => {
  reload()
  loadInbound()
})
</script>
