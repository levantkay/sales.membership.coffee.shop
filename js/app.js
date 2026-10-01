const { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY } = window.SUPABASE_CONFIG || {};
const configured = Boolean(
  SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase?.createClient &&
  !SUPABASE_URL.includes('YOUR-PROJECT') && !SUPABASE_ANON_KEY.includes('YOUR-SUPABASE')
);
const db = configured ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const state = {
  products: [],
  members: [],
  memberLookup: null,
  cart: [],
  activeCategory: 'All',
  sales: [],
  membershipFees: { monthly:35000, reactivation:10000 },
  membershipBillingReady: false,
  pendingMembershipAction: null,
  editingSaleId: null,
  saleEditItems: [],
  charts: {}
};

const money = n => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(n || 0));
const dateFmt = value => new Date(value).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
const dateTimeFmt = value => new Date(value).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

function toast(message, type = 'info') {
  const el = document.querySelector('#toast');
  el.textContent = message;
  el.className = `toast show ${type}`;
  setTimeout(() => el.className = 'toast', 2600);
}

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active-view'));
  document.querySelector(`#view-${name}`).classList.add('active-view');
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  document.querySelector('#page-title').textContent = { dashboard:'Dashboard', sales:'Penjualan', membership:'Membership', products:'Produk' }[name];
}

document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => showView(btn.dataset.view)));
document.querySelectorAll('[data-go]').forEach(btn => btn.addEventListener('click', () => {
  showView(btn.dataset.go);
  if (btn.dataset.go === 'sales') document.querySelector('#sales-history').scrollIntoView({ behavior:'smooth', block:'start' });
}));

document.querySelector('#today-pill').textContent = new Date().toLocaleDateString('id-ID', { weekday:'short', day:'2-digit', month:'short', year:'numeric' });
document.querySelector('#refresh-btn').addEventListener('click', loadAll);

function membershipRule(joinedAt) {
  const joined = new Date(joinedAt);
  const now = new Date();
  let months = (now.getFullYear() - joined.getFullYear()) * 12 + (now.getMonth() - joined.getMonth());
  if (now.getDate() < joined.getDate()) months -= 1;
  months = Math.max(0, months);
  if (months < 3) return { months, tier:'BRONZE', discount:5 };
  if (months < 6) return { months, tier:'SILVER', discount:10 };
  return { months, tier:'GOLD', discount:15 };
}

function getTierBadge(tier) {
  return `<span class="tier-badge ${tier.toLowerCase()}">${tier}</span>`;
}

async function loadAll() {
  if (!configured) {
    toast('Isi backend/config.js dengan Supabase URL + anon key.', 'warn');
    renderDemoState();
    return;
  }
  try {
    const [{ data: products, error: pErr }, { data: members, error: mErr }, { data: sales, error: sErr }, { data: fees, error: feeErr }] = await Promise.all([
      db.from('products').select('*').order('category').order('name'),
      db.from('members').select('*').order('joined_at', { ascending:false }),
      db.from('sales').select('id, receipt_no, sold_at, member_id, subtotal, discount_pct, discount_amount, total, payment_method').order('sold_at', { ascending:false }).limit(150),
      db.from('membership_settings').select('monthly_fee, reactivation_fee').eq('id', 1).single()
    ]);
    if (pErr) throw pErr;
    if (mErr) throw mErr;
    if (sErr) throw sErr;
    state.products = products || [];
    state.members = members || [];
    state.sales = sales || [];
    state.membershipBillingReady = !feeErr;
    if (feeErr) {
      state.membershipFees = { monthly:35000, reactivation:10000 };
      toast('Jalankan backend/membership_billing_migration.sql di Supabase untuk mengaktifkan iuran dan perubahan status.', 'warn');
    } else {
      state.membershipFees = { monthly:Number(fees.monthly_fee), reactivation:Number(fees.reactivation_fee) };
    }
    renderAll();
  } catch (err) {
    console.error(err);
    toast(`Supabase error: ${err.message}`, 'error');
  }
}

function renderAll() {
  renderProducts();
  renderPOS();
  renderSalesHistory();
  renderMembers();
  renderDashboard();
  renderCart();
}

