// rules.ts —— 封存台业务规则层
// 只包含纯函数：状态推导、封存准入校验、退回释放、取板核对。
// 不依赖 React 与 localStorage，所有变更都返回新 State，失败时原 State 不动。

export type OrderStatus = "修补中" | "待封存" | "已封存" | "催取中" | "已取板";

export interface Damage {
  id: string;
  location: string;
  lengthCm: number;
  repaired: boolean;
}

export interface HistoryEvent {
  at: string;
  text: string;
}

export interface WorkOrder {
  id: string;
  customer: string;
  board: string;
  boardType: string;
  edgeAngle: string;
  edgeReviewed: boolean;
  damages: Damage[];
  slotId: number | null;
  sealCode: string | null;
  pickupContact: string;
  pickupDate: string; // 到场日 YYYY-MM-DD
  createdAt: string;
  sealedAt: string | null;
  pickedAt: string | null;
  history: HistoryEvent[];
}

export interface Slot {
  id: number;
  orderId: string | null;
}

export interface State {
  orders: WorkOrder[];
  slots: Slot[];
}

export type Result =
  | { ok: true; state: State; note: string }
  | { ok: false; reason: string };

export const SLOT_COUNT = 6;

const ok = (state: State, note: string): Result => ({ ok: true, state, note });
const fail = (reason: string): Result => ({ ok: false, reason });

// ---------- 状态推导 ----------

export function repairComplete(o: WorkOrder): boolean {
  return o.damages.every((d) => d.repaired);
}

export function edgeReviewPassed(o: WorkOrder): boolean {
  return o.edgeReviewed;
}

/** 进入封存位的门槛：损伤修补完成 且 刃角复核通过 */
export function canEnterSlot(o: WorkOrder): boolean {
  return repairComplete(o) && edgeReviewPassed(o);
}

export function isOverdue(o: WorkOrder, today: string): boolean {
  return (
    o.slotId !== null &&
    o.pickedAt === null &&
    o.pickupDate !== "" &&
    o.pickupDate < today
  );
}

/** 超期未取 → 催取中，但工单与封存记录全部保留 */
export function deriveStatus(o: WorkOrder, today: string): OrderStatus {
  if (o.pickedAt !== null) return "已取板";
  if (o.slotId !== null) return isOverdue(o, today) ? "催取中" : "已封存";
  return canEnterSlot(o) ? "待封存" : "修补中";
}

export function freeSlotCount(slots: Slot[]): number {
  return slots.filter((s) => s.orderId === null).length;
}

/** 同客户名下已封存但未取板的工单 */
export function customerUnpicked(
  orders: WorkOrder[],
  customer: string,
  excludeId?: string
): WorkOrder[] {
  return orders.filter(
    (o) =>
      o.customer === customer &&
      o.id !== excludeId &&
      o.slotId !== null &&
      o.pickedAt === null
  );
}

// ---------- 内部工具 ----------

function withEvent(o: WorkOrder, at: string, text: string): WorkOrder {
  return { ...o, history: [...o.history, { at, text }] };
}

function replaceOrder(state: State, order: WorkOrder, slots: Slot[]): State {
  return {
    orders: state.orders.map((o) => (o.id === order.id ? order : o)),
    slots,
  };
}

/**
 * 封存中的工单一旦被改回“不满足封存条件”（新增损伤 / 改动刃角 / 修补状态回退），
 * 立即退回修补并释放封存位，封存码作废，全程留痕。
 */
function releaseIfUnsealable(
  order: WorkOrder,
  state: State,
  today: string,
  why: string
): { order: WorkOrder; slots: Slot[]; released: boolean } {
  if (order.slotId === null || canEnterSlot(order)) {
    return { order, slots: state.slots, released: false };
  }
  const releasedOrder = withEvent(
    { ...order, slotId: null, sealCode: null, sealedAt: null },
    today,
    `${why}：封存作废，退回修补并释放封存位 #${order.slotId}`
  );
  const slots = state.slots.map((s) =>
    s.orderId === order.id ? { ...s, orderId: null } : s
  );
  return { order: releasedOrder, slots, released: true };
}

