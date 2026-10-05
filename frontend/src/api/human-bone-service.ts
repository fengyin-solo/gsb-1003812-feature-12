import { ensureInboundItem } from '@/api/storage-service'
import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'
import type { Seat } from '@/stores/session'

const HUMAN_BONE_KEY = 'human_bone'

export const HUMAN_BONE_STATUSES = {
  waiting: '待送鉴',
  examining: '鉴定中',
  examined: '已鉴定',
  reviewed: '已复核',
} as const

export const GENDER_OPTIONS = ['男', '女', '性别待定']
export const AGE_OPTIONS = ['0-12岁', '12-18岁', '18-25岁', '25-35岁', '35-50岁', '50岁以上']

// 未成年个体性别二态性未充分发育，牙发育与骨骺愈合给出的年龄结论更可靠：
// 性别判定与年龄范围冲突时，保留年龄范围结论，明确的男/女降级为「性别待定」。
const MINOR_AGE_RANGE = '0-12岁'

export type RegisterInput = {
  specimenId: string
  featureUnit: string
  collectorUnit: string
  bodyPart: string
}

export type ExamineInput = {
  gender: string
  ageRange: string
  pathology: string
}

export function listSpecimens(): EntryRow[] {
  return listRows(HUMAN_BONE_KEY)
}

// 登记与「鉴定部位」解耦：旧标本没有该字段时按空兼容，不阻断任何流程。
function getField(row: EntryRow, field: string): string {
  const value = row[field]
  return value === undefined || value === null ? '' : String(value)
}

export function registerSpecimen(input: RegisterInput, seat: Seat): ActionResult {
  if (seat.role !== 'collector') {
    return { ok: false, message: '只有采集单位可以登记标本，鉴定人与复核人无此权限' }
  }
  const specimenId = input.specimenId.trim()
  if (!specimenId) {
    return { ok: false, message: '请填写标本编号' }
  }
  if (!input.featureUnit.trim()) {
    return { ok: false, message: '请填写出土单位' }
  }
  const collectorUnit = input.collectorUnit.trim() || seat.unit
  const rows = listSpecimens()
  if (rows.some((row) => getField(row, '标本编号') === specimenId)) {
    return { ok: false, message: `标本编号 ${specimenId} 已存在，不能重复登记` }
  }
  const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const row: EntryRow = {
    id: nextId,
    status: HUMAN_BONE_STATUSES.waiting,
    pending: true,
    abnormal: false,
    标本编号: specimenId,
    出土单位: input.featureUnit.trim(),
    采集单位: collectorUnit,
    // 鉴定部位允许留空，兼容旧标本与部位缺失的采集情形。
    鉴定部位: input.bodyPart.trim(),
    性别判定: '',
    年龄范围: '',
    病理特征: '',
    鉴定人: '',
    复核人: '',
    鉴定版本: '',
    鉴定备注: '',
    鉴定状态: HUMAN_BONE_STATUSES.waiting,
  }
  saveRows(HUMAN_BONE_KEY, [...rows, row])
  return { ok: true, message: `标本 ${specimenId} 已登记，等待采集单位安排送鉴` }
}

export function sendForExamination(id: number, seat: Seat): ActionResult {
  if (seat.role !== 'collector') {
    return { ok: false, message: '只有采集单位可以安排送鉴' }
  }
  return transition(id, HUMAN_BONE_STATUSES.waiting, HUMAN_BONE_STATUSES.examining, (row) => ({
    ...row,
    鉴定状态: HUMAN_BONE_STATUSES.examining,
  }), '已安排送鉴，等待鉴定人受理')
}

export function submitExamination(id: number, input: ExamineInput, seat: Seat): ActionResult {
  if (seat.role !== 'examiner') {
    return { ok: false, message: '性别、年龄与病理判定只能由鉴定人完成' }
  }
  if (!GENDER_OPTIONS.includes(input.gender)) {
    return { ok: false, message: '请选择性别判定' }
  }
  if (!AGE_OPTIONS.includes(input.ageRange)) {
    return { ok: false, message: '请选择年龄范围' }
  }

  // 冲突裁决：年龄落在未成年区间而性别给了明确男/女，以年龄为准，性别降级。
  let gender = input.gender
  let warning: string | undefined
  let note: string
  if (input.ageRange === MINOR_AGE_RANGE && (gender === '男' || gender === '女')) {
    note = `性别/年龄冲突：年龄范围「${input.ageRange}」属未成年个体，性别二态性未发育，按规则保留年龄结论，性别由「${gender}」调整为「性别待定」`
    gender = '性别待定'
    warning = note
  } else {
    note = ''
  }

  const result = transition(
    id,
    HUMAN_BONE_STATUSES.examining,
    HUMAN_BONE_STATUSES.examined,
    (row) => ({
      ...row,
      性别判定: gender,
      年龄范围: input.ageRange,
      病理特征: input.pathology.trim(),
      鉴定人: seat.person,
      鉴定版本: 1,
      鉴定备注: [getField(row, '鉴定备注'), note].filter(Boolean).join('；'),
      鉴定状态: HUMAN_BONE_STATUSES.examined,
    }),
    '鉴定意见已提交，等待复核人最终确认',
  )
  if (result.ok && warning) {
    result.warning = warning
  }
  return result
}