function renderDemoState() {
  state.products = [
    { id:'demo1', sku:'CF-001', name:'Cloud Latte', category:'Coffee', price:28000, is_active:true },
    { id:'demo2', sku:'CF-002', name:'Brown Sugar Oat', category:'Coffee', price:32000, is_active:true },
    { id:'demo3', sku:'CF-003', name:'Americano', category:'Coffee', price:22000, is_active:true },
    { id:'demo4', sku:'CF-004', name:'Matcha Cream', category:'Non-Coffee', price:30000, is_active:true },
    { id:'demo5', sku:'FD-001', name:'Butter Croissant', category:'Pastry', price:24000, is_active:true },
    { id:'demo6', sku:'FD-002', name:'Cinnamon Roll', category:'Pastry', price:26000, is_active:true }
  ];
  state.members = [
    {id:'m1',membership_number:'BRW-0001',joined_at:'2025-07-01',status:'ACTIVE'},
    {id:'m2',membership_number:'BRW-0002',joined_at:'2026-01-10',status:'ACTIVE'},
    {id:'m3',membership_number:'BRW-0003',joined_at:'2026-04-01',status:'ACTIVE'},
    {id:'m4',membership_number:'BRW-0004',joined_at:'2026-08-01',status:'ACTIVE'},
    {id:'m5',membership_number:'BRW-0005',joined_at:'2026-08-20',status:'ACTIVE'}
  ];
  state.sales = [];
  renderAll();
}

function renderPOS() {
  const cats = ['All', ...new Set(state.products.filter(p => p.is_active).map(p => p.category))];
  const filter = document.querySelector('#category-filter');
  filter.innerHTML = cats.map(cat => `<button class="filter-chip ${cat===state.activeCategory ? 'active':''}" data-cat="${escapeHtml(cat)}">${escapeHtml(cat)}</button>`).join('');
  filter.querySelectorAll('.filter-chip').forEach(btn => btn.addEventListener('click', () => { state.activeCategory = btn.dataset.cat; renderPOS(); }));

  const items = state.products.filter(p => p.is_active && (state.activeCategory === 'All' || p.category === state.activeCategory));
  document.querySelector('#pos-products').innerHTML = items.map(p => `
    <button class="product-card" data-id="${p.id}"><span class="product-thumb">${p.category === 'Pastry' ? '🥐' : p.category === 'Non-Coffee' ? '🍵' : '☕'}</span><div><b>${escapeHtml(p.name)}</b><span>${escapeHtml(p.category)}</span><strong>${money(p.price)}</strong></div></button>
  `).join('');
  document.querySelectorAll('.product-card').forEach(btn => btn.addEventListener('click', () => addToCart(btn.dataset.id)));
}

function addToCart(id) {
  const product = state.products.find(p => p.id === id);
  if (!product) return;
  const current = state.cart.find(i => i.product.id === id);
  if (current) current.qty += 1; else state.cart.push({ product, qty: 1 });
  renderCart();
}

function renderCart() {
  const wrap = document.querySelector('#cart-items');
  if (!state.cart.length) {
    wrap.innerHTML = '<div class="empty-state"><span>☕</span><p>Belum ada item.<br>Pilih minuman atau pastry.</p></div>';
  } else {
    wrap.innerHTML = state.cart.map(i => `
      <div class="cart-row"><div><b>${escapeHtml(i.product.name)}</b><small>${money(i.product.price)} × ${i.qty}</small></div><div class="cart-actions"><strong>${money(i.product.price * i.qty)}</strong><button data-remove="${i.product.id}">−</button><span>${i.qty}</span><button data-add="${i.product.id}">＋</button></div></div>
    `).join('');
    wrap.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', () => changeQty(b.dataset.remove, -1)));
    wrap.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => changeQty(b.dataset.add, 1)));
  }
  updateSummary();
}

