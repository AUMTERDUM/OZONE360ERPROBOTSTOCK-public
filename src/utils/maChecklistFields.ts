// MA (maintenance) checklist items per robot category. The visit form and the printable PDF
// both read from here, so they always list the same items. Content comes from the PUDU
// manuals and check sheets in Google Drive: PuduBot 2 user manual + daily check sheets,
// BellaBot maintenance guide, KettyBot install checklist, FlashBot manual, CC1 Series
// technical manual, MT1 Vac product intro, T300 function intro + spare-parts list.

export type MaCategory = 'delivery' | 'industrial' | 'cleaning';

export const MA_CATEGORIES: MaCategory[] = ['delivery', 'industrial', 'cleaning'];

export const MA_CATEGORY_LABELS: Record<MaCategory, string> = {
  delivery: 'หุ่นส่งของ (PuduBot2/BellaBot/KettyBot/FlashBot)',
  industrial: 'หุ่นขนส่งอุตสาหกรรม (T150/T300/T600)',
  cleaning: 'หุ่นทำความสะอาด (CC1/MT1/SH1)',
};

export interface MaItem {
  id: string;
  label: string;
  /** Only shown for models whose name contains one of these (ignoring case and spaces). */
  models?: string[];
  /** Hidden for models whose name contains one of these. */
  exceptModels?: string[];
}

export interface MaSection {
  title: string;
  items: MaItem[];
}

export type MaItemResult = 'OK' | 'Issue' | 'Repaired' | 'NA';

export const MA_RESULT_LABELS: Record<MaItemResult, string> = {
  OK: 'ปกติ',
  Issue: 'มีปัญหา',
  Repaired: 'ซ่อมแล้ว',
  NA: 'ไม่เกี่ยว',
};

// Model groups, matched against the normalized model name (upper case, no spaces/dashes).
const MT1 = ['MT1'];
const WET_EXCEPT = MT1; // MT1 / MT1 Vac / MT1 Max sweep and vacuum only — no water system.

const COMMON_SECTIONS: MaSection[] = [
  {
    title: 'การทำงานของหุ่นยนต์',
    items: [
      { id: 'nav', label: 'เดินตามแผนที่ได้ปกติ / แผนที่และจุดต่าง ๆ ถูกต้อง' },
      { id: 'avoid', label: 'การหลบหลีกสิ่งกีดขวาง' },
      { id: 'lidar', label: 'Lidar หมุนปกติ / ทำความสะอาดเลนส์' },
      { id: 'charge', label: 'การชาร์จไฟ / กลับแท่นชาร์จอัตโนมัติ / ขั้วชาร์จไม่ชำรุด' },
      { id: 'battery', label: 'คุณภาพแบตเตอรี่ (ระยะเวลาใช้งานต่อรอบ)' },
      { id: 'software', label: 'อัปเดตเวอร์ชันซอฟต์แวร์' },
      { id: 'network', label: 'สัญญาณ Wi-Fi / 4G และการเชื่อมต่อคลาวด์' },
      { id: 'iot', label: 'การเชื่อมต่อลิฟต์ / ประตูอัตโนมัติ (ถ้ามี)' },
    ],
  },
  {
    title: 'สภาพภายนอก',
    items: [
      { id: 'crack', label: 'ร่องรอยแตกหัก / ฝาครอบหลวม' },
      { id: 'clean', label: 'ทำความสะอาดตัวหุ่น' },
      { id: 'estop', label: 'ปุ่มหยุดฉุกเฉิน / ปุ่มเปิด-ปิด' },
      { id: 'screen', label: 'หน้าจอสัมผัส / ไฟสถานะ / ลำโพงแจ้งเตือน' },
    ],
  },
];

