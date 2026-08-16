// employee.js
// Скрипт страницы сотрудника

import { calculateWeekPay, getFinalPay } from './modules/calculator.js';

const { db, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs, addDoc } = window;

const urlParams = new URLSearchParams(window.location.search);
const EMPLOYEE_ID = urlParams.get('id');

if (!EMPLOYEE_ID) {
    document.body.innerHTML = `
        <div style="padding:50px;text-align:center;color:var(--red);">
            <h1>❌ Ошибка!</h1>
            <p>Не указан ID сотрудника. Обратитесь к руководителю.</p>
            <p style="font-size:0.8rem;color:var(--mut);margin-top:20px;">
                Ссылка должна быть: employee.html?id=ВАШ_ID
            </p>
        </div>
    `;
    throw new Error('No employee ID');
}

let currentWeekOffset = 0;
let currentData = null;
let isSaving = false;
let employeeName = 'Сотрудник';
let employeeRoomId = null;
let settings = {
    rDay: 3000,
    rExtra: 3500,
    rOt1: 400,
    rOt2: 800,
    otLimit: 5,
    hpd: 8
};
const NORMAL_HOURS_PER_DAY = 8;
const DAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

// ============================================
// ФУНКЦИИ ДЛЯ РАБОТЫ СО ВРЕМЕНЕМ
// ============================================

function timeToMinutes(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':');
    return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}

function calculateHoursFromTime(startTime, endTime) {
    if (!startTime || !endTime) return 0;
    const startMin = timeToMinutes(startTime);
    let endMin = timeToMinutes(endTime);
    if (endMin <= startMin) {
        endMin += 24 * 60;
    }
    return Math.round((endMin - startMin) / 60 * 100) / 100;
}

function getDefaultStartTime() {
    return '08:00';
}

function getDefaultEndTime() {
    return '17:00';
}

// ============================================
// ФУНКЦИИ ФОРМАТИРОВАНИЯ
// ============================================

function formatDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateShort(d) {
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }).replace('.', '');
}

// ============================================
// ОБНОВЛЕНИЕ ССЫЛКИ НА СТАТИСТИКУ
// ============================================

function updateStatsLink() {
    const statsLink = document.getElementById('statsLink');
    if (statsLink && EMPLOYEE_ID) {
        statsLink.href = `employee-stats.html?id=${EMPLOYEE_ID}`;
    }
}

// ============================================
// ФИНАНСОВЫЕ ФУНКЦИИ ДЛЯ СОТРУДНИКА
// ============================================

async function getEmployeeAdvances(employeeId) {
    try {
        const advancesRef = collection(db, 'salaryAdvances');
        const q = query(advancesRef, where('employeeId', '==', employeeId));
        const snapshot = await getDocs(q);
        const advances = [];
        snapshot.forEach((doc) => {
            advances.push({ id: doc.id, ...doc.data() });
        });
        return advances.sort((a, b) => b.date.localeCompare(a.date));
    } catch (error) {
        console.error('Ошибка загрузки авансов:', error);
        return [];
    }
}

async function addEmployeeAdvance(employeeId, amount, comment) {
    try {
        const docRef = await addDoc(collection(db, 'salaryAdvances'), {
            employeeId: employeeId,
            amount: parseFloat(amount) || 0,
            type: 'advance',
            status: 'active',
            date: new Date().toISOString(),
            comment: comment || '',
            repaidAt: null,
            repaidFromWeek: null,
            repaidAmount: null
        });
        return { success: true, id: docRef.id };
    } catch (error) {
        console.error('Ошибка добавления аванса:', error);
        return { success: false, error: error.message };
    }
}

async function repayEmployeeAdvance(advanceId) {
    try {
        const advanceRef = doc(db, 'salaryAdvances', advanceId);
        await updateDoc(advanceRef, {
            status: 'repaid',
            repaidAt: new Date().toISOString(),
            repaidFromWeek: null,
            repaidAmount: 0
        });
        return { success: true };
    } catch (error) {
        console.error('Ошибка погашения аванса:', error);
        return { success: false, error: error.message };
    }
}

async function deleteEmployeeAdvance(advanceId) {
    try {
        await deleteDoc(doc(db, 'salaryAdvances', advanceId));
        return { success: true };
    } catch (error) {
        console.error('Ошибка удаления аванса:', error);
        return { success: false, error: error.message };
    }
}

// ============================================
// UI ДЛЯ ФИНАНСОВОГО БЛОКА (С АРХИВОМ)
// ============================================