function renderSalesHistory() {
  const body = document.querySelector('#sales-history-body');
  body.innerHTML = state.sales.map(s => {
    const member = state.members.find(m => m.id === s.member_id)?.membership_number || 'Walk-in';
    return `<tr><td><span class="mono">${escapeHtml(s.receipt_no)}</span></td><td>${dateTimeFmt(s.sold_at)}</td><td>${escapeHtml(member)}</td><td><b>${money(s.total)}</b></td><td>${escapeHtml(s.payment_method)}</td><td><div class="sale-edit-actions"><button class="text-button" data-sale-detail="${escapeHtml(s.id)}">Detail</button><button class="text-button" data-sale-edit="${escapeHtml(s.id)}">Edit</button><button class="text-button status-action" data-sale-delete="${escapeHtml(s.id)}">Hapus</button></div></td></tr>`;
  }).join('') || '<tr><td colspan="6" class="empty-cell">Belum ada transaksi.</td></tr>';
  body.querySelectorAll('[data-sale-detail]').forEach(button => button.addEventListener('click', () => showSaleDetail(button.dataset.saleDetail)));
  body.querySelectorAll('[data-sale-edit]').forEach(button => button.addEventListener('click', () => openSaleEditor(button.dataset.saleEdit)));
  body.querySelectorAll('[data-sale-delete]').forEach(button => button.addEventListener('click', () => deleteSale(button.dataset.saleDelete)));
}

async function openSaleEditor(saleId) {
  if (!configured) { toast('Hubungkan Supabase untuk merevisi transaksi.', 'warn'); return; }
  const sale = state.sales.find(item => item.id === saleId);
  if (!sale) return;
  try {
    const { data: items, error } = await db.from('sale_items')
      .select('product_id, qty, products(name)')
      .eq('sale_id', saleId);
    if (error) throw error;
    state.editingSaleId = saleId;
    state.saleEditItems = (items || []).map(item => ({ product_id:item.product_id, qty:item.qty }));
    document.querySelector('#sale-edit-title').textContent = `Edit ${sale.receipt_no}`;
    const memberSelect = document.querySelector('#sale-edit-member');
    const members = [...state.members];
    const saleMember = members.find(member => member.id === sale.member_id);
    const memberOptions = members.filter(member => member.status === 'ACTIVE' || member.id === sale.member_id);
    memberSelect.innerHTML = '<option value="">Walk-in</option>' + memberOptions.map(member =>
      `<option value="${escapeHtml(member.id)}">${escapeHtml(member.membership_number)}${member.status === 'INACTIVE' ? ' (INACTIVE)' : ''}</option>`
    ).join('');
    memberSelect.value = saleMember?.id || '';
    document.querySelector('#sale-edit-payment').value = sale.payment_method;
    document.querySelector('#sale-edit-message').textContent = '';
    renderSaleEditItems();
    openModal('sale-edit-modal');
  } catch (err) {
    console.error(err);
    toast(`Gagal membuka transaksi: ${err.message}`, 'error');
  }
}

function renderSaleEditItems() {
  const wrap = document.querySelector('#sale-edit-items');
  wrap.innerHTML = state.saleEditItems.map((item, index) => {
    const options = state.products.map(product => {
      const disabled = !product.is_active && product.id !== item.product_id;
      return `<option value="${escapeHtml(product.id)}" ${product.id === item.product_id ? 'selected' : ''} ${disabled ? 'disabled' : ''}>${escapeHtml(product.name)} · ${money(product.price)}${product.is_active ? '' : ' (non-available)'}</option>`;
    }).join('');
    return `<div class="sale-edit-row"><label class="field-label">Produk<select class="input-control" data-sale-product="${index}">${options}</select></label><label class="field-label">Qty<input class="input-control" data-sale-qty="${index}" type="number" min="1" max="999" value="${item.qty}"></label><button class="remove-sale-item" data-sale-item-remove="${index}" type="button" aria-label="Hapus item">×</button></div>`;
  }).join('') || '<p class="micro-copy">Belum ada item. Tambahkan minimal satu produk.</p>';
  wrap.querySelectorAll('[data-sale-product]').forEach(select => select.addEventListener('change', () => {
    state.saleEditItems[Number(select.dataset.saleProduct)].product_id = select.value;
  }));
  wrap.querySelectorAll('[data-sale-qty]').forEach(input => input.addEventListener('input', () => {
    state.saleEditItems[Number(input.dataset.saleQty)].qty = Number(input.value);
  }));
  wrap.querySelectorAll('[data-sale-item-remove]').forEach(button => button.addEventListener('click', () => {
    state.saleEditItems.splice(Number(button.dataset.saleItemRemove), 1);
    renderSaleEditItems();
  }));
}

document.querySelector('#add-sale-item').addEventListener('click', () => {
  const product = state.products.find(item => item.is_active);
  if (!product) { document.querySelector('#sale-edit-message').textContent = 'Tidak ada produk available untuk ditambahkan.'; return; }
  state.saleEditItems.push({ product_id:product.id, qty:1 });
  renderSaleEditItems();
});

