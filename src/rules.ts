// 业务规则层：封存资格、拒绝条件、退回修补、取板核对、催取转换、筛选与历史
// 纯函数，不接触 React 与 localStorage，便于核对规则
import type {
  Damage,
  EdgeSpec,
  Filters,
  OrderStatus,
  SealResult,
  WorkOrder,
} from "./types";

/** 占用封存位的状态：已封存、催取中都占着位 */
export const SLOT_OCCUPYING: OrderStatus[] = ["sealed", "urged"];

/** 未取板工单状态（用于"同客户已有未取板工单"拒绝规则） */
export const NOT_PICKED: OrderStatus[] = ["sealed", "urged"];

export function isOccupying(status: OrderStatus): boolean {
  return SLOT_OCCUPYING.includes(status);
}

/** 规则1：所有底板损伤必须修补完成（无未修补损伤） */
export function damageRepaired(damages: Damage[]): boolean {
  return damages.every((d) => d.repairedAt !== null);
}

/** 规则2：刃角必须复核通过 */
export function edgeRechecked(edge: EdgeSpec): boolean {
  return edge.recheckPassed === true;
}

export interface SealContext {
  order: WorkOrder;
  orders: WorkOrder[];
  freeSlotCount: number;
}

/**
 * 工单进入封存位前的整体校验。
 * 任一条件不满足即整单拒绝，原工单和封存位占用均不变。
 */
export function evaluateSeal(ctx: SealContext): SealResult {
  const { order, orders, freeSlotCount } = ctx;

  if (order.status !== "repair") {
    return { ok: false, error: "只有修补中的工单可以封存" };
  }
  if (order.damages.length > 0 && !damageRepaired(order.damages)) {
    return { ok: false, error: "损伤修补尚未完成，不能封存" };
  }
  if (!edgeRechecked(order.edge)) {
    return { ok: false, error: "刃角复核未通过，不能封存" };
  }
  if (!order.pickupContact || !order.dueDate) {
    return { ok: false, error: "请登记取板联系人与到场日" };
  }
  if (freeSlotCount <= 0) {
    return { ok: false, error: "封存位不足，整单拒绝（原工单与占用不变）" };
  }
  const dup = orders.some(
    (o) =>
      o.id !== order.id &&
      o.customer.trim() === order.customer.trim() &&
      NOT_PICKED.includes(o.status),
  );
  if (dup) {
    return { ok: false, error: "同客户已有未取板工单，整单拒绝" };
  }

  return { ok: true };
}

/**
 * 封存后退回修补判定：
 * 新增损伤（当前损伤条数多于封存时快照），或刃角（侧刃/底刃）被改动。
 * 已复核状态变化不在此列——改动刃角本身即触发退回。
 */
export function shouldReturnFromSeal(order: WorkOrder): boolean {
  if (!isOccupying(order.status) || !order.sealedEdge) return false;
  const addedDamage = order.damages.length > order.sealedDamageCount;
  const edgeChanged =
    order.edge.side !== order.sealedEdge.side ||
    order.edge.base !== order.sealedEdge.base;
  return addedDamage || edgeChanged;
}

/** 取板核对：封存码必须完全一致 */
export function codeMatches(order: WorkOrder, code: string): boolean {
  return order.sealCode !== null && code.trim() === order.sealCode;
}

/** 催取：到场日早于今天仍未取板 */
export function isOverdue(order: WorkOrder, today: string): boolean {
  return (
    order.status === "sealed" &&
    order.dueDate !== null &&
    order.dueDate < today
  );
}

/** 筛选：状态 + 板型 + 关键字（工单号/客户/品牌） */
export function filterOrders(orders: WorkOrder[], f: Filters): WorkOrder[] {
  const kw = f.keyword.trim().toLowerCase();
  return orders.filter((o) => {
    if (f.status !== "all" && o.status !== f.status) return false;
    if (f.boardType !== "all" && o.boardType !== f.boardType) return false;
    if (kw) {
      const hay = `${o.id} ${o.customer} ${o.brand}`.toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });
}

/** 客户历史：该客户名下全部工单，按创建时间倒序 */
export function customerHistory(
  orders: WorkOrder[],
  customer: string,
): WorkOrder[] {
  const name = customer.trim().toLowerCase();
  if (!name) return [];
  return orders
    .filter((o) => o.customer.trim().toLowerCase() === name)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** 最近到场日：已封存/催取工单中最早的 dueDate，用于封存位看板 */
export function nextDueDate(orders: WorkOrder[]): string | null {
  const dates = orders
    .filter((o) => isOccupying(o.status) && o.dueDate)
    .map((o) => o.dueDate as string)
    .sort();
  return dates[0] ?? null;
}

/** 封存位占用情况：按 slotId 去重推导 */
export function occupiedSlots(orders: WorkOrder[]): Set<string> {
  return new Set(
    orders
      .filter((o) => isOccupying(o.status) && o.slotId)
      .map((o) => o.slotId as string),
  );
}