function makeSealCode(state: State): string {
  const used = new Set(state.orders.map((o) => o.sealCode));
  let code = "";
  do {
    code = `SEAL-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  } while (used.has(code));
  return code;
}

// ---------- 业务动作 ----------

/**
 * 申请进入封存位。任一条不满足即整单拒绝：
 * 原工单与封存位占用完全不变（直接返回失败，不产生新 State）。
 */
export function trySeal(
  state: State,
  orderId: string,
  contact: string,
  pickupDate: string,
  today: string
): Result {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) return fail("工单不存在");
  if (order.pickedAt !== null) return fail("工单已取板归档，不能再次封存");
  if (order.slotId !== null) return fail("工单已在封存位中");
  if (!repairComplete(order)) return fail("尚有损伤修补未完成，整单拒绝");
  if (!edgeReviewPassed(order)) return fail("刃角复核未通过，整单拒绝");
  if (!contact.trim()) return fail("需登记取板联系人");
  if (!pickupDate) return fail("需登记到场日");
  if (customerUnpicked(state.orders, order.customer, order.id).length > 0) {
    return fail(
      `客户「${order.customer}」已有未取板工单，整单拒绝，原工单与封存位占用不变`
    );
  }
  const slot = state.slots.find((s) => s.orderId === null);
  if (!slot) return fail("封存位不足，整单拒绝，原工单与封存位占用不变");

  const sealCode = makeSealCode(state);
  const sealed = withEvent(
    {
      ...order,
      slotId: slot.id,
      sealCode,
      pickupContact: contact.trim(),
      pickupDate,
      sealedAt: today,
    },
    today,
    `封存入位 #${slot.id}，封存码 ${sealCode}，取板联系人 ${contact.trim()}，到场日 ${pickupDate}`
  );
  return ok(
    {
      orders: state.orders.map((o) => (o.id === order.id ? sealed : o)),
      slots: state.slots.map((s) =>
        s.id === slot.id ? { ...s, orderId: order.id } : s
      ),
    },
    `已入封存位 #${slot.id}，封存码 ${sealCode}`
  );
}

/** 取板：核对封存码，通过后释放封存位；记录保留 */
export function confirmPickup(
  state: State,
  orderId: string,
  code: string,
  today: string
): Result {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) return fail("工单不存在");
  if (order.pickedAt !== null) return fail("工单已取板归档");
  if (order.slotId === null) return fail("工单不在封存位，无法取板");
  if (!code.trim()) return fail("请输入封存码");
  if (code.trim().toUpperCase() !== order.sealCode) {
    return fail("封存码核对不符，取板被拒绝");
  }
  const picked = withEvent(
    { ...order, pickedAt: today, slotId: null },
    today,
    `封存码核对通过，${order.pickupContact} 取板离场，封存位 #${order.slotId} 释放`
  );
  return ok(
    {
      orders: state.orders.map((o) => (o.id === order.id ? picked : o)),
      slots: state.slots.map((s) =>
        s.orderId === order.id ? { ...s, orderId: null } : s
      ),
    },
    "封存码核对通过，已取板"
  );
}

/** 登记新损伤；若工单已封存则触发退回修补并释放封存位 */
export function addDamage(
  state: State,
  orderId: string,
  location: string,
  lengthCm: number,
  today: string
): Result {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) return fail("工单不存在");
  if (order.pickedAt !== null) return fail("工单已取板归档，不能再登记损伤");
  if (!location.trim()) return fail("请填写损伤位置");
  if (!Number.isFinite(lengthCm) || lengthCm <= 0) {
    return fail("请填写有效的损伤长度");
  }
  const damage: Damage = {
    id: `D-${Date.now().toString(36)}-${order.damages.length + 1}`,
    location: location.trim(),
    lengthCm,
    repaired: false,
  };
  const next = withEvent(
    { ...order, damages: [...order.damages, damage] },
    today,
    `新增损伤：${damage.location} ${lengthCm}cm`
  );
  const rel = releaseIfUnsealable(next, state, today, "封存后新增损伤");
  return ok(
    replaceOrder(state, rel.order, rel.slots),
    rel.released ? "已登记损伤，工单退回修补并释放封存位" : "损伤已登记"
  );
}