document.querySelector('#sale-edit-form').addEventListener('submit', async event => {
  event.preventDefault();
  const message = document.querySelector('#sale-edit-message');
  if (!state.editingSaleId || !state.saleEditItems.length) { message.textContent = 'Transaksi harus memiliki minimal satu item.'; message.className = 'form-message error'; return; }
  if (state.saleEditItems.some(item => !Number.isInteger(item.qty) || item.qty < 1 || item.qty > 999)) { message.textContent = 'Jumlah tiap item harus antara 1 dan 999.'; message.className = 'form-message error'; return; }
  const submit = document.querySelector('#sale-edit-submit');
  submit.disabled = true;
  message.textContent = '';
  try {
    const { error } = await db.rpc('revise_sale', {
      p_sale_id:state.editingSaleId,
      p_member_id:document.querySelector('#sale-edit-member').value || null,
      p_payment_method:document.querySelector('#sale-edit-payment').value,
      p_items:state.saleEditItems
    });
    if (error) throw error;
    closeModal('sale-edit-modal');
    toast('Transaksi berhasil direvisi.', 'success');
    state.editingSaleId = null;
    state.saleEditItems = [];
    await loadAll();
  } catch (err) {
    console.error(err);
    message.textContent = `Gagal merevisi transaksi: ${err.message}`;
    message.className = 'form-message error';
  } finally {
    submit.disabled = false;
  }
});

async function deleteSale(saleId) {
  const sale = state.sales.find(item => item.id === saleId);
  if (!sale || !window.confirm(`Hapus transaksi ${sale.receipt_no} beserta rincian itemnya? Tindakan ini tidak dapat dibatalkan.`)) return;
  if (!configured) { toast('Hubungkan Supabase untuk menghapus transaksi.', 'warn'); return; }
  try {
    const { error } = await db.rpc('delete_sale', { p_sale_id:saleId });
    if (error) throw error;
    toast('Transaksi berhasil dihapus.', 'success');
    await loadAll();
  } catch (err) {
    console.error(err);
    toast(`Gagal menghapus transaksi: ${err.message}`, 'error');
  }
}

async function showSaleDetail(saleId) {
  const sale = state.sales.find(item => item.id === saleId);
  if (!sale) return;
  const content = document.querySelector('#sale-detail-content');
  document.querySelector('#sale-detail-title').textContent = `Receipt ${sale.receipt_no}`;
  content.innerHTML = '<p class="micro-copy">Memuat rincian transaksi…</p>';
  openModal('sale-detail-modal');
  if (!configured) {
    content.innerHTML = '<p class="form-message warn">Rincian item hanya tersedia untuk transaksi yang tersimpan di Supabase.</p>';
    return;
  }
  try {
    const { data: items, error } = await db.from('sale_items')
      .select('qty, unit_price, line_total, products(name, sku)')
      .eq('sale_id', saleId);
    if (error) throw error;
    const member = state.members.find(m => m.id === sale.member_id)?.membership_number || 'Walk-in';
    const itemRows = (items || []).map(item => {
      const product = Array.isArray(item.products) ? item.products[0] : item.products;
      return `<tr><td><b>${escapeHtml(product?.name || 'Produk')}</b><br><small class="mono">${escapeHtml(product?.sku || '')}</small></td><td>${item.qty}</td><td>${money(item.unit_price)}</td><td>${money(item.line_total)}</td></tr>`;
    }).join('') || '<tr><td colspan="4" class="empty-cell">Rincian produk tidak ditemukan.</td></tr>';
    content.innerHTML = `<p class="micro-copy">${dateTimeFmt(sale.sold_at)} · ${escapeHtml(member)} · ${escapeHtml(sale.payment_method)}</p><div class="table-wrap"><table><thead><tr><th>Produk</th><th>Qty</th><th>Harga</th><th>Jumlah</th></tr></thead><tbody>${itemRows}</tbody></table></div><div class="summary-box"><div><span>Subtotal</span><b>${money(sale.subtotal)}</b></div><div><span>Diskon (${sale.discount_pct}%)</span><b>- ${money(sale.discount_amount)}</b></div><div class="summary-total"><span>Total</span><strong>${money(sale.total)}</strong></div></div>`;
  } catch (err) {
    console.error(err);
    content.innerHTML = `<p class="form-message error">Gagal memuat detail: ${escapeHtml(err.message)}</p>`;
  }
}

