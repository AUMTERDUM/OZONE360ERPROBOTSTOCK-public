import { jsPDF } from 'jspdf';

/**
 * Draws the OZONE360 Robotics Service logo in a PDF document.
 * @param doc - jsPDF instance
 * @param x   - left position in mm
 * @param y   - top position (center of circle) in mm
 */
export function drawPdfLogo(doc: jsPDF, x: number, y: number) {
  const circleX = x + 11;
  const circleY = y + 9;

  // Outer orange circle ring
  doc.setDrawColor(249, 115, 22);
  doc.setLineWidth(1.8);
  doc.circle(circleX, circleY, 9, 'S');

  // Inner faint ring
  doc.setLineWidth(0.6);
  doc.circle(circleX, circleY, 4.8, 'S');

  // Center dot
  doc.setFillColor(249, 115, 22);
  doc.circle(circleX, circleY, 1.3, 'F');

  // OZONE360° bold text
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(30, 58, 138); // blue-900
  doc.text('OZONE360\u00B0', x + 24, y + 7);

  // Robotics Service subtitle
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(30, 64, 175); // blue-700
  doc.text('Robotics Service', x + 24.5, y + 14);

  // Reset
  doc.setTextColor(0, 0, 0);
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.2);
}
