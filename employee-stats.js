// employee-stats.js
// Полная страница статистики сотрудника

const { db, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs, addDoc } = window;

const urlParams = new URLSearchParams(window.location.search);
const EMPLOYEE_ID = urlParams.get('id');

if (!EMPLOYEE_ID) {
    document.body.innerHTML = `
        <div style="padding:50px;text-align:center;color:var(--red);">
            <h1>❌ Ошибка!</h1>
            <p>Не указан ID сотрудника.</p>
        </div>
    `;
    throw new Error('No employee ID');
}

let employeeName = 'Сотрудник';
let settings = {
    rDay: 3000,
    rExtra: 3500,
    rOt1: 400,
    rOt2: 800,
    otLimit: 5
};
const NORMAL_HOURS_PER_DAY = 8;

// ============================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================

function getWeekNumber(weekKey) {
    const match = weekKey.match(/W(\d+)/);
    return match ? parseInt(match[1]) : weekKey;
}

function formatDateRange(weekKey) {
    try {
        const match = weekKey.match(/^(\d+)-W(\d+)/);
        if (!match) return weekKey;
        const year = parseInt(match[1]);
        const weekNum = parseInt(match[2]);
        const jan4 = new Date(year, 0, 4);
        const dayOfWeek = jan4.getDay();
        let daysToMonday;
        if (dayOfWeek === 0) {
            daysToMonday = 1;
        } else {
            daysToMonday = 1 - dayOfWeek;
        }
        const firstMonday = new Date(jan4);
        firstMonday.setDate(jan4.getDate() + daysToMonday);
        const startDate = new Date(firstMonday);
        startDate.setDate(firstMonday.getDate() + (weekNum - 1) * 7);
        const endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 6);
        const options = { day: '2-digit', month: 'short' };
        const start = startDate.toLocaleDateString('ru-RU', options);
        const end = endDate.toLocaleDateString('ru-RU', options);
        return `${start} – ${end}`;
    } catch (error) {
        return weekKey;
    }
}

function formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatHours(hours) {
    return hours.toFixed(2).replace('.', ',');
}

function calculateWeekPay(weekData, settings) {
    const workDays = weekData.workDays || [true, true, true, true, true, false, false];
    const hours = weekData.hours || [NORMAL_HOURS_PER_DAY, NORMAL_HOURS_PER_DAY, NORMAL_HOURS_PER_DAY, NORMAL_HOURS_PER_DAY, NORMAL_HOURS_PER_DAY, 0, 0];
    
    const rD = settings.rDay || 3000;
    const rE = settings.rExtra || 3500;
    const r1 = settings.rOt1 || 400;
    const r2 = settings.rOt2 || 800;
    const lim = settings.otLimit || 5;
    
    const days = workDays.filter(Boolean).length;
    const totalHours = hours.reduce((a, b) => a + b, 0);
    const norm = days * NORMAL_HOURS_PER_DAY;
    const ot = Math.max(0, totalHours - norm);
    const ot1 = Math.min(ot, lim);
    const ot2 = Math.max(0, ot - lim);
    
    let payBase = 0;
    let payExtra = 0;
    
    for (let i = 0; i < workDays.length; i++) {
        if (!workDays[i]) continue;
        const dayHours = hours[i] || 0;
        const dayIndex = workDays.slice(0, i).filter(Boolean).length;
        const isExtraDay = dayIndex >= 5;
        const dayRate = isExtraDay ? rE : rD;
        const dayPay = Math.min(dayRate, (dayHours / NORMAL_HOURS_PER_DAY) * dayRate);
        if (isExtraDay) {
            payExtra += dayPay;
        } else {
            payBase += dayPay;
        }
    }
    
    const payOt1 = ot1 * r1;
    const payOt2 = ot2 * r2;
    const total = payBase + payExtra + payOt1 + payOt2;
    
    return {
        days,
        totalHours,
        norm,
        ot,
        ot1,
        ot2,
        payBase,
        payExtra,
        payOt1,
        payOt2,
        total,
        workDays,
        hours
    };
}

// ============================================
// РАБОТА С АВАНСАМИ
// ============================================

async function getEmployeeAdvances() {
    try {
        const advancesRef = collection(db, 'salaryAdvances');
        const q = query(advancesRef, where('employeeId', '==', EMPLOYEE_ID));
        const snapshot = await getDocs(q);
        const advances = [];
        snapshot.forEach((doc) => {
            advances.push({ id: doc.id, ...doc.data() });
        });
        return advances.sort((a, b) => a.date.localeCompare(b.date));
    } catch (error) {
        console.error('Ошибка загрузки авансов:', error);
        return [];
    }
}