function changeQty(id, delta) {
  const row = state.cart.find(i => i.product.id === id);
  if (!row) return;
  row.qty += delta;
  if (row.qty <= 0) state.cart = state.cart.filter(i => i.product.id !== id);
  renderCart();
}

document.querySelector('#clear-cart').addEventListener('click', () => { state.cart = []; state.memberLookup = null; document.querySelector('#member-number').value = ''; document.querySelector('#member-status').textContent='Belum ada member.'; renderCart(); });

function currentDiscount() {
  const member = state.memberLookup;
  if (!member) return 0;
  return member.rule.discount;
}

function updateSummary() {
  const subtotal = state.cart.reduce((s, i) => s + Number(i.product.price) * i.qty, 0);
  const discountAmount = subtotal * (currentDiscount() / 100);
  const total = subtotal - discountAmount;
  document.querySelector('#cart-subtotal').textContent = money(subtotal);
  document.querySelector('#cart-discount').textContent = `- ${money(discountAmount)}`;
  document.querySelector('#cart-total').textContent = money(total);
}

document.querySelector('#check-member').addEventListener('click', lookupMember);
document.querySelector('#member-number').addEventListener('keydown', e => { if(e.key==='Enter'){ e.preventDefault(); lookupMember(); } });

async function lookupMember() {
  const value = document.querySelector('#member-number').value.trim().toUpperCase();
  const status = document.querySelector('#member-status');
  if (!value) { state.memberLookup=null; status.textContent='Belum ada member.'; updateSummary(); return; }
  const local = state.members.find(m => m.membership_number.toUpperCase() === value);
  if (!local) { state.memberLookup=null; status.innerHTML='<span class="status-error">Membership number tidak ditemukan.</span>'; updateSummary(); return; }
  if (local.status !== 'ACTIVE') { state.memberLookup=null; status.innerHTML='<span class="status-error">Membership tidak aktif.</span>'; updateSummary(); return; }
  const rule = membershipRule(local.joined_at);
  state.memberLookup = { ...local, rule };
  status.innerHTML = `<span class="status-success">✓ ${escapeHtml(local.membership_number)} · ${rule.tier} · Diskon ${rule.discount}%</span>`;
  updateSummary();
}

document.querySelector('#checkout-btn').addEventListener('click', checkout);

async function checkout() {
  const msg = document.querySelector('#checkout-message');
  msg.textContent='';
  if (!state.cart.length) { msg.textContent='Tambahkan minimal satu produk.'; msg.className='form-message error'; return; }
  if (!configured) { msg.textContent='Demo UI aktif. Hubungkan Supabase untuk menyimpan transaksi.'; msg.className='form-message warn'; toast('Checkout demo tidak disimpan ke database.', 'warn'); return; }
  try {
    const subtotal = state.cart.reduce((s, i) => s + Number(i.product.price) * i.qty, 0);
    const discountPct = currentDiscount();
    const discountAmount = subtotal * discountPct / 100;
    const total = subtotal - discountAmount;
    const receipt = `BRW-${Date.now().toString().slice(-8)}`;
    const payment = document.querySelector('#payment-method').value;
    const { data: sale, error } = await db.from('sales').insert({ receipt_no:receipt, member_id:state.memberLookup?.id || null, subtotal, discount_pct:discountPct, discount_amount:discountAmount, total, payment_method:payment }).select().single();
    if (error) throw error;
    const lineRows = state.cart.map(i => ({ sale_id:sale.id, product_id:i.product.id, qty:i.qty, unit_price:i.product.price, line_total:Number(i.product.price)*i.qty }));
    const { error: lineError } = await db.from('sale_items').insert(lineRows);
    if (lineError) throw lineError;
    toast(`Transaksi ${receipt} berhasil disimpan.`, 'success');
    state.cart = []; state.memberLookup=null; document.querySelector('#member-number').value=''; document.querySelector('#member-status').textContent='Belum ada member.'; renderCart();
    await loadAll();
  } catch (err) {
    console.error(err);
    msg.textContent = `Gagal menyimpan: ${err.message}`; msg.className='form-message error';
  }
}

