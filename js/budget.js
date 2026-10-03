// Budgets Page Specific JS

async function initPage() {
  try {
    renderBudgets();
  } catch (err) {
    console.error('Error rendering budgets:', err);
  }
}

function renderBudgets() {
  const container = document.getElementById('budget-items-grid');
  const currency = (state.user && state.user.currency) || '₹';
  
  if (!container) return;

  if (!state.budgets || !Array.isArray(state.budgets) || state.budgets.length === 0) {
    container.innerHTML = `
      <div class="col-span-full bg-white p-8 rounded-2xl border text-center text-slate-400">
        No budget limits configured yet. Click 'Configure Category Limit' to get started.
      </div>`;
    return;
  }

  container.innerHTML = state.budgets.map(item => {
    const limit = item;
    
    // Calculate spent from transactions if not directly populated on the budget object
    let computedSpent = item.spent;
    if (computedSpent === undefined || computedSpent === null) {
      computedSpent = (state.transactions || [])
        .filter(t => t.type === 'expense' && t.category === item.category && (t.date && t.date.substring(0, 7) === item.month))
        .reduce((sum, t) => sum + Number(t.amount || 0), 0);
    }

    // Null/undefined safety fallbacks for all calculations and numeric formatting
    const limitVal = Number(item.limit || item.amount || limit?.amount || 0);
    const spentVal = Number(item.spent || computedSpent || 0);
    const remainingVal = Number(item.remaining ?? Math.max(0, limitVal - spentVal));
    const percentage = limitVal > 0 ? ((spentVal / limitVal) * 100).toFixed(1) : 0;
    const numPercent = Number(percentage);

    const formattedLimit = Number(limit?.amount ?? item.amount ?? 0).toLocaleString();
    const formattedSpent = Number(item.spent || spentVal || 0).toFixed(2);
    const formattedRemaining = Number(item.remaining || remainingVal || 0).toFixed(2);

    let barColor = 'bg-primary-600';
    if (numPercent >= 100) barColor = 'bg-danger';
    else if (numPercent >= 80) barColor = 'bg-warning';

    return `
      <div class="bg-white rounded-3xl p-5 shadow-sm border border-slate-200/60 relative overflow-hidden flex flex-col justify-between">
        <div class="flex justify-between items-start mb-4">
          <div>
            <span class="text-xs font-semibold text-slate-400 uppercase tracking-wider">${item.category || 'Category'} Budget</span>
            <h4 class="text-xl font-bold text-slate-800 mt-1">${currency}${formattedLimit}</h4>
          </div>
          <span class="px-2.5 py-1 text-[10px] font-bold bg-slate-100 rounded-lg text-slate-500">${item.month || ''}</span>
        </div>

        <div class="space-y-2 mt-4">
          <div class="flex justify-between text-xs font-bold">
            <span class="text-slate-500">Spent: ${currency}${formattedSpent}</span>
            <span class="text-slate-800">${percentage}%</span>
          </div>
          <div class="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
            <div class="${barColor} h-full rounded-full" style="width: ${Math.min(100, numPercent)}%"></div>
          </div>
          <div class="flex justify-between text-[10px] font-semibold text-slate-400 pt-1">
            <span>Remaining: ${currency}${formattedRemaining}</span>
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
  const amount = Number(document.getElementById('budget-amount').value || 0);
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
    console.error('Failed to save budget:', err);
    alert(err.message || 'Failed to save budget.');
  }
}

// Modal helper overrides
function showModal(id) {
  document.getElementById(id).classList.remove('hidden');
}
function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}
