// admin-dashboard.js

import { firebaseConfig } from './config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
    getFirestore, 
    collection, doc, getDocs, addDoc, updateDoc, deleteDoc,
    query, where, onSnapshot, getDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { 
    getAuth, 
    onAuthStateChanged, 
    signOut 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { calculateWeekPay, getFinalPay } from './modules/calculator.js';

// ============================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

let currentUser = null;
let allEmployees = [];
let allWeeks = {};
let allAttendance = {};
let allSettings = {};
let currentSalaryWeek = 0;
let currentAttWeek = 0;

// ============================================
// АВТОРИЗАЦИЯ
// ============================================
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        const emailEl = document.getElementById('userEmail');
        if (emailEl) emailEl.textContent = '👤 ' + user.email;
        loadAllData();
    } else {
        window.location.href = 'index.html';
    }
});

const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
        signOut(auth);
    });
}

// ============================================
// ВКЛАДКИ
// ============================================
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        const target = document.getElementById('tab' + btn.dataset.tab.charAt(0).toUpperCase() + btn.dataset.tab.slice(1));
        if (target) target.classList.add('active');
    });
});

// ============================================
// ЗАГРУЗКА ВСЕХ ДАННЫХ
// ============================================
async function loadAllData() {
    try {
        console.log('🔄 Загрузка данных...');

        const empSnap = await getDocs(collection(db, 'salaryEmployees'));
        allEmployees = [];
        empSnap.forEach(doc => allEmployees.push({ id: doc.id, ...doc.data() }));
        allEmployees.sort((a, b) => a.name?.localeCompare(b.name) || 0);
        console.log('👤 Сотрудников загружено:', allEmployees.length);

        const weekSnap = await getDocs(collection(db, 'salaryWeeks'));
        allWeeks = {};
        weekSnap.forEach(doc => {
            const data = doc.data();
            const key = data.employeeId + '_' + data.weekKey;
            allWeeks[key] = { id: doc.id, ...data };
        });
        console.log('📅 Недель загружено:', Object.keys(allWeeks).length);

        const attSnap = await getDocs(collection(db, 'attendance'));
        allAttendance = {};
        attSnap.forEach(doc => {
            const data = doc.data();
            const key = data.employeeId + '_' + data.date;
            if (!allAttendance[key]) allAttendance[key] = [];
            allAttendance[key].push({ id: doc.id, ...data });
        });
        console.log('📋 Отметок загружено:', attSnap.size);
        console.log('📋 allAttendance keys:', Object.keys(allAttendance));

        const settingsSnap = await getDocs(collection(db, 'salarySettings'));
        allSettings = {};
        settingsSnap.forEach(doc => {
            allSettings[doc.id] = { id: doc.id, ...doc.data() };
        });

        renderSalary();
        renderAttendance();

    } catch (error) {
        console.error('Ошибка загрузки:', error);
        const wrap = document.getElementById('salaryTableWrap');
        if (wrap) {
            wrap.innerHTML = '<div class="loading" style="color:var(--red);">❌ Ошибка: ' + error.message + '</div>';
        }
    }
}

// ============================================
// ПОЛУЧЕНИЕ НАСТРОЕК СОТРУДНИКА
// ============================================
function getEmployeeSettings(employeeId) {
    const settings = allSettings[employeeId];
    if (settings) {
        return {
            rDay: settings.rDay || 3000,
            rExtra: settings.rExtra || 3500,
            rOt1: settings.rOt1 || 400,
            rOt2: settings.rOt2 || 800,
            otLimit: settings.otLimit || 5,
            hpd: settings.hpd || 8
        };
    }
    return { rDay: 3000, rExtra: 3500, rOt1: 400, rOt2: 800, otLimit: 5, hpd: 8 };
}

