// Audits Search & Filtering Logic

async function initPage() {
  // Populate filter selectors
  populateAuditFilters();
  renderAuditsTable();
}

function populateAuditFilters() {
  const catSel = document.getElementById('audit-filter-category');
  const accSel = document.getElementById('audit-filter-account');
  if (!catSel || !accSel) return;

  const accounts = [...new Set(state.transactions.map(t => t.account))];
  const categories = [...new Set(state.transactions.map(t => t.category))];

  accSel.innerHTML = '<option value="All">All Ledgers</option>' + accounts.map(a => `<option value="${a}">${a}</option>`).join('');
  catSel.innerHTML = '<option value="All">All Categories</option>' + categories.map(c => `<option value="${c}">${c}</option>`).join('');
}

function renderAuditsTable() {
  const container = document.getElementById('audits-table-body');
  const query = document.getElementById('audit-search').value.toLowerCase().trim();
  const category = document.getElementById('audit-filter-category').value;
  const account = document.getElementById('audit-filter-account').value;
  const type = document.getElementById('audit-filter-type').value;

  const currency = state.user.currency || '₹';

  let filtered = state.transactions;

  if (query) {
    filtered = filtered.filter(t => 
      t.description.toLowerCase().includes(query) || 
      (t.notes && t.notes.toLowerCase().includes(query))
    );
  }
  if (category !== 'All') {
    filtered = filtered.filter(t => t.category === category);
  }
  if (account !== 'All') {
    filtered = filtered.filter(t => t.account === account);
  }
  if (type !== 'All') {
    filtered = filtered.filter(t => t.type === type);
  }

  if (!container) return;

  if (filtered.length === 0) {
    container.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-slate-400">No matching audit logs found. Try other filters.</td></tr>`;
    return;
  }

  container.innerHTML = filtered.map(t => {
    const sign = t.type === 'income' ? '+' : '-';
    const color = t.type === 'income' ? 'text-success' : 'text-danger';
    return `
      <tr class="hover:bg-slate-50/50 transition">
        <td class="py-3.5 font-medium text-slate-400 text-xs">${new Date(t.date).toLocaleDateString([], {month: 'short', day: 'numeric', year: 'numeric'})}</td>
        <td class="py-3.5 font-bold text-slate-800">${t.description}</td>
        <td class="py-3.5"><span class="px-2.5 py-1 bg-slate-100 text-slate-600 rounded-lg font-bold text-xs">${t.category}</span></td>
        <td class="py-3.5 text-xs text-slate-500 font-medium">${t.account}</td>
        <td class="py-3.5 text-slate-400 text-xs truncate max-w-[200px]">${t.notes || '—'}</td>
        <td class="py-3.5 text-right font-extrabold ${color}">${sign}${currency}${Number(t.amount || 0).toFixed(2)}</td>
      </tr>
    `;
  }).join('');
}
