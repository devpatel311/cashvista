// Income Inflow CRUD Logic

async function initPage() {
  renderInflows();
}

function renderInflows() {
  const container = document.getElementById('income-table-body');
  const currency = state.user.currency || '₹';
  const inflows = state.transactions.filter(t => t.type === 'income');

  if (!container) return;

  if (inflows.length === 0) {
    container.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-slate-400">No income flows logged.</td></tr>`;
    return;
  }

  container.innerHTML = inflows.map(t => `
    <tr class="hover:bg-slate-50/50 transition">
      <td class="py-3.5 font-medium text-slate-400 text-xs">${new Date(t.date).toLocaleDateString([], {month: 'short', day: 'numeric', year: 'numeric'})}</td>
      <td class="py-3.5 font-bold text-slate-800">${t.description}</td>
      <td class="py-3.5"><span class="px-2.5 py-1 bg-slate-100 text-slate-600 rounded-lg font-bold text-xs">${t.category}</span></td>
      <td class="py-3.5 text-xs text-slate-500 font-medium">${t.account}</td>
      <td class="py-3.5 text-slate-400 text-xs truncate max-w-[150px]">${t.notes || '—'}</td>
      <td class="py-3.5 text-right font-extrabold text-success">${currency}${t.amount.toFixed(2)}</td>
      <td class="py-3.5 text-center space-x-2">
        <button onclick="editTransaction('${t._id}')" class="text-slate-400 hover:text-primary-600"><i data-lucide="edit-3" class="w-4 h-4 inline"></i></button>
        <button onclick="deleteTransaction('${t._id}')" class="text-slate-400 hover:text-rose-600"><i data-lucide="trash-2" class="w-4 h-4 inline"></i></button>
      </td>
    </tr>
  `).join('');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function openTransactionModal(type) {
  document.getElementById('tx-id').value = '';
  document.getElementById('tx-type').value = type;
  document.getElementById('tx-description').value = '';
  document.getElementById('tx-amount').value = '';
  document.getElementById('tx-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('tx-notes').value = '';
  
  const titleEl = document.getElementById('tx-modal-title');
  const catSelect = document.getElementById('tx-category');
  const accSelect = document.getElementById('tx-account');
  
  titleEl.innerText = 'Log Income Inflow';
  catSelect.innerHTML = `
    <option value="Salary">Salary</option>
    <option value="Freelance">Freelance Consulting</option>
    <option value="Investment">Investment Dividends</option>
    <option value="Others">Others</option>
  `;

  accSelect.innerHTML = state.accounts.map(a => `<option value="${a.name}">${a.name}</option>`).join('');
  showModal('tx-modal');
}

async function editTransaction(id) {
  const tx = state.transactions.find(t => t._id === id);
  if (!tx) return;

  openTransactionModal(tx.type);
  document.getElementById('tx-id').value = tx._id;
  document.getElementById('tx-description').value = tx.description;
  document.getElementById('tx-category').value = tx.category;
  document.getElementById('tx-account').value = tx.account;
  document.getElementById('tx-amount').value = tx.amount;
  document.getElementById('tx-date').value = new Date(tx.date).toISOString().split('T')[0];
  document.getElementById('tx-notes').value = tx.notes || '';
}

async function handleTransactionSubmit(e) {
  e.preventDefault();
  
  const id = document.getElementById('tx-id').value;
  const type = document.getElementById('tx-type').value;
  const category = document.getElementById('tx-category').value;
  const account = document.getElementById('tx-account').value;
  const amount = Number(document.getElementById('tx-amount').value);
  const date = document.getElementById('tx-date').value;
  const description = document.getElementById('tx-description').value;
  const notes = document.getElementById('tx-notes').value;

  const payload = { type, category, account, amount, date, description, notes };
  const method = id ? 'PUT' : 'POST';
  const url = id ? `${API_BASE}/transactions/${id}` : `${API_BASE}/transactions`;

  try {
    const res = await fetch(url, {
      method,
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Transaction submission failed.');
    
    closeModal('tx-modal');
    await fetchUserData(); // Refresh notifications
    await fetchFinancialData(); // Refresh datasets
    renderInflows();
  } catch (error) {
    alert(error.message);
  }
}

async function deleteTransaction(id) {
  const confirmed = await customConfirm();
  if (!confirmed) return;
  try {
    const res = await fetch(`${API_BASE}/transactions/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error('Delete failed.');
    
    await fetchUserData();
    await fetchFinancialData();
    renderInflows();
  } catch (error) {
    alert(error.message);
  }
}

// Modal helper overrides
function showModal(id) {
  document.getElementById(id).classList.remove('hidden');
}
function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}