function renderMembers() {
  const query = document.querySelector('#member-search').value.trim().toUpperCase();
  const rows = state.members.filter(m => !query || m.membership_number.toUpperCase().includes(query));
  document.querySelector('#new-member-fee').textContent = money(state.membershipFees.monthly);
  document.querySelector('#members-body').innerHTML = rows.map(m => {
    const r = membershipRule(m.joined_at);
    const action = m.status === 'ACTIVE'
      ? `<button class="text-button" data-renew-member="${escapeHtml(m.id)}">Bayar iuran</button><button class="text-button status-action" data-deactivate-member="${escapeHtml(m.id)}">Nonaktifkan</button>`
      : `<button class="text-button" data-reactivate-member="${escapeHtml(m.id)}">Aktifkan kembali</button>`;
    return `<tr><td><b>${escapeHtml(m.membership_number)}</b></td><td>${dateFmt(m.joined_at)}</td><td>${r.months} bln</td><td>${getTierBadge(r.tier)}</td><td><b>${r.discount}%</b></td><td>${m.paid_through ? dateFmt(m.paid_through) : 'Belum tercatat'}</td><td><span class="status-pill ${m.status.toLowerCase()}">${m.status}</span></td><td><div class="member-actions">${action}</div></td></tr>`;
  }).join('') || '<tr><td colspan="8" class="empty-cell">Member tidak ditemukan.</td></tr>';
  document.querySelectorAll('[data-renew-member]').forEach(button => button.addEventListener('click', () => openMembershipPayment(button.dataset.renewMember, 'RENEWAL')));
  document.querySelectorAll('[data-reactivate-member]').forEach(button => button.addEventListener('click', () => openMembershipPayment(button.dataset.reactivateMember, 'REACTIVATION')));
  document.querySelectorAll('[data-deactivate-member]').forEach(button => button.addEventListener('click', () => deactivateMember(button.dataset.deactivateMember)));
}
document.querySelector('#member-search').addEventListener('input', renderMembers);

function openMembershipPayment(memberId, paymentType) {
  const member = state.members.find(item => item.id === memberId);
  if (!member) return;
  state.pendingMembershipAction = { memberId, paymentType };
  const monthly = state.membershipFees.monthly;
  const reactivation = paymentType === 'REACTIVATION' ? state.membershipFees.reactivation : 0;
  const total = monthly + reactivation;
  document.querySelector('#membership-payment-title').textContent = paymentType === 'REACTIVATION' ? 'Aktifkan kembali membership' : 'Bayar iuran membership';
  document.querySelector('#membership-payment-summary').innerHTML = `<p><b>${escapeHtml(member.membership_number)}</b></p><div><span>Iuran 1 bulan</span><b>${money(monthly)}</b></div>${reactivation ? `<div><span>Biaya aktivasi ulang</span><b>${money(reactivation)}</b></div>` : ''}<div class="summary-total"><span>Total pembayaran</span><strong>${money(total)}</strong></div>${reactivation ? '<p class="micro-copy">Tanggal bergabung dan masa membership tetap berlanjut, tidak direset.</p>' : ''}`;
  document.querySelector('#membership-payment-message').textContent = '';
  openModal('membership-payment-modal');
}

async function deactivateMember(memberId) {
  const member = state.members.find(item => item.id === memberId);
  if (!member || !window.confirm(`Nonaktifkan membership ${member.membership_number}?`)) return;
  if (!configured || !state.membershipBillingReady) { toast('Jalankan membership_billing_migration.sql di Supabase terlebih dahulu.', 'warn'); return; }
  try {
    const { error } = await db.rpc('change_membership_status', { p_member_id:memberId, p_status:'INACTIVE', p_payment_method:null });
    if (error) throw error;
    toast('Membership dinonaktifkan.', 'success');
    await loadAll();
  } catch (err) {
    console.error(err);
    toast(`Gagal mengubah status: ${err.message}`, 'error');
  }
}

