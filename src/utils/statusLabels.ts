export const robotStatusLabels: Record<string, string> = {
  'In Stock': 'ในคลัง',
  Assigned: 'ติดตั้งแล้ว',
  'In Maintenance': 'ซ่อมบำรุง',
  Missing: '⚠️ สูญหาย',
};

export const ticketStatusLabels: Record<string, string> = {
  Pending: 'รอดำเนินการ',
  'Waiting Quotation': 'รอทำใบเสนอราคา',
  'In Progress': 'กำลังซ่อม',
  'Ready to Ship': 'รอเตรียมส่ง',
  Completed: 'เสร็จสิ้น',
};

export const priorityLabels: Record<string, string> = {
  Low: 'ต่ำ',
  Normal: 'ปกติ',
  High: 'สูง',
  Urgent: 'เร่งด่วน',
  Critical: 'วิกฤต',
};

export const purchaseOrderStatusLabels: Record<string, string> = {
  Draft: 'ร่าง', Ordered: 'สั่งซื้อแล้ว', Partial: 'รับบางส่วน', Received: 'รับครบแล้ว', Cancelled: 'ยกเลิก',
};

export const loanStatusLabels: Record<string, string> = {
  Pending: 'รออนุมัติ', Approved: 'อนุมัติแล้ว', Active: 'กำลังยืม', Returned: 'คืนแล้ว', Cancelled: 'ยกเลิก',
};

export const maVisitStatusLabels: Record<string, string> = {
  Scheduled: 'นัดหมายแล้ว', Completed: 'เสร็จสิ้น', Skipped: 'ข้าม',
};

export const deliveryNoteStatusLabels: Record<string, string> = {
  Pending: 'รอส่ง', Packed: 'แพคแล้ว', 'In Transit': 'ระหว่างขนส่ง', Delivered: 'ส่งแล้ว', Accepted: 'ตรวจรับแล้ว', Invoiced: 'ส่งของสำเร็จ',
};

export const materialRequestStatusLabels: Record<string, string> = {
  Pending: 'รอดำเนินการ', Approved: 'อนุมัติแล้ว', Ordered: 'สั่งซื้อแล้ว', Cancelled: 'ยกเลิก',
};

export const projectRequestStatusLabels: Record<string, string> = {
  Draft: 'ร่าง', Pending: 'รอดำเนินการ', Approved: 'อนุมัติแล้ว', InProgress: 'กำลังดำเนินการ', Completed: 'เสร็จสิ้น', Cancelled: 'ยกเลิก',
};

export const statusLabel = (status: string, labels: Record<string, string> = {}) => labels[status] ?? status;