async function renderEmployeeFinance() {
    const container = document.getElementById('employeeFinanceContent');
    if (!container) return;
    
    try {
        const advances = await getEmployeeAdvances(EMPLOYEE_ID);
        const activeAdvances = advances.filter(a => a.status === 'active');
        const totalDebt = activeAdvances.reduce((sum, a) => sum + a.amount, 0);
        
        // Берем последние 4 аванса (включая погашенные)
        const visibleAdvances = advances.slice(0, 4);
        const archivedAdvances = advances.slice(4);
        const hasArchived = archivedAdvances.length > 0;
        
        container.innerHTML = `
            <div class="debt-summary">
                <div class="debt-item">
                    <div class="label">Аванс</div>
                    <div class="value debt">${totalDebt.toLocaleString()} ₽</div>
                </div>
                <div class="debt-item">
                    <div class="label">Активных авансов</div>
                    <div class="value count">${activeAdvances.length}</div>
                </div>
            </div>
            
            <div class="advance-form">
                <input type="number" id="advanceAmount" placeholder="Сумма аванса" min="0" step="100">
                <input type="text" id="advanceComment" placeholder="Комментарий (необязательно)">
                <button id="takeAdvanceBtn">📤 Взять аванс</button>
                ${activeAdvances.length > 0 ? `
                    <button id="repayAllBtn" class="repay-all-btn">✅ Погасить все</button>
                ` : ''}
            </div>
            
            <div id="advanceMessage" style="font-size:.8rem; margin-bottom:8px; min-height:20px;"></div>
            
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <span style="font-weight:600; font-size:.85rem;">📋 Последние операции</span>
                <span style="font-size:.7rem; color:var(--mut);">${advances.length} записей</span>
            </div>
            <div class="advance-list" id="advanceList">
                ${advances.length === 0 ? `
                    <div class="no-advances">Нет авансов</div>
                ` : `
                    ${visibleAdvances.map(a => `
                        <div class="advance-row ${a.status === 'active' ? 'active-row' : 'repaid-row'}">
                            <div class="info">
                                <div>
                                    ${a.type === 'advance' ? '📤' : '📥'} 
                                    ${a.status === 'active' ? 'Аванс' : 'Погашен'}
                                    ${a.status === 'active' ? ' <span style="color:var(--red);font-size:.6rem;">(активен)</span>' : ''}
                                </div>
                                <div class="comment">${a.comment || 'Без комментария'} · ${formatDate(a.date)}</div>
                            </div>
                            <div style="display:flex; align-items:center; gap:12px;">
                                <div class="amount ${a.status === 'active' ? 'active' : 'repaid'}">
                                    ${a.amount.toLocaleString()} ₽
                                </div>
                                ${a.status === 'active' ? `
                                    <div class="actions">
                                        <button class="repay-btn" onclick="window.handleRepayAdvance('${a.id}')">✅</button>
                                        <button class="delete-btn" onclick="window.handleDeleteAdvance('${a.id}')">🗑️</button>
                                    </div>
                                ` : `
                                    <span style="font-size:.6rem; color:var(--mut);">погашен</span>
                                `}
                            </div>
                        </div>
                    `).join('')}
                    
                    ${hasArchived ? `
                        <div style="margin-top:8px;">
                            <button id="toggleArchiveBtn" 
                                    style="background:rgba(255,255,255,.05); border:1px solid var(--line); 
                                           color:var(--mut); padding:6px 12px; border-radius:6px; 
                                           cursor:pointer; font-size:.7rem; width:100%; transition:.2s;">
                                📂 Показать архив (${archivedAdvances.length})
                            </button>
                            <div id="archiveContainer" style="display:none; margin-top:4px; border-top:1px dashed var(--line); padding-top:4px;">
                                ${archivedAdvances.map(a => `
                                    <div class="advance-row ${a.status === 'active' ? 'active-row' : 'repaid-row'}" style="opacity:0.7;">
                                        <div class="info">
                                            <div>
                                                ${a.type === 'advance' ? '📤' : '📥'} 
                                                ${a.status === 'active' ? 'Аванс' : 'Погашен'}
                                            </div>
                                            <div class="comment">${a.comment || 'Без комментария'} · ${formatDate(a.date)}</div>
                                        </div>
                                        <div style="display:flex; align-items:center; gap:12px;">
                                            <div class="amount ${a.status === 'active' ? 'active' : 'repaid'}">
                                                ${a.amount.toLocaleString()} ₽
                                            </div>
                                            ${a.status === 'active' ? `
                                                <div class="actions">
                                                    <button class="repay-btn" onclick="window.handleRepayAdvance('${a.id}')">✅</button>
                                                    <button class="delete-btn" onclick="window.handleDeleteAdvance('${a.id}')">🗑️</button>
                                                </div>
                                            ` : `
                                                <span style="font-size:.6rem; color:var(--mut);">погашен</span>
                                            `}
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                `}
            </div>
        `;
        
        // Обработчики
        const takeBtn = document.getElementById('takeAdvanceBtn');
        if (takeBtn) {
            takeBtn.addEventListener('click', handleTakeAdvance);
        }
        
        const repayAllBtn = document.getElementById('repayAllBtn');
        if (repayAllBtn) {
            repayAllBtn.addEventListener('click', handleRepayAll);
        }
        
        const amountInput = document.getElementById('advanceAmount');
        if (amountInput) {
            amountInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') handleTakeAdvance();
            });
        }
        
        // Кнопка показа/скрытия архива
        const toggleBtn = document.getElementById('toggleArchiveBtn');
        const archiveContainer = document.getElementById('archiveContainer');
        if (toggleBtn && archiveContainer) {
            toggleBtn.addEventListener('click', () => {
                const isHidden = archiveContainer.style.display === 'none';
                archiveContainer.style.display = isHidden ? 'block' : 'none';
                toggleBtn.textContent = isHidden 
                    ? `📂 Скрыть архив (${archivedAdvances.length})` 
                    : `📂 Показать архив (${archivedAdvances.length})`;
            });
        }
        
    } catch (error) {
        console.error('Ошибка рендеринга финансов:', error);
        container.innerHTML = `
            <div style="text-align:center; padding: 20px; color: var(--red);">
                ❌ Ошибка загрузки финансов
            </div>
        `;
    }
}

// ============================================
// ОБРАБОТЧИКИ ДЛЯ ФИНАНСОВ
// ============================================

