// PUDU "Early Warning Notification Callback": PUDU POSTs robot events to a URL we register with
// them (doc: "04 Pudu Open Platform - Early Warning Notification Callback - API Documentation").
// Robot faults become maintenance tickets, so a broken robot is on the board before the customer calls.
import { eq, and, ne, like } from 'drizzle-orm';
import type { Db } from '../db/client';
import { maintenanceTickets, robots } from '../db/schema';
import { createMaintenanceTicketFromInput } from './maintenance';
import { createNotification } from './notifications';

export interface PuduCallbackBody {
  callback_type?: string;
  data?: {
    sn?: string;
    error_type?: string;
    error_level?: string;
    error_detail?: string;
    error_id?: string;
    run_status?: string;
    timestamp?: number;
    extend_info?: { map_name?: string; map_point?: string; battery?: number; shop_name?: string };
  };
}

// Thai labels for the fault types PUDU documents; anything else is shown as-is.
const ERROR_LABELS: Record<string, string> = {
  LostBattery: 'ไม่ได้รับข้อมูลแบตเตอรี่',
  LostCamera: 'ไม่ได้รับข้อมูลกล้อง',
  LostCAN: 'ไม่ได้รับข้อมูล CAN bus',
  LostIMU: 'ไม่ได้รับข้อมูล IMU',
  LostLidar: 'ไม่ได้รับข้อมูล Lidar',
  LostLocalization: 'หุ่นหลงตำแหน่ง (Localization)',
  LostRGBD: 'ไม่ได้รับข้อมูลกล้อง RGBD',
  WheelErrorLeft: 'มอเตอร์ล้อซ้ายผิดปกติ',
  WheelErrorRight: 'มอเตอร์ล้อขวาผิดปกติ',
  EmergencyStop: 'กดปุ่มหยุดฉุกเฉิน',
};

// Fatal/Error faults open a ticket; Warning/Event only notify. An emergency stop is usually a person
// pressing the button, so it notifies rather than opening a repair job.
const TICKET_LEVELS = new Set(['Fatal', 'Error']);
const NOTIFY_ONLY_TYPES = new Set(['EmergencyStop']);

/** Tag stored in the ticket description so repeat callbacks for the same fault reuse the open ticket. */
const faultTag = (errorType: string) => `[PUDU:${errorType}]`;

export async function handlePuduCallback(db: Db, body: PuduCallbackBody): Promise<{ action: string; ticketId?: string }> {
  const type = body.callback_type;
  const data = body.data ?? {};
  if (type !== 'robotErrorWarning' && type !== 'robotErrorNotice') return { action: 'ignored' };

  const sn = String(data.sn ?? '').trim().toUpperCase();
  const errorType = String(data.error_type ?? 'Unknown');
  const level = String(data.error_level ?? '');
  if (!sn) return { action: 'ignored' };

  const robot = await db.query.robots.findFirst({ where: eq(robots.serialNumber, sn) });
  const label = ERROR_LABELS[errorType] ?? errorType;
  const where = [data.extend_info?.shop_name, data.extend_info?.map_point].filter(Boolean).join(' · ');
  const summary = `${sn}: ${label} (${level || '-'})${where ? ` @ ${where}` : ''}`;

  if (!robot) {
    await createNotification(db, 'pudu_alert', 'PUDU แจ้งเตือนหุ่นที่ไม่มีในระบบ', summary, 'Robot', sn);
    return { action: 'unknown-robot' };
  }
  if (!TICKET_LEVELS.has(level) || NOTIFY_ONLY_TYPES.has(errorType)) {
    await createNotification(db, 'pudu_alert', `PUDU แจ้งเตือน: ${label}`, summary, 'Robot', robot.id);
    return { action: 'notified' };
  }

  const tag = faultTag(errorType);
  const open = await db.query.maintenanceTickets.findFirst({
    where: and(eq(maintenanceTickets.robotId, robot.id), ne(maintenanceTickets.status, 'Completed'), like(maintenanceTickets.issueDescription, `%${tag}%`)),
  });
  if (open) return { action: 'duplicate', ticketId: open.id };

  const detail = [
    `${tag} PUDU แจ้งความผิดปกติอัตโนมัติ: ${label}`,
    `ระดับ: ${level}`,
    data.error_detail ? `รายละเอียด: ${data.error_detail}` : '',
    where ? `ตำแหน่ง: ${where}` : '',
    typeof data.extend_info?.battery === 'number' ? `แบตเตอรี่: ${data.extend_info.battery}%` : '',
    data.timestamp ? `เวลา: ${new Date(data.timestamp * 1000).toISOString()}` : '',
  ].filter(Boolean).join('\n');
  const ticket = await createMaintenanceTicketFromInput(db, {
    robotId: robot.id,
    customerId: robot.customerId,
    issueDescription: detail,
    status: 'Pending',
    priorityLevel: level === 'Fatal' ? 'High' : 'Normal',
  }, 'pudu-callback');
  await createNotification(db, 'pudu_alert', `เปิด Ticket อัตโนมัติจาก PUDU: ${label}`, summary, 'MaintenanceTicket', ticket.id);
  return { action: 'ticket-created', ticketId: ticket.id };
}

/** Constant-time string compare for the CallbackCode header. */
export function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
