/**
 * SpendPulse Personal Finance Analyzer - Frontend Application Logic
 */

let state = {
  transactions: [],
  analytics: null,
  columns: [],
  currentFile: null,
  filtered: [],
  currentPage: 1,
  pageSize: 15,
  monthlyChart: null,
  categoryChart: null,
  activeMapping: null
};

// Available categories for dropdown selector
const ALL_CATEGORIES = [
  "Income",
  "Housing & Rent",
  "Groceries",
  "Dining & Cafes",
  "Utilities & Bills",
  "Transportation",
  "Entertainment & Subscriptions",
  "Shopping & Retail",
  "Healthcare & Fitness",
  "Investments & Finance",
  "Bank Fees & Charges",
  "Uncategorized"
];

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  setupDropZone();
  // Auto-load sample checking statement on initial visit for immediate preview
  loadSampleDataset('checking_csv');
});

// Setup Drag & Drop
function setupDropZone() {
  const dropZone = document.getElementById('dropZone');

  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
    }, false);
  });

  dropZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0) {
      handleUploadedFile(files[0]);
    }
  });

  dropZone.addEventListener('click', () => {
    triggerFilePicker();
  });
}

function triggerFilePicker() {
  document.getElementById('fileInput').click();
}

function handleFileSelect(event) {
  const file = event.target.files[0];
  if (file) {
    handleUploadedFile(file);
  }
}

// Ingest & Inspect arbitrary file
async function handleUploadedFile(file) {
  state.currentFile = file;
  const formData = new FormData();
  formData.append('file', file);

  try {
    // First inspect the file to get column suggestions
    const inspectRes = await fetch('/api/inspect', {
      method: 'POST',
      body: formData
    });

    if (!inspectRes.ok) {
      const err = await inspectRes.json();
      alert(`Error reading file: ${err.detail || 'Invalid format'}`);
      return;
    }

    const inspectData = await inspectRes.json();
    state.columns = inspectData.columns;

    // Check if standard date and (amount or debit/credit) were detected automatically
    const mapping = inspectData.suggested_mapping;
    const hasDate = !!mapping.date_col;
    const hasAmount = !!mapping.amount_col || (!!mapping.debit_col && !!mapping.credit_col);

    if (hasDate && hasAmount) {
      // Auto-analyze immediately!
      uploadWithMapping(file, null);
    } else {
      // Open Column Mapper modal for user clarification
      populateMapperModal(inspectData);
      openMapperModal();
    }
  } catch (error) {
    console.error(error);
    alert('An unexpected error occurred while processing the file.');
  }
}

// Upload and analyze file with given mapping
async function uploadWithMapping(file, mapping) {
  const formData = new FormData();
  formData.append('file', file);
  if (mapping) {
    formData.append('column_mapping', JSON.stringify(mapping));
  }
  formData.append('account_name', file.name.replace(/\.[^/.]+$/, ""));

  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });

    if (!res.ok) {
      const err = await res.json();
      alert(`Analysis failed: ${err.detail || 'Could not process dataset'}`);
      return;
    }

    const data = await res.json();
    applyAnalysisResult(data);
  } catch (err) {
    console.error(err);
    alert('Failed to connect to analyzer server.');
  }
}

// Load built-in sample datasets
async function loadSampleDataset(sampleType) {
  try {
    const res = await fetch(`/api/sample/${sampleType}`);
    if (!res.ok) {
      alert('Failed to load sample dataset.');
      return;
    }
    const data = await res.json();
    state.currentFile = { name: data.filename };
    applyAnalysisResult(data);
  } catch (err) {
    console.error(err);
    alert('Could not fetch sample dataset.');
  }
}

// Update state and render all UI components
function applyAnalysisResult(data) {
  state.transactions = data.transactions;
  state.analytics = data.analytics;
  state.columns = data.columns || [];
  state.activeMapping = data.summary?.detected_mapping || null;

  // Render Status Bar
  const statusBar = document.getElementById('statusBar');
  statusBar.classList.remove('hidden');
  document.getElementById('loadedFileName').textContent = data.filename || 'Statement';
  document.getElementById('statusRowCount').textContent = state.transactions.length.toLocaleString();
  
  const dr = state.analytics.summary.date_range;
  if (dr && dr.start && dr.end) {
    document.getElementById('statusDateRange').textContent = `Period: ${dr.start} to ${dr.end}`;
  }

  // Render KPI Metrics
  renderKPIs(state.analytics.summary, state.analytics.recurring_subscriptions);

  // Render Visual Charts
  renderMonthlyChart(state.analytics.monthly_trends);
  renderCategoryChart(state.analytics.category_breakdown);

  // Render Insights Widgets
  renderRecurringSubscriptions(state.analytics.recurring_subscriptions);
  renderBudgetHealth(state.analytics.budgets);

  // Populate Filter Dropdowns & Transactions Table
  populateCategoryFilter();
  applyTableFilters();

  lucide.createIcons();
}