document.querySelector('#membership-payment-submit').addEventListener('click', async () => {
  const action = state.pendingMembershipAction;
  const message = document.querySelector('#membership-payment-message');
  if (!action) return;
  if (!configured || !state.membershipBillingReady) { message.textContent = 'Jalankan membership_billing_migration.sql di Supabase terlebih dahulu.'; message.className = 'form-message warn'; return; }
  const submit = document.querySelector('#membership-payment-submit');
  submit.disabled = true;
  message.textContent = '';
  try {
    const paymentMethod = document.querySelector('#membership-payment-method').value;
    const result = action.paymentType === 'REACTIVATION'
      ? await db.rpc('change_membership_status', { p_member_id:action.memberId, p_status:'ACTIVE', p_payment_method:paymentMethod })
      : await db.rpc('renew_membership', { p_member_id:action.memberId, p_payment_method:paymentMethod });
    if (result.error) throw result.error;
    closeModal('membership-payment-modal');
    state.pendingMembershipAction = null;
    toast(action.paymentType === 'REACTIVATION' ? 'Membership aktif kembali dan pembayaran tercatat.' : 'Iuran membership berhasil dibayar.', 'success');
    await loadAll();
  } catch (err) {
    console.error(err);
    message.textContent = `Pembayaran gagal: ${err.message}`;
    message.className = 'form-message error';
  } finally {
    submit.disabled = false;
  }
});