const DELIVERY_SECTIONS: MaSection[] = [
  {
    title: 'ระบบส่งของ',
    items: [
      { id: 'tray', label: 'ถาด / ตัวยึดถาด (แน่นหนา, สะอาด, ตำแหน่งตรงกัน)', exceptModels: ['FLASHBOT'] },
      { id: 'wheels', label: 'ล้อขับเคลื่อน (เช็ดทำความสะอาด, เอาเส้นผม/เศษที่พันออก)' },
      { id: 'caster', label: 'ล้อหมุนอิสระเสริม' },
      { id: 'rgbd', label: 'กล้อง RGBD / Marker camera / เซนเซอร์ความลึก (เลนส์ไม่ขุ่นมัว)' },
      { id: 'appCall', label: 'การเรียกหุ่นผ่าน App / API / Pager / Watch' },
      { id: 'returnPoint', label: 'กลับจุดรับของ / จุดสแตนด์บาย' },
      { id: 'multiRobot', label: 'การทำงานของหุ่นยนต์มากกว่า 1 ตัว' },
      { id: 'adScreen', label: 'จอโฆษณา / ส่งภาพไปจอใหญ่', models: ['KETTYBOT', 'PUDUBOT2', 'PUDU2'] },
      { id: 'reception', label: 'โหมดต้อนรับลูกค้า (ตรวจจับคน)', models: ['KETTYBOT', 'FLASHBOT'] },
      { id: 'touchFace', label: 'หน้าจอใบหน้า / เซนเซอร์สัมผัสที่หัว', models: ['BELLABOT'] },
      { id: 'compartment', label: 'ฝาปิดช่องใส่ของอัตโนมัติ / ไฟในช่อง', models: ['FLASHBOT'] },
      { id: 'uvLamp', label: 'หลอด UV ฆ่าเชื้อในช่อง', models: ['FLASHBOT'] },
      { id: 'access', label: 'สวิตช์กุญแจ / ช่องเสียบการ์ด / รหัสผ่าน', models: ['FLASHBOT'] },
      { id: 'eskin', label: 'E-Skin / แถบไฟบ่งชี้สถานะ', models: ['FLASHBOT'] },
    ],
  },
];

const INDUSTRIAL_SECTIONS: MaSection[] = [
  {
    title: 'ระบบขนส่ง',
    items: [
      { id: 'wheels', label: 'ล้อขับเคลื่อน / ล้อ Omni / ล้อกำหนดทิศทาง' },
      { id: 'lift', label: 'ระบบยก (Electric actuator) / Limit switch / ลูกกลิ้งลำเลียง (ถ้ามี)', exceptModels: ['T150'] },
      { id: 'shelfDock', label: 'การเข้าและออกจากชั้นวาง / รถเข็น (จับขาชั้นวางหรือแถบสะท้อน)', exceptModels: ['T150'] },
      { id: 'shelfMount', label: 'จุดยึดชั้นวาง / ขาชั้นวาง (ขนาดตามสเปก)', exceptModels: ['T150'] },
      { id: 'shelfLayers', label: 'ชั้นวาง / ช่องวางของบนตัวหุ่น (แน่นหนา)', models: ['T150'] },
      { id: 'payload', label: 'ทดสอบบรรทุกน้ำหนักตามหน้างาน' },
      { id: 'bumper', label: 'เซนเซอร์ชนด้านหน้า / ยางซิลิโคนกันกระแทกขอบหน้า-หลัง' },
      { id: 'rgbd', label: 'กล้อง RGBD ด้านบน-ล่าง / กล้อง RGB / Marker camera' },
      { id: 'rearLidar', label: 'Lidar หน้า-หลัง (สาย Lidar ไม่หลวม)' },
      { id: 'brake', label: 'สวิตช์เบรก / ปลดล็อกมอเตอร์สำหรับเข็นด้วยมือ' },
      { id: 'staticChain', label: 'โซ่ระบายไฟฟ้าสถิต' },
      { id: 'shortcut', label: 'ปุ่มลัด (Follow mode) / ไฟหน้า / ไฟ LED' },
      { id: 'marker', label: 'Marker / QR บนเพดานหรือพื้น' },
      { id: 'appCall', label: 'การเรียกหุ่นผ่านระบบ / API / PLC / Pager' },
      { id: 'multiRobot', label: 'การทำงานของหุ่นยนต์มากกว่า 1 ตัว' },
    ],
  },
];