// Render KPI Cards
function renderKPIs(summary, subscriptions) {
  const fmt = (num) => '₹' + Math.abs(num).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  document.getElementById('kpiIncome').textContent = fmt(summary.total_income);
  document.getElementById('kpiExpense').textContent = fmt(summary.total_expense);
  
  const netEl = document.getElementById('kpiNet');
  netEl.textContent = (summary.net_cash_flow < 0 ? '-' : '+') + fmt(summary.net_cash_flow);
  netEl.className = summary.net_cash_flow >= 0 
    ? 'text-xl sm:text-2xl font-bold text-emerald-400' 
    : 'text-xl sm:text-2xl font-bold text-rose-400';

  const savingsEl = document.getElementById('kpiSavings');
  savingsEl.textContent = `${summary.savings_rate.toFixed(1)}%`;
  savingsEl.className = summary.savings_rate >= 20 
    ? 'text-xl sm:text-2xl font-bold text-emerald-400' 
    : 'text-xl sm:text-2xl font-bold text-violet-400';

  const subCount = subscriptions.length;
  document.getElementById('kpiRecurring').textContent = subCount;
  const totalSubAnnual = subscriptions.reduce((acc, s) => acc + s.estimated_annual_cost, 0);
  document.getElementById('kpiRecurringSubtitle').textContent = `₹${Math.round(totalSubAnnual / 12).toLocaleString('en-IN')}/mo estimated`;
}

// Render Monthly Cashflow Chart
function renderMonthlyChart(trends) {
  const ctx = document.getElementById('monthlyChart').getContext('2d');
  if (state.monthlyChart) {
    state.monthlyChart.destroy();
  }

  const labels = trends.map(t => t.month);
  const incomes = trends.map(t => t.income);
  const expenses = trends.map(t => t.expense);
  const nets = trends.map(t => t.net);

  state.monthlyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Income',
          data: incomes,
          backgroundColor: 'rgba(52, 211, 153, 0.75)',
          borderColor: '#10b981',
          borderWidth: 1,
          borderRadius: 4
        },
        {
          label: 'Expenses',
          data: expenses,
          backgroundColor: 'rgba(244, 63, 94, 0.75)',
          borderColor: '#f43f5e',
          borderWidth: 1,
          borderRadius: 4
        },
        {
          type: 'line',
          label: 'Net Cash Flow',
          data: nets,
          borderColor: '#818cf8',
          backgroundColor: 'rgba(129, 140, 248, 0.1)',
          borderWidth: 2,
          pointBackgroundColor: '#6366f1',
          pointRadius: 4,
          tension: 0.3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: '#94a3b8', font: { size: 11 } }
        },
        tooltip: {
          callbacks: {
            label: (item) => ` ${item.dataset.label}: ₹${item.raw.toLocaleString('en-IN')}`
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(51, 65, 85, 0.3)' },
          ticks: { color: '#94a3b8', font: { size: 11 } }
        },
        y: {
          grid: { color: 'rgba(51, 65, 85, 0.3)' },
          ticks: {
            color: '#94a3b8',
            font: { size: 11 },
            callback: (v) => '₹' + v.toLocaleString('en-IN')
          }
        }
      }
    }
  });
}

// Render Category Doughnut Chart
function renderCategoryChart(categories) {
  const ctx = document.getElementById('categoryChart').getContext('2d');
  if (state.categoryChart) {
    state.categoryChart.destroy();
  }

  const topCats = categories.slice(0, 7);
  const labels = topCats.map(c => c.category);
  const dataVals = topCats.map(c => c.total);

  const colors = [
    '#6366f1', '#ec4899', '#10b981', '#f59e0b',
    '#06b6d4', '#8b5cf6', '#64748b', '#f43f5e'
  ];

  state.categoryChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: dataVals,
        backgroundColor: colors,
        borderColor: '#0f172a',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: { color: '#cbd5e1', font: { size: 10 }, boxWidth: 12 }
        },
        tooltip: {
          callbacks: {
            label: (item) => ` ${item.label}: ₹${item.raw.toLocaleString('en-IN')}`
          }
        }
      },
      cutout: '65%'
    }
  });
}