async function handleTakeAdvance() {
    const amountInput = document.getElementById('advanceAmount');
    const commentInput = document.getElementById('advanceComment');
    const messageEl = document.getElementById('advanceMessage');
    
    const amount = parseFloat(amountInput?.value);
    const comment = commentInput?.value?.trim() || '';
    
    if (!amount || amount <= 0) {
        if (messageEl) messageEl.textContent = '❌ Введите сумму';
        return;
    }
    
    const btn = document.getElementById('takeAdvanceBtn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ ...';
    }
    
    try {
        const result = await addEmployeeAdvance(EMPLOYEE_ID, amount, comment);
        if (result.success) {
            if (amountInput) amountInput.value = '';
            if (commentInput) commentInput.value = '';
            if (messageEl) messageEl.textContent = '✅ Аванс взят!';
            await renderEmployeeFinance();
        } else {
            if (messageEl) messageEl.textContent = '❌ ' + result.error;
        }
    } catch (error) {
        if (messageEl) messageEl.textContent = '❌ ' + error.message;
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = '📤 Взять аванс';
        }
    }
}

async function handleRepayAll() {
    if (!confirm('Погасить все активные авансы?')) return;
    
    try {
        const advances = await getEmployeeAdvances(EMPLOYEE_ID);
        const active = advances.filter(a => a.status === 'active');
        let successCount = 0;
        for (const a of active) {
            const result = await repayEmployeeAdvance(a.id);
            if (result.success) successCount++;
        }
        await renderEmployeeFinance();
        const messageEl = document.getElementById('advanceMessage');
        if (messageEl) messageEl.textContent = `✅ Погашено ${successCount} авансов`;
    } catch (error) {
        const messageEl = document.getElementById('advanceMessage');
        if (messageEl) messageEl.textContent = '❌ ' + error.message;
    }
}

window.handleRepayAdvance = async function(advanceId) {
    if (!confirm('Погасить этот аванс?')) return;
    try {
        const result = await repayEmployeeAdvance(advanceId);
        if (result.success) {
            await renderEmployeeFinance();
            const messageEl = document.getElementById('advanceMessage');
            if (messageEl) messageEl.textContent = '✅ Аванс погашен';
        } else {
            const messageEl = document.getElementById('advanceMessage');
            if (messageEl) messageEl.textContent = '❌ ' + result.error;
        }
    } catch (error) {
        const messageEl = document.getElementById('advanceMessage');
        if (messageEl) messageEl.textContent = '❌ ' + error.message;
    }
};

window.handleDeleteAdvance = async function(advanceId) {
    if (!confirm('Удалить аванс?')) return;
    try {
        const result = await deleteEmployeeAdvance(advanceId);
        if (result.success) {
            await renderEmployeeFinance();
            const messageEl = document.getElementById('advanceMessage');
            if (messageEl) messageEl.textContent = '🗑️ Аванс удалён';
        } else {
            const messageEl = document.getElementById('advanceMessage');
            if (messageEl) messageEl.textContent = '❌ ' + result.error;
        }
    } catch (error) {
        const messageEl = document.getElementById('advanceMessage');
        if (messageEl) messageEl.textContent = '❌ ' + error.message;
    }
};

// ============================================
// ЗАГРУЗКА НАСТРОЕК
// ============================================

async function loadEmployeeInfo() {
    try {
        const docRef = doc(db, 'salaryEmployees', EMPLOYEE_ID);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            employeeName = data.name || 'Сотрудник';
            employeeRoomId = data.roomId || null;
            console.log('👤 Имя сотрудника:', employeeName);
            
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
            return data;
        }
    } catch (error) {
        console.warn('Не удалось загрузить информацию о сотруднике:', error);
        const badge = document.getElementById('userBadge');
        if (badge) {
            badge.style.display = 'flex';
            badge.title = `ID: ${EMPLOYEE_ID}`;
        }
        const idLabelEl = document.getElementById('userIdLabel');
        if (idLabelEl) idLabelEl.textContent = `ID: ${EMPLOYEE_ID.substring(0, 8)}...`;
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
                otLimit: data.otLimit || 5,
                hpd: data.hpd || 8
            };
            console.log('⚙️ Настройки загружены:', settings);
            document.getElementById('rDay').value = settings.rDay;
            document.getElementById('rExtra').value = settings.rExtra;
            document.getElementById('rOt1').value = settings.rOt1;
            document.getElementById('rOt2').value = settings.rOt2;
            document.getElementById('otLimit').value = settings.otLimit;
            // hpd не показываем в UI, но используем в расчётах
        } else {
            console.log('⚙️ Настройки не найдены, используем дефолтные');
            await saveSettings();
        }
    } catch (error) {
        console.warn('Не удалось загрузить настройки:', error);
    }
}

async function saveSettings() {
    try {
        const docRef = doc(db, 'salarySettings', EMPLOYEE_ID);
        const data = {
            employeeId: EMPLOYEE_ID,
            rDay: settings.rDay,
            rExtra: settings.rExtra,
            rOt1: settings.rOt1,
            rOt2: settings.rOt2,
            otLimit: settings.otLimit,
            hpd: settings.hpd,
            updatedAt: new Date().toISOString()
        };
        if (employeeRoomId) {
            data.roomId = employeeRoomId;
        }
        await setDoc(docRef, data, { merge: true });
        console.log('⚙️ Настройки сохранены');
    } catch (error) {
        console.warn('Не удалось сохранить настройки:', error);
    }
}

// ============================================
// ФУНКЦИИ РАБОТЫ С ДАТАМИ
// ============================================

function getWeekKey(date) {
    const d = new Date(date);
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const y = d.getUTCFullYear();
    const week = Math.ceil(((d - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7);
    return `${y}-W${String(week).padStart(2, '0')}`;
}

function getMonday(date) {
    const d = new Date(date);
    const day = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - day);
    d.setHours(0, 0, 0, 0);
    return d;
}

function getWeekDates(offset) {
    const today = new Date();
    const baseMonday = getMonday(today);
    const monday = new Date(baseMonday);
    monday.setDate(monday.getDate() + offset * 7);
    const dates = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(d.getDate() + i);
        dates.push(d);
    }
    return dates;
}

