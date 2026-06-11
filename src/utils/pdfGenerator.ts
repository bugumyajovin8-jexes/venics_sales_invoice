import { jsPDF } from 'jspdf';
import { formatCurrency } from './format';
import { format } from 'date-fns';

const printPdf = (doc: jsPDF) => {
  try {
    doc.autoPrint();
    const blobUrl = doc.output('bloburl');
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.src = String(blobUrl);
    document.body.appendChild(iframe);
    
    iframe.onload = () => {
      setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
          setTimeout(() => {
            try {
              document.body.removeChild(iframe);
            } catch (e) {
              // ignore if already removed
            }
          }, 30000);
        } catch (err) {
          console.error("Iframe print error", err);
        }
      }, 500);
    };
  } catch (error) {
    console.error("Failed to trigger printing", error);
  }
};

interface Sale {
  id: string;
  shop_id: string;
  user_id: string;
  total_amount: number;
  total_profit: number;
  is_credit: boolean;
  is_paid: boolean;
  payment_method: string;
  status: string;
  customer_name?: string;
  customer_phone?: string;
  due_date?: string;
  date: string;
  is_vat?: boolean;
  created_at: string;
  updated_at: string;
}

interface SaleItem {
  id: string;
  sale_id: string;
  shop_id: string;
  product_id: string;
  product_name: string;
  qty: number;
  buy_price: number;
  sell_price: number;
}

interface ShopSettings {
  shopName?: string;
  name?: string; // Merge alias
  currency?: string;
  phone?: string;
  whatsapp_phone?: string;
  owner_name?: string;
}

