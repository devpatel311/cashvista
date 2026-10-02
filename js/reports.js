// ============================================================
// Cashvista – Reports Page JS
// ============================================================

async function initPage() {
  renderReports();
}

// ── Chart ───────────────────────────────────────────────────
async function renderReports() {
  const currency = state.user.currency || '₹';

  const res = await fetch(`${API_BASE}/reports/monthly`, { headers: getAuthHeaders() });
  if (!res.ok) return;
  const reportData = await res.json();

  if (state.charts.reports) state.charts.reports.destroy();
  const ctx = document.getElementById('chart-reports-comparison').getContext('2d');

  const labels   = reportData.map(r => r.month);
  const incomes  = reportData.map(r => r.income);
  const expenses = reportData.map(r => r.expenses);

  state.charts.reports = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Income',   data: incomes,  backgroundColor: '#10B981', borderRadius: 8 },
        { label: 'Expenses', data: expenses, backgroundColor: '#EF4444', borderRadius: 8 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { grid: { borderDash: [5, 5] } } }
    }
  });
}

// ── Timeframe filter helper ──────────────────────────────────
function getDateRangeForScope(scope) {
  const now = new Date();
  let start, label;

  switch (scope) {
    case 'last-3-months':
      start = new Date(now);
      start.setMonth(now.getMonth() - 3);
      label = 'Last 3 Months';
      break;
    case 'this-year':
      start = new Date(now.getFullYear(), 0, 1);
      label = `Full Calendar Year ${now.getFullYear()}`;
      break;
    case 'this-month':
    default:
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      label = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
  }

  return { start, end: now, label };
}

function filterTransactions(transactions, scope, category) {
  const { start, end } = getDateRangeForScope(scope);
  return transactions.filter(t => {
    const d = new Date(t.date);
    const inRange    = d >= start && d <= end;
    const inCategory = category === 'All' || t.category === category;
    return inRange && inCategory;
  });
}