function isFutureWeek(weekKey) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekDates = getWeekDates(0);
    const currentWeekKey = getWeekKey(weekDates[0]);
    const currentNum = parseInt(currentWeekKey.match(/W(\d+)/)?.[1] || 0);
    const currentYear = parseInt(currentWeekKey.match(/^(\d+)-/)?.[1] || 0);
    const weekNum = parseInt(weekKey.match(/W(\d+)/)?.[1] || 0);
    const weekYear = parseInt(weekKey.match(/^(\d+)-/)?.[1] || 0);
    if (weekYear > currentYear) return true;
    if (weekYear === currentYear && weekNum > currentNum) return true;
    return false;
}

// ============================================
// РАБОТА С БАЗОЙ ДАННЫХ
// ============================================

async function loadWeekData(weekKey) {
    try {
        const docRef = doc(db, 'salaryWeeks', `${EMPLOYEE_ID}_${weekKey}`);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            return {
                workDays: data.workDays || [true, true, true, true, true, false, false],
                hours: data.hours || [NORMAL_HOURS_PER_DAY, NORMAL_HOURS_PER_DAY, NORMAL_HOURS_PER_DAY, NORMAL_HOURS_PER_DAY, NORMAL_HOURS_PER_DAY, 0, 0],
                isPaid: data.isPaid || false,
                workStart: data.workStart || [getDefaultStartTime(), getDefaultStartTime(), getDefaultStartTime(), getDefaultStartTime(), getDefaultStartTime(), '', ''],
                workEnd: data.workEnd || [getDefaultEndTime(), getDefaultEndTime(), getDefaultEndTime(), getDefaultEndTime(), getDefaultEndTime(), '', '']
            };
        } else {
            return {
                workDays: [true, true, true, true, true, false, false],
                hours: [NORMAL_HOURS_PER_DAY, NORMAL_HOURS_PER_DAY, NORMAL_HOURS_PER_DAY, NORMAL_HOURS_PER_DAY, NORMAL_HOURS_PER_DAY, 0, 0],
                isPaid: false,
                workStart: [getDefaultStartTime(), getDefaultStartTime(), getDefaultStartTime(), getDefaultStartTime(), getDefaultStartTime(), '', ''],
                workEnd: [getDefaultEndTime(), getDefaultEndTime(), getDefaultEndTime(), getDefaultEndTime(), getDefaultEndTime(), '', '']
            };
        }
    } catch (error) {
        console.error('Ошибка загрузки:', error);
        return {
            workDays: [true, true, true, true, true, false, false],
            hours: [NORMAL_HOURS_PER_DAY, NORMAL_HOURS_PER_DAY, NORMAL_HOURS_PER_DAY, NORMAL_HOURS_PER_DAY, NORMAL_HOURS_PER_DAY, 0, 0],
            isPaid: false,
            workStart: [getDefaultStartTime(), getDefaultStartTime(), getDefaultStartTime(), getDefaultStartTime(), getDefaultStartTime(), '', ''],
            workEnd: [getDefaultEndTime(), getDefaultEndTime(), getDefaultEndTime(), getDefaultEndTime(), getDefaultEndTime(), '', '']
        };
    }
}

async function saveWeekData(weekKey, workDays, hours, workStart, workEnd) {
    if (isSaving) return;
    isSaving = true;
    try {
        const docRef = doc(db, 'salaryWeeks', `${EMPLOYEE_ID}_${weekKey}`);
        const data = {
            employeeId: EMPLOYEE_ID,
            weekKey: weekKey,
            workDays: workDays,
            hours: hours.map(h => Math.round(h * 100) / 100),
            isPaid: currentData?.isPaid || false,
            workStart: workStart,
            workEnd: workEnd,
            updatedAt: new Date().toISOString()
        };
        if (employeeRoomId) {
            data.roomId = employeeRoomId;
        }
        await setDoc(docRef, data, { merge: true });
        showSaveIndicator('✅ Сохранено');
    } catch (error) {
        console.error('Ошибка сохранения:', error);
        showSaveIndicator('❌ Ошибка сохранения');
    } finally {
        isSaving = false;
    }
}

async function clearFutureWeeks() {
    const dates = getWeekDates(0);
    const weeksRef = collection(db, 'salaryWeeks');
    const q = query(weeksRef, where('employeeId', '==', EMPLOYEE_ID));
    const snapshot = await getDocs(q);
    let futureWeeks = [];
    snapshot.forEach((doc) => {
        const week = { id: doc.id, ...doc.data() };
        if (isFutureWeek(week.weekKey)) {
            futureWeeks.push(week);
        }
    });
    if (futureWeeks.length === 0) {
        showSaveIndicator('✅ Нет будущих недель для очистки');
        return;
    }
    const weekList = futureWeeks.map(w => {
        const num = w.weekKey.match(/W(\d+)/)?.[1] || '?';
        return `Неделя ${num}`;
    }).join(', ');
    if (!confirm(`Найдено ${futureWeeks.length} будущих недель:\n${weekList}\n\nОчистить их?`)) {
        return;
    }
    let deletedCount = 0;
    for (const week of futureWeeks) {
        try {
            await deleteDoc(doc(db, 'salaryWeeks', week.id));
            deletedCount++;
        } catch (error) {
            console.error('Ошибка удаления:', error);
        }
    }
    showSaveIndicator(`✅ Очищено ${deletedCount} будущих недель`);
    currentWeekOffset = 0;
    const newDates = getWeekDates(0);
    const newWeekKey = getWeekKey(newDates[0]);
    updateWeekLabel(newDates);
    currentData = await loadWeekData(newWeekKey);
    if (!currentData) {
        currentData = {
            workDays: [true, true, true, true, true, false, false],
            hours: [NORMAL_HOURS_PER_DAY, NORMAL_HOURS_PER_DAY, NORMAL_HOURS_PER_DAY, NORMAL_HOURS_PER_DAY, NORMAL_HOURS_PER_DAY, 0, 0],
            isPaid: false,
            workStart: [getDefaultStartTime(), getDefaultStartTime(), getDefaultStartTime(), getDefaultStartTime(), getDefaultStartTime(), '', ''],
            workEnd: [getDefaultEndTime(), getDefaultEndTime(), getDefaultEndTime(), getDefaultEndTime(), getDefaultEndTime(), '', '']
        };
    }
    update();
    try {
        if (window.updateStatsAfterClear) {
            await window.updateStatsAfterClear(EMPLOYEE_ID);
        }
    } catch (e) {}
}