// ============================================
// РАСЧЁТ ЗАРПЛАТЫ
// ============================================
function getWeekKey(date) {
    const d = new Date(date);
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const y = d.getUTCFullYear();
    const week = Math.ceil(((d - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7);
    return `${y}-W${String(week).padStart(2, '0')}`;
}

// ============================================
// ПОЛУЧЕНИЕ ДАТ НЕДЕЛИ (С ПОНЕДЕЛЬНИКА!)
// ============================================
function getWeekDates(offset) {
    const today = new Date();
    // Получаем день недели (0=воскресенье, 1=понедельник, ...)
    const dayOfWeek = today.getDay();
    // Вычисляем сколько дней до понедельника
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    
    const monday = new Date(today);
    monday.setDate(today.getDate() - daysToMonday + offset * 7);
    monday.setHours(0, 0, 0, 0);
    
    const dates = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        dates.push(d);
    }
    return dates;
}

function getWeekRange(offset) {
    const dates = getWeekDates(offset);
    const start = dates[0];
    const end = dates[6];
    const weekKey = getWeekKey(start);
    return { start, end, weekKey, dates };
}

function formatDateShort(d) {
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
}

// ============================================
// РЕНДЕР ЗАРПЛАТЫ
// ============================================
async function renderSalary() {
    const wrap = document.getElementById('salaryTableWrap');
    const label = document.getElementById('salaryWeekLabel');
    
    if (!wrap) return;
    
    try {
        const { start, end, weekKey } = getWeekRange(currentSalaryWeek);
        if (label) label.textContent = `${formatDateShort(start)} – ${formatDateShort(end)} (${weekKey})`;

        let html = `<table>
            <thead>
                <tr>
                    <th>Сотрудник</th>
                    <th>Дней</th>
                    <th>Часов</th>
                    <th>Перераб.</th>
                    <th style="text-align:right;">Зарплата</th>
                    <th style="text-align:center;">Статус</th>
                    <th style="text-align:center;">Действия</th>
                </tr>
            </thead>
            <tbody>`;

        let totalPay = 0;
        let paidCount = 0;
        let totalCount = 0;

        for (const emp of allEmployees) {
            const weekData = allWeeks[emp.id + '_' + weekKey];
            
            if (!weekData) {
                html += `<tr>
                    <td class="col-employee">${emp.name || 'Без имени'}</td>
                    <td colspan="6" style="text-align:center;color:var(--mut);font-size:.8rem;">Нет данных</td>
                </tr>`;
                continue;
            }

            const settings = getEmployeeSettings(emp.id);
            const stats = calculateWeekPay(weekData, settings);
            const isPaid = weekData.isPaid || false;
            const paidAmount = weekData.paidAmount || 0;

            totalPay += stats.total;
            totalCount++;
            if (isPaid) paidCount++;

            let statusHtml = isPaid 
                ? `<span class="status-badge paid">✅ Выплачено</span>`
                : `<span class="status-badge unpaid">⏳ Ожидает</span>`;

            html += `<tr>
                <td class="col-employee">${emp.name || 'Без имени'}</td>
                <td>${stats.days}</td>
                <td>${stats.totalHours.toFixed(1)}</td>
                <td>${stats.ot > 0 ? stats.ot.toFixed(1) + 'ч' : '—'}</td>
                <td class="col-pay" style="text-align:right;">${stats.total.toLocaleString()} ₽</td>
                <td style="text-align:center;">${statusHtml}</td>
                <td style="text-align:center;">
                    <button class="btn-sm ghost" onclick="window.showEmployeeSettings('${emp.id}')" title="Настройки">⚙️</button>
                    <button class="btn-sm amber" onclick="window.viewWeekDetails('${emp.id}','${weekKey}')" title="Детали">👁️</button>
                </td>
            </tr>`;
        }

        html += `<tr style="border-top:2px solid var(--amber);">
            <td><b style="color:var(--amber);">📊 ИТОГО</b></td>
            <td colspan="3"></td>
            <td style="text-align:right;font-weight:700;color:var(--amber);font-size:1.1rem;">${totalPay.toLocaleString()} ₽</td>
            <td style="text-align:center;font-size:.8rem;color:var(--mut);">${paidCount}/${totalCount}</td>
            <td></td>
        </tr>`;

        html += `</tbody></table>`;
        wrap.innerHTML = html;

    } catch (error) {
        console.error('Ошибка рендера зарплаты:', error);
        wrap.innerHTML = `<div class="loading" style="color:var(--red);">❌ Ошибка: ${error.message}</div>`;
    }
}

// ============================================
// РЕНДЕР ПОСЕЩАЕМОСТИ
// ============================================
async function renderAttendance() {
    const container = document.getElementById('attendanceContent');
    const label = document.getElementById('attWeekLabel');
    
    if (!container) return;
    
    try {
        const { start, end, weekKey, dates } = getWeekRange(currentAttWeek);
        if (label) label.textContent = `${formatDateShort(start)} – ${formatDateShort(end)} (${weekKey})`;

        const weekDates = dates.map(d => d.toISOString().slice(0, 10));
        console.log('📅 Даты недели (ПН-ВС):', weekDates);

        const allLogs = [];

        for (const emp of allEmployees) {
            for (const dateStr of weekDates) {
                const key = emp.id + '_' + dateStr;
                const logs = allAttendance[key] || [];
                if (logs.length > 0) {
                    const sortedLogs = [...logs].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
                    allLogs.push({
                        employeeId: emp.id,
                        employeeName: emp.name || 'Без имени',
                        date: dateStr,
                        logs: sortedLogs
                    });
                }
            }
        }

        allLogs.sort((a, b) => {
            if (a.date !== b.date) return a.date.localeCompare(b.date);
            return a.employeeName.localeCompare(b.employeeName);
        });

        if (allLogs.length === 0) {
            container.innerHTML = `
                <div class="no-data">
                    <div style="font-size:3rem;margin-bottom:12px;">📭</div>
                    <div>Нет отметок за эту неделю</div>
                    <div style="font-size:.7rem;color:var(--mut);margin-top:6px;">
                        Текущая неделя: ${weekDates[0]} — ${weekDates[6]}
                    </div>
                </div>
            `;
            return;
        }

        const grouped = {};
        for (const log of allLogs) {
            if (!grouped[log.date]) grouped[log.date] = [];
            grouped[log.date].push(log);
        }

        let html = `<div class="attendance-grid">`;
        const sortedDates = Object.keys(grouped).sort();

        for (const date of sortedDates) {
            const dateObj = new Date(date + 'T00:00:00');
            const dayName = dateObj.toLocaleDateString('ru-RU', { weekday: 'short' });
            const dayMonth = dateObj.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
            const logs = grouped[date];

            html += `<div class="attendance-day">
                <div class="day-header">
                    <span>${dayName}, ${dayMonth}</span>
                    <span class="date">${logs.length} записей</span>
                </div>`;

            for (const log of logs) {
                const inLog = log.logs.find(l => l.type === 'in');
                const outLog = log.logs.find(l => l.type === 'out');
                const times = [];

                if (inLog) {
                    const time = new Date(inLog.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
                    times.push({ type: 'in', time, id: inLog.id, timestamp: inLog.timestamp });
                }
                if (outLog) {
                    const time = new Date(outLog.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
                    times.push({ type: 'out', time, id: outLog.id, timestamp: outLog.timestamp });
                }

                html += `<div class="attendance-row">
                    <span class="emp-name">${log.employeeName}</span>
                    <div class="time-group">
                        ${times.map(t => `
                            <span class="time-badge ${t.type}" 
                                  onclick="window.editAttendanceTime('${t.id}', '${t.timestamp}')"
                                  title="Нажмите чтобы изменить время">
                                ${t.type === 'in' ? '✅' : '🚪'} ${t.time}
                                <span class="edit-hint">✏️</span>
                            </span>
                        `).join('')}
                        ${times.length === 0 ? '<span style="color:var(--mut);font-size:.7rem;">—</span>' : ''}
                    </div>
                    <div class="actions">
                        ${times.map(t => `
                            <button class="btn-sm red" onclick="window.deleteAttendance('${t.id}')" title="Удалить">🗑️</button>
                        `).join('')}
                    </div>
                </div>`;
            }

            html += `</div>`;
        }

        html += `</div>`;
        container.innerHTML = html;

    } catch (error) {
        console.error('Ошибка рендера посещаемости:', error);
        container.innerHTML = `<div class="loading" style="color:var(--red);">❌ Ошибка: ${error.message}</div>`;
    }
}

// ============================================
// НАВИГАЦИЯ ПО НЕДЕЛЯМ
// ============================================
const salaryPrev = document.getElementById('salaryWeekPrev');
const salaryNext = document.getElementById('salaryWeekNext');
const salaryRefresh = document.getElementById('refreshSalaryBtn');

if (salaryPrev) salaryPrev.addEventListener('click', () => { currentSalaryWeek--; renderSalary(); });
if (salaryNext) salaryNext.addEventListener('click', () => { currentSalaryWeek++; renderSalary(); });
if (salaryRefresh) salaryRefresh.addEventListener('click', renderSalary);

const attPrev = document.getElementById('attWeekPrev');
const attNext = document.getElementById('attWeekNext');
const attToday = document.getElementById('attWeekToday');
const attRefresh = document.getElementById('refreshAttBtn');

if (attPrev) attPrev.addEventListener('click', () => { currentAttWeek--; renderAttendance(); });
if (attNext) attNext.addEventListener('click', () => { currentAttWeek++; renderAttendance(); });
if (attToday) attToday.addEventListener('click', () => { currentAttWeek = 0; renderAttendance(); });
if (attRefresh) attRefresh.addEventListener('click', renderAttendance);

// ============================================
// НАСТРОЙКИ СОТРУДНИКА (МОДАЛКА)
// ============================================
window.showEmployeeSettings = function(employeeId) {
    const emp = allEmployees.find(e => e.id === employeeId);
    if (!emp) return;

    const settings = getEmployeeSettings(employeeId);
    const modal = document.getElementById('modalOverlay');
    const body = document.getElementById('modalBody');
    const title = document.getElementById('modalTitle');
    const sub = document.getElementById('modalSub');
    const actions = document.getElementById('modalActions');

    if (!modal || !body) return;

    if (title) title.textContent = `⚙️ Настройки ${emp.name}`;
    if (sub) sub.textContent = 'Ставки и параметры расчёта';

    body.innerHTML = `
        <div class="field">
            <label>Базовая ставка (день 1–5), ₽</label>
            <input type="number" id="set_rDay" value="${settings.rDay}" step="100" min="0">
        </div>
        <div class="field">
            <label>Повышенная ставка (день 6–7), ₽</label>
            <input type="number" id="set_rExtra" value="${settings.rExtra}" step="100" min="0">
        </div>
        <div class="field">
            <label>Переработка (до лимита), ₽/ч</label>
            <input type="number" id="set_rOt1" value="${settings.rOt1}" step="50" min="0">
        </div>
        <div class="field">
            <label>Переработка (сверх лимита), ₽/ч</label>
            <input type="number" id="set_rOt2" value="${settings.rOt2}" step="50" min="0">
        </div>
        <div class="field">
            <label>Лимит дешёвой переработки, ч</label>
            <input type="number" id="set_otLimit" value="${settings.otLimit}" step="0.5" min="0" max="24">
        </div>
        <div class="field">
            <label>PIN-код сотрудника</label>
            <input type="text" id="set_pin" value="${emp.pin || ''}" maxlength="6" inputmode="numeric">
        </div>
    `;

    if (actions) {
        actions.innerHTML = `
            <button class="btn btn-amber" id="modalSaveBtn">💾 Сохранить</button>
            <button class="btn btn-ghost" id="modalCancelBtn">Отмена</button>
        `;
    }

    modal.classList.add('active');

    const saveBtn = document.getElementById('modalSaveBtn');
    const cancelBtn = document.getElementById('modalCancelBtn');

    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            const data = {
                rDay: parseFloat(document.getElementById('set_rDay')?.value) || 3000,
                rExtra: parseFloat(document.getElementById('set_rExtra')?.value) || 3500,
                rOt1: parseFloat(document.getElementById('set_rOt1')?.value) || 400,
                rOt2: parseFloat(document.getElementById('set_rOt2')?.value) || 800,
                otLimit: parseFloat(document.getElementById('set_otLimit')?.value) || 5,
                pin: document.getElementById('set_pin')?.value.trim() || ''
            };

            try {
                const settingsRef = doc(db, 'salarySettings', employeeId);
                await updateDoc(settingsRef, {
                    rDay: data.rDay,
                    rExtra: data.rExtra,
                    rOt1: data.rOt1,
                    rOt2: data.rOt2,
                    otLimit: data.otLimit,
                    updatedAt: new Date().toISOString()
                }, { merge: true });

                if (data.pin) {
                    await updateDoc(doc(db, 'salaryEmployees', employeeId), { pin: data.pin });
                }

                allSettings[employeeId] = { ...allSettings[employeeId], ...data };
                const empData = allEmployees.find(e => e.id === employeeId);
                if (empData) empData.pin = data.pin;

                modal.classList.remove('active');
                renderSalary();
                showNotification('✅ Настройки сохранены');

            } catch (error) {
                showNotification('❌ Ошибка: ' + error.message, true);
            }
        });
    }

    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            modal.classList.remove('active');
        });
    }
};

