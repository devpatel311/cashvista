// Settings Specific preference sync

async function initPage() {
  // Sync options loaded during auth profile check
  if (state.user) {
    document.getElementById('setting-currency').value = state.user.currency || '₹';
    document.getElementById('setting-theme').value = state.user.theme || 'light';
  }
}

async function saveSystemSettings() {
  const currency = document.getElementById('setting-currency').value;
  const theme = document.getElementById('setting-theme').value;

  try {
    const res = await fetch(`${API_BASE}/user/profile`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ currency, theme })
    });
    if (res.ok) {
      state.user.currency = currency;
      state.user.theme = theme;
      alert('Preferences saved successfully!');
    }
  } catch (err) {
    console.error(err);
  }
}
