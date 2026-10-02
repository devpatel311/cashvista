// Dashboard Page Specific JS

async function initPage() {
  renderDashboard();
}

function setDateRange(range) {
  state.dateRange = range;
  document.getElementById('range-btn-month').className = range === 'this-month' 
    ? 'px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary-600 text-white transition'
    : 'px-3 py-1.5 text-xs font-semibold rounded-lg text-slate-500 hover:bg-slate-100 transition';
  
  document.getElementById('range-btn-year').className = range === 'this-year'
    ? 'px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary-600 text-white transition'
    : 'px-3 py-1.5 text-xs font-semibold rounded-lg text-slate-500 hover:bg-slate-100 transition';

  renderDashboard();
}
window.setDateRange = setDateRange;

function getFilteredTransactions() {
  const now = new Date();
  const currentMonth = now.toISOString().substring(0, 7); // YYYY-MM
  const currentYear = now.getFullYear().toString(); // YYYY

  return state.transactions.filter(t => {
    const tDate = new Date(t.date);
    if (state.dateRange === 'this-month') {
      return tDate.toISOString().substring(0, 7) === currentMonth;
    } else {
      return tDate.getFullYear().toString() === currentYear;
    }
  });
}

function renderDashboard() {
  const filteredTxs = getFilteredTransactions();
  const baseCurrency = getUserBaseCurrency();   // e.g. 'INR'
  const currency = state.user.currency || '₹';  // Legacy symbol for budget display

  // Build a quick lookup: accountName → currencyCode
  const accountCurrencyMap = {};
  state.accounts.forEach(a => {
    accountCurrencyMap[a.name] = a.currency || baseCurrency;
  });

  // 1. Calculate Summary aggregates — convert all to base currency
  const incomeTotal = filteredTxs
    .filter(t => t.type === 'income')
    .reduce((s, t) => {
      const acctCur = accountCurrencyMap[t.account] || baseCurrency;
      return s + convertToBaseCurrency(t.amount, acctCur, baseCurrency);
    }, 0);

  const expenseTotal = filteredTxs
    .filter(t => t.type === 'expense')
    .reduce((s, t) => {
      const acctCur = accountCurrencyMap[t.account] || baseCurrency;
      return s + convertToBaseCurrency(t.amount, acctCur, baseCurrency);
    }, 0);

  // Net worth: sum of all account balances converted to base currency
  const balanceTotal = state.accounts.reduce((s, a) => {
    return s + convertToBaseCurrency(a.balance, a.currency || baseCurrency, baseCurrency);
  }, 0);

  // Render Dashboard Stat Cards (all values are now in base currency)
  document.getElementById('card-income-total').innerText   = formatCurrency(incomeTotal,   baseCurrency);
  document.getElementById('card-expenses-total').innerText = formatCurrency(expenseTotal,  baseCurrency);
  document.getElementById('card-balance-total').innerText  = formatCurrency(balanceTotal,  baseCurrency);

  // Budget Status calculations (budgets are always in base currency)
  const currentMonth = new Date().toISOString().substring(0, 7);
  const activeBudgets = state.budgets.filter(b => b.month === currentMonth);
  const totalBudgetLimit = activeBudgets.reduce((s, b) => s + b.amount, 0);

  const thisMonthSpent = state.transactions
    .filter(t => t.type === 'expense' && new Date(t.date).toISOString().substring(0, 7) === currentMonth)
    .reduce((s, t) => {
      const acctCur = accountCurrencyMap[t.account] || baseCurrency;
      return s + convertToBaseCurrency(t.amount, acctCur, baseCurrency);
    }, 0);

  let budgetPercent = 0;
  let budgetText = `${currency}0.00 left`;
  if (totalBudgetLimit > 0) {
    budgetPercent = Math.min(100, Math.round((thisMonthSpent / totalBudgetLimit) * 100));
    budgetText = `${formatCurrency(Math.max(0, totalBudgetLimit - thisMonthSpent), baseCurrency)} left of ${formatCurrency(totalBudgetLimit, baseCurrency)}`;
  } else {
    budgetText = 'No budgets defined';
  }

  document.getElementById('card-budget-percent').innerText      = `${budgetPercent}%`;
  document.getElementById('card-budget-progress').style.width   = `${budgetPercent}%`;
  document.getElementById('card-budget-remaining').innerHTML     = `<span>${budgetText}</span>`;

  // Circular Chart Sync
  document.getElementById('circular-budget-text').innerText     = `${budgetPercent}%`;
  const circleOffset = 390 - (390 * budgetPercent) / 100;
  document.getElementById('circular-budget-stroke').style.strokeDashoffset = circleOffset;
  document.getElementById('utilization-spent-totals').innerText =
    `${formatCurrency(thisMonthSpent, baseCurrency)} / ${formatCurrency(totalBudgetLimit, baseCurrency)}`;

  // 2. Render Recent Transactions list — each row uses its own account's currency
  const txBody = document.getElementById('dashboard-tx-table');
  const recentTxs = state.transactions.slice(0, 5);

  if (recentTxs.length === 0) {
    txBody.innerHTML = `<tr><td colspan="5" class="py-4 text-center text-xs text-slate-400">No transactions recorded.</td></tr>`;
  } else {
    txBody.innerHTML = recentTxs.map(t => {
      const sign      = t.type === 'income' ? '+' : '-';
      const color     = t.type === 'income' ? 'text-success' : 'text-danger';
      const acctCur   = accountCurrencyMap[t.account] || baseCurrency;
      const formatted = formatCurrency(t.amount, acctCur);
      // If the account uses a foreign currency, show the base-converted equivalent
      const baseEq    = acctCur !== baseCurrency
        ? `<span class="text-[10px] text-slate-400 font-normal ml-1">≈ ${formatCurrency(convertToBaseCurrency(t.amount, acctCur, baseCurrency), baseCurrency)}</span>`
        : '';
      return `
        <tr class="hover:bg-slate-50/50 transition">
          <td class="py-3 font-medium text-slate-400 text-xs">${new Date(t.date).toLocaleDateString([], {month: 'short', day: 'numeric', year: 'numeric'})}</td>
          <td class="py-3 font-semibold text-slate-800 max-w-[150px] truncate">${t.description}</td>
          <td class="py-3"><span class="px-2 py-1 bg-slate-100 rounded-lg text-xs font-semibold text-slate-600">${t.category}</span></td>
          <td class="py-3 text-xs text-slate-500 font-medium">${t.account}</td>
          <td class="py-3 text-right font-bold ${color}">${sign}${formatted}${baseEq}</td>
        </tr>
      `;
    }).join('');
  }

  // 3. Render Chart.js visual structures
  renderDashboardCharts(filteredTxs, baseCurrency);

}
function renderDashboardCharts(txs, currency) {
  // Recreate or Update Income vs Expense Line Chart
  if (state.charts.incomeExpenses) state.charts.incomeExpenses.destroy();
  const ctxLine = document.getElementById('chart-income-expenses').getContext('2d');
  
  if (state.dateRange === 'this-year') {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const incAgg = Array(12).fill(0);
    const expAgg = Array(12).fill(0);
    
    txs.forEach(t => {
      const mIdx = new Date(t.date).getMonth();
      if (t.type === 'income') incAgg[mIdx] += t.amount;
      else expAgg[mIdx] += t.amount;
    });

    state.charts.incomeExpenses = new Chart(ctxLine, {
      type: 'line',
      data: {
        labels: months,
        datasets: [
          { label: 'Income', data: incAgg, borderColor: '#10B981', backgroundColor: 'rgba(16, 185, 129, 0.05)', fill: true, tension: 0.35, borderWidth: 3 },
          { label: 'Expenses', data: expAgg, borderColor: '#EF4444', backgroundColor: 'rgba(239, 68, 68, 0.05)', fill: true, tension: 0.35, borderWidth: 3 }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
  } else {
    // Daily timeline grouping for current month
    const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    const labels = Array.from({length: daysInMonth}, (_, i) => (i + 1).toString());
    const incAgg = Array(daysInMonth).fill(0);
    const expAgg = Array(daysInMonth).fill(0);

    txs.forEach(t => {
      const day = new Date(t.date).getDate();
      if (day <= daysInMonth) {
        if (t.type === 'income') incAgg[day - 1] += t.amount;
        else expAgg[day - 1] += t.amount;
      }
    });

    state.charts.incomeExpenses = new Chart(ctxLine, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Income', data: incAgg, borderColor: '#10B981', tension: 0.3, borderWidth: 2.5, pointRadius: 0, fill: false },
          { label: 'Expenses', data: expAgg, borderColor: '#EF4444', tension: 0.3, borderWidth: 2.5, pointRadius: 0, fill: false }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
  }

  // Recreate Donut Chart
  if (state.charts.categories) state.charts.categories.destroy();
  const ctxDonut = document.getElementById('chart-categories').getContext('2d');
  
  const categories = ['Housing', 'Food', 'Transportation', 'Entertainment', 'Utilities', 'Others'];
  const catSpent = categories.map(c => 
    txs.filter(t => t.type === 'expense' && t.category === c).reduce((sum, t) => sum + t.amount, 0)
  );

  const colorPalette = ['#1E40AF', '#10B981', '#F59E0B', '#3B82F6', '#EF4444', '#64748B'];

  state.charts.categories = new Chart(ctxDonut, {
    type: 'doughnut',
    data: {
      labels: categories,
      datasets: [{
        data: catSpent,
        backgroundColor: colorPalette,
        borderWidth: 0,
        hoverOffset: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '72%',
      plugins: { legend: { display: false } }
    }
  });

  // Legend Injection
  const legend = document.getElementById('donut-legend');
  const totalExpense = catSpent.reduce((a, b) => a + b, 0) || 1;
  legend.innerHTML = categories.map((cat, idx) => {
    const spent = catSpent[idx];
    const pct = Math.round((spent / totalExpense) * 100);
    return `
      <div class="flex items-center gap-2">
        <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: ${colorPalette[idx]}"></span>
        <span class="text-slate-500 font-medium truncate">${cat}</span>
        <span class="ml-auto font-bold text-slate-800">${pct}%</span>
      </div>
    `;
  }).join('');

  // Weekly trend chart
  if (state.charts.weeklyTrends) state.charts.weeklyTrends.destroy();
  const ctxBar = document.getElementById('chart-weekly-trends').getContext('2d');

  const weeklyLabels = ['Week 1', 'Week 2', 'Week 3', 'Week 4'];
  const weekIncome = Array(4).fill(0);
  const weekExpense = Array(4).fill(0);

  txs.forEach(t => {
    const day = new Date(t.date).getDate();
    let wIdx = Math.floor((day - 1) / 7);
    if (wIdx > 3) wIdx = 3;
    
    if (t.type === 'income') weekIncome[wIdx] += t.amount;
    else weekExpense[wIdx] += t.amount;
  });

  state.charts.weeklyTrends = new Chart(ctxBar, {
    type: 'bar',
    data: {
      labels: weeklyLabels,
      datasets: [
        { label: 'Weekly Income', data: weekIncome, backgroundColor: '#10B981', borderRadius: 6 },
        { label: 'Weekly Expenses', data: weekExpense, backgroundColor: '#EF4444', borderRadius: 6 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { grid: { borderDash: [5, 5] } }
      }
    }
  });
}