// ============================================
// ДЕТАЛИ НЕДЕЛИ
// ============================================
window.viewWeekDetails = function(employeeId, weekKey) {
    const weekData = allWeeks[employeeId + '_' + weekKey];
    if (!weekData) {
        showNotification('Нет данных за эту неделю', true);
        return;
    }

    const emp = allEmployees.find(e => e.id === employeeId);
    const settings = getEmployeeSettings(employeeId);
    const stats = calculateWeekPay(weekData, settings);

    const modal = document.getElementById('modalOverlay');
    const body = document.getElementById('modalBody');
    const actions = document.getElementById('modalActions');
    const title = document.getElementById('modalTitle');
    const sub = document.getElementById('modalSub');

    if (!modal || !body) return;

    if (title) title.textContent = `📊 ${emp?.name || 'Сотрудник'}`;
    if (sub) sub.textContent = `Неделя ${weekKey}`;

    body.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
            <div style="background:rgba(255,255,255,.05);padding:12px;border-radius:8px;text-align:center;">
                <div style="color:var(--mut);font-size:.7rem;">Дней</div>
                <div style="font-size:1.4rem;font-weight:bold;color:var(--amber2);">${stats.days}</div>
            </div>
            <div style="background:rgba(255,255,255,.05);padding:12px;border-radius:8px;text-align:center;">
                <div style="color:var(--mut);font-size:.7rem;">Часов</div>
                <div style="font-size:1.4rem;font-weight:bold;color:var(--amber2);">${stats.totalHours.toFixed(1)}</div>
            </div>
            <div style="background:rgba(255,255,255,.05);padding:12px;border-radius:8px;text-align:center;">
                <div style="color:var(--mut);font-size:.7rem;">Переработка</div>
                <div style="font-size:1.4rem;font-weight:bold;color:${stats.ot > 0 ? 'var(--amber)' : 'var(--mut)'};">${stats.ot > 0 ? stats.ot.toFixed(1) + 'ч' : '—'}</div>
            </div>
            <div style="background:rgba(255,181,46,.1);padding:12px;border-radius:8px;text-align:center;border:1px solid var(--amber);">
                <div style="color:var(--mut);font-size:.7rem;">Итого</div>
                <div style="font-size:1.6rem;font-weight:bold;color:var(--amber);">${stats.total.toLocaleString()} ₽</div>
            </div>
        </div>
        <div style="font-size:.75rem;color:var(--mut);border-top:1px solid var(--line);padding-top:12px;">
            Базовая: ${stats.payBase.toLocaleString()} ₽ · 
            Повышенная: ${stats.payExtra.toLocaleString()} ₽ · 
            Переработка: ${(stats.payOt1 + stats.payOt2).toLocaleString()} ₽
        </div>
    `;

    if (actions) {
        actions.innerHTML = `
            <button class="btn btn-ghost" id="modalCancelBtn">Закрыть</button>
        `;
    }

    modal.classList.add('active');

    const cancelBtn = document.getElementById('modalCancelBtn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            modal.classList.remove('active');
        });
    }
};

// ============================================
// РЕДАКТИРОВАНИЕ ВРЕМЕНИ ОТМЕТКИ
// ============================================
window.editAttendanceTime = function(attendanceId, currentTimestamp) {
    const date = new Date(currentTimestamp);
    const currentTime = date.toTimeString().slice(0, 5);

    const modal = document.getElementById('modalOverlay');
    const body = document.getElementById('modalBody');
    const actions = document.getElementById('modalActions');
    const title = document.getElementById('modalTitle');
    const sub = document.getElementById('modalSub');

    if (!modal || !body) return;

    if (title) title.textContent = '✏️ Редактировать время';
    if (sub) sub.textContent = 'Измените время отметки';

    body.innerHTML = `
        <div class="field">
            <label>Новое время (ЧЧ:ММ)</label>
            <input type="time" id="editTimeInput" value="${currentTime}" step="60">
        </div>
        <div class="field">
            <label>Новая дата</label>
            <input type="date" id="editDateInput" value="${date.toISOString().slice(0,10)}">
        </div>
    `;

    if (actions) {
        actions.innerHTML = `
            <button class="btn btn-amber" id="modalSaveBtn">💾 Сохранить</button>
            <button class="btn btn-ghost" id="modalCancelBtn">Отмена</button>
            <button class="btn btn-red" id="modalDeleteBtn">🗑️ Удалить</button>
        `;
    }

    modal.classList.add('active');

    const saveBtn = document.getElementById('modalSaveBtn');
    const cancelBtn = document.getElementById('modalCancelBtn');
    const deleteBtn = document.getElementById('modalDeleteBtn');

    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            const newTime = document.getElementById('editTimeInput')?.value;
            const newDate = document.getElementById('editDateInput')?.value;

            if (!newTime || !newDate) {
                showNotification('❌ Заполните все поля', true);
                return;
            }

            const newTimestamp = new Date(newDate + 'T' + newTime + ':00').toISOString();

            try {
                await updateDoc(doc(db, 'attendance', attendanceId), {
                    timestamp: newTimestamp,
                    date: newDate
                });

                modal.classList.remove('active');
                showNotification('✅ Время обновлено');
                loadAllData();

            } catch (error) {
                showNotification('❌ Ошибка: ' + error.message, true);
            }
        });
    }

    if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
            if (!confirm('Удалить эту отметку?')) return;
            try {
                await deleteDoc(doc(db, 'attendance', attendanceId));
                modal.classList.remove('active');
                showNotification('🗑️ Отметка удалена');
                loadAllData();
            } catch (error) {
                showNotification('❌ Ошибка: ' + error.message, true);
            }
        });
    }

    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            modal.classList.remove('active');
        });
    }
};

// ============================================
// УДАЛЕНИЕ ОТМЕТКИ (из таблицы)
// ============================================
window.deleteAttendance = async function(attendanceId) {
    if (!confirm('Удалить эту отметку?')) return;
    try {
        await deleteDoc(doc(db, 'attendance', attendanceId));
        showNotification('🗑️ Отметка удалена');
        loadAllData();
    } catch (error) {
        showNotification('❌ Ошибка: ' + error.message, true);
    }
};

// ============================================
// УВЕДОМЛЕНИЯ
// ============================================
function showNotification(message, isError = false) {
    let el = document.getElementById('notif');
    if (!el) {
        el = document.createElement('div');
        el.id = 'notif';
        el.style.cssText = `
            position: fixed;
            bottom: 30px;
            right: 30px;
            background: var(--teal);
            color: #0c1520;
            padding: 15px 25px;
            border-radius: 12px;
            font-weight: bold;
            opacity: 0;
            transition: opacity 0.4s;
            z-index: 9999;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            font-family: var(--mono);
            max-width: 90%;
        `;
        document.body.appendChild(el);
    }
    el.textContent = message;
    el.className = 'notification show';
    if (isError) {
        el.style.background = 'var(--red)';
        el.style.color = '#fff';
    } else {
        el.style.background = 'var(--teal)';
        el.style.color = '#0c1520';
    }
    clearTimeout(el._timer);
    el._timer = setTimeout(() => {
        el.classList.remove('show');
        el.style.opacity = '0';
    }, 3000);
}

console.log('✅ Админ-панель загружена');