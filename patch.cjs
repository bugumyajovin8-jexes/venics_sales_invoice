const fs = require('fs');
let content = fs.readFileSync('src/utils/pdfGenerator.ts', 'utf8');

const target = `  // -- Totals block --
  currentY += 4;
  
  const originalTotal = saleItems.reduce((sum, item) => sum + (item.sell_price * item.qty), 0);
  const discountAmount = originalTotal > sale.total_amount ? originalTotal - sale.total_amount : 0;
  
  const isVatOn = !!sale.is_vat;
  const subtotalExclVat = isVatOn ? (sale.total_amount / 1.18) : sale.total_amount;
  const vatAmount = isVatOn ? (sale.total_amount - subtotalExclVat) : 0;

  doc.setFont('Helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(textColor[0], textColor[1], textColor[2]);

  if (discountAmount > 0) {
    doc.text('Total Before Discount:', 100, currentY + 2);
    doc.text(formatCurrency(originalTotal, currency), 165, currentY + 2);
    currentY += 5;
    
    doc.setTextColor(220, 38, 38); // Red-600
    doc.text('Discount Applied:', 100, currentY + 2);
    doc.text(\`-\${formatCurrency(discountAmount, currency)}\`, 165, currentY + 2);
    doc.setTextColor(textColor[0], textColor[1], textColor[2]);
    currentY += 5;
  }

  doc.text('Subtotal (Excl. VAT):', 100, currentY + 2);
  doc.text(formatCurrency(subtotalExclVat, currency), 165, currentY + 2);`;

const replacement = `  // -- Totals block --
  currentY += 4;
  
  const isVatOn = !!sale.is_vat;
  const subtotalExclVat = isVatOn ? (sale.total_amount / 1.18) : sale.total_amount;
  const vatAmount = isVatOn ? (sale.total_amount - subtotalExclVat) : 0;

  doc.setFont('Helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(textColor[0], textColor[1], textColor[2]);

  doc.text('Subtotal (Excl. VAT):', 100, currentY + 2);
  doc.text(formatCurrency(subtotalExclVat, currency), 165, currentY + 2);`;

content = content.split(target).join(replacement);
fs.writeFileSync('src/utils/pdfGenerator.ts', content);
