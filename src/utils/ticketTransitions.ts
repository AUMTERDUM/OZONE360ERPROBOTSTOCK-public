// Mirror of worker/src/lib/transitions.ts TICKET_TRANSITIONS — the UI only offers moves the API accepts.
export const TICKET_TRANSITIONS: Record<string, string[]> = {
  'Pending': ['In Progress', 'Cancelled'],
  'In Progress': ['Waiting Quotation', 'Ready to Ship', 'Completed', 'Pending'],
  'Waiting Quotation': ['In Progress', 'Ready to Ship', 'Cancelled'],
  'Ready to Ship': ['Completed', 'In Progress'],
  'Completed': [],
  'Cancelled': ['Pending'],
};