// Render Recurring Subscriptions
function renderRecurringSubscriptions(subscriptions) {
  const container = document.getElementById('recurringList');
  if (!subscriptions || subscriptions.length === 0) {
    container.innerHTML = '<div class="text-center py-6 text-xs text-slate-500">No recurring subscriptions detected.</div>';
    return;
  }

  container.innerHTML = subscriptions.map(sub => `
    <div class="flex items-center justify-between p-2.5 rounded-lg bg-slate-800/50 border border-slate-700/60 hover:bg-slate-800 transition">
      <div class="flex items-center gap-2.5">
        <div class="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center font-bold text-xs">
          ${sub.merchant.charAt(0).toUpperCase()}
        </div>
        <div>
          <h4 class="text-xs font-semibold text-white">${sub.merchant}</h4>
          <span class="text-[10px] text-slate-400">${sub.category} &bull; ${sub.frequency}</span>
        </div>
      </div>
      <div class="text-right">
        <div class="text-xs font-bold text-amber-400">₹${sub.average_amount.toFixed(2)}</div>
        <div class="text-[10px] text-slate-500">₹${sub.estimated_annual_cost.toFixed(0)}/yr</div>
      </div>
    </div>
  `).join('');
}

// Render Category Budget Health
function renderBudgetHealth(budgets) {
  const container = document.getElementById('budgetList');
  if (!budgets || budgets.length === 0) {
    container.innerHTML = '<div class="text-center py-6 text-xs text-slate-500">No budget metrics available.</div>';
    return;
  }

  container.innerHTML = budgets.map(b => {
    let barColor = 'bg-indigo-500';
    let badgeClass = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    let badgeText = 'Safe';

    if (b.status === 'exceeded') {
      barColor = 'bg-rose-500';
      badgeClass = 'bg-rose-500/10 text-rose-400 border-rose-500/20';
      badgeText = 'Exceeded';
    } else if (b.status === 'warning') {
      barColor = 'bg-amber-500';
      badgeClass = 'bg-amber-500/10 text-amber-400 border-amber-500/20';
      badgeText = 'Pacing High';
    }

    const cappedPct = Math.min(100, b.percentage);

    return `
      <div class="space-y-1">
        <div class="flex items-center justify-between text-xs">
          <span class="font-medium text-slate-200">${b.category}</span>
          <div class="flex items-center gap-2">
            <span class="text-slate-400">₹${b.spent.toLocaleString('en-IN')} / ₹${b.budget.toLocaleString('en-IN')}</span>
            <span class="text-[10px] px-1.5 py-0.5 rounded border ${badgeClass} font-semibold">${badgeText}</span>
          </div>
        </div>
        <div class="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
          <div class="${barColor} h-1.5 rounded-full transition-all duration-300" style="width: ${cappedPct}%"></div>
        </div>
      </div>
    `;
  }).join('');
}

// Filter Categories Dropdown
function populateCategoryFilter() {
  const select = document.getElementById('txCategoryFilter');
  const distinctCategories = Array.from(new Set(state.transactions.map(t => t.category))).sort();

  select.innerHTML = '<option value="ALL">All Categories</option>' + 
    distinctCategories.map(c => `<option value="${c}">${c}</option>`).join('');
}

// Table Filters & Pagination
function applyTableFilters() {
  const query = document.getElementById('txSearchInput').value.toLowerCase().trim();
  const categoryFilter = document.getElementById('txCategoryFilter').value;
  const typeFilter = document.getElementById('txTypeFilter').value;

  state.filtered = state.transactions.filter(tx => {
    const matchesQuery = !query || 
      tx.description.toLowerCase().includes(query) || 
      (tx.merchant && tx.merchant.toLowerCase().includes(query));

    const matchesCategory = categoryFilter === 'ALL' || tx.category === categoryFilter;
    const matchesType = typeFilter === 'ALL' || tx.type === typeFilter;

    return matchesQuery && matchesCategory && matchesType;
  });

  state.currentPage = 1;
  renderTable();
}