async function getActiveAdvances() {
    const all = await getEmployeeAdvances();
    return all.filter(a => a.status === 'active');
}

async function repayAdvance(advanceId, amount, weekId, weekKey) {
    try {
        const advanceRef = doc(db, 'salaryAdvances', advanceId);
        const advanceSnap = await getDoc(advanceRef);
        if (!advanceSnap.exists()) {
            return { success: false, error: 'Аванс не найден' };
        }
        const advance = advanceSnap.data();
        
        if (amount >= advance.amount) {
            await updateDoc(advanceRef, {
                status: 'repaid',
                repaidAt: new Date().toISOString(),
                repaidFromWeek: weekId,
                repaidAmount: advance.amount
            });
            return { success: true, repaidAmount: advance.amount, fullyRepaid: true };
        } else {
            await updateDoc(advanceRef, {
                amount: advance.amount - amount,
                repaidAt: new Date().toISOString(),
                repaidFromWeek: weekId,
                repaidAmount: amount,
                partiallyRepaid: true,
                originalAmount: advance.originalAmount || advance.amount
            });
            return { success: true, repaidAmount: amount, fullyRepaid: false };
        }
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ============================================
// ДОЛГ КОМПАНИИ
// ============================================

async function getCompanyDebt() {
    try {
        const debtRef = doc(db, 'companyDebt', EMPLOYEE_ID);
        const debtSnap = await getDoc(debtRef);
        if (debtSnap.exists()) {
            return debtSnap.data();
        }
        return { totalDebt: 0, history: [] };
    } catch (error) {
        console.error('Ошибка загрузки долга компании:', error);
        return { totalDebt: 0, history: [] };
    }
}

async function addCompanyDebt(amount, weekKey, weekId, comment) {
    try {
        const debtRef = doc(db, 'companyDebt', EMPLOYEE_ID);
        const current = await getCompanyDebt();
        
        const newHistory = current.history || [];
        newHistory.push({
            amount: parseFloat(amount) || 0,
            weekKey: weekKey,
            weekId: weekId,
            date: new Date().toISOString(),
            comment: comment || 'Невыплаченная часть зарплаты'
        });
        
        const totalDebt = (current.totalDebt || 0) + (parseFloat(amount) || 0);
        
        await setDoc(debtRef, {
            employeeId: EMPLOYEE_ID,
            totalDebt: totalDebt,
            history: newHistory,
            updatedAt: new Date().toISOString()
        });
        
        return { success: true, totalDebt };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function reduceCompanyDebt(amount) {
    try {
        const debtRef = doc(db, 'companyDebt', EMPLOYEE_ID);
        const current = await getCompanyDebt();
        const newTotal = Math.max(0, (current.totalDebt || 0) - (parseFloat(amount) || 0));
        
        const newHistory = current.history || [];
        newHistory.push({
            amount: -(parseFloat(amount) || 0),
            date: new Date().toISOString(),
            comment: 'Погашено компанией'
        });
        
        await setDoc(debtRef, {
            employeeId: EMPLOYEE_ID,
            totalDebt: newTotal,
            history: newHistory,
            updatedAt: new Date().toISOString()
        });
        
        return { success: true, totalDebt: newTotal };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function writeOffCompanyDebt(amount, comment) {
    try {
        const debtRef = doc(db, 'companyDebt', EMPLOYEE_ID);
        const current = await getCompanyDebt();
        
        if (current.totalDebt < amount) {
            return { success: false, error: 'Сумма превышает долг компании' };
        }
        
        const newTotal = current.totalDebt - amount;
        const newHistory = current.history || [];
        newHistory.push({
            amount: -amount,
            date: new Date().toISOString(),
            comment: comment || 'Списано компанией'
        });
        
        await setDoc(debtRef, {
            employeeId: EMPLOYEE_ID,
            totalDebt: newTotal,
            history: newHistory,
            updatedAt: new Date().toISOString()
        });
        
        return { success: true, totalDebt: newTotal };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ============================================
// ОТМЕТКА О ПОЛУЧЕНИИ ЗАРПЛАТЫ
// ============================================

async function markWeekAsPaid(weekId, amount, weekKey) {
    try {
        const weekRef = doc(db, 'salaryWeeks', weekId);
        const weekSnap = await getDoc(weekRef);
        if (!weekSnap.exists()) {
            return { success: false, error: 'Неделя не найдена' };
        }
        
        const weekData = weekSnap.data();
        const stats = calculateWeekPay(weekData, settings);
        const fullAmount = stats.total;
        const paidAmount = parseFloat(amount) || fullAmount;
        
        let companyDebtCreated = false;
        let debtAmount = 0;
        if (paidAmount < fullAmount) {
            debtAmount = fullAmount - paidAmount;
            const debtResult = await addCompanyDebt(
                debtAmount,
                weekKey,
                weekId,
                `Невыплаченная часть зарплаты за неделю ${weekKey}`
            );
            companyDebtCreated = debtResult.success;
        }
        
        await updateDoc(weekRef, {
            isPaid: true,
            paidAmount: paidAmount,
            paidAt: new Date().toISOString(),
            fullAmount: fullAmount,
            companyDebt: fullAmount - paidAmount
        });
        
        return { 
            success: true, 
            paidAmount,
            fullAmount,
            companyDebtCreated,
            companyDebtAmount: fullAmount - paidAmount
        };
    } catch (error) {
        console.error('Ошибка отметки о выплате:', error);
        return { success: false, error: error.message };
    }
}

// ============================================
// РЕДАКТИРОВАНИЕ СУММЫ ВЫПЛАТЫ
// ============================================

async function updateWeekPayment(weekId, newAmount, weekKey) {
    try {
        const weekRef = doc(db, 'salaryWeeks', weekId);
        const weekSnap = await getDoc(weekRef);
        if (!weekSnap.exists()) {
            return { success: false, error: 'Неделя не найдена' };
        }
        
        const weekData = weekSnap.data();
        const stats = calculateWeekPay(weekData, settings);
        const fullAmount = stats.total;
        const paidAmount = parseFloat(newAmount) || 0;
        
        await updateDoc(weekRef, {
            paidAmount: paidAmount,
            paidAt: new Date().toISOString(),
            isPaid: paidAmount > 0
        });
        
        const oldPaid = weekData.paidAmount || 0;
        const oldCompanyDebt = weekData.companyDebt || 0;
        const newCompanyDebt = Math.max(0, fullAmount - paidAmount);
        
        if (oldCompanyDebt !== newCompanyDebt) {
            const debtDiff = newCompanyDebt - oldCompanyDebt;
            if (debtDiff > 0) {
                await addCompanyDebt(debtDiff, weekKey, weekId, 'Корректировка долга компании');
            } else if (debtDiff < 0) {
                await reduceCompanyDebt(Math.abs(debtDiff));
            }
        }
        
        await updateDoc(weekRef, {
            companyDebt: newCompanyDebt
        });
        
        return { 
            success: true, 
            paidAmount,
            fullAmount,
            companyDebt: newCompanyDebt,
            isPaid: paidAmount > 0
        };
    } catch (error) {
        console.error('Ошибка обновления выплаты:', error);
        return { success: false, error: error.message };
    }
}

// ============================================
// ЗАГРУЗКА ДАННЫХ
// ============================================

async function loadEmployeeInfo() {
    try {
        const docRef = doc(db, 'salaryEmployees', EMPLOYEE_ID);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            employeeName = data.name || 'Сотрудник';
            
            const badge = document.getElementById('userBadge');
            const nameEl = document.getElementById('userName');
            const avatarEl = document.getElementById('userAvatar');
            const idLabelEl = document.getElementById('userIdLabel');
            if (badge) {
                badge.style.display = 'flex';
                badge.title = `ID: ${EMPLOYEE_ID}`;
            }
            if (nameEl) nameEl.textContent = employeeName;
            if (avatarEl) avatarEl.textContent = employeeName.charAt(0).toUpperCase();
            if (idLabelEl) idLabelEl.textContent = `ID: ${EMPLOYEE_ID.substring(0, 8)}...`;
            
            document.getElementById('employeeNameHeader').textContent = employeeName;
            document.getElementById('backLink').href = `employee.html?id=${EMPLOYEE_ID}`;
            
            return data;
        }
    } catch (error) {
        console.warn('Не удалось загрузить информацию о сотруднике:', error);
        const badge = document.getElementById('userBadge');
        if (badge) {
            badge.style.display = 'flex';
            badge.title = `ID: ${EMPLOYEE_ID}`;
        }
    }
    return null;
}

async function loadSettings() {
    try {
        const docRef = doc(db, 'salarySettings', EMPLOYEE_ID);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            settings = {
                rDay: data.rDay || 3000,
                rExtra: data.rExtra || 3500,
                rOt1: data.rOt1 || 400,
                rOt2: data.rOt2 || 800,
                otLimit: data.otLimit || 5
            };
        }
    } catch (error) {
        console.warn('Не удалось загрузить настройки:', error);
    }
}

async function loadWeeks() {
    try {
        const weeksRef = collection(db, 'salaryWeeks');
        const q = query(weeksRef, where('employeeId', '==', EMPLOYEE_ID));
        const snapshot = await getDocs(q);
        const weeks = [];
        snapshot.forEach((doc) => {
            weeks.push({ id: doc.id, ...doc.data() });
        });
        return weeks.sort((a, b) => b.weekKey.localeCompare(a.weekKey));
    } catch (error) {
        console.error('Ошибка загрузки недель:', error);
        return [];
    }
}

// ============================================
// РЕНДЕРИНГ
// ============================================

async function renderStats() {
    const weekList = document.getElementById('weekList');
    const weeksCount = document.getElementById('weeksCount');
    
    try {
        const weeks = await loadWeeks();
        const allAdvances = await getEmployeeAdvances();
        const activeAdvances = allAdvances.filter(a => a.status === 'active');
        const companyDebt = await getCompanyDebt();
        const totalDebt = activeAdvances.reduce((sum, a) => sum + a.amount, 0);
        
        let totalEarned = 0;
        let totalReceived = 0;
        
        const sortedWeeks = weeks.sort((a, b) => b.weekKey.localeCompare(a.weekKey));
        
        weeksCount.textContent = `${sortedWeeks.length} недель`;
        
        if (sortedWeeks.length === 0) {
            weekList.innerHTML = `
                <div class="empty-state">
                    <div class="icon">📭</div>
                    <div>Нет данных. Заполните расписание!</div>
                </div>
            `;
            return;
        }
        
        sortedWeeks.forEach(week => {
            const stats = calculateWeekPay(week, settings);
            totalEarned += stats.total;
            if (week.isPaid) {
                totalReceived += week.paidAmount || stats.total;
            }
        });
        
        document.getElementById('totalEarned').textContent = totalEarned.toLocaleString() + ' ₽';
        document.getElementById('totalReceived').textContent = totalReceived.toLocaleString() + ' ₽';
        document.getElementById('totalDebt').textContent = totalDebt.toLocaleString() + ' ₽';
        
        const statsGrid = document.getElementById('statsGrid');
        const oldDebtCard = statsGrid.querySelector('.stat-card:last-child');
        if (oldDebtCard && oldDebtCard.textContent.includes('Долг компании')) {
            oldDebtCard.remove();
        }
        if (oldDebtCard && oldDebtCard.textContent.includes('Списать долг')) {
            oldDebtCard.remove();
        }
        
        if (companyDebt.totalDebt > 0) {
            statsGrid.innerHTML += `
                <div class="stat-card" style="border-color: var(--amber);">
                    <div class="label">Долг компании</div>
                    <div class="value amber">${companyDebt.totalDebt.toLocaleString()} ₽</div>
                    <button onclick="window.handleWriteOffDebt()" 
                            style="margin-top:6px; background:var(--red); color:#fff; border:none; padding:4px 12px; border-radius:6px; cursor:pointer; font-size:.6rem;">
                        🗑️ Списать долг
                    </button>
                </div>
            `;
        }
        
        let html = '';
        sortedWeeks.forEach(week => {
            const stats = calculateWeekPay(week, settings);
            const weekNum = getWeekNumber(week.weekKey);
            const dateRange = formatDateRange(week.weekKey);
            const isPaid = week.isPaid || false;
            const paidAmount = week.paidAmount || 0;
            const debtRepaid = week.debtRepaid || false;
            const repaidAmount = week.repaidAmount || 0;
            const companyDebtAmount = week.companyDebt || 0;
            const fullAmount = stats.total;
            const finalPay = fullAmount - (week.repaidAmount || 0);
            
            const totalActiveDebt = activeAdvances.reduce((sum, a) => sum + a.amount, 0);
            
            let statusText = isPaid ? '✅ Получено' : '⏳ Ожидает';
            let statusClass = isPaid ? 'paid' : 'unpaid';
            
            const hasCompanyDebt = companyDebtAmount > 0;
            
            // Определяем, сколько уже погашено авансов из этой недели
            const weekRepaidAmount = week.repaidAmount || 0;
            const hasRepaid = weekRepaidAmount > 0;
            
            html += `
                <div class="week-item">
                    <div class="week-header">
                        <div>
                            <span class="week-title">Неделя ${weekNum}</span>
                            ${hasRepaid ? ' <span class="debt-badge" style="background:rgba(62,207,168,.15);border-color:var(--teal);">💳 Погашен аванс</span>' : ''}
                            ${hasCompanyDebt ? ' <span class="debt-badge" style="background:rgba(255,181,46,.2);border-color:var(--amber);">🏢 Долг компании</span>' : ''}
                        </div>
                        <span class="week-date">${dateRange}</span>
                    </div>
                    <div class="week-details">
                        <div class="detail-item">
                            <div class="dlabel">Дней</div>
                            <div class="dvalue">${stats.days}</div>
                        </div>
                        <div class="detail-item">
                            <div class="dlabel">Часов</div>
                            <div class="dvalue">${formatHours(stats.totalHours)}</div>
                        </div>
                        <div class="detail-item">
                            <div class="dlabel">Переработка</div>
                            <div class="dvalue ${stats.ot > 0 ? 'debt' : 'mut'}">${stats.ot > 0 ? formatHours(stats.ot) + ' ч' : '—'}</div>
                        </div>
                        <div class="detail-item">
                            <div class="dlabel">Зарплата</div>
                            <div class="dvalue amber">${stats.total.toLocaleString()} ₽</div>
                        </div>
                        ${hasRepaid ? `
                            <div class="detail-item" style="border:1px solid var(--teal); border-radius:6px; grid-column: span 2; background:rgba(62,207,168,.05);">
                                <div class="dlabel" style="color:var(--teal);">💳 Погашено аванса</div>
                                <div class="dvalue" style="color:var(--red);">-${weekRepaidAmount.toLocaleString()} ₽</div>
                            </div>
                            <div class="detail-item">
                                <div class="dlabel">К выплате</div>
                                <div class="dvalue amber">${finalPay.toLocaleString()} ₽</div>
                            </div>
                        ` : ''}
                        <div class="detail-item">
                            <div class="dlabel">Статус</div>
                            <div class="dvalue ${statusClass}">${statusText}</div>
                        </div>
                        <div class="detail-item">
                            <div class="dlabel">${isPaid ? 'Получено' : 'К получению'}</div>
                            <div class="dvalue ${isPaid ? 'paid' : 'unpaid'}">${isPaid ? paidAmount.toLocaleString() : (hasRepaid ? finalPay.toLocaleString() : stats.total.toLocaleString())} ₽</div>
                        </div>
                        ${hasCompanyDebt ? `
                            <div class="detail-item" style="grid-column: span 3;">
                                <div class="dlabel" style="color:var(--amber);">🏢 Долг компании</div>
                                <div class="dvalue amber">${companyDebtAmount.toLocaleString()} ₽</div>
                            </div>
                        ` : ''}
                    </div>
                    
                    ${!isPaid && totalActiveDebt > 0 ? `
                        <div class="week-actions" style="border-top: 2px solid var(--amber);">
                            <div style="width:100%; font-size:.75rem; color:var(--amber); margin-bottom:4px;">
                                💰 Активных долгов: ${activeAdvances.length} (всего: ${totalActiveDebt.toLocaleString()} ₽)
                            </div>
                            ${activeAdvances.map((advance, index) => `
                                <div style="display:flex; align-items:center; gap:6px; width:100%; flex-wrap:wrap; padding:4px 0; border-top: ${index > 0 ? '1px solid var(--line)' : 'none'};">
                                    <span style="font-size:.7rem; flex:1; min-width:80px;">
                                        #${index + 1}: ${advance.amount.toLocaleString()} ₽
                                        ${advance.comment ? `(${advance.comment})` : ''}
                                    </span>
                                    <div class="pay-input-group" style="flex:1; min-width:80px;">
                                        <input type="number" id="repayAmount_${week.id}_${advance.id}" placeholder="Сумма" value="${Math.min(advance.amount, stats.total - (week.repaidAmount || 0))}" step="100" min="0" max="${advance.amount}">
                                        <span style="font-size:.7rem; color:var(--mut);">₽</span>
                                    </div>
                                    <button class="btn-small amber" onclick="window.handleRepayAdvance('${week.id}', '${week.weekKey}', '${advance.id}', ${advance.amount})" style="flex:0; min-width:44px;">
                                        💳
                                    </button>
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
                    
                    ${!isPaid && totalActiveDebt === 0 ? `
                        <div class="week-actions">
                            <div class="pay-input-group">
                                <input type="number" id="payAmount_${week.id}" placeholder="Сумма" value="${stats.total - (week.repaidAmount || 0)}" step="100" min="0">
                                <span style="font-size:.7rem; color:var(--mut);">₽</span>
                            </div>
                            <button class="btn-small amber" onclick="window.handleMarkPaid('${week.id}', '${week.weekKey}')">
                                ✅ Получено
                            </button>
                        </div>
                    ` : ''}
                    
                    ${isPaid ? `
                        <div class="week-actions">
                            <div style="display:flex; flex-wrap:wrap; gap:6px; align-items:center; flex:1;">
                                <span style="font-size:.7rem; color:var(--mut);">
                                    Получено: <strong>${paidAmount.toLocaleString()} ₽</strong>
                                    ${week.paidAt ? ` (${formatDate(week.paidAt)})` : ''}
                                </span>
                                ${week.companyDebt > 0 ? `
                                    <span style="font-size:.7rem; color:var(--amber);">🏢 Долг: ${week.companyDebt.toLocaleString()} ₽</span>
                                ` : ''}
                            </div>
                            <button class="btn-small ghost" onclick="window.handleEditPayment('${week.id}', ${paidAmount}, ${stats.total}, '${week.weekKey}')" style="flex:0;">
                                ✏️
                            </button>
                        </div>
                    ` : ''}
                </div>
            `;
        });
        
        weekList.innerHTML = html;
        
    } catch (error) {
        console.error('Ошибка рендеринга:', error);
        weekList.innerHTML = `
            <div class="empty-state">
                <div class="icon">❌</div>
                <div>Ошибка загрузки: ${error.message}</div>
            </div>
        `;
    }
}

// ============================================
// ОБРАБОТЧИКИ (ЭКСПОРТИРУЕМ В WINDOW)
// ============================================

// Отметка о получении зарплаты
window.handleMarkPaid = async function(weekId, weekKey) {
    const input = document.getElementById(`payAmount_${weekId}`);
    if (!input) return;
    
    const amount = parseFloat(input.value);
    if (!amount || amount <= 0) {
        alert('❌ Введите корректную сумму');
        return;
    }
    
    const weeks = await loadWeeks();
    const week = weeks.find(w => w.id === weekId);
    if (!week) return;
    const stats = calculateWeekPay(week, settings);
    const finalPay = stats.total - (week.repaidAmount || 0);
    
    if (amount > finalPay) {
        if (!confirm(`Сумма (${amount.toLocaleString()} ₽) превышает сумму к выплате (${finalPay.toLocaleString()} ₽). Продолжить?`)) {
            return;
        }
    }
    
    const message = amount < finalPay 
        ? `Отметить неделю как полученную на ${amount.toLocaleString()} ₽?\nНевыплаченная часть (${(finalPay - amount).toLocaleString()} ₽) будет записана как долг компании.`
        : `Отметить неделю как полученную на ${amount.toLocaleString()} ₽?`;
    
    if (!confirm(message)) return;
    
    try {
        const result = await markWeekAsPaid(weekId, amount, weekKey);
        if (result.success) {
            let msg = `✅ Неделя отмечена как полученная!\nПолучено: ${result.paidAmount.toLocaleString()} ₽`;
            if (result.companyDebtAmount > 0) {
                msg += `\n🏢 Долг компании: ${result.companyDebtAmount.toLocaleString()} ₽`;
            }
            alert(msg);
            await renderStats();
        } else {
            alert('❌ Ошибка: ' + result.error);
        }
    } catch (error) {
        alert('❌ Ошибка: ' + error.message);
    }
};

// Погашение конкретного аванса
window.handleRepayAdvance = async function(weekId, weekKey, advanceId, advanceAmount) {
    const input = document.getElementById(`repayAmount_${weekId}_${advanceId}`);
    if (!input) return;
    
    const amount = parseFloat(input.value);
    if (!amount || amount <= 0) {
        alert('❌ Введите корректную сумму');
        return;
    }
    
    if (amount > advanceAmount) {
        alert(`❌ Сумма (${amount.toLocaleString()} ₽) превышает долг (${advanceAmount.toLocaleString()} ₽)`);
        return;
    }
    
    const weeks = await loadWeeks();
    const week = weeks.find(w => w.id === weekId);
    if (!week) {
        alert('❌ Неделя не найдена');
        return;
    }
    const stats = calculateWeekPay(week, settings);
    const currentRepaid = week.repaidAmount || 0;
    const maxRepay = stats.total - currentRepaid;
    
    if (amount > maxRepay) {
        alert(`❌ Недостаточно средств. Доступно для погашения: ${maxRepay.toLocaleString()} ₽`);
        return;
    }
    
    const isFullyRepaid = amount >= advanceAmount;
    const message = isFullyRepaid
        ? `Погасить аванс полностью (${amount.toLocaleString()} ₽) из зарплаты за неделю ${weekKey}?`
        : `Погасить часть аванса (${amount.toLocaleString()} ₽) из зарплаты за неделю ${weekKey}? Остаток: ${(advanceAmount - amount).toLocaleString()} ₽`;
    
    if (!confirm(message)) return;
    
    try {
        const result = await repayAdvance(advanceId, amount, weekId, weekKey);
        if (result.success) {
            const weekRef = doc(db, 'salaryWeeks', weekId);
            const newRepaidAmount = currentRepaid + amount;
            const finalPay = stats.total - newRepaidAmount;
            
            await updateDoc(weekRef, {
                debtRepaid: true,
                repaidAmount: newRepaidAmount,
                finalPay: finalPay
            });
            
            alert(`✅ Аванс погашен!\nПогашено: ${result.repaidAmount.toLocaleString()} ₽\n${result.fullyRepaid ? '✅ Аванс полностью погашен' : '⏳ Остаток: ' + (advanceAmount - amount).toLocaleString() + ' ₽'}\n💰 К выплате: ${finalPay.toLocaleString()} ₽`);
            await renderStats();
        } else {
            alert('❌ Ошибка: ' + result.error);
        }
    } catch (error) {
        alert('❌ Ошибка: ' + error.message);
    }
};

// Редактирование выплаты
window.handleEditPayment = function(weekId, currentAmount, fullAmount, weekKey) {
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,.7);
        backdrop-filter: blur(4px);
        z-index: 1001;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
    `;
    modal.innerHTML = `
        <div style="background: var(--card); border-radius: 16px; padding: 24px; max-width: 420px; width: 100%; border: 1px solid var(--line);">
            <h3 style="font-family: var(--display); color: var(--amber); margin-bottom: 4px;">✏️ Редактировать выплату</h3>
            <div style="color: var(--mut); font-size: .85rem; margin-bottom: 16px;">Неделя ${weekKey}</div>
            <div style="margin-bottom: 12px;">
                <label style="font-size: .75rem; color: var(--mut); display: block; margin-bottom: 4px;">Полная зарплата</label>
                <div style="font-size: 1.1rem; font-weight: bold; color: var(--amber);">${fullAmount.toLocaleString()} ₽</div>
            </div>
            <div style="margin-bottom: 12px;">
                <label style="font-size: .75rem; color: var(--mut); display: block; margin-bottom: 4px;">Фактически выплачено</label>
                <input type="number" id="editPaymentInput" value="${currentAmount}" min="0" step="100"
                       style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--line); background: var(--bg2); color: var(--txt); font-size: 1rem;">
            </div>
            <div style="margin-bottom: 12px; padding: 8px 12px; background: rgba(255,181,46,.06); border-radius: 8px; border: 1px dashed var(--amber);">
                <div style="display: flex; justify-content: space-between; font-size: .8rem;">
                    <span style="color: var(--mut);">Долг компании:</span>
                    <span style="color: var(--amber); font-weight: bold;" id="previewDebt">${(fullAmount - currentAmount).toLocaleString()} ₽</span>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: .8rem;">
                    <span style="color: var(--mut);">Статус:</span>
                    <span style="color: var(--teal); font-weight: bold;" id="previewStatus">${currentAmount > 0 ? '✅ Выплачено' : '⏳ Не выплачено'}</span>
                </div>
            </div>
            <div style="display: flex; gap: 10px; margin-top: 8px;">
                <button id="saveEditPayment" class="btn btn-amber" style="flex:1;">💾 Сохранить</button>
                <button id="cancelEditPayment" class="btn btn-ghost" style="flex:1;">Отмена</button>
            </div>
            <div id="editError" style="color: var(--red); margin-top: 10px; font-size: .8rem;"></div>
        </div>
    `;
    document.body.appendChild(modal);
    
    const input = modal.querySelector('#editPaymentInput');
    const previewDebt = modal.querySelector('#previewDebt');
    const previewStatus = modal.querySelector('#previewStatus');
    
    input.addEventListener('input', function() {
        const val = parseFloat(this.value) || 0;
        const debt = Math.max(0, fullAmount - val);
        previewDebt.textContent = debt.toLocaleString() + ' ₽';
        previewDebt.style.color = debt > 0 ? 'var(--amber)' : 'var(--teal)';
        previewStatus.textContent = val > 0 ? '✅ Выплачено' : '⏳ Не выплачено';
        previewStatus.style.color = val > 0 ? 'var(--teal)' : 'var(--red)';
    });
    
    modal.querySelector('#cancelEditPayment').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
    
    modal.querySelector('#saveEditPayment').addEventListener('click', async () => {
        const newAmount = parseFloat(input.value);
        const errorEl = modal.querySelector('#editError');
        
        if (isNaN(newAmount) || newAmount < 0) {
            errorEl.textContent = '❌ Введите корректную сумму';
            return;
        }
        
        if (newAmount === currentAmount) {
            modal.remove();
            return;
        }
        
        try {
            const result = await updateWeekPayment(weekId, newAmount, weekKey);
            if (result.success) {
                alert(`✅ Сумма выплаты обновлена!\nПолучено: ${result.paidAmount.toLocaleString()} ₽\n${result.companyDebt > 0 ? '🏢 Долг компании: ' + result.companyDebt.toLocaleString() + ' ₽' : '✅ Долг погашен'}`);
                modal.remove();
                await renderStats();
            } else {
                errorEl.textContent = '❌ ' + result.error;
            }
        } catch (error) {
            errorEl.textContent = '❌ ' + error.message;
        }
    });
};

// Списание долга компании
window.handleWriteOffDebt = async function() {
    const companyDebt = await getCompanyDebt();
    if (companyDebt.totalDebt <= 0) {
        alert('Нет долга компании для списания');
        return;
    }
    
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,.7);
        backdrop-filter: blur(4px);
        z-index: 1001;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
    `;
    modal.innerHTML = `
        <div style="background: var(--card); border-radius: 16px; padding: 24px; max-width: 400px; width: 100%; border: 1px solid var(--line);">
            <h3 style="font-family: var(--display); color: var(--amber); margin-bottom: 4px;">🗑️ Списать долг компании</h3>
            <div style="color: var(--mut); font-size: .85rem; margin-bottom: 16px;">
                Текущий долг: <strong style="color:var(--amber);">${companyDebt.totalDebt.toLocaleString()} ₽</strong>
            </div>
            <div style="margin-bottom: 12px;">
                <label style="font-size: .75rem; color: var(--mut); display: block; margin-bottom: 4px;">Сумма для списания</label>
                <input type="number" id="writeOffAmount" value="${companyDebt.totalDebt}" min="0" max="${companyDebt.totalDebt}" step="100"
                       style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--line); background: var(--bg2); color: var(--txt); font-size: 1rem;">
            </div>
            <div style="margin-bottom: 12px;">
                <label style="font-size: .75rem; color: var(--mut); display: block; margin-bottom: 4px;">Комментарий</label>
                <input type="text" id="writeOffComment" placeholder="Причина списания" 
                       style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--line); background: var(--bg2); color: var(--txt); font-size: 1rem;">
            </div>
            <div style="display: flex; gap: 10px; margin-top: 8px;">
                <button id="saveWriteOff" class="btn btn-amber" style="flex:1;">✅ Списать</button>
                <button id="cancelWriteOff" class="btn btn-ghost" style="flex:1;">Отмена</button>
            </div>
            <div id="writeOffError" style="color: var(--red); margin-top: 10px; font-size: .8rem;"></div>
        </div>
    `;
    document.body.appendChild(modal);
    
    modal.querySelector('#cancelWriteOff').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
    
    modal.querySelector('#saveWriteOff').addEventListener('click', async () => {
        const amount = parseFloat(modal.querySelector('#writeOffAmount').value);
        const comment = modal.querySelector('#writeOffComment').value.trim() || 'Списано компанией';
        const errorEl = modal.querySelector('#writeOffError');
        
        if (!amount || amount <= 0) {
            errorEl.textContent = '❌ Введите корректную сумму';
            return;
        }
        
        if (amount > companyDebt.totalDebt) {
            errorEl.textContent = `❌ Сумма превышает долг (${companyDebt.totalDebt.toLocaleString()} ₽)`;
            return;
        }
        
        if (!confirm(`Списать ${amount.toLocaleString()} ₽ из долга компании?`)) {
            return;
        }
        
        try {
            const result = await writeOffCompanyDebt(amount, comment);
            if (result.success) {
                alert(`✅ Долг компании списан!\nСписано: ${amount.toLocaleString()} ₽\nОстаток: ${result.totalDebt.toLocaleString()} ₽`);
                modal.remove();
                await renderStats();
            } else {
                errorEl.textContent = '❌ ' + result.error;
            }
        } catch (error) {
            errorEl.textContent = '❌ ' + error.message;
        }
    });
};

// ============================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================

async function init() {
    await loadEmployeeInfo();
    await loadSettings();
    await renderStats();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}