// ============================================
// UI КОМПОНЕНТЫ
// ============================================

function showSaveIndicator(message) {
    let el = document.getElementById('saveIndicator');
    if (!el) {
        el = document.createElement('div');
        el.id = 'saveIndicator';
        el.className = 'save-indicator';
        document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'), 2500);
}

function showSettingsSaved(message, isError = false) {
    const el = document.getElementById('settingsSaved');
    if (!el) return;
    el.textContent = message;
    el.className = 'settings-saved show';
    if (isError) el.classList.add('error');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => {
        el.classList.remove('show');
    }, 3000);
}

function formatHours(hours) {
    return hours.toFixed(2).replace('.', ',');
}

function updateTimeInputs() {
    if (!currentData) return;
    const { workDays, workStart, workEnd } = currentData;
    const items = document.querySelectorAll('.day-time-item');
    items.forEach((item, i) => {
        const startInput = item.querySelector('.time-start');
        const endInput = item.querySelector('.time-end');
        const hoursDisplay = item.querySelector('.time-hours strong');
        if (workDays[i]) {
            startInput.disabled = false;
            endInput.disabled = false;
            startInput.value = workStart[i] || getDefaultStartTime();
            endInput.value = workEnd[i] || getDefaultEndTime();
            const h = calculateHoursFromTime(startInput.value, endInput.value);
            hoursDisplay.textContent = formatHours(h);
        } else {
            startInput.disabled = true;
            endInput.disabled = true;
            startInput.value = '';
            endInput.value = '';
            hoursDisplay.textContent = '0';
        }
    });
}