const CLEANING_SECTIONS: MaSection[] = [
  {
    title: 'ระบบทำความสะอาด',
    items: [
      { id: 'sideBrush', label: 'แปรงข้าง (สึกหรอ, เส้นผมพัน)' },
      { id: 'rollerBrush', label: 'แปรงลูกกลิ้ง / ถาดรองขยะ' },
      { id: 'squeegee', label: 'ยางรีดน้ำ / ยางดันฝุ่น (สึกหรอ, ฉีกขาด)' },
      { id: 'dustBox', label: 'กล่องฝุ่น / ถุงเก็บฝุ่น / ถังขยะ' },
      { id: 'cleanTank', label: 'ถังน้ำดี + ไส้กรอง', exceptModels: WET_EXCEPT },
      { id: 'dirtyTank', label: 'ถังน้ำเสีย + กล่องกรองน้ำ + ฟองน้ำกรองอากาศ', exceptModels: WET_EXCEPT },
      { id: 'drainValve', label: 'วาล์วระบายน้ำ / สายระบาย (ไม่รั่วซึม)', exceptModels: WET_EXCEPT },
      { id: 'levelSensor', label: 'เซนเซอร์ระดับน้ำ (ทุ่นลอย)', exceptModels: WET_EXCEPT },
      { id: 'waterFlow', label: 'การจ่ายน้ำ / ปั๊มน้ำ / แรงดูด', exceptModels: WET_EXCEPT },
      { id: 'hepa', label: 'ไส้กรอง HEPA / ระบบดูดฝุ่น / ท่อดูด', models: MT1 },
      { id: 'mopModule', label: 'โมดูลถูพื้น / ไม้ถูพื้น (ถอดเร็ว)', models: MT1 },
      { id: 'handVac', label: 'ชุดดูดฝุ่นแบบมือถือ', models: ['MT1VAC'] },
      { id: 'bumper', label: 'กันชน / เซนเซอร์ชน / เลเซอร์เส้น' },
      { id: 'wheels', label: 'ล้อขับเคลื่อน / ล้อหมุนอิสระ' },
      { id: 'station', label: 'แท่นชาร์จ / แท่นเติมน้ำ-ถ่ายน้ำ (Workstation)' },
      { id: 'socCalib', label: 'คาลิเบรตแบต (ชาร์จเต็ม SOC) — ทุก 3 เดือน' },
      { id: 'aiCamera', label: 'กล้อง AI (ตรวจคราบ / ตรวจขยะ / Heatmap)', models: ['CC1PRO', 'CCBC02', 'MT1'] },
    ],
  },
];

const CATEGORY_SECTIONS: Record<MaCategory, MaSection[]> = {
  delivery: DELIVERY_SECTIONS,
  industrial: INDUSTRIAL_SECTIONS,
  cleaning: CLEANING_SECTIONS,
};

/** "CC1 Pro", "CC1Pro" and "cc1-pro" all compare as "CC1PRO". */
const normalizeModel = (name: string | undefined) => (name || '').toUpperCase().replace(/[\s\-_]/g, '');

/** Guesses the checklist category from a model name, used when a model has none set. */
export function guessMaCategory(modelName: string | undefined): MaCategory {
  const name = normalizeModel(modelName);
  if (/CC1|MT1|SH1|CLEAN|SCRUB/.test(name)) return 'cleaning';
  if (/T150|T300|T600|UNDERRIDE/.test(name)) return 'industrial';
  return 'delivery';
}

export function resolveMaCategory(model?: { name?: string; maCategory?: string | null }): MaCategory {
  const set = model?.maCategory as MaCategory | undefined;
  return set && MA_CATEGORIES.includes(set) ? set : guessMaCategory(model?.name);
}

/**
 * Common sections plus the category's own, filtered for the model. Items limited to some
 * models are hidden when the model is unknown; items excluded for some models stay shown.
 */
export function maChecklistFor(category: MaCategory, modelName?: string): MaSection[] {
  const name = normalizeModel(modelName);
  const has = (list: string[]) => !!name && list.some(m => name.includes(normalizeModel(m)));
  const fitsModel = (item: MaItem) => (!item.models || has(item.models)) && !(item.exceptModels && has(item.exceptModels));
  return [...CATEGORY_SECTIONS[category], ...COMMON_SECTIONS]
    .map(s => ({ ...s, items: s.items.filter(fitsModel) }))
    .filter(s => s.items.length > 0);
}

/** For the blank PDF: every item of the category, model-specific ones included. */
export function maChecklistAllItems(category: MaCategory): MaSection[] {
  return [...CATEGORY_SECTIONS[category], ...COMMON_SECTIONS];
}

/** Short note shown next to model-specific items on the blank PDF, e.g. "เฉพาะ FlashBot". */
export function maItemScopeNote(item: MaItem): string {
  if (item.models) return `เฉพาะ ${item.models.join('/')}`;
  if (item.exceptModels) return `ยกเว้น ${item.exceptModels.join('/')}`;
  return '';
}

// The spare-part catalog lists models as "CC1, CC1Pro" / "Pudu2"; robot models use names like "PuduBot2".
const PART_MODEL_ALIASES: Record<string, string> = { PUDUBOT2: 'PUDU2', PUDUBOT: 'PUDU1', PUDUBOT1: 'PUDU1' };
const partModelKey = (name: string | undefined) => {
  const key = normalizeModel(name);
  return PART_MODEL_ALIASES[key] ?? key;
};

/** True when a spare part's `productModel` list names this robot model. */
export function partFitsModel(partProductModel: string | undefined, robotModelName: string | undefined): boolean {
  const robot = partModelKey(robotModelName);
  if (!robot || !partProductModel) return false;
  return partProductModel.split(/[,/;|]/).some(m => partModelKey(m) === robot);
}
