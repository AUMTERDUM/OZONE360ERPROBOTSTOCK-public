// Status-workflow transition maps (mirrors server/index.ts).
export const TICKET_TRANSITIONS: Record<string, string[]> = {
  'Pending': ['In Progress', 'Cancelled'],
  'In Progress': ['Waiting Quotation', 'Ready to Ship', 'Completed', 'Pending'],
  'Waiting Quotation': ['In Progress', 'Ready to Ship', 'Cancelled'],
  'Ready to Ship': ['Completed', 'In Progress'],
  'Completed': [],
  'Cancelled': ['Pending'],
};

export const PO_TRANSITIONS: Record<string, string[]> = {
  'Draft': ['Ordered', 'Cancelled'],
  'Ordered': ['Partial', 'Received', 'Cancelled'],
  'Partial': ['Received', 'Cancelled'],
  'Received': [],
  'Cancelled': ['Draft'],
};

export const DN_TRANSITIONS: Record<string, string[]> = {
  'Pending': ['Packed', 'In Transit', 'Delivered'],
  'Packed': ['In Transit', 'Delivered', 'Pending'],
  'In Transit': ['Delivered', 'Packed'],
  'Delivered': ['Accepted', 'In Transit'],
  'Accepted': ['Invoiced'],
  'Invoiced': [],
};

export const LOAN_TRANSITIONS: Record<string, string[]> = {
  'Pending': ['Approved', 'Cancelled'],
  'Approved': ['Active', 'Cancelled'],
  'Active': ['Returned', 'Cancelled'],
  'Returned': [],
  'Cancelled': ['Pending'],
};

export const PROJECT_REQUEST_TRANSITIONS: Record<string, string[]> = {
  'Draft': ['Pending', 'Cancelled'],
  'Pending': ['Approved', 'Cancelled'],
  'Approved': ['InProgress', 'Cancelled'],
  'InProgress': ['Completed', 'Cancelled'],
  'Completed': [],
  'Cancelled': ['Draft'],
};

export function isValidTransition(transitions: Record<string, string[]>, from: string, to: string): boolean {
  if (from === to) return true;
  const allowed = transitions[from];
  return allowed ? allowed.includes(to) : false;
}