function renderProducts() {
  const q = document.querySelector('#product-search').value.trim().toLowerCase();
  const rows = state.products.filter(p => [p.sku,p.name,p.category].some(v => String(v).toLowerCase().includes(q)));
  document.querySelector('#products-body').innerHTML = rows.map(p => `<tr><td><span class="mono">${escapeHtml(p.sku)}</span></td><td><b>${escapeHtml(p.name)}</b></td><td>${escapeHtml(p.category)}</td><td>${money(p.price)}</td><td><span class="status-pill ${p.is_active ? 'active':'inactive'}">${p.is_active ? 'AVAILABLE':'NON-AVAILABLE'}</span></td><td><button class="text-button product-action" data-product-availability="${escapeHtml(p.id)}" data-next-availability="${!p.is_active}">${p.is_active ? 'Non-available' : 'Jadikan available'}</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty-cell">Produk tidak ditemukan.</td></tr>';
  document.querySelectorAll('[data-product-availability]').forEach(button => button.addEventListener('click', () => setProductAvailability(button.dataset.productAvailability, button.dataset.nextAvailability === 'true')));
}

async function setProductAvailability(productId, isActive) {
  if (!configured) { toast('Hubungkan Supabase untuk mengubah ketersediaan produk.', 'warn'); return; }
  try {
    const { error } = await db.rpc('set_product_availability', { p_product_id:productId, p_is_active:isActive });
    if (error) throw error;
    toast(isActive ? 'Produk tersedia kembali di menu POS.' : 'Produk ditandai non-available.', 'success');
    await loadAll();
  } catch (err) {
    console.error(err);
    toast(`Gagal mengubah ketersediaan: ${err.message}`, 'error');
  }
}
document.querySelector('#product-search').addEventListener('input', renderProducts);

function renderDashboard() {
  const now = new Date();
  const todaySales = state.sales.filter(s => new Date(s.sold_at).toDateString() === now.toDateString());
  const total = todaySales.reduce((s,x)=>s+Number(x.total),0);
  document.querySelector('#stat-today-sales').textContent = money(total);
  document.querySelector('#stat-today-tx').textContent = todaySales.length;
  document.querySelector('#stat-members').textContent = state.members.filter(m=>m.status==='ACTIVE').length;
  document.querySelector('#stat-avg-ticket').textContent = money(todaySales.length ? total/todaySales.length : 0);
  document.querySelector('#recent-sales-body').innerHTML = state.sales.slice(0,6).map(s => {
    const member = state.members.find(m=>m.id===s.member_id)?.membership_number || 'Walk-in';
    return `<tr><td><span class="mono">${escapeHtml(s.receipt_no)}</span></td><td>${escapeHtml(member)}</td><td>${money(s.subtotal)}</td><td>${s.discount_pct}%</td><td><b>${money(s.total)}</b></td></tr>`;
  }).join('') || '<tr><td colspan="5" class="empty-cell">Belum ada transaksi.</td></tr>';
  drawCharts();
}

function drawCharts() {
  const salesByDay = [];
  for (let i=6;i>=0;i--) {
    const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()-i);
    const label = d.toLocaleDateString('id-ID',{day:'2-digit',month:'short'});
    const val = state.sales.filter(s=>new Date(s.sold_at).toDateString()===d.toDateString()).reduce((a,s)=>a+Number(s.total),0);
    salesByDay.push({label,val});
  }
  const counts = { BRONZE:0, SILVER:0, GOLD:0 };
  state.members.filter(m=>m.status==='ACTIVE').forEach(m=>counts[membershipRule(m.joined_at).tier]++);
  const Chart = window.Chart;
  if (!Chart) return;
  if (state.charts.sales) state.charts.sales.destroy();
  if (state.charts.membership) state.charts.membership.destroy();
  state.charts.sales = new Chart(document.querySelector('#salesChart'), { type:'bar', data:{labels:salesByDay.map(x=>x.label),datasets:[{data:salesByDay.map(x=>x.val),borderRadius:8,borderSkipped:false,backgroundColor:'rgba(214,160,84,.72)'}]}, options:{plugins:{legend:{display:false}},scales:{x:{grid:{display:false},ticks:{color:'#bdb4aa'}},y:{grid:{color:'rgba(255,255,255,.06)'},ticks:{color:'#bdb4aa', callback:v=>`Rp ${Math.round(v/1000)}k`}}}} });
  state.charts.membership = new Chart(document.querySelector('#membershipChart'), { type:'doughnut', data:{labels:['Bronze','Silver','Gold'],datasets:[{data:[counts.BRONZE,counts.SILVER,counts.GOLD],backgroundColor:['#a97649','#9ea5ad','#d6a054'],borderColor:'rgba(25,18,14,.8)',borderWidth:4}]}, options:{cutout:'72%',plugins:{legend:{display:false}}} });
  document.querySelector('#tier-legend').innerHTML = [['bronze','Bronze',counts.BRONZE],['silver','Silver',counts.SILVER],['gold','Gold',counts.GOLD]].map(([c,n,v])=>`<span><i class="tier-dot ${c}"></i>${n} <b>${v}</b></span>`).join('');
}

function openModal(id){ document.querySelector(`#${id}`).classList.add('open'); }
function closeModal(id){ document.querySelector(`#${id}`).classList.remove('open'); }
document.querySelector('#open-member-form').addEventListener('click',()=>openModal('member-modal'));
document.querySelector('#open-product-form').addEventListener('click',()=>openModal('product-modal'));
document.querySelectorAll('.modal-close').forEach(b=>b.addEventListener('click',()=>closeModal(b.dataset.close)));

document.querySelector('#member-form').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  if (!configured) { document.querySelector('#member-form-message').textContent='Demo UI aktif. Hubungkan Supabase untuk menyimpan member.'; document.querySelector('#member-form-message').className='form-message warn'; return; }
  if (!state.membershipBillingReady) { document.querySelector('#member-form-message').textContent='Jalankan membership_billing_migration.sql di Supabase terlebih dahulu.'; document.querySelector('#member-form-message').className='form-message warn'; return; }
  try {
    const { error } = await db.rpc('register_member', {
      p_membership_number:String(fd.get('membership_number')).trim().toUpperCase(),
      p_joined_at:fd.get('joined_at'),
      p_payment_method:fd.get('payment_method')
    });
    if (error) throw error;
    toast('Member baru dibuat dan iuran bulan pertama tercatat.', 'success'); e.target.reset(); closeModal('member-modal'); await loadAll();
  } catch(err){ document.querySelector('#member-form-message').textContent = err.message; document.querySelector('#member-form-message').className='form-message error'; }
});

document.querySelector('#product-form').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  if (!configured) { document.querySelector('#product-form-message').textContent='Demo UI aktif. Hubungkan Supabase untuk menyimpan produk.'; document.querySelector('#product-form-message').className='form-message warn'; return; }
  try {
    const { error } = await db.from('products').insert({ sku:String(fd.get('sku')).trim().toUpperCase(), name:String(fd.get('name')).trim(), category:fd.get('category'), price:Number(fd.get('price')), is_active:true });
    if (error) throw error;
    toast('Produk baru berhasil ditambahkan.', 'success'); e.target.reset(); closeModal('product-modal'); await loadAll();
  } catch(err){ document.querySelector('#product-form-message').textContent = err.message; document.querySelector('#product-form-message').className='form-message error'; }
});

window.addEventListener('keydown', e => { if(e.key==='Escape') document.querySelectorAll('.modal-backdrop.open').forEach(m=>m.classList.remove('open')); });

loadAll();