function renderTable() {
  const tbody = document.getElementById('transactionsTableBody');
  const total = state.filtered.length;

  if (total === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-slate-500 font-sans">No matching transactions found.</td></tr>`;
    document.getElementById('paginationInfo').textContent = 'Showing 0 of 0 transactions';
    document.getElementById('prevPageBtn').disabled = true;
    document.getElementById('nextPageBtn').disabled = true;
    return;
  }

  const startIdx = (state.currentPage - 1) * state.pageSize;
  const endIdx = Math.min(startIdx + state.pageSize, total);
  const pageItems = state.filtered.slice(startIdx, endIdx);

  tbody.innerHTML = pageItems.map(tx => {
    const isIncome = tx.amount > 0;
    const amountClass = isIncome ? 'text-emerald-400' : 'text-slate-200';
    const sign = isIncome ? '+' : '';

    return `
      <tr class="hover:bg-slate-800/40 transition">
        <td class="py-2 px-4 whitespace-nowrap text-slate-400">${tx.date}</td>
        <td class="py-2 px-4 font-sans font-medium text-white">${tx.merchant || tx.description}</td>
        <td class="py-2 px-4 text-slate-500 hidden md:table-cell truncate max-w-xs font-sans">${tx.description}</td>
        <td class="py-2 px-4 font-sans">
          <select onchange="updateTransactionCategory('${tx.id}', this.value)" 
            class="text-[11px] py-0.5 px-2 rounded-md bg-slate-800 border border-slate-700 text-slate-300 focus:outline-none focus:border-indigo-500 cursor-pointer">
            ${ALL_CATEGORIES.map(cat => `<option value="${cat}" ${cat === tx.category ? 'selected' : ''}>${cat}</option>`).join('')}
          </select>
        </td>
        <td class="py-2 px-4 text-right font-semibold ${amountClass}">
          ${sign}₹${Math.abs(tx.amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </td>
      </tr>
    `;
  }).join('');

  document.getElementById('paginationInfo').textContent = `Showing ${startIdx + 1} to ${endIdx} of ${total} transactions`;
  document.getElementById('currentPageNum').textContent = `Page ${state.currentPage} of ${Math.ceil(total / state.pageSize)}`;
  document.getElementById('prevPageBtn').disabled = state.currentPage === 1;
  document.getElementById('nextPageBtn').disabled = endIdx >= total;
}

function changePage(delta) {
  state.currentPage += delta;
  renderTable();
}

// Update Transaction Category on the fly
async function updateTransactionCategory(txId, newCategory) {
  try {
    const res = await fetch('/api/update-transaction-category', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transactions: state.transactions,
        transaction_id: txId,
        new_category: newCategory
      })
    });

    if (res.ok) {
      const data = await res.json();
      state.transactions = data.transactions;
      state.analytics = data.analytics;
      // Re-render UI components to reflect change in analytics
      renderKPIs(state.analytics.summary, state.analytics.recurring_subscriptions);
      renderCategoryChart(state.analytics.category_breakdown);
      renderBudgetHealth(state.analytics.budgets);
      populateCategoryFilter();
      applyTableFilters();
    }
  } catch (err) {
    console.error('Failed to update category', err);
  }
}

// Export clean standardized CSV
async function exportCleanCSV() {
  if (!state.transactions || state.transactions.length === 0) {
    alert('No transactions to export.');
    return;
  }

  try {
    const res = await fetch('/api/export/csv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactions: state.transactions })
    });

    if (!res.ok) throw new Error('Export failed');

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `spendpulse_cleaned_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (err) {
    alert('Failed to generate export file.');
  }
}

// Column Mapping Modal Logic
function openMapperModal() {
  document.getElementById('mapperModal').classList.remove('hidden');
}

function closeMapperModal() {
  document.getElementById('mapperModal').classList.add('hidden');
}

function populateMapperModal(inspectData) {
  document.getElementById('modalFileName').textContent = inspectData.filename;
  const cols = inspectData.columns;
  const sug = inspectData.suggested_mapping || {};

  const makeOptions = (selected) => 
    '<option value="">-- None --</option>' + 
    cols.map(c => `<option value="${c}" ${c === selected ? 'selected' : ''}>${c}</option>`).join('');

  document.getElementById('mapDateCol').innerHTML = makeOptions(sug.date_col);
  document.getElementById('mapDescCol').innerHTML = makeOptions(sug.desc_col);
  document.getElementById('mapAmountCol').innerHTML = makeOptions(sug.amount_col);
  document.getElementById('mapCategoryCol').innerHTML = makeOptions(sug.category_col);
  document.getElementById('mapDebitCol').innerHTML = makeOptions(sug.debit_col);
  document.getElementById('mapCreditCol').innerHTML = makeOptions(sug.credit_col);
}

function applyCustomMappingAndAnalyze() {
  const mapping = {
    date_col: document.getElementById('mapDateCol').value || null,
    desc_col: document.getElementById('mapDescCol').value || null,
    amount_col: document.getElementById('mapAmountCol').value || null,
    category_col: document.getElementById('mapCategoryCol').value || null,
    debit_col: document.getElementById('mapDebitCol').value || null,
    credit_col: document.getElementById('mapCreditCol').value || null,
    invert_amount: document.getElementById('mapInvertAmount').checked
  };

  if (!mapping.date_col) {
    alert('Please select a Date column.');
    return;
  }
  if (!mapping.desc_col) {
    alert('Please select a Description column.');
    return;
  }
  if (!mapping.amount_col && (!mapping.debit_col && !mapping.credit_col)) {
    alert('Please select an Amount column or separate Debit/Credit columns.');
    return;
  }

  closeMapperModal();
  if (state.currentFile) {
    uploadWithMapping(state.currentFile, mapping);
  }
}