export function confirmReview(id: number, seat: Seat): ActionResult {
  if (seat.role !== 'reviewer') {
    return { ok: false, message: '只有复核人可以最终确认；采集单位与鉴定人均无权确认' }
  }
  const rows = listSpecimens()
  const current = rows.find((row) => Number(row.id) === id)
  if (!current) {
    return { ok: false, message: `没有找到编号为 ${id} 的人骨标本` }
  }
  // 重复确认只留下一个版本：已复核的标本直接拦下，不再落新版本、不再生成入库事项。
  if (String(current.status) === HUMAN_BONE_STATUSES.reviewed) {
    return { ok: false, message: '该标本已经复核确认，重复确认不会生成新版本' }
  }
  if (String(current.status) !== HUMAN_BONE_STATUSES.examined) {
    return {
      ok: false,
      message: `标本当前为「${current.status}」，需鉴定人提交鉴定（已鉴定）后才能复核确认`,
    }
  }
  // 跨单位复核拦截：复核人所属单位必须与标本的采集单位一致；旧标本缺采集单位同样拦截。
  const collectorUnit = getField(current, '采集单位')
  if (!collectorUnit) {
    return {
      ok: false,
      message: '该旧标本未登记采集单位，无法核验复核单位归属，请补录采集单位后再确认',
    }
  }
  if (collectorUnit !== seat.unit) {
    return {
      ok: false,
      message: `跨单位复核被拦截：标本采集单位为「${collectorUnit}」，当前复核人属于「${seat.unit}」`,
    }
  }

  const specimenId = getField(current, '标本编号')
  const conclusion = [
    getField(current, '性别判定'),
    getField(current, '年龄范围'),
    getField(current, '病理特征') || '无病理描述',
  ].join('｜')

  const updated: EntryRow = {
    ...current,
    status: HUMAN_BONE_STATUSES.reviewed,
    pending: false,
    abnormal: false,
    复核人: seat.person,
    鉴定状态: HUMAN_BONE_STATUSES.reviewed,
  }
  const index = rows.findIndex((row) => Number(row.id) === id)
  saveRows(HUMAN_BONE_KEY, rows.map((row, i) => (i === index ? updated : row)))

  // 跨模块联动：确认后向库房管理生成标本入库事项（内部按标本编号幂等）。
  const inbound = ensureInboundItem({
    specimenId,
    collectorUnit,
    reviewer: seat.person,
    conclusion,
  })
  return {
    ok: true,
    message: `标本 ${specimenId} 复核确认完成（鉴定版本 v1，复核人 ${seat.person}）；${inbound.message}`,
  }
}

// 各席位在某一标本状态下可执行的动作，页面据此渲染按钮；服务端同样逐动作校验，前后端取数一致。
export function availableActions(status: string, seat: Seat): string[] {
  switch (seat.role) {
    case 'collector':
      return status === HUMAN_BONE_STATUSES.waiting ? ['安排送鉴'] : []
    case 'examiner':
      return status === HUMAN_BONE_STATUSES.examining ? ['提交鉴定'] : []
    case 'reviewer':
      return status === HUMAN_BONE_STATUSES.examined ? ['复核确认'] : []
    default:
      return []
  }
}

type Patch = (row: EntryRow) => EntryRow

function transition(
  id: number,
  expected: string,
  target: string,
  patch: Patch,
  message: string,
): ActionResult {
  const rows = listSpecimens()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的人骨标本` }
  }
  const current = rows[index]
  const status = String(current.status)
  if (status === target) {
    return { ok: false, message: `标本已经是「${target}」，不用重复操作` }
  }
  if (status !== expected) {
    return { ok: false, message: `标本当前为「${status}」，不能执行该操作（应处于「${expected}」）` }
  }
  const updated: EntryRow = {
    ...patch(current),
    status: target,
    pending: target !== HUMAN_BONE_STATUSES.reviewed,
  }
  saveRows(HUMAN_BONE_KEY, rows.map((row, i) => (i === index ? updated : row)))
  return { ok: true, message }
}