// ── Toast notification ───────────────────────────────────────
function showExportToast(message, type = 'success') {
  const existing = document.getElementById('export-toast');
  if (existing) existing.remove();

  const colors = { success: '#059669', error: '#DC2626', info: '#334155' };
  const icons  = {
    success: '<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>',
    error:   '<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>',
    info:    '<path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20A10 10 0 0012 2z"/>'
  };

  const toast = document.createElement('div');
  toast.id = 'export-toast';
  toast.style.cssText = `
    position:fixed; bottom:96px; right:24px; z-index:9999;
    display:flex; align-items:center; gap:12px;
    padding:14px 20px; border-radius:16px; max-width:340px;
    background:${colors[type] || colors.success}; color:#fff;
    font-family:'Plus Jakarta Sans',sans-serif; font-size:13px; font-weight:600;
    box-shadow:0 20px 40px rgba(0,0,0,0.18);
    transform:translateY(16px); opacity:0;
    transition:all 0.3s cubic-bezier(0.34,1.56,0.64,1);
  `;
  toast.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" style="width:18px;height:18px;flex-shrink:0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
      ${icons[type] || icons.success}
    </svg>
    <span>${message}</span>`;

  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    toast.style.transform = 'translateY(0)';
    toast.style.opacity   = '1';
  });
  setTimeout(() => {
    toast.style.transform = 'translateY(16px)';
    toast.style.opacity   = '0';
    setTimeout(() => toast.remove(), 350);
  }, 4500);
}

// ── Button loading state ─────────────────────────────────────
function setExportBtnLoading(format, isLoading) {
  const btn = document.getElementById(`btn-export-${format}`);
  if (!btn) return;

  if (isLoading) {
    btn.disabled = true;
    btn.dataset.original = btn.innerHTML;
    btn.innerHTML = `
      <svg style="width:16px;height:16px;animation:spin 0.8s linear infinite" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" opacity=".25"/>
        <path fill="currentColor" opacity=".75" d="M4 12a8 8 0 018-8v8H4z"/>
      </svg>
      Generating ${format.toUpperCase()}…`;
  } else {
    btn.disabled = false;
    if (btn.dataset.original) btn.innerHTML = btn.dataset.original;
  }
}

// ── Main export dispatcher ───────────────────────────────────
async function simulateExport(format) {
  const scope    = document.getElementById('report-scope').value;
  const category = document.getElementById('report-category').value;

  setExportBtnLoading(format, true);

  try {
    const transactions = state.transactions || [];

    if (!transactions.length) {
      showExportToast('No transaction data loaded yet.', 'error');
      return;
    }

    const filtered = filterTransactions(transactions, scope, category);

    if (!filtered.length) {
      const { label } = getDateRangeForScope(scope);
      showExportToast(`No transactions for "${label}" / "${category}".`, 'info');
      return;
    }

    if (format === 'pdf') {
      await exportPDF(filtered, scope, category);
    } else {
      exportCSV(filtered, scope, category);
    }
  } catch (err) {
    console.error('[Cashvista Export Error]', err);
    showExportToast(`Export failed: ${err.message}`, 'error');
  } finally {
    setExportBtnLoading(format, false);
  }
}

// ── PDF Export (jsPDF + AutoTable) ───────────────────────────
async function exportPDF(transactions, scope, category) {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    throw new Error('jsPDF library not available. Please refresh the page.');
  }

  const { jsPDF }   = window.jspdf;
  const { label }   = getDateRangeForScope(scope);
  const currency    = state.user.currency || '₹';
  const username    = state.user?.username || 'User';
  const generatedAt = new Date().toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  const doc  = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // ── Header bar ──────────────────────────────────────────
  doc.setFillColor(15, 61, 58);
  doc.rect(0, 0, pageW, 40, 'F');

  doc.setFillColor(0, 217, 163);
  doc.rect(0, 38, pageW, 2, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text('CASHVISTA', 14, 16);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(180, 220, 215);
  doc.text('Personal Finance Intelligence Platform', 14, 24);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 217, 163);
  doc.text('LEDGER STATEMENT', 14, 34);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(180, 220, 215);
  doc.text(`Generated: ${generatedAt}`, pageW - 14, 16, { align: 'right' });
  doc.text(`Account  : ${username}`,    pageW - 14, 23, { align: 'right' });
  doc.text(`Period   : ${label}`,        pageW - 14, 30, { align: 'right' });
  doc.text(`Category : ${category}`,     pageW - 14, 37, { align: 'right' });

  // ── Summary metric boxes ─────────────────────────────────
  const totalIncome   = transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const totalExpenses = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const netSavings    = totalIncome - totalExpenses;

  const boxY = 46;
  const boxH = 24;
  const boxW = (pageW - 28 - 8) / 3;

  const boxes = [
    { label: 'TOTAL INCOME',   value: `${currency}${totalIncome.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,   bg: [220, 252, 231], fg: [5,  150, 105] },
    { label: 'TOTAL EXPENSES', value: `${currency}${totalExpenses.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, bg: [254, 226, 226], fg: [220, 38,  38]  },
    {
      label: 'NET SAVINGS',
      value: `${netSavings >= 0 ? '' : '-'}${currency}${Math.abs(netSavings).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
      bg: netSavings >= 0 ? [219, 234, 254] : [255, 237, 213],
      fg: netSavings >= 0 ? [37,  99,  235] : [234, 88,  12]
    }
  ];

  boxes.forEach((box, i) => {
    const x = 14 + i * (boxW + 4);
    doc.setFillColor(...box.bg);
    doc.roundedRect(x, boxY, boxW, boxH, 3, 3, 'F');

    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(100, 116, 139);
    doc.text(box.label, x + 4, boxY + 8);

    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...box.fg);
    doc.text(box.value, x + 4, boxY + 19);
  });

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(148, 163, 184);
  doc.text(`${transactions.length} transaction(s) included in this statement.`, 14, boxY + boxH + 6);

  // ── Transaction table ────────────────────────────────────
  const rows = transactions.map(t => [
    new Date(t.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
    t.description || '—',
    t.category,
    t.account,
    t.type.charAt(0).toUpperCase() + t.type.slice(1),
    `${t.type === 'expense' ? '-' : '+'}${currency}${Number(t.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
  ]);

  doc.autoTable({
    startY: boxY + boxH + 10,
    head: [['Date', 'Description', 'Category', 'Account', 'Type', 'Amount']],
    body: rows,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      cellPadding: 3.5,
      textColor: [30, 41, 59],
      lineColor: [226, 232, 240],
      lineWidth: 0.25
    },
    headStyles: {
      fillColor: [15, 61, 58],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8
    },
    columnStyles: {
      0: { cellWidth: 26 },
      1: { cellWidth: 54 },
      2: { cellWidth: 27 },
      3: { cellWidth: 27 },
      4: { cellWidth: 18 },
      5: { cellWidth: 34, halign: 'right', fontStyle: 'bold' }
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 5) {
        const isExpense = rows[data.row.index]?.[4] === 'Expense';
        data.cell.styles.textColor = isExpense ? [220, 38, 38] : [5, 150, 105];
      }
    },
    foot: [[
      { content: 'TOTALS', colSpan: 4, styles: { halign: 'right', fontStyle: 'bold', fillColor: [241, 245, 249], textColor: [30,41,59] } },
      { content: 'Income',   styles: { fontStyle: 'bold', fillColor: [220,252,231], textColor: [5,150,105] } },
      { content: `+${currency}${totalIncome.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, styles: { halign: 'right', fontStyle: 'bold', fillColor: [220,252,231], textColor: [5,150,105] } }
    ], [
      { content: '', colSpan: 4, styles: { fillColor: [241,245,249] } },
      { content: 'Expenses', styles: { fontStyle: 'bold', fillColor: [254,226,226], textColor: [220,38,38] } },
      { content: `-${currency}${totalExpenses.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, styles: { halign: 'right', fontStyle: 'bold', fillColor: [254,226,226], textColor: [220,38,38] } }
    ]],
    footStyles: { fontSize: 8.5 },
    showFoot: 'lastPage',
    margin: { left: 14, right: 14 }
  });

  // ── Page footer ──────────────────────────────────────────
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setDrawColor(226, 232, 240);
    doc.line(14, pageH - 13, pageW - 14, pageH - 13);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(148, 163, 184);
    doc.text('Cashvista — Confidential. For personal use only.', 14, pageH - 6);
    doc.text(`Page ${i} / ${totalPages}`, pageW - 14, pageH - 6, { align: 'right' });
  }

  // ── Download ─────────────────────────────────────────────
  const safePeriod   = label.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const safeCategory = category.replace(/\s+/g, '_').toLowerCase();
  doc.save(`cashvista_ledger_${safePeriod}_${safeCategory}.pdf`);
  showExportToast(`✅ PDF saved — ${transactions.length} transactions`, 'success');
}

// ── CSV Export ───────────────────────────────────────────────
function exportCSV(transactions, scope, category) {
  const { label } = getDateRangeForScope(scope);
  const currency  = state.user.currency || '₹';

  const totalIncome   = transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const totalExpenses = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;

  const headerRow  = ['Date', 'Description', 'Category', 'Account', 'Type', `Amount (${currency})`];
  const dataRows   = transactions.map(t => [
    new Date(t.date).toLocaleDateString('en-IN'),
    t.description || '',
    t.category,
    t.account,
    t.type,
    (t.type === 'expense' ? -t.amount : t.amount).toFixed(2)
  ].map(escape));

  const summaryRows = [
    [],
    ['', '', '', '', escape('Total Income'),   escape(totalIncome.toFixed(2))],
    ['', '', '', '', escape('Total Expenses'), escape(totalExpenses.toFixed(2))],
    ['', '', '', '', escape('Net Savings'),    escape((totalIncome - totalExpenses).toFixed(2))]
  ];

  const csvContent = [
    [escape(`Cashvista Ledger Statement – ${label} – Category: ${category}`)],
    [],
    headerRow.map(escape),
    ...dataRows,
    ...summaryRows
  ].map(row => (Array.isArray(row) ? row.join(',') : row)).join('\r\n');

  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const safePeriod   = label.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const safeCategory = category.replace(/\s+/g, '_').toLowerCase();

  a.href     = url;
  a.download = `cashvista_ledger_${safePeriod}_${safeCategory}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showExportToast(`✅ CSV saved — ${transactions.length} rows`, 'success');
}