// ===== ОСНОВНАЯ ФУНКЦИЯ ОБНОВЛЕНИЯ UI =====
function update() {
    if (!currentData) return;
    
    const { workDays, hours, workStart, workEnd } = currentData;
    const dates = getWeekDates(currentWeekOffset);
    const weekKey = getWeekKey(dates[0]);
    const isFuture = isFutureWeek(weekKey);
    
    // Используем модуль для расчёта зарплаты
    const stats = calculateWeekPay(currentData, settings);
    
    // Извлекаем все нужные значения из stats
    const days = stats.days;
    const totalHours = stats.totalHours;
    const norm = stats.norm;
    const ot = stats.ot;
    const ot1 = stats.ot1;
    const ot2 = stats.ot2;
    const payBase = stats.payBase;
    const payExtra = stats.payExtra;
    const payOt1 = stats.payOt1;
    const payOt2 = stats.payOt2;
    const total = stats.total;
    
    // Обновляем дни
    document.querySelectorAll('#days .day').forEach((b, i) => {
        const on = workDays[i];
        b.classList.toggle('on', on);
        const dayIndex = workDays.slice(0, i).filter(Boolean).length;
        const isExtra = on && dayIndex >= 5;
        b.classList.toggle('extra', isExtra);
        const rate = isExtra ? settings.rExtra : settings.rDay;
        b.querySelector('i').textContent = rate.toLocaleString() + ' ₽';
    });
    
    // Обновляем время
    updateTimeInputs();
    
    // Счетчики
    document.getElementById('dOut').textContent = days;
    document.getElementById('normOut').textContent = `норма: ${norm.toFixed(1).replace('.', ',')} ч (${days} дн × ${settings.hpd} ч)`;
    
    // Бейджи
    const otB = document.getElementById('otBadge');
    const uwB = document.getElementById('uwBadge');
    if (ot > 0) {
        otB.hidden = false;
        otB.textContent = `переработка +${formatHours(ot)} ч`;
        otB.className = 'badge ' + (ot2 > 0 ? 'hot' : 'ot');
    } else {
        otB.hidden = true;
    }
    if (days > 0 && totalHours < norm) {
        uwB.hidden = false;
        uwB.textContent = `меньше нормы на ${formatHours(norm - totalHours)} ч`;
    } else {
        uwB.hidden = true;
    }
    
    // Строки расчета
    document.getElementById('qBase').textContent = `${workDays.slice(0, 5).filter(Boolean).length} дн × ${settings.rDay.toLocaleString()} ₽ (пропорционально)`;
    document.getElementById('vBase').textContent = payBase.toLocaleString() + ' ₽';
    
    const rowExtra = document.getElementById('rowExtra');
    const extraDaysCount = workDays.slice(5, 7).filter(Boolean).length;
    if (extraDaysCount === 0) {
        rowExtra.classList.add('gone');
    } else {
        rowExtra.classList.remove('gone');
        document.getElementById('qExtra').textContent = `${extraDaysCount} дн × ${settings.rExtra.toLocaleString()} ₽ (пропорционально)`;
        document.getElementById('vExtra').textContent = payExtra.toLocaleString() + ' ₽';
    }
    
    const rowOt1 = document.getElementById('rowOt1');
    if (ot1 === 0) {
        rowOt1.classList.add('gone');
    } else {
        rowOt1.classList.remove('gone');
        document.getElementById('qOt1').textContent = `${formatHours(ot1)} ч × ${settings.rOt1.toLocaleString()} ₽`;
        document.getElementById('vOt1').textContent = payOt1.toLocaleString() + ' ₽';
    }
    
    const rowOt2 = document.getElementById('rowOt2');
    if (ot2 === 0) {
        rowOt2.classList.add('gone');
    } else {
        rowOt2.classList.remove('gone');
        document.getElementById('qOt2').textContent = `${formatHours(ot2)} ч × ${settings.rOt2.toLocaleString()} ₽`;
        document.getElementById('vOt2').textContent = payOt2.toLocaleString() + ' ₽';
    }
    
    // Бары
    const scale = Math.max(totalHours, norm, 1);
    document.getElementById('bNorm').style.width = (Math.min(totalHours, norm) / scale * 100) + '%';
    document.getElementById('bOt1').style.width = (ot1 / scale * 100) + '%';
    document.getElementById('bOt2').style.width = (ot2 / scale * 100) + '%';
    document.getElementById('lNorm').textContent = formatHours(Math.min(totalHours, norm)) + ' ч';
    document.getElementById('lOt1').textContent = formatHours(ot1) + ' ч';
    document.getElementById('lOt2').textContent = formatHours(ot2) + ' ч';
    
    // Итог
    document.getElementById('totalOut').textContent = total.toLocaleString();
    const stamp = document.getElementById('stamp');
    stamp.classList.remove('pop');
    void stamp.offsetWidth;
    stamp.classList.add('pop');
    
    // Формула
    const parts = [];
    if (payBase > 0) parts.push(`<b class="f-n">${(payBase / (settings.rDay || 1)).toFixed(2)}×${settings.rDay.toLocaleString()}</b>`);
    if (payExtra > 0) parts.push(`<b class="f-n">${(payExtra / (settings.rExtra || 1)).toFixed(2)}×${settings.rExtra.toLocaleString()}</b>`);
    if (ot1 > 0) parts.push(`<b class="f-1">${formatHours(ot1)}×${settings.rOt1.toLocaleString()}</b>`);
    if (ot2 > 0) parts.push(`<b class="f-2">${formatHours(ot2)}×${settings.rOt2.toLocaleString()}</b>`);
    document.getElementById('formula').innerHTML = parts.length ? parts.join(' + ') + ` = ${total.toLocaleString()} ₽` : '—';
    
    // Мета
    document.getElementById('metaLine').textContent =
        `отработано ${formatHours(totalHours)} ч · норма ${formatHours(norm)} ч`;
    
    // Чипсы
    document.getElementById('chip1').textContent = `1–5 день · ${settings.rDay.toLocaleString()} ₽`;
    document.getElementById('chip2').textContent = `6–7 день · ${settings.rExtra.toLocaleString()} ₽`;
    document.getElementById('chip3').textContent = `переработка · ${settings.rOt1.toLocaleString()} / ${settings.rOt2.toLocaleString()} ₽/ч`;
    
    // Заголовок недели
    const mon = dates[0];
    const sun = dates[6];
    const weekLabel = `неделя №${weekKey.replace('W', '')} · ${formatDateShort(mon)} – ${formatDateShort(sun)}`;
    document.getElementById('eyebrow').textContent = `Табель · ${weekLabel}`;
    document.getElementById('wk').textContent = weekLabel;
    
    // Кнопка очистки будущих недель
    const clearBtn = document.getElementById('clearFutureBtn');
    if (clearBtn) {
        if (isFuture) {
            clearBtn.style.display = 'inline-block';
            clearBtn.style.background = 'var(--red)';
            clearBtn.style.color = '#fff';
            clearBtn.textContent = '⚠️ Будущая неделя! Очистить всё';
        } else {
            clearBtn.style.display = 'none';
        }
    }
}

// ============================================
// ПОСТРОЕНИЕ UI
// ============================================

function buildUI() {
    const daysBox = document.getElementById('days');
    daysBox.innerHTML = '';
    DAY_NAMES.forEach((n, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'day';
        b.dataset.i = i;
        b.innerHTML = `<b>${n}</b><i></i>`;
        b.addEventListener('click', async () => {
            if (!currentData) return;
            currentData.workDays[i] = !currentData.workDays[i];
            if (currentData.workDays[i]) {
                const hours = calculateHoursFromTime(
                    currentData.workStart[i] || getDefaultStartTime(),
                    currentData.workEnd[i] || getDefaultEndTime()
                );
                currentData.hours[i] = hours || NORMAL_HOURS_PER_DAY;
            } else {
                currentData.hours[i] = 0;
            }
            update();
            const dates = getWeekDates(currentWeekOffset);
            const weekKey = getWeekKey(dates[0]);
            await saveWeekData(weekKey, currentData.workDays, currentData.hours, currentData.workStart, currentData.workEnd);
        });
        daysBox.appendChild(b);
    });
    
    const timeGroup = document.getElementById('dayTimeGroup');
    timeGroup.innerHTML = '';
    DAY_NAMES.forEach((n, i) => {
        const div = document.createElement('div');
        div.className = 'day-time-item';
        div.innerHTML = `
            <span class="day-label">${n}</span>
            <input type="time" class="time-start" value="">
            <input type="time" class="time-end" value="">
            <span class="time-hours">⏱ <strong>0</strong> ч</span>
        `;
        const startInput = div.querySelector('.time-start');
        const endInput = div.querySelector('.time-end');
        
        const onTimeChange = async () => {
            if (!currentData) return;
            const i = parseInt(div.dataset.index || '0');
            if (!currentData.workDays[i]) {
                startInput.value = '';
                endInput.value = '';
                return;
            }
            currentData.workStart[i] = startInput.value || '';
            currentData.workEnd[i] = endInput.value || '';
            const hours = calculateHoursFromTime(startInput.value, endInput.value);
            currentData.hours[i] = hours || 0;
            update();
            const dates = getWeekDates(currentWeekOffset);
            const weekKey = getWeekKey(dates[0]);
            await saveWeekData(weekKey, currentData.workDays, currentData.hours, currentData.workStart, currentData.workEnd);
        };
        
        startInput.addEventListener('change', onTimeChange);
        endInput.addEventListener('change', onTimeChange);
        startInput.addEventListener('blur', onTimeChange);
        endInput.addEventListener('blur', onTimeChange);
        
        div.dataset.index = i;
        timeGroup.appendChild(div);
    });
}

