// Accounts Page Specific JS

async function initPage() {
  renderAccounts();
}

function renderAccounts() {
  const container = document.getElementById('accounts-cards-grid');
  const currency = state.user.currency || '₹';

  if (!container) return;

  container.innerHTML = state.accounts.map(a => {
    let typeIcon = 'banknote';
    let cardBg = 'bg-white border-slate-200/60';
    let textColor = 'text-slate-400';
    let balanceColor = 'text-slate-800';
    
    if (a.type === 'Bank') { typeIcon = 'building-2'; }
    if (a.type === 'Credit Card') { typeIcon = 'credit-card'; cardBg = 'bg-slate-900 text-white border-transparent'; textColor = 'text-slate-400'; balanceColor = 'text-white'; }
    if (a.type === 'Cash') { typeIcon = 'coins'; }
    if (a.type === 'Investment') { typeIcon = 'line-chart'; }

    return `
      <div class="rounded-3xl p-5 shadow-sm border ${cardBg} flex flex-col justify-between h-44 relative">
        <div class="flex justify-between items-start">
          <div>
            <span class="text-xs font-semibold uppercase tracking-wider ${balanceColor === 'text-white' ? 'text-slate-400' : 'text-slate-500'}">${a.type} Ledger</span>
            <h4 class="text-lg font-bold mt-1 ${balanceColor}">${a.name}</h4>
          </div>
          <div class="p-2 bg-slate-100 rounded-xl text-slate-600"><i data-lucide="${typeIcon}" class="w-5 h-5"></i></div>
        </div>

        <div class="mt-auto">
          <span class="text-[10px] font-semibold ${balanceColor === 'text-white' ? 'text-slate-400' : 'text-slate-500'}">Available Balance</span>
          <h2 class="text-2xl font-black ${balanceColor}">${currency}${a.balance.toLocaleString(undefined, {minimumFractionDigits: 2})}</h2>
        </div>
      </div>
    `;
  }).join('');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function openAccountModal() {
  document.getElementById('account-name').value = '';
  document.getElementById('account-balance').value = '';
  showModal('account-modal');
}

async function handleAccountSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('account-name').value;
  const type = document.getElementById('account-type').value;
  const balance = Number(document.getElementById('account-balance').value);

  try {
    const res = await fetch(`${API_BASE}/accounts`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ name, type, balance })
    });
    if (!res.ok) throw new Error('Failed to create account.');
    
    closeModal('account-modal');
    await fetchFinancialData();
    renderAccounts();
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
