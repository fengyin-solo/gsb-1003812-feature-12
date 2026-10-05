import { defineStore } from 'pinia'

// 鉴定席位：采集单位、鉴定人、复核人各有职责边界，页面和业务服务都按当前席位取数与放行。
export type SeatKey = 'collector' | 'examiner' | 'reviewer' | 'outside_reviewer'

export type Seat = {
  key: SeatKey
  label: string
  role: string
  unit: string
  person: string
  description: string
}

// 跨单位复核的拦截规则依赖「所属单位」：外单位复核人用于演示拦截。
export const SEATS: Seat[] = [
  {
    key: 'collector',
    label: '采集单位·经办人',
    role: 'collector',
    unit: '陕西省考古研究院田野一队',
    person: '王田野',
    description: '只能登记标本、安排送鉴，不能做鉴定结论。',
  },
  {
    key: 'examiner',
    label: '鉴定人',
    role: 'examiner',
    unit: '体质人类学鉴定组',
    person: '周华',
    description: '完成性别、年龄与病理判定并提交鉴定。',
  },
  {
    key: 'reviewer',
    label: '复核人（本单位）',
    role: 'reviewer',
    unit: '陕西省考古研究院田野一队',
    person: '李穆',
    description: '只有复核人能最终确认，且必须与采集单位同单位。',
  },
  {
    key: 'outside_reviewer',
    label: '复核人（外单位·演示拦截）',
    role: 'reviewer',
    unit: '邻省考古研究所协作组',
    person: '赵协作',
    description: '同样具备复核资格，但所属单位不同，确认时应被拦截。',
  },
]

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    scope: '田野考古发掘数字化管理系统',
    seatKey: 'collector' as SeatKey,
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    seat(state): Seat {
      return SEATS.find((item) => item.key === state.seatKey) ?? SEATS[0]
    },
    // 所属单位是跨单位复核拦截的取数依据。
    seatUnit(): string {
      return this.seat.unit
    },
    seatRole(): string {
      return this.seat.role
    },
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setSeat(key: SeatKey) {
      this.seatKey = key
    },
  },
})