export const generateCreditInvoice = (
  sale: Sale,
  saleItems: SaleItem[],
  shopSettings: ShopSettings | null,
  userName?: string
) => {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });
  
  // Custom theme colors
  const primaryColor = [15, 23, 42]; // Slate-900 (deep dark blue)
  const secondaryColor = [37, 99, 235]; // Blue-600
  const textColor = [51, 65, 85]; // Slate-700
  const lightGrey = [248, 250, 252]; // Slate-50 background tint
  const borderGrey = [226, 232, 240]; // Slate-200 border
  const accentRed = [220, 38, 38]; // Red-600 (for warning/due date of mkopo)

  // Document setup details
  const shopName = shopSettings?.name || shopSettings?.shopName || 'YOUR SHOP';
  const currency = shopSettings?.currency || 'TZS';
  const shopPhone = shopSettings?.phone || shopSettings?.whatsapp_phone || '';
  const shopOwner = shopSettings?.owner_name || '';

  // Brand Header Accent Line (thick top border color)
  doc.setFillColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
  doc.rect(0, 0, 210, 8, 'F');

  // Title Column (Right aligned)
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.text(shopName.toUpperCase(), 15, 28);

  // Shop Info subtitle
  doc.setFont('Helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(textColor[0], textColor[1], textColor[2]);
  let headerY = 34;
  if (shopOwner) {
    doc.text(`Owner: ${shopOwner}`, 15, headerY);
    headerY += 5;
  }
  if (shopPhone) {
    doc.text(`Phone: ${shopPhone}`, 15, headerY);
    headerY += 5;
  }

  // Document Type Header Box on Right
  doc.setFillColor(lightGrey[0], lightGrey[1], lightGrey[2]);
  doc.rect(130, 20, 65, 28, 'F');
  // Stroke around type box
  doc.setDrawColor(borderGrey[0], borderGrey[1], borderGrey[2]);
  doc.rect(130, 20, 65, 28, 'S');

  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
  doc.text('SALES INVOICE', 135, 27);
  doc.setFontSize(9);
  doc.setTextColor(textColor[0], textColor[1], textColor[2]);
  doc.text('INVOICE', 135, 31);

  // Invoice Number and Date
  doc.setFont('Helvetica', 'bold');
  doc.text('Invoice No:', 135, 38);
  doc.setFont('Helvetica', 'normal');
  doc.text(`${sale.id.slice(0, 8).toUpperCase()}`, 164, 38);

  doc.setFont('Helvetica', 'bold');
  doc.text('Date:', 135, 43);
  doc.setFont('Helvetica', 'normal');
  const saleDateStr = sale.date ? format(new Date(sale.date), 'dd/MM/yyyy HH:mm') : format(new Date(), 'dd/MM/yyyy HH:mm');
  doc.text(saleDateStr, 149, 43);

  // Divider Line
  doc.setDrawColor(borderGrey[0], borderGrey[1], borderGrey[2]);
  doc.setLineWidth(0.5);
  doc.line(15, 52, 195, 52);

  // Customer and payment information block
  // Draw two light panels
  doc.setFillColor(lightGrey[0], lightGrey[1], lightGrey[2]);
  // Left Panel - Customer Info
  doc.rect(15, 58, 85, 30, 'F');
  doc.rect(15, 58, 85, 30, 'S');

  // Right Panel - Payment Info
  doc.rect(110, 58, 85, 30, 'F');
  doc.rect(110, 58, 85, 30, 'S');

  // Customer Info Content
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.text('CUSTOMER', 20, 64);

  doc.setFontSize(9);
  doc.setTextColor(textColor[0], textColor[1], textColor[2]);
  doc.setFont('Helvetica', 'bold');
  doc.text('Name:', 20, 71);
  doc.setFont('Helvetica', 'normal');
  doc.text(sale.customer_name || 'Not Specified', 31, 71);

  doc.setFont('Helvetica', 'bold');
  doc.text('Phone:', 20, 77);
  doc.setFont('Helvetica', 'normal');
  doc.text(sale.customer_phone || '-', 31, 77);

  // Payment Info Content
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.text('DUE DATE', 115, 64);

  doc.setFontSize(9);
  doc.setTextColor(textColor[0], textColor[1], textColor[2]);
  doc.setFont('Helvetica', 'bold');
  doc.text('Payment Method:', 115, 71);
  doc.setFont('Helvetica', 'normal');
  doc.text('Pay Later / Invoice Account', 145, 71);

  doc.setFont('Helvetica', 'bold');
  doc.text('Due Date: ' , 115, 77);
  doc.setFont('Helvetica', 'bold');
  doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
  const dueDateStr = sale.due_date ? format(new Date(sale.due_date), 'dd/MM/yyyy') : 'Not Set';
  doc.text(dueDateStr, 142, 77);

  // Reset text color
  doc.setTextColor(textColor[0], textColor[1], textColor[2]);

  // -- Table Header --
  const tableY = 96;
  doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.rect(15, tableY, 180, 8, 'F');

  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  doc.text('#', 18, tableY + 5.5);
  doc.text('Item Name', 27, tableY + 5.5);
  doc.text('Qty', 105, tableY + 5.5);
  doc.text('Unit Price', 130, tableY + 5.5);
  doc.text('Subtotal', 165, tableY + 5.5);

  // -- Table Rows --
  let currentY = tableY + 8;
  doc.setFontSize(9);
  doc.setTextColor(textColor[0], textColor[1], textColor[2]);
  
  saleItems.forEach((item, index) => {
    // Alternating rows shading
    if (index % 2 === 1) {
      doc.setFillColor(lightGrey[0], lightGrey[1], lightGrey[2]);
      doc.rect(15, currentY, 180, 8, 'F');
    }

    // Border bottom under each row
    doc.setDrawColor(borderGrey[0], borderGrey[1], borderGrey[2]);
    doc.setLineWidth(0.1);
    doc.line(15, currentY + 8, 195, currentY + 8);

    doc.setFont('Helvetica', 'normal');
    doc.text((index + 1).toString(), 18, currentY + 5.5);
    
    // Product name truncated if too long
    const prodName = item.product_name.length > 38 ? item.product_name.slice(0, 36) + '...' : item.product_name;
    doc.text(prodName, 27, currentY + 5.5);
    
    doc.text(`${item.qty}`, 105, currentY + 5.5);
    doc.text(formatCurrency(item.sell_price, currency), 130, currentY + 5.5);
    doc.text(formatCurrency(item.sell_price * item.qty, currency), 165, currentY + 5.5);

    currentY += 8;
  });

  // -- Totals block --
  currentY += 4;
  
  const isVatOn = !!sale.is_vat;
  const subtotalExclVat = isVatOn ? (sale.total_amount / 1.18) : sale.total_amount;
  const vatAmount = isVatOn ? (sale.total_amount - subtotalExclVat) : 0;
  const grandTotal = sale.total_amount;

  doc.setFont('Helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(textColor[0], textColor[1], textColor[2]);

  doc.text('Subtotal (Excl. VAT):', 100, currentY + 2);
  doc.text(formatCurrency(subtotalExclVat, currency), 165, currentY + 2);

  currentY += 5;
  doc.text('V.A.T (18%):', 100, currentY + 2);
  doc.text(formatCurrency(vatAmount, currency), 165, currentY + 2);

  currentY += 6;
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.text('GRAND TOTAL:', 100, currentY + 2);
  
  doc.setFontSize(12);
  doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
  doc.text(formatCurrency(grandTotal, currency), 165, currentY + 2);

  currentY += 15;

  // Ensure signatures fit cleanly
  if (currentY > 230) {
    doc.addPage();
    currentY = 20;
    // Redraw colored top bar on next page too
    doc.setFillColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
    doc.rect(0, 0, 210, 8, 'F');
  }

  // Terms and condition container is removed from invoice as requested
  currentY += 10;

  // Signatures
  doc.setFont('Helvetica', 'normal');
  doc.setFontSize(9);
  doc.setLineWidth(0.3);
  doc.setDrawColor(textColor[0], textColor[1], textColor[2]);

  // Customer line
  doc.line(15, currentY + 14, 85, currentY + 14);
  doc.text('Customer Signature', 15, currentY + 18);

  // Shop seller line with Automated Digital Stamp
  const stampX = 135;
  const stampY = currentY - 2;

  // Outer rectangle of the stamp (elegant double-border look using secondary color)
  doc.setDrawColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
  doc.setLineWidth(0.5);
  doc.rect(stampX, stampY, 52, 14); // 52mm x 14mm
  
  // Inner subtle border
  doc.setLineWidth(0.25);
  doc.rect(stampX + 1, stampY + 1, 50, 12);
  
  // Stamp Content text
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
  doc.text(shopName.toUpperCase(), stampX + 26, stampY + 4, { align: 'center' });
  
  // Handwritten-looking script signature
  doc.setFont('Times-BoldItalic', 'italic');
  doc.setFontSize(9.5);
  doc.setTextColor(textColor[0], textColor[1], textColor[2]);
  doc.text(userName ? `Signed: ${userName}` : 'Approved Official', stampX + 26, stampY + 8.5, { align: 'center' });
  
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(5.5);
  doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
  doc.text('VERIFIED DIGITAL STAMP', stampX + 26, stampY + 12, { align: 'center' });

  // Reset drawing styles & text under the stamp
  doc.setDrawColor(textColor[0], textColor[1], textColor[2]);
  doc.setTextColor(textColor[0], textColor[1], textColor[2]);
  doc.setFont('Helvetica', 'normal');
  doc.setFontSize(9);
  doc.line(125, currentY + 14, 195, currentY + 14);
  doc.text('Authorized Seller Stamp & Signature', 125, currentY + 18);

  // Footer Accent Bottom Line
  const footerY = 282;
  doc.setDrawColor(borderGrey[0], borderGrey[1], borderGrey[2]);
  doc.line(15, footerY, 195, footerY);
  
  doc.setFontSize(7.5);
  doc.setTextColor(148, 163, 184); // Slate-400
  doc.text('This invoice was automatically generated by Venics Sales System.', 15, footerY + 5);
  doc.text(`Unique Reference Number: ${sale.id}`, 15, footerY + 9);

  // Save the document with clean filename
  const customerNameClean = (sale.customer_name || 'customer').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  doc.save(`invoice_${customerNameClean}_${sale.id.slice(0, 8)}.pdf`);
  printPdf(doc);
};

export const generateReceipt = (
  sale: Sale,
  saleItems: SaleItem[],
  shopSettings: ShopSettings | null,
  userName?: string
) => {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });
  
  // Custom theme colors (Emerald highlight for receipt/sucessful payment)
  const primaryColor = [15, 23, 42]; // Slate-900 (deep dark blue)
  const secondaryColor = [16, 185, 129]; // Emerald-500
  const textColor = [51, 65, 85]; // Slate-700
  const lightGrey = [248, 250, 252]; // Slate-50 background tint
  const borderGrey = [226, 232, 240]; // Slate-200 border

  // Document setup details
  const shopName = shopSettings?.name || shopSettings?.shopName || 'YOUR SHOP';
  const currency = shopSettings?.currency || 'TZS';
  const shopPhone = shopSettings?.phone || shopSettings?.whatsapp_phone || '';
  const shopOwner = shopSettings?.owner_name || '';

  // Brand Header Accent Line (thick top border color)
  doc.setFillColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
  doc.rect(0, 0, 210, 8, 'F');

  // Title Column
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.text(shopName.toUpperCase(), 15, 28);

  // Shop Info subtitle
  doc.setFont('Helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(textColor[0], textColor[1], textColor[2]);
  let headerY = 34;
  if (shopOwner) {
    doc.text(`Owner: ${shopOwner}`, 15, headerY);
    headerY += 5;
  }
  if (shopPhone) {
    doc.text(`Phone: ${shopPhone}`, 15, headerY);
    headerY += 5;
  }
  if (userName) {
    doc.text(`Seller: ${userName}`, 15, headerY);
    headerY += 5;
  }

  // Document Type Header Box on Right
  doc.setFillColor(lightGrey[0], lightGrey[1], lightGrey[2]);
  doc.rect(130, 20, 65, 28, 'F');
  doc.setDrawColor(borderGrey[0], borderGrey[1], borderGrey[2]);
  doc.rect(130, 20, 65, 28, 'S');

  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
  doc.text('SALES RECEIPT', 135, 27);
  doc.setFontSize(9);
  doc.setTextColor(textColor[0], textColor[1], textColor[2]);
  doc.text('RECEIPT', 135, 31);

  // Receipt Number and Date
  doc.setFont('Helvetica', 'bold');
  doc.text('Receipt No:', 135, 38);
  doc.setFont('Helvetica', 'normal');
  doc.text(`${sale.id.slice(0, 8).toUpperCase()}`, 164, 38);

  doc.setFont('Helvetica', 'bold');
  doc.text('Date:', 135, 43);
  doc.setFont('Helvetica', 'normal');
  const saleDateStr = sale.date ? format(new Date(sale.date), 'dd/MM/yyyy HH:mm') : format(new Date(), 'dd/MM/yyyy HH:mm');
  doc.text(saleDateStr, 149, 43);

  // Divider Line
  doc.setDrawColor(borderGrey[0], borderGrey[1], borderGrey[2]);
  doc.setLineWidth(0.5);
  doc.line(15, 52, 195, 52);

  // Customer and payment information block
  doc.setFillColor(lightGrey[0], lightGrey[1], lightGrey[2]);
  // Left Panel - Customer Info
  doc.rect(15, 58, 85, 30, 'F');
  doc.rect(15, 58, 85, 30, 'S');

  // Right Panel - Payment Info
  doc.rect(110, 58, 85, 30, 'F');
  doc.rect(110, 58, 85, 30, 'S');

  // Customer Info Content
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.text('CUSTOMER', 20, 64);

  doc.setFontSize(9);
  doc.setTextColor(textColor[0], textColor[1], textColor[2]);
  doc.setFont('Helvetica', 'bold');
  doc.text('Name:', 20, 71);
  doc.setFont('Helvetica', 'normal');
  doc.text(sale.customer_name || 'Walk-in Customer', 31, 71);

  doc.setFont('Helvetica', 'bold');
  doc.text('Phone:', 20, 77);
  doc.setFont('Helvetica', 'normal');
  doc.text(sale.customer_phone || '-', 31, 77);

  // Payment Info Content
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.text('PAYMENT STATUS', 115, 64);

  const getPaymentMethodLabel = (method: string) => {
    switch (method?.toLowerCase()) {
      case 'cash': return 'Cash';
      case 'mobile_money': return 'Mobile Money';
      case 'credit': return 'Invoice';
      default: return 'Cash';
    }
  };

  doc.setFontSize(9);
  doc.setTextColor(textColor[0], textColor[1], textColor[2]);
  doc.setFont('Helvetica', 'bold');
  doc.text('Payment Method:', 115, 71);
  doc.setFont('Helvetica', 'normal');
  doc.text(getPaymentMethodLabel(sale.payment_method), 145, 71);

  doc.setFont('Helvetica', 'bold');
  doc.text('Receipt Status:', 115, 77);
  doc.setFont('Helvetica', 'bold');
  doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
  doc.text('FULLY PAID', 142, 77);

  // Reset text color
  doc.setTextColor(textColor[0], textColor[1], textColor[2]);

  // -- Table Header --
  const tableY = 96;
  doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.rect(15, tableY, 180, 8, 'F');

  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  doc.text('#', 18, tableY + 5.5);
  doc.text('Item Name', 27, tableY + 5.5);
  doc.text('Qty', 105, tableY + 5.5);
  doc.text('Unit Price', 130, tableY + 5.5);
  doc.text('Subtotal', 165, tableY + 5.5);

  // -- Table Rows --
  let currentY = tableY + 8;
  doc.setFontSize(9);
  doc.setTextColor(textColor[0], textColor[1], textColor[2]);
  
  saleItems.forEach((item, index) => {
    if (index % 2 === 1) {
      doc.setFillColor(lightGrey[0], lightGrey[1], lightGrey[2]);
      doc.rect(15, currentY, 180, 8, 'F');
    }

    doc.setDrawColor(borderGrey[0], borderGrey[1], borderGrey[2]);
    doc.setLineWidth(0.1);
    doc.line(15, currentY + 8, 195, currentY + 8);

    doc.setFont('Helvetica', 'normal');
    doc.text((index + 1).toString(), 18, currentY + 5.5);
    
    const prodName = item.product_name.length > 38 ? item.product_name.slice(0, 36) + '...' : item.product_name;
    doc.text(prodName, 27, currentY + 5.5);
    
    doc.text(`${item.qty}`, 105, currentY + 5.5);
    doc.text(formatCurrency(item.sell_price, currency), 130, currentY + 5.5);
    doc.text(formatCurrency(item.sell_price * item.qty, currency), 165, currentY + 5.5);

    currentY += 8;
  });

  // -- Totals block --
  currentY += 4;
  
  const isVatOn = !!sale.is_vat;
  const subtotalExclVat = isVatOn ? (sale.total_amount / 1.18) : sale.total_amount;
  const vatAmount = isVatOn ? (sale.total_amount - subtotalExclVat) : 0;
  const grandTotal = sale.total_amount;

  doc.setFont('Helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(textColor[0], textColor[1], textColor[2]);

  doc.text('Subtotal (Excl. VAT):', 100, currentY + 2);
  doc.text(formatCurrency(subtotalExclVat, currency), 165, currentY + 2);

  currentY += 5;
  doc.text('V.A.T (18%):', 100, currentY + 2);
  doc.text(formatCurrency(vatAmount, currency), 165, currentY + 2);

  currentY += 6;
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.text('GRAND TOTAL:', 100, currentY + 2);
  
  doc.setFontSize(12);
  doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
  doc.text(formatCurrency(grandTotal, currency), 165, currentY + 2);

  currentY += 15;

  // Ensure signatures fit cleanly
  if (currentY > 230) {
    doc.addPage();
    currentY = 20;
    doc.setFillColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
    doc.rect(0, 0, 210, 8, 'F');
  }

  // Terms and condition container is removed from receipt as requested
  currentY += 10;

  // Signatures
  doc.setFont('Helvetica', 'normal');
  doc.setFontSize(9);
  doc.setLineWidth(0.3);
  doc.setDrawColor(textColor[0], textColor[1], textColor[2]);

  // Customer line
  doc.line(15, currentY + 14, 85, currentY + 14);
  doc.text('Customer Signature', 15, currentY + 18);

  // Shop seller line with Automated Digital Stamp
  const stampX = 135;
  const stampY = currentY - 2;

  // Outer rectangle of the stamp (elegant double-border look using secondary color)
  doc.setDrawColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
  doc.setLineWidth(0.5);
  doc.rect(stampX, stampY, 52, 14); // 52mm x 14mm
  
  // Inner subtle border
  doc.setLineWidth(0.25);
  doc.rect(stampX + 1, stampY + 1, 50, 12);
  
  // Stamp Content text
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
  doc.text(shopName.toUpperCase(), stampX + 26, stampY + 4, { align: 'center' });
  
  // Handwritten-looking script signature
  doc.setFont('Times-BoldItalic', 'italic');
  doc.setFontSize(9.5);
  doc.setTextColor(textColor[0], textColor[1], textColor[2]);
  doc.text(userName ? `Signed: ${userName}` : 'Approved Official', stampX + 26, stampY + 8.5, { align: 'center' });
  
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(5.5);
  doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
  doc.text('VERIFIED DIGITAL STAMP', stampX + 26, stampY + 12, { align: 'center' });

  // Reset drawing styles & text under the stamp
  doc.setDrawColor(textColor[0], textColor[1], textColor[2]);
  doc.setTextColor(textColor[0], textColor[1], textColor[2]);
  doc.setFont('Helvetica', 'normal');
  doc.setFontSize(9);
  doc.line(125, currentY + 14, 195, currentY + 14);
  doc.text('Authorized Seller Stamp & Signature', 125, currentY + 18);

  // Footer Accent Bottom Line
  const footerY = 282;
  doc.setDrawColor(borderGrey[0], borderGrey[1], borderGrey[2]);
  doc.line(15, footerY, 195, footerY);
  
  doc.setFontSize(7.5);
  doc.setTextColor(148, 163, 184); // Slate-400
  doc.text('This receipt was automatically generated by Venics Sales System.', 15, footerY + 5);
  doc.text(`Unique Reference Number: ${sale.id}`, 15, footerY + 9);

  // Save the document with clean filename
  const customerNameClean = (sale.customer_name || 'customer').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  doc.save(`receipt_${customerNameClean}_${sale.id.slice(0, 8)}.pdf`);
  printPdf(doc);
};
