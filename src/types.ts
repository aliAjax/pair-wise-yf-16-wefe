// 雪板交付封存台 —— 领域类型定义

export const BOARD_TYPES = ["全地域", "公园板", "竞速板", "粉雪板"] as const;
export type BoardType = (typeof BOARD_TYPES)[number];

/**
 * 工单状态
 * repair  修补中（未入封存）
 * sealed  已封存（占用封存位，等客户取板）
 * urged   催取中（超过到场日仍未取，保留封存位与记录）
 * picked  已取板（完成交付）
 */
export type OrderStatus = "repair" | "sealed" | "urged" | "picked";

export const STATUS_LABEL: Record<OrderStatus, string> = {
  repair: "修补中",
  sealed: "已封存",
  urged: "催取中",
  picked: "已取板",
};

/** 底板损伤登记，repairedAt 非空表示已修补完成 */
export interface Damage {
  id: string;
  position: string;
  note: string;
  repairedAt: string | null;
}

/** 刃角：侧刃度数 + 底刃度数，复核通过由 technician 记录 */
export interface EdgeSpec {
  side: number;
  base: number;
  recheckPassed: boolean;
  recheckAt: string | null;
}

export interface AuditEntry {
  at: string;
  action: string;
}

export interface WorkOrder {
  id: string;
  brand: string;
  length: number;
  boardType: BoardType;
  customer: string;
  contact: string;
  wax: string;
  preference: string;
  damages: Damage[];
  edge: EdgeSpec;
  status: OrderStatus;
  /** 封存信息：封存码、封存位、取板联系人、到场日 */
  sealCode: string | null;
  slotId: string | null;
  pickupContact: string | null;
  dueDate: string | null;
  sealedAt: string | null;
  pickedAt: string | null;
  /** 封存时的损伤快照与刃角快照，用于判定封存后是否被改动 */
  sealedDamageCount: number;
  sealedEdge: EdgeSpec | null;
  history: AuditEntry[];
  createdAt: string;
}

export interface Filters {
  status: OrderStatus | "all";
  boardType: BoardType | "all";
  keyword: string;
}

export interface ShopState {
  orders: WorkOrder[];
  /** 封存位总数；占用通过订单 slotId 实时推导 */
  slotTotal: number;
  filters: Filters;
}

export interface SealResult {
  ok: boolean;
  error?: string;
  code?: string;
}