/** 改动刃角；复核状态清零，若已封存则退回修补并释放封存位 */
export function changeEdgeAngle(
  state: State,
  orderId: string,
  angle: string,
  today: string
): Result {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) return fail("工单不存在");
  if (order.pickedAt !== null) return fail("工单已取板归档，不能改动刃角");
  if (!angle.trim()) return fail("请填写刃角参数");
  if (angle.trim() === order.edgeAngle) return fail("刃角未发生变化");
  const next = withEvent(
    { ...order, edgeAngle: angle.trim(), edgeReviewed: false },
    today,
    `刃角调整为 ${angle.trim()}，需重新复核`
  );
  const rel = releaseIfUnsealable(next, state, today, "封存后改动刃角");
  return ok(
    replaceOrder(state, rel.order, rel.slots),
    rel.released
      ? "刃角已改动，工单退回修补并释放封存位"
      : "刃角已更新，需重新复核"
  );
}

/** 切换单条损伤的修补状态；已封存工单被标回未修时同样触发退回 */
export function toggleDamageRepaired(
  state: State,
  orderId: string,
  damageId: string,
  today: string
): Result {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) return fail("工单不存在");
  if (order.pickedAt !== null) return fail("工单已取板归档，不能改动");
  const damage = order.damages.find((d) => d.id === damageId);
  if (!damage) return fail("损伤记录不存在");
  const damages = order.damages.map((d) =>
    d.id === damageId ? { ...d, repaired: !d.repaired } : d
  );
  const next = withEvent(
    { ...order, damages },
    today,
    damage.repaired
      ? `损伤「${damage.location}」标回未修`
      : `损伤「${damage.location}」修补完成`
  );
  const rel = releaseIfUnsealable(next, state, today, "修补状态回退");
  return ok(
    replaceOrder(state, rel.order, rel.slots),
    rel.released ? "修补状态回退，工单退回修补并释放封存位" : "修补状态已更新"
  );
}

/** 刃角复核通过 */
export function setEdgeReviewed(
  state: State,
  orderId: string,
  today: string
): Result {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) return fail("工单不存在");
  if (order.pickedAt !== null) return fail("工单已取板归档，不能改动");
  if (order.edgeReviewed) return fail("刃角已复核通过，无需重复操作");
  const next = withEvent(
    { ...order, edgeReviewed: true },
    today,
    `刃角复核通过（${order.edgeAngle}）`
  );
  return ok(replaceOrder(state, next, state.slots), "刃角复核通过");
}

export interface NewOrderDraft {
  customer: string;
  board: string;
  boardType: string;
  edgeAngle: string;
}

/** 开立工单，进入修补流程 */
export function addOrder(
  state: State,
  draft: NewOrderDraft,
  today: string
): Result {
  if (!draft.customer.trim()) return fail("请填写客户姓名");
  if (!draft.board.trim()) return fail("请填写雪板信息");
  if (!draft.edgeAngle.trim()) return fail("请填写刃角参数");
  const nextNum =
    state.orders.reduce((max, o) => {
      const n = parseInt(o.id.replace(/\D/g, ""), 10);
      return Number.isFinite(n) ? Math.max(max, n) : max;
    }, 200) + 1;
  const order: WorkOrder = {
    id: `ORD-${nextNum}`,
    customer: draft.customer.trim(),
    board: draft.board.trim(),
    boardType: draft.boardType,
    edgeAngle: draft.edgeAngle.trim(),
    edgeReviewed: false,
    damages: [],
    slotId: null,
    sealCode: null,
    pickupContact: "",
    pickupDate: "",
    createdAt: today,
    sealedAt: null,
    pickedAt: null,
    history: [{ at: today, text: "工单开立，进入修补流程" }],
  };
  return ok(
    { ...state, orders: [order, ...state.orders] },
    `工单 ${order.id} 已开立`
  );
}