function updateWeekLabel(dates) {
    const mon = dates[0];
    const sun = dates[6];
    const weekKey = getWeekKey(mon);
    const today = new Date();
    const todayWeek = getWeekKey(today);
    const isCurrent = weekKey === todayWeek;
    document.getElementById('weekRange').textContent = `${formatDateShort(mon)} – ${formatDateShort(sun)}`;
    document.getElementById('weekSub').textContent = isCurrent ? 'текущая неделя' : weekKey;
}

// ============================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================

async function init() {
    console.log('🚀 Запуск init()...');
    
    await loadSettings();
    await loadEmployeeInfo();
    buildUI();
    
    // Обновляем ссылку на статистику
    updateStatsLink();
    
    const dates = getWeekDates(0);
    const weekKey = getWeekKey(dates[0]);
    currentData = await loadWeekData(weekKey);
    if (!currentData) {
        currentData = {
            workDays: [true, true, true, true, true, false, false],
            hours: [NORMAL_HOURS_PER_DAY, NORMAL_HOURS_PER_DAY, NORMAL_HOURS_PER_DAY, NORMAL_HOURS_PER_DAY, NORMAL_HOURS_PER_DAY, 0, 0],
            isPaid: false,
            workStart: [getDefaultStartTime(), getDefaultStartTime(), getDefaultStartTime(), getDefaultStartTime(), getDefaultStartTime(), '', ''],
            workEnd: [getDefaultEndTime(), getDefaultEndTime(), getDefaultEndTime(), getDefaultEndTime(), getDefaultEndTime(), '', '']
        };
    }
    updateWeekLabel(dates);
    update();
    
    await renderEmployeeFinance();
    
    // Обработчики навигации
    document.getElementById('weekPrev').addEventListener('click', async () => {
        currentWeekOffset--;
        const dates = getWeekDates(currentWeekOffset);
        const weekKey = getWeekKey(dates[0]);
        updateWeekLabel(dates);
        currentData = await loadWeekData(weekKey);
        if (!currentData) {
            currentData = {
                workDays: [true, true, true, true, true, false, false],
                hours: [NORMAL_HOURS_PER_DAY, NORMAL_HOURS_PER_DAY, NORMAL_HOURS_PER_DAY, NORMAL_HOURS_PER_DAY, NORMAL_HOURS_PER_DAY, 0, 0],
                isPaid: false,
                workStart: [getDefaultStartTime(), getDefaultStartTime(), getDefaultStartTime(), getDefaultStartTime(), getDefaultStartTime(), '', ''],
                workEnd: [getDefaultEndTime(), getDefaultEndTime(), getDefaultEndTime(), getDefaultEndTime(), getDefaultEndTime(), '', '']
            };
        }
        update();
    });
    document.getElementById('weekNext').addEventListener('click', async () => {
        currentWeekOffset++;
        const dates = getWeekDates(currentWeekOffset);
        const weekKey = getWeekKey(dates[0]);
        updateWeekLabel(dates);
        currentData = await loadWeekData(weekKey);
        if (!currentData) {
            currentData = {
                workDays: [true, true, true, true, true, false, false],
                hours: [NORMAL_HOURS_PER_DAY, NORMAL_HOURS_PER_DAY, NORMAL_HOURS_PER_DAY, NORMAL_HOURS_PER_DAY, NORMAL_HOURS_PER_DAY, 0, 0],
                isPaid: false,
                workStart: [getDefaultStartTime(), getDefaultStartTime(), getDefaultStartTime(), getDefaultStartTime(), getDefaultStartTime(), '', ''],
                workEnd: [getDefaultEndTime(), getDefaultEndTime(), getDefaultEndTime(), getDefaultEndTime(), getDefaultEndTime(), '', '']
            };
        }
        update();
    });
    document.getElementById('weekToday').addEventListener('click', async () => {
        currentWeekOffset = 0;
        const dates = getWeekDates(0);
        const weekKey = getWeekKey(dates[0]);
        updateWeekLabel(dates);
        currentData = await loadWeekData(weekKey);
        if (!currentData) {
            currentData = {
                workDays: [true, true, true, true, true, false, false],
                hours: [NORMAL_HOURS_PER_DAY, NORMAL_HOURS_PER_DAY, NORMAL_HOURS_PER_DAY, NORMAL_HOURS_PER_DAY, NORMAL_HOURS_PER_DAY, 0, 0],
                isPaid: false,
                workStart: [getDefaultStartTime(), getDefaultStartTime(), getDefaultStartTime(), getDefaultStartTime(), getDefaultStartTime(), '', ''],
                workEnd: [getDefaultEndTime(), getDefaultEndTime(), getDefaultEndTime(), getDefaultEndTime(), getDefaultEndTime(), '', '']
            };
        }
        update();
    });
    
    document.getElementById('dMinus').addEventListener('click', async () => {
        if (!currentData) return;
        const idx = currentData.workDays.lastIndexOf(true);
        if (idx !== -1) {
            currentData.workDays[idx] = false;
            currentData.hours[idx] = 0;
            currentData.workStart[idx] = '';
            currentData.workEnd[idx] = '';
            update();
            const dates = getWeekDates(currentWeekOffset);
            const weekKey = getWeekKey(dates[0]);
            await saveWeekData(weekKey, currentData.workDays, currentData.hours, currentData.workStart, currentData.workEnd);
        }
    });
    document.getElementById('dPlus').addEventListener('click', async () => {
        if (!currentData) return;
        const idx = currentData.workDays.indexOf(false);
        if (idx !== -1) {
            currentData.workDays[idx] = true;
            currentData.workStart[idx] = getDefaultStartTime();
            currentData.workEnd[idx] = getDefaultEndTime();
            const hours = calculateHoursFromTime(getDefaultStartTime(), getDefaultEndTime());
            currentData.hours[idx] = hours;
            update();
            const dates = getWeekDates(currentWeekOffset);
            const weekKey = getWeekKey(dates[0]);
            await saveWeekData(weekKey, currentData.workDays, currentData.hours, currentData.workStart, currentData.workEnd);
        }
    });
    
    // Обработчики для ставок
    const settingsFields = ['rDay', 'rExtra', 'rOt1', 'rOt2', 'otLimit'];
    settingsFields.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', async () => {
                const value = parseFloat(el.value) || 0;
                settings[id] = value;
                await saveSettings();
                showSettingsSaved('✅ Настройки сохранены');
                update();
            });
            el.addEventListener('input', () => {
                const value = parseFloat(el.value) || 0;
                settings[id] = value;
                update();
            });
        }
    });
    
    // Кнопка очистки будущих недель
    const clearFutureBtn = document.createElement('button');
    clearFutureBtn.id = 'clearFutureBtn';
    clearFutureBtn.className = 'btn btn-ghost';
    clearFutureBtn.style.display = 'none';
    clearFutureBtn.textContent = '⚠️ Будущая неделя! Очистить всё';
    clearFutureBtn.addEventListener('click', clearFutureWeeks);
    const actionsDiv = document.querySelector('.actions');
    if (actionsDiv) {
        actionsDiv.appendChild(clearFutureBtn);
    }
    
    document.getElementById('resetBtn').addEventListener('click', async () => {
        if (!confirm('Сбросить данные за эту неделю?')) return;
        const dates = getWeekDates(currentWeekOffset);
        const weekKey = getWeekKey(dates[0]);
        currentData = {
            workDays: [true, true, true, true, true, false, false],
            hours: [NORMAL_HOURS_PER_DAY, NORMAL_HOURS_PER_DAY, NORMAL_HOURS_PER_DAY, NORMAL_HOURS_PER_DAY, NORMAL_HOURS_PER_DAY, 0, 0],
            isPaid: false,
            workStart: [getDefaultStartTime(), getDefaultStartTime(), getDefaultStartTime(), getDefaultStartTime(), getDefaultStartTime(), '', ''],
            workEnd: [getDefaultEndTime(), getDefaultEndTime(), getDefaultEndTime(), getDefaultEndTime(), getDefaultEndTime(), '', '']
        };
        update();
        await saveWeekData(weekKey, currentData.workDays, currentData.hours, currentData.workStart, currentData.workEnd);
    });
    
    document.getElementById('copyBtn').addEventListener('click', async () => {
        const total = document.getElementById('totalOut').textContent;
        const dates = getWeekDates(currentWeekOffset);
        const mon = dates[0];
        const sun = dates[6];
        const text = `Зарплата за неделю ${formatDateShort(mon)}–${formatDateShort(sun)}: ${total} ₽`;
        try {
            await navigator.clipboard.writeText(text);
            const btn = document.getElementById('copyBtn');
            const old = btn.textContent;
            btn.textContent = '✓ Скопировано';
            setTimeout(() => btn.textContent = old, 1500);
        } catch (e) {
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
            const btn = document.getElementById('copyBtn');
            const old = btn.textContent;
            btn.textContent = '✓ Скопировано';
            setTimeout(() => btn.textContent = old, 1500);
        }
    });
    
    console.log('✅ init() завершён');
}

const style = document.createElement('style');
style.textContent = `
    .save-indicator {
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: var(--teal);
        color: #0c1520;
        padding: 10px 20px;
        border-radius: 999px;
        font-size: .85rem;
        font-weight: 700;
        opacity: 0;
        transition: opacity .4s;
        pointer-events: none;
        font-family: var(--mono);
        z-index: 9999;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    }
    .save-indicator.show {
        opacity: 1;
    }
    .save-indicator.error {
        background: var(--red);
        color: #fff;
    }
    .settings-saved {
        font-size: .7rem;
        color: var(--teal);
        margin-left: 8px;
        opacity: 0;
        transition: opacity .3s;
        font-weight: normal;
    }
    .settings-saved.show {
        opacity: 1;
    }
    .settings-saved.error {
        color: var(--red);
    }
    #clearFutureBtn {
        background: var(--red) !important;
        color: #fff !important;
        border: 1px solid var(--red) !important;
    }
    #clearFutureBtn:hover {
        background: #c0392b !important;
        transform: translateY(-2px);
    }
`;
document.head.appendChild(style);

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}