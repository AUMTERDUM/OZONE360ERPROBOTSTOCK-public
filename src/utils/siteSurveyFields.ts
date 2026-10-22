// Field definitions for the two PUDU site-survey questionnaires (AMR delivery robots and
// cleaning robots), used to render the form and to lay out the exported PDF identically.

export type SurveyFormType = 'amr' | 'cleaning';

export type SurveyField =
  | { key: string; label: string; kind: 'text'; unit?: string; placeholder?: string }
  | { key: string; label: string; kind: 'textarea' }
  | { key: string; label: string; kind: 'number'; unit?: string }
  | { key: string; label: string; kind: 'select'; options: string[] }
  | { key: string; label: string; kind: 'checks'; options: string[] };

export interface SurveySection {
  title: string;
  fields: SurveyField[];
}

export const AMR_SECTIONS: SurveySection[] = [
  {
    title: '1. ข้อมูลมิติพื้นที่ และสิ่งกีดขวางทางกายภาพ (Physical Layout & Clearance)',
    fields: [
      { key: 'aisleWidthCm', label: 'ความกว้างช่องทางเดินแคบที่สุด', kind: 'number', unit: 'cm' },
      { key: 'aisleNarrowestLocation', label: 'ตำแหน่งจุดแคบสุด', kind: 'text' },
      { key: 'turningWidthCm', label: 'ความกว้างจุดกลับรถ / วงเลี้ยว', kind: 'number', unit: 'cm' },
      { key: 'turningType', label: 'รูปแบบการเลี้ยว', kind: 'select', options: ['เลี้ยวโค้ง', 'หมุนกลับตัว 180°'] },
      { key: 'maxSlopeDeg', label: 'ความชันสูงสุดวัดได้', kind: 'number', unit: '°' },
      { key: 'slopeLengthM', label: 'ระยะทางช่วงลาดเอียง', kind: 'number', unit: 'm' },
      { key: 'floorGapMm', label: 'ความกว้างร่องรอยต่อพื้น', kind: 'number', unit: 'mm' },
      { key: 'stepHeightMm', label: 'ความสูงธรณีประตู/สเต็ป', kind: 'number', unit: 'mm' },
      { key: 'ceilingHeightM', label: 'ระยะความสูงต่ำสุด (เพดาน/สิ่งแขวน)', kind: 'number', unit: 'm' },
      { key: 'overheadObstacles', label: 'สิ่งกีดขวางด้านบน', kind: 'text' },
    ],
  },
  {
    title: '2. ข้อมูลภาระงาน ขนส่งสินค้า และรอบการทำงาน (Payload & Workflow)',
    fields: [
      { key: 'cargoType', label: 'ประเภทบรรจุภัณฑ์ / สินค้า', kind: 'checks', options: ['กล่องลังพลาสติก/กระดาษ', 'ถาดชิ้นส่วนอะไหล่', 'รถเข็น (Trolley)', 'พาเลทไม้/พลาสติก', 'อื่นๆ'] },
      { key: 'cargoTypeOther', label: 'ระบุประเภทอื่นๆ', kind: 'text' },
      { key: 'cargoWidthCm', label: 'ขนาดกว้าง (W)', kind: 'number', unit: 'cm' },
      { key: 'cargoLengthCm', label: 'ขนาดยาว (L)', kind: 'number', unit: 'cm' },
      { key: 'cargoHeightCm', label: 'ขนาดสูง (H)', kind: 'number', unit: 'cm' },
      { key: 'cargoLoadHeightCm', label: 'ความสูงจากพื้นถึงจุดวางสินค้า', kind: 'number', unit: 'cm' },
      { key: 'avgPayloadKg', label: 'น้ำหนักเฉลี่ยต่อเที่ยว', kind: 'number', unit: 'kg' },
      { key: 'maxPayloadKg', label: 'น้ำหนักสูงสุดที่ต้องยก/ลาก', kind: 'number', unit: 'kg' },
      { key: 'distancePerTripM', label: 'ระยะทางวิ่งต่อเที่ยว (ไป-กลับ)', kind: 'number', unit: 'm' },
      { key: 'stationCount', label: 'จำนวนจุดจอดส่ง (Station)', kind: 'number', unit: 'จุด' },
      { key: 'targetTripsPerShift', label: 'เป้าหมายรอบการวิ่ง (ต่อกะ 8 ชม.)', kind: 'number', unit: 'เที่ยว' },
      { key: 'workHoursPerDay', label: 'ชั่วโมงทำงานต่อวัน', kind: 'number', unit: 'ชม./วัน' },
    ],
  },
  {
    title: '3. ระบบสื่อสาร และโครงสร้างพื้นฐาน (Infrastructure & System Integration)',
    fields: [
      { key: 'wifiRssiDbm', label: 'ระดับความเข้มสัญญาณ Wi-Fi (RSSI)', kind: 'number', unit: 'dBm' },
      { key: 'wifiBand', label: 'ความถี่ที่รองรับ', kind: 'checks', options: ['2.4 GHz', '5 GHz', 'มีจุดอับสัญญาณ'] },
      { key: 'wifiDeadZone', label: 'ระบุจุดอับสัญญาณ', kind: 'text' },
      { key: 'autoDoorCount', label: 'จำนวนประตูอัตโนมัติที่ต้องผ่าน', kind: 'number', unit: 'บาน' },
      { key: 'doorControlType', label: 'ระบบควบคุมประตู', kind: 'checks', options: ['Dry Contact', 'Wi-Fi Relay'] },
      { key: 'elevatorCrossing', label: 'การข้ามชั้นด้วยลิฟต์', kind: 'select', options: ['ไม่ต้องข้ามชั้น', 'ข้ามชั้น'] },
      { key: 'elevatorModel', label: 'โมเดลลิฟต์ (ถ้าข้ามชั้น)', kind: 'text' },
      { key: 'chargingAreaWidthCm', label: 'พื้นที่วางแท่นชาร์จ - กว้าง', kind: 'number', unit: 'cm' },
      { key: 'chargingAreaLengthCm', label: 'พื้นที่วางแท่นชาร์จ - ยาว', kind: 'number', unit: 'cm' },
      { key: 'powerReady', label: 'ระบบไฟฟ้าที่เตรียมไว้', kind: 'checks', options: ['AC 220V 16A Single Phase', 'เบรกเกอร์แยกเฉพาะ'] },
    ],
  },
  {
    title: '5. สรุปผลประเมิน และการเลือกรุ่นที่แนะนำ (Survey Summary & Model Selection)',
    fields: [
      { key: 'feasibility', label: 'สรุปความพร้อมหน้างาน', kind: 'select', options: ['พร้อมติดตั้งใช้งานได้ทันที (Site Ready)', 'ต้องปรับปรุงพื้นที่/ระบบ', 'ไม่ผ่านเกณฑ์'] },
      { key: 'feasibilityNote', label: 'รายละเอียด/เหตุผล', kind: 'textarea' },
      { key: 'recommendedModel', label: 'รุ่นหุ่นยนต์ที่วิศวกรแนะนำ', kind: 'checks', options: ['PUDU T150', 'PUDU T300', 'PUDU T600 / Underride', 'PUDU MP2000'] },
      { key: 'quantityNeeded', label: 'จำนวนที่ต้องใช้รวม', kind: 'number', unit: 'คัน' },
      { key: 'notes', label: 'หมายเหตุเพิ่มเติม', kind: 'textarea' },
    ],
  },
];

