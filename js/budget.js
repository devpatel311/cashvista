// Budgets Page Specific JS

async function initPage() {
  renderBudgets();
}

function renderBudgets() {
  const container = document.getElementById('budget-items-grid');
  const currency = state.user.currency || '₹';
  
  if (!container) return;

  if (state.budgets.length === 0) {
    container.innerHTML = `
      <div class="col-span-full bg-white p-8 rounded-2xl border text-center text-slate-400">
        No budgets configured. Click "Configure Category Limit" to define a monthly spending limit.
      </div>`;
    return;
  }

  container.innerHTML = state.budgets.map(b => {
    let barColor = 'bg-primary-600';
    if (b.percentUsed >= 100) barColor = 'bg-danger';
    else if (b.percentUsed >= 80) barColor = 'bg-warning';

    return `
      <div class="bg-white rounded-3xl p-5 shadow-sm border border-slate-200/60 relative overflow-hidden flex flex-col justify-between">
        <div class="flex justify-between items-start mb-4">
          <div>
            <span class="text-xs font-semibold text-slate-400 uppercase tracking-wider">${b.category} Budget</span>
            <h4 class="text-xl font-bold text-slate-800 mt-1">${currency}${b.amount.toLocaleString()}</h4>
          </div>
          <span class="px-2.5 py-1 text-[10px] font-bold bg-slate-100 rounded-lg text-slate-500">${b.month}</span>
        </div>

        <div class="space-y-2 mt-4">
          <div class="flex justify-between text-xs font-bold">
            <span class="text-slate-500">Spent: ${currency}${b.spent.toFixed(2)}</span>
            <span class="text-slate-800">${b.percentUsed}%</span>
          </div>
          <div class="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
            <div class="${barColor} h-full rounded-full" style="width: ${Math.min(100, b.percentUsed)}%"></div>
          </div>
          <div class="flex justify-between text-[10px] font-semibold text-slate-400 pt-1">
            <span>Remaining: ${currency}${b.remaining.toFixed(2)}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function openBudgetModal() {
  document.getElementById('budget-amount').value = '';
  document.getElementById('budget-month').value = new Date().toISOString().substring(0, 7);
  showModal('budget-modal');
}

async function handleBudgetSubmit(e) {
  e.preventDefault();
  const category = document.getElementById('budget-category').value;
  const amount = Number(document.getElementById('budget-amount').value);
  const month = document.getElementById('budget-month').value;

  try {
    const res = await fetch(`${API_BASE}/budgets`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ category, amount, month })
    });
    if (!res.ok) throw new Error('Failed to save budget.');
    
    closeModal('budget-modal');
    await fetchFinancialData();
    renderBudgets();
  } catch (err) {
    alert(err.message);
  }
}

// Modal helper overrides
function showModal(id) {
  document.getElementById(id).classList.remove('hidden');
}
function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}