export const CLEANING_SECTIONS: SurveySection[] = [
  {
    title: '1. การวิเคราะห์ประเภทพื้นผิว และวัสดุ (Surface Material Analysis)',
    fields: [
      { key: 'floorMaterial', label: 'ประเภทวัสดุพื้นผิว', kind: 'text', placeholder: 'Epoxy, PU, คอนกรีตขัดมัน, หินขัด, กระเบื้องยาง ฯลฯ' },
      { key: 'floorSmoothness', label: 'สภาพความเรียบ', kind: 'text' },
      { key: 'frictionLevel', label: 'ระดับความลื่นพื้นผิว', kind: 'text' },
      { key: 'hasWaxCoating', label: 'มีสารเคลือบเงา/Wax หรือไม่', kind: 'select', options: ['มี', 'ไม่มี'] },
      { key: 'expansionJointMm', label: 'ความกว้างรอยต่อ Expansion Joint', kind: 'number', unit: 'mm' },
      { key: 'stepHeightMm', label: 'ความสูงธรณีประตู/สเต็ปพื้น', kind: 'number', unit: 'mm' },
      { key: 'maxSlopeDeg', label: 'ความชันสูงสุดวัดได้', kind: 'number', unit: '°' },
      { key: 'slopeLengthM', label: 'ความยาวทางลาด', kind: 'number', unit: 'm' },
    ],
  },
  {
    title: '2. ลักษณะคราบสกปรก และประเภทสิ่งปนเปื้อน (Contaminant & Waste Types)',
    fields: [
      { key: 'dustType', label: 'ชนิดฝุ่น/ขยะ', kind: 'text', placeholder: 'เช่น ฝุ่นปูน, ฝุ่นไม้, เศษพลาสติก' },
      { key: 'dustDensity', label: 'ความหนาแน่นฝุ่น', kind: 'checks', options: ['ฝุ่นบางปานกลาง', 'ฝุ่นหนาแน่นสูง', 'เศษขยะชิ้นใหญ่ (เกิน 2 cm)'] },
      { key: 'wetContaminantType', label: 'ชนิดคราบเปียก/น้ำมัน', kind: 'text', placeholder: 'เช่น น้ำสะอาดขัง, คราบน้ำมันเครื่อง, สารเคมี' },
      { key: 'stickinessLevel', label: 'ระดับความเหนียว/คราบติดแน่น', kind: 'text' },
      { key: 'detergentUsed', label: 'น้ำยาทำความสะอาดที่ใช้อยู่ปัจจุบัน', kind: 'text' },
      { key: 'phLevel', label: 'ระดับค่า pH ที่โรงงานอนุญาตให้ใช้', kind: 'number' },
    ],
  },
  {
    title: '3. ขนาดพื้นที่ และกรอบเวลาการทำงาน (Area Size & Operating Window)',
    fields: [
      { key: 'totalAreaSqm', label: 'พื้นที่รวมทั้งหมด', kind: 'number', unit: 'ตร.ม.' },
      { key: 'netAreaSqm', label: 'พื้นที่สุทธิหลังหักเครื่องจักร/ชั้นวาง', kind: 'number', unit: 'ตร.ม.' },
      { key: 'windowFrom', label: 'เวลาที่อนุญาตให้เข้าทำงาน (ตั้งแต่)', kind: 'text', placeholder: 'HH:MM' },
      { key: 'windowTo', label: 'เวลาที่อนุญาตให้เข้าทำงาน (ถึง)', kind: 'text', placeholder: 'HH:MM' },
      { key: 'shiftType', label: 'รูปแบบกะการทำงาน', kind: 'select', options: ['กะดึกเท่านั้น', 'ทำงานระหว่างสายผลิตวิ่ง', '24 ชั่วโมง'] },
    ],
  },
  {
    title: '4. ระบบสาธารณูปโภค และจุดติดตั้ง Workstation (Utilities & Docking Station)',
    fields: [
      { key: 'waterDistanceM', label: 'จุดเติมน้ำสะอาด - ระยะห่างจากพื้นที่ทำงาน', kind: 'number', unit: 'm' },
      { key: 'waterPressureBar', label: 'แรงดันน้ำดีหน้างาน', kind: 'number', unit: 'Bar' },
      { key: 'waterInletInch', label: 'ขนาดหัวต่อเกลียวก๊อกน้ำ', kind: 'text', unit: 'นิ้ว' },
      { key: 'waterReady', label: 'ความพร้อมจุดต่อน้ำ', kind: 'select', options: ['มีจุดต่อพร้อมใช้งาน', 'ต้องเดินท่อเพิ่ม'] },
      { key: 'drainageType', label: 'ลักษณะจุดระบายน้ำเสีย', kind: 'select', options: ['ท่อระบายน้ำทิ้งระดับพื้น', 'ถังดักไขมัน/คราบ', 'บ่อพักน้ำเสีย'] },
      { key: 'drainHeightCm', label: 'ระดับความสูงของท่อทิ้งน้ำจากพื้น', kind: 'number', unit: 'cm' },
      { key: 'drainFlow', label: 'การระบายน้ำ', kind: 'select', options: ['ไหลด้วยแรงโน้มถ่วง', 'มีปั๊มสูบ'] },
      { key: 'powerVoltage', label: 'แรงดันไฟฟ้า', kind: 'select', options: ['AC 220V 16A', 'AC 380V Three Phase'] },
      { key: 'breakerSeparate', label: 'เบรกเกอร์แยก', kind: 'select', options: ['มี', 'ไม่มี'] },
      { key: 'workstationWidthCm', label: 'พื้นที่วาง Workstation - กว้าง', kind: 'number', unit: 'cm' },
      { key: 'workstationLengthCm', label: 'พื้นที่วาง Workstation - ยาว', kind: 'number', unit: 'cm' },
      { key: 'workstationHeightCm', label: 'พื้นที่วาง Workstation - สูง', kind: 'number', unit: 'cm' },
      { key: 'wifiDbm', label: 'ความเข้มสัญญาณ Wi-Fi ในพื้นที่', kind: 'number', unit: 'dBm' },
      { key: 'wifiBand', label: 'ย่านความถี่ Wi-Fi', kind: 'checks', options: ['2.4 GHz', '5 GHz', 'สัญญาณครอบคลุม 100%', 'มีจุดอับสัญญาณ'] },
      { key: 'wifiDeadZone', label: 'ระบุจุดอับสัญญาณ (ถ้ามี)', kind: 'text' },
    ],
  },
  {
    title: '6. สรุปผลประเมิน และโมเดลทำความสะอาดที่แนะนำ (Survey Summary & Recommendation)',
    fields: [
      { key: 'feasibility', label: 'สรุปความพร้อมหน้างาน', kind: 'select', options: ['พร้อมติดตั้งใช้งานได้ทันที (Site Ready)', 'ต้องเตรียมจุดน้ำดี/น้ำเสีย/ไฟฟ้าเพิ่มเติม', 'ต้องปรับปรุงสภาพพื้นผิว/รอยต่อพื้นก่อนติดตั้ง'] },
      { key: 'feasibilityNote', label: 'รายละเอียด/เหตุผล', kind: 'textarea' },
      { key: 'recommendedModel', label: 'รุ่นหุ่นยนต์ทำความสะอาดที่แนะนำ', kind: 'checks', options: ['PUDU CC1 / CC1 Pro', 'PUDU MT1 / MT1 Max / MT1 Vac', 'PUDU BG1 / BG1 Pro'] },
      { key: 'quantityNeeded', label: 'จำนวนที่ต้องใช้รวม', kind: 'number', unit: 'คัน' },
      { key: 'notes', label: 'หมายเหตุเพิ่มเติม', kind: 'textarea' },
    ],
  },
];

export const SURVEY_TITLES: Record<SurveyFormType, string> = {
  amr: 'แบบฟอร์มสำรวจหน้างาน: หุ่นยนต์ขนส่งอุตสาหกรรม (AMR)',
  cleaning: 'แบบฟอร์มสำรวจหน้างาน: หุ่นยนต์ทำความสะอาดอุตสาหกรรม',
};

export const surveySections = (formType: SurveyFormType): SurveySection[] => (formType === 'amr' ? AMR_SECTIONS : CLEANING_SECTIONS);
