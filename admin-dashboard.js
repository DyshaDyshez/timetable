// admin-dashboard.js
// Источник истины для рабочих дней.
// ОПТИМИЗИРОВАНАЯ ВЕРСИЯ — БЕЗ БЕСКОНЕЧНЫХ ЦИКЛОВ И ЛОГОВ

import { firebaseConfig } from './config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
    getFirestore, 
    collection, doc, getDocs, addDoc, updateDoc, deleteDoc, setDoc,
    query, where, onSnapshot, getDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { 
    getAuth, 
    onAuthStateChanged, 
    signOut 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { calculateWeekPay } from './modules/calculator.js';
import { calculateDayHoursFromLogs, buildWeekDataFromAttendance } from './modules/attendance.js';
// ❌ УБИРАЕМ АУДИТ — он создаёт бесконечные логи
// import { initAudit, logAction } from './modules/audit.js';
import { exportWeeklyReport } from './export-scheduler.js';

// ============================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
// ❌ НЕ ИНИЦИАЛИЗИРУЕМ АУДИТ
// initAudit(app);

let currentUser = null;
let allEmployees = [];
let allWeeks = {};
let allAttendance = {};
let allSettings = {};
let currentSalaryWeek = 0;
let currentAttWeek = 0;
let isRendering = false;
let renderTimeout = null;
let isSaving = false;

// ============================================
// АВТОРИЗАЦИЯ
// ============================================
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        const emailEl = document.getElementById('userEmail');
        if (emailEl) emailEl.textContent = '👤 ' + user.email;
        startListening();
    } else {
        window.location.href = 'index.html';
    }
});

document.getElementById('logoutBtn')?.addEventListener('click', () => signOut(auth));

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
        if (btn.dataset.tab === 'attendance') {
            renderAttendance();
        }
    });
});

// ============================================
// ЗАПУСК СЛУШАТЕЛЕЙ
// ============================================
function startListening() {
    // ❌ УБРАН ВСЕ ЛОГИ

    onSnapshot(collection(db, 'salaryEmployees'), (snapshot) => {
        allEmployees = [];
        snapshot.forEach(doc => allEmployees.push({ id: doc.id, ...doc.data() }));
        allEmployees.sort((a, b) => a.name?.localeCompare(b.name) || 0);
        window.__allEmployees = allEmployees;
        scheduleRender();
    }, (error) => {
        showNotification('❌ Ошибка загрузки сотрудников', true);
    });

    onSnapshot(collection(db, 'salaryWeeks'), (snapshot) => {
        allWeeks = {};
        snapshot.forEach(doc => {
            const data = doc.data();
            const key = data.employeeId + '_' + data.weekKey;
            allWeeks[key] = { id: doc.id, ...data };
        });
        window.__allWeeks = allWeeks;
        scheduleRender();
    }, (error) => {
        showNotification('❌ Ошибка загрузки недель', true);
    });

    onSnapshot(collection(db, 'attendance'), (snapshot) => {
        allAttendance = {};
        snapshot.forEach(doc => {
            const data = doc.data();
            const employeeId = data.employeeId || 'unknown';
            const date = data.date || 'unknown';
            const key = employeeId + '_' + date;
            if (!allAttendance[key]) {
                allAttendance[key] = [];
            }
            allAttendance[key].push({ id: doc.id, ...data });
        });
        window.__allAttendance = allAttendance;
        scheduleRender();
    }, (error) => {
        showNotification('❌ Ошибка загрузки посещаемости', true);
    });

    onSnapshot(collection(db, 'salarySettings'), (snapshot) => {
        allSettings = {};
        snapshot.forEach(doc => {
            allSettings[doc.id] = { id: doc.id, ...doc.data() };
        });
        window.__allSettings = allSettings;
        scheduleRender();
    }, (error) => {
        showNotification('❌ Ошибка загрузки настроек', true);
    });
}

// ============================================
// ПЛАНИРОВЩИК РЕНДЕРА
// ============================================
function scheduleRender() {
    clearTimeout(renderTimeout);
    renderTimeout = setTimeout(() => {
        if (!isRendering && !isSaving) {
            renderAll();
        }
    }, 500);
}

// ============================================
// РУЧНОЕ ОБНОВЛЕНИЕ
// ============================================
async function manualRefresh() {
    if (isRendering) return;
    isRendering = true;
    
    const btn = document.getElementById('manualRefreshBtn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ ...';
    }
    
    try {
        const empSnapshot = await getDocs(collection(db, 'salaryEmployees'));
        allEmployees = [];
        empSnapshot.forEach(doc => allEmployees.push({ id: doc.id, ...doc.data() }));
        allEmployees.sort((a, b) => a.name?.localeCompare(b.name) || 0);
        window.__allEmployees = allEmployees;
        
        const weeksSnapshot = await getDocs(collection(db, 'salaryWeeks'));
        allWeeks = {};
        weeksSnapshot.forEach(doc => {
            const data = doc.data();
            const key = data.employeeId + '_' + data.weekKey;
            allWeeks[key] = { id: doc.id, ...data };
        });
        window.__allWeeks = allWeeks;
        
        const attSnapshot = await getDocs(collection(db, 'attendance'));
        allAttendance = {};
        attSnapshot.forEach(doc => {
            const data = doc.data();
            const employeeId = data.employeeId || 'unknown';
            const date = data.date || 'unknown';
            const key = employeeId + '_' + date;
            if (!allAttendance[key]) {
                allAttendance[key] = [];
            }
            allAttendance[key].push({ id: doc.id, ...data });
        });
        window.__allAttendance = allAttendance;
        
        const settingsSnapshot = await getDocs(collection(db, 'salarySettings'));
        allSettings = {};
        settingsSnapshot.forEach(doc => {
            allSettings[doc.id] = { id: doc.id, ...doc.data() };
        });
        window.__allSettings = allSettings;
        
        renderAll();
        showNotification('✅ Данные обновлены');
    } catch (error) {
        showNotification('❌ Ошибка обновления', true);
    } finally {
        isRendering = false;
        if (btn) {
            btn.disabled = false;
            btn.textContent = '🔄 Обновить данные';
        }
    }
}

// ============================================
// ОБЩИЙ РЕНДЕР
// ============================================
function renderAll() {
    if (isRendering || isSaving) return;
    isRendering = true;
    
    try {
        if (allEmployees.length === 0) {
            const attContainer = document.getElementById('attendanceContent');
            if (attContainer) {
                attContainer.innerHTML = `<div class="loading">⏳ Загрузка...</div>`;
            }
            isRendering = false;
            return;
        }
        renderSalary();
        if (Object.keys(allAttendance).length > 0) {
            renderAttendance();
        }
    } catch (error) {
        // ❌ НЕТ ЛОГОВ
    } finally {
        isRendering = false;
    }
}

// ============================================
// ПОЛУЧЕНИЕ НАСТРОЕК
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
// ФУНКЦИИ ДАТ
// ============================================

function getWeekKeyUTC(date) {
    const d = new Date(date);
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const y = d.getUTCFullYear();
    const week = Math.ceil(((d - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7);
    return `${y}-W${String(week).padStart(2, '0')}`;
}

function getWeekDatesUTC(offset) {
    const today = new Date();
    const utcToday = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    const dayOfWeek = new Date(utcToday).getUTCDay();
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const mondayUTC = new Date(utcToday - daysToMonday * 86400000 + offset * 7 * 86400000);
    const dates = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(mondayUTC);
        d.setUTCDate(d.getUTCDate() + i);
        dates.push(d);
    }
    return dates;
}

function getWeekRange(offset) {
    const dates = getWeekDatesUTC(offset);
    const start = dates[0];
    const end = dates[6];
    const weekKey = getWeekKeyUTC(start);
    return { start, end, weekKey, dates };
}

function formatDateShort(d) {
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
}

function formatDateDisplay(d) {
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
}

function formatTime(date) {
    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function getDayNameFromIndex(index) {
    const days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    return days[index] || '?';
}

function getDayName(dateStr) {
    const d = new Date(dateStr + 'T00:00:00Z');
    const index = d.getUTCDay() === 0 ? 6 : d.getUTCDay() - 1;
    return getDayNameFromIndex(index);
}

function getDayMonth(dateStr) {
    const d = new Date(dateStr + 'T00:00:00Z');
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
}

function isToday(dateStr) {
    const today = new Date().toISOString().slice(0, 10);
    return dateStr === today;
}

// ============================================
// РЕНДЕР ЗАРПЛАТЫ (БЕЗ СОХРАНЕНИЯ В БД)
// ============================================
function renderSalary() {
    const wrap = document.getElementById('salaryTableWrap');
    const label = document.getElementById('salaryWeekLabel');
    if (!wrap) return;

    const { start, end, weekKey } = getWeekRange(currentSalaryWeek);
    if (label) label.textContent = `${formatDateShort(start)} – ${formatDateShort(end)} (${weekKey})`;

    let html = `<table>
        <thead><tr>
            <th>Сотрудник</th>
            <th>Дней</th>
            <th>Часов</th>
            <th>Перераб.</th>
            <th style="text-align:right;">Зарплата</th>
            <th style="text-align:center;">Статус</th>
            <th style="text-align:center;">Действия</th>
        </tr></thead><tbody>`;

    let totalPay = 0, paidCount = 0, totalCount = 0;

    for (const emp of allEmployees) {
        let weekData = allWeeks[emp.id + '_' + weekKey];
        let fromAttendance = false;
        
        if (!weekData) {
            const attData = buildWeekDataFromAttendance(emp.id, getWeekDatesUTC(currentSalaryWeek), allAttendance);
            if (attData.fromAttendance) {
                weekData = attData;
                fromAttendance = true;
            }
        }
        
        if (!weekData) {
            html += `<tr><td class="col-employee">${emp.name || 'Без имени'}</td>
                <td colspan="6" style="text-align:center;color:var(--mut);font-size:.8rem;">Нет данных</td></tr>`;
            continue;
        }
        
        const settings = getEmployeeSettings(emp.id);
        let displaySalary, displayDays, displayHours, displayOt;
        let source = 'calculated';
        
        if (weekData.fixedSalary !== undefined && weekData.fixedSalary !== null && weekData.fixedSalary > 0) {
            displaySalary = weekData.fixedSalary;
            displayDays = weekData.fixedDays !== undefined && weekData.fixedDays !== null ? weekData.fixedDays : weekData.workDays?.filter(d => d).length || 0;
            displayHours = weekData.fixedHours !== undefined && weekData.fixedHours !== null ? weekData.fixedHours : weekData.hours?.reduce((a, b) => a + b, 0) || 0;
            displayOt = weekData.fixedOt !== undefined && weekData.fixedOt !== null ? weekData.fixedOt : 0;
            source = 'fixed';
        } else if (weekData.calculatedPay !== undefined && weekData.calculatedPay !== null && weekData.calculatedPay > 0) {
            displaySalary = weekData.calculatedPay;
            displayDays = weekData.calculatedDays !== undefined && weekData.calculatedDays !== null ? weekData.calculatedDays : weekData.workDays?.filter(d => d).length || 0;
            displayHours = weekData.calculatedHours !== undefined && weekData.calculatedHours !== null ? weekData.calculatedHours : weekData.hours?.reduce((a, b) => a + b, 0) || 0;
            displayOt = weekData.calculatedOt !== undefined && weekData.calculatedOt !== null ? weekData.calculatedOt : 0;
            source = 'calculated';
        } else {
            const stats = calculateWeekPay(weekData, settings);
            displaySalary = stats.total;
            displayDays = stats.days;
            displayHours = stats.totalHours;
            displayOt = stats.ot;
            source = 'fallback';
        }
        
        const isPaid = weekData.isPaid || false;
        totalPay += displaySalary;
        totalCount++;
        if (isPaid) paidCount++;

        const sourceIndicator = fromAttendance ? ' 📌' : '';
        const sourceLabel = source === 'fixed' ? '🔒' : source === 'calculated' ? '💾' : '⚡';

        html += `<tr>
            <td class="col-employee">${emp.name} ${sourceLabel}${sourceIndicator}</td>
            <td>${displayDays}</td>
            <td>${displayHours.toFixed(1)}</td>
            <td>${displayOt > 0 ? displayOt.toFixed(1) + 'ч' : '—'}</td>
            <td class="col-pay" style="text-align:right; font-weight:700; color:var(--amber); font-size:1.1rem;">${displaySalary.toLocaleString()} ₽</td>
            <td style="text-align:center;">${isPaid ? '<span class="status-badge paid">✅ Выплачено</span>' : '<span class="status-badge unpaid">⏳ Ожидает</span>'}</td>
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
    </tr></tbody></table>`;
    wrap.innerHTML = html;
}

// ============================================
// РЕНДЕР ПОСЕЩАЕМОСТИ
// ============================================
function renderAttendance() {
    const container = document.getElementById('attendanceContent');
    const label = document.getElementById('attWeekLabel');
    if (!container) return;

    const { start, end, weekKey, dates } = getWeekRange(currentAttWeek);
    if (label) label.textContent = `${formatDateShort(start)} – ${formatDateShort(end)} (${weekKey})`;

    const weekDates = dates.map(d => d.toISOString().slice(0, 10));

    const allDayData = [];

    for (const emp of allEmployees) {
        for (const dateStr of weekDates) {
            const key = emp.id + '_' + dateStr;
            const logs = allAttendance[key] || [];
            
            const dateObj = new Date(dateStr + 'T00:00:00Z');
            const weekKey = getWeekKeyUTC(dateObj);
            const weekData = allWeeks[emp.id + '_' + weekKey];
            const dayIndex = dateObj.getUTCDay() === 0 ? 6 : dateObj.getUTCDay() - 1;
            
            let plannedHours = 0;
            let plannedStart = '';
            let plannedEnd = '';
            let isWorkDay = false;
            
            if (weekData) {
                plannedHours = weekData.hours && weekData.hours[dayIndex] ? weekData.hours[dayIndex] : 0;
                plannedStart = weekData.workStart && weekData.workStart[dayIndex] ? weekData.workStart[dayIndex] : '';
                plannedEnd = weekData.workEnd && weekData.workEnd[dayIndex] ? weekData.workEnd[dayIndex] : '';
                isWorkDay = weekData.workDays && weekData.workDays[dayIndex] ? weekData.workDays[dayIndex] : false;
            }
            
            const dayInfo = logs.length > 0 ? calculateDayHoursFromLogs(logs) : null;
            
            allDayData.push({
                employeeId: emp.id,
                employeeName: emp.name || 'Без имени',
                date: dateStr,
                dateObj: dateObj,
                logs: logs,
                hasLogs: logs.length > 0,
                dayInfo: dayInfo,
                plannedHours: plannedHours,
                plannedStart: plannedStart,
                plannedEnd: plannedEnd,
                isWorkDay: isWorkDay,
                weekKey: weekKey,
                dayIndex: dayIndex
            });
        }
    }

    allDayData.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return a.employeeName.localeCompare(b.employeeName);
    });

    if (allDayData.length === 0) {
        container.innerHTML = `<div class="no-data">Нет данных за эту неделю</div>`;
        return;
    }

    const grouped = {};
    for (const data of allDayData) {
        if (!grouped[data.date]) grouped[data.date] = [];
        grouped[data.date].push(data);
    }

    let html = `<div class="attendance-grid">`;
    const sortedDates = Object.keys(grouped).sort();

    for (const date of sortedDates) {
        const dayName = getDayName(date);
        const dayMonth = getDayMonth(date);
        const isTodayDate = isToday(date);
        const items = grouped[date];

        html += `<div class="attendance-day" style="${isTodayDate ? 'border-color: var(--amber);' : ''}">
            <div class="day-header">
                <span>${dayName}, ${dayMonth} ${isTodayDate ? '⭐ Сегодня' : ''}</span>
                <span class="date">${items.length} сотрудников</span>
            </div>`;

        for (const item of items) {
            let logsHtml = '';
            let segmentsHtml = '';
            
            if (item.hasLogs && item.dayInfo) {
                const sorted = [...item.logs].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
                const filtered = [];
                let lastType = null;
                for (const log of sorted) {
                    if (log.type !== lastType) {
                        filtered.push(log);
                        lastType = log.type;
                    }
                }
                if (filtered.length > 0 && filtered[0].type === 'out') {
                    filtered.shift();
                }

                for (const log of filtered) {
                    const time = new Date(log.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
                    const icon = log.type === 'in' ? '✅' : '🚪';
                    const label = log.type === 'in' ? 'Пришёл' : 'Ушёл';
                    logsHtml += `
                        <span class="time-badge ${log.type}" 
                              onclick="window.editAttendanceTime('${log.id}', '${log.timestamp}')"
                              title="Нажмите чтобы изменить время">
                            ${icon} ${time} (${label})
                            <span class="edit-hint">✏️</span>
                        </span>
                    `;
                }

                if (item.dayInfo.segments && item.dayInfo.segments.length > 0) {
                    segmentsHtml = item.dayInfo.segments.map((seg) => {
                        const startStr = formatTime(seg.start);
                        const endStr = seg.isOpen ? '... (сейчас)' : formatTime(seg.end);
                        const hours = Math.floor(seg.minutes / 60);
                        const mins = seg.minutes % 60;
                        return `<span class="segment">${startStr} → ${endStr} <span class="segment-time">${hours}ч ${mins}м</span></span>`;
                    }).join(' ');
                }
            }

            let totalDisplay = '';
            let totalClass = '';
            
            if (item.hasLogs && item.dayInfo) {
                totalDisplay = item.dayInfo.totalHours;
                totalClass = 'has-time';
            } else if (item.isWorkDay && item.plannedHours > 0) {
                totalDisplay = `${Math.floor(item.plannedHours)}ч ${Math.round((item.plannedHours % 1) * 60)}м (план)`;
                totalClass = 'planned';
            } else {
                totalDisplay = '—';
                totalClass = 'empty';
            }

            const totalMinutes = item.hasLogs && item.dayInfo ? item.dayInfo.totalMinutes : 0;

            html += `
                <div class="attendance-row ${item.hasLogs ? 'has-logs' : 'no-logs'}">
                    <span class="emp-name">${item.employeeName}</span>
                    <div class="time-group">
                        ${item.hasLogs ? logsHtml : '<span style="font-size:.65rem;color:var(--mut);">Нет отметок</span>'}
                    </div>
                    <div class="day-total">
                        <span class="total-badge ${totalClass}">
                            📊 ${totalDisplay}
                            ${item.hasLogs && totalMinutes > 0 ? `<span class="total-decimal">(${item.dayInfo.totalHoursDecimal.toFixed(2)} ч)</span>` : ''}
                            ${item.isWorkDay && !item.hasLogs && item.plannedHours > 0 ? `<span class="total-decimal">(${item.plannedHours.toFixed(2)} ч)</span>` : ''}
                        </span>
                    </div>
                    ${item.hasLogs && segmentsHtml ? `<div class="segments-info">${segmentsHtml}</div>` : ''}
                    <div class="actions">
                        <button class="btn-sm amber" onclick="window.editEmployeeDay('${item.employeeId}', '${item.date}', ${item.dayIndex})" title="Редактировать день">✏️</button>
                        ${item.hasLogs ? `<button class="btn-sm red" onclick="window.deleteDayAttendance('${item.employeeId}', '${item.date}')" title="Удалить все отметки за день">🗑️</button>` : ''}
                    </div>
                </div>
            `;
        }

        html += `</div>`;
    }

    html += `</div>`;
    container.innerHTML = html;
}

// ============================================
// НАВИГАЦИЯ ПО НЕДЕЛЯМ
// ============================================
document.getElementById('salaryWeekPrev')?.addEventListener('click', () => { currentSalaryWeek--; renderSalary(); });
document.getElementById('salaryWeekNext')?.addEventListener('click', () => { currentSalaryWeek++; renderSalary(); });
document.getElementById('refreshSalaryBtn')?.addEventListener('click', renderSalary);

document.getElementById('attWeekPrev')?.addEventListener('click', () => { currentAttWeek--; renderAttendance(); });
document.getElementById('attWeekNext')?.addEventListener('click', () => { currentAttWeek++; renderAttendance(); });
document.getElementById('attWeekToday')?.addEventListener('click', () => { currentAttWeek = 0; renderAttendance(); });
document.getElementById('refreshAttBtn')?.addEventListener('click', renderAttendance);

// ============================================
// КНОПКА РУЧНОГО ОБНОВЛЕНИЯ
// ============================================
document.getElementById('manualRefreshBtn')?.addEventListener('click', manualRefresh);

// ============================================
// НАСТРОЙКИ СОТРУДНИКА
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

    title.textContent = `⚙️ Настройки ${emp.name}`;
    sub.textContent = 'Ставки и параметры расчёта';
    body.innerHTML = `
        <div class="field"><label>Базовая ставка (день 1–5), ₽</label><input type="number" id="set_rDay" value="${settings.rDay}" step="100" min="0"></div>
        <div class="field"><label>Повышенная ставка (день 6–7), ₽</label><input type="number" id="set_rExtra" value="${settings.rExtra}" step="100" min="0"></div>
        <div class="field"><label>Переработка (до лимита), ₽/ч</label><input type="number" id="set_rOt1" value="${settings.rOt1}" step="50" min="0"></div>
        <div class="field"><label>Переработка (сверх лимита), ₽/ч</label><input type="number" id="set_rOt2" value="${settings.rOt2}" step="50" min="0"></div>
        <div class="field"><label>Лимит дешёвой переработки, ч</label><input type="number" id="set_otLimit" value="${settings.otLimit}" step="0.5" min="0" max="24"></div>
        <div class="field"><label>PIN-код сотрудника</label><input type="text" id="set_pin" value="${emp.pin || ''}" maxlength="6" inputmode="numeric"></div>
    `;
    actions.innerHTML = `
        <button class="btn btn-amber" id="modalSaveBtn">💾 Сохранить</button>
        <button class="btn btn-ghost" id="modalCancelBtn">Отмена</button>
    `;
    modal.classList.add('active');

    document.getElementById('modalSaveBtn').addEventListener('click', async () => {
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
                rDay: data.rDay, rExtra: data.rExtra, rOt1: data.rOt1, rOt2: data.rOt2,
                otLimit: data.otLimit, updatedAt: new Date().toISOString()
            }, { merge: true });
            if (data.pin) await updateDoc(doc(db, 'salaryEmployees', employeeId), { pin: data.pin });
            modal.classList.remove('active');
            showNotification('✅ Настройки сохранены');
        } catch (error) {
            showNotification('❌ Ошибка сохранения настроек', true);
        }
    });
    document.getElementById('modalCancelBtn').addEventListener('click', () => modal.classList.remove('active'));
};

// ============================================
// ДЕТАЛИ НЕДЕЛИ
// ============================================
window.viewWeekDetails = function(employeeId, weekKey) {
    const weekData = allWeeks[employeeId + '_' + weekKey];
    if (!weekData) { showNotification('Нет данных за эту неделю', true); return; }
    const emp = allEmployees.find(e => e.id === employeeId);
    const settings = getEmployeeSettings(employeeId);
    const modal = document.getElementById('modalOverlay');
    const body = document.getElementById('modalBody');
    const actions = document.getElementById('modalActions');
    const title = document.getElementById('modalTitle');
    const sub = document.getElementById('modalSub');
    if (!modal || !body) return;
    title.textContent = `📊 ${emp?.name || 'Сотрудник'}`;
    sub.textContent = `Неделя ${weekKey}`;

    let displaySalary, displayDays, displayHours, displayOt, sourceLabel;
    
    if (weekData.fixedSalary !== undefined && weekData.fixedSalary !== null && weekData.fixedSalary > 0) {
        displaySalary = weekData.fixedSalary;
        displayDays = weekData.fixedDays || weekData.workDays?.filter(d => d).length || 0;
        displayHours = weekData.fixedHours || weekData.hours?.reduce((a, b) => a + b, 0) || 0;
        displayOt = weekData.fixedOt || 0;
        sourceLabel = '🔒 Фиксированная';
    } else if (weekData.calculatedPay !== undefined && weekData.calculatedPay !== null && weekData.calculatedPay > 0) {
        displaySalary = weekData.calculatedPay;
        displayDays = weekData.calculatedDays || weekData.workDays?.filter(d => d).length || 0;
        displayHours = weekData.calculatedHours || weekData.hours?.reduce((a, b) => a + b, 0) || 0;
        displayOt = weekData.calculatedOt || 0;
        sourceLabel = '💾 Из БД';
    } else {
        const stats = calculateWeekPay(weekData, settings);
        displaySalary = stats.total;
        displayDays = stats.days;
        displayHours = stats.totalHours;
        displayOt = stats.ot;
        sourceLabel = '⚡ Расчёт';
    }

    body.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
            <div style="background:rgba(255,255,255,.05);padding:12px;border-radius:8px;text-align:center;">
                <div style="color:var(--mut);font-size:.7rem;">Дней</div>
                <div style="font-size:1.4rem;font-weight:bold;color:var(--amber2);">${displayDays}</div>
            </div>
            <div style="background:rgba(255,255,255,.05);padding:12px;border-radius:8px;text-align:center;">
                <div style="color:var(--mut);font-size:.7rem;">Часов</div>
                <div style="font-size:1.4rem;font-weight:bold;color:var(--amber2);">${displayHours.toFixed(1)}</div>
            </div>
            <div style="background:rgba(255,255,255,.05);padding:12px;border-radius:8px;text-align:center;">
                <div style="color:var(--mut);font-size:.7rem;">Переработка</div>
                <div style="font-size:1.4rem;font-weight:bold;color:${displayOt > 0 ? 'var(--amber)' : 'var(--mut)'};">${displayOt > 0 ? displayOt.toFixed(1) + 'ч' : '—'}</div>
            </div>
            <div style="background:rgba(255,181,46,.1);padding:12px;border-radius:8px;text-align:center;border:1px solid var(--amber);">
                <div style="color:var(--mut);font-size:.7rem;">Итого</div>
                <div style="font-size:1.6rem;font-weight:bold;color:var(--amber);">${displaySalary.toLocaleString()} ₽</div>
                <div style="font-size:.6rem;color:var(--mut);">${sourceLabel}</div>
            </div>
        </div>
    `;
    actions.innerHTML = `<button class="btn btn-ghost" id="modalCancelBtn">Закрыть</button>`;
    modal.classList.add('active');
    document.getElementById('modalCancelBtn').addEventListener('click', () => modal.classList.remove('active'));
};

// ============================================
// РЕДАКТИРОВАНИЕ ДНЯ
// ============================================

let editDayData = null;

window.editEmployeeDay = function(employeeId, dateStr, dayIndexParam) {
    const emp = allEmployees.find(e => e.id === employeeId);
    if (!emp) {
        showNotification('❌ Сотрудник не найден', true);
        return;
    }

    const dateObj = new Date(dateStr + 'T00:00:00Z');
    const weekKey = getWeekKeyUTC(dateObj);
    const weekData = allWeeks[employeeId + '_' + weekKey];
    
    let dayIndex = dayIndexParam;
    if (dayIndex === undefined || dayIndex === null) {
        dayIndex = dateObj.getUTCDay() === 0 ? 6 : dateObj.getUTCDay() - 1;
    }
    
    let currentHours = 0;
    let currentStart = '08:00';
    let currentEnd = '17:00';
    let currentIsWorkDay = false;
    
    if (weekData) {
        const hoursArr = weekData.hours || [0, 0, 0, 0, 0, 0, 0];
        const workDays = weekData.workDays || [false, false, false, false, false, false, false];
        const workStart = weekData.workStart || ['', '', '', '', '', '', ''];
        const workEnd = weekData.workEnd || ['', '', '', '', '', '', ''];
        
        currentHours = hoursArr[dayIndex] || 0;
        currentStart = workStart[dayIndex] || '08:00';
        currentEnd = workEnd[dayIndex] || '17:00';
        currentIsWorkDay = workDays[dayIndex] || false;
    }

    editDayData = {
        employeeId: employeeId,
        employeeName: emp.name,
        dateStr: dateStr,
        weekKey: weekKey,
        dayIndex: dayIndex,
        weekDocId: employeeId + '_' + weekKey,
        currentHours: currentHours,
        currentStart: currentStart,
        currentEnd: currentEnd,
        currentIsWorkDay: currentIsWorkDay,
        dateObj: dateObj
    };

    const modal = document.getElementById('editDayModal');
    const title = document.getElementById('editDayTitle');
    const sub = document.getElementById('editDaySub');
    const dateInput = document.getElementById('editDayDate');
    const hoursInput = document.getElementById('editDayHours');
    const startInput = document.getElementById('editDayStart');
    const endInput = document.getElementById('editDayEnd');
    const hoursDisplay = document.getElementById('editDayHoursDisplay');

    const dayName = getDayNameFromIndex(dayIndex);
    title.textContent = `✏️ Редактировать день: ${emp.name}`;
    sub.textContent = `Дата: ${formatDateDisplay(dateObj)} (${dayName})`;
    dateInput.value = dateStr;
    
    if (currentIsWorkDay && currentHours > 0) {
        hoursInput.value = currentHours;
        startInput.value = currentStart;
        endInput.value = currentEnd;
    } else {
        hoursInput.value = '';
        startInput.value = '08:00';
        endInput.value = '17:00';
    }
    
    updateHoursDisplay();

    modal.style.display = 'flex';
    modal.classList.add('active');

    setTimeout(() => hoursInput.focus(), 100);
};

function updateHoursDisplay() {
    const startInput = document.getElementById('editDayStart');
    const endInput = document.getElementById('editDayEnd');
    const hoursDisplay = document.getElementById('editDayHoursDisplay');
    const hoursInput = document.getElementById('editDayHours');
    
    if (!startInput || !endInput || !hoursDisplay) return;
    
    const start = startInput.value;
    const end = endInput.value;
    
    if (start && end) {
        const startMin = timeToMinutes(start);
        let endMin = timeToMinutes(end);
        if (endMin <= startMin) {
            endMin += 24 * 60;
        }
        const diffMinutes = endMin - startMin;
        const hours = Math.round((diffMinutes / 60) * 100) / 100;
        
        if (hours > 0) {
            hoursDisplay.textContent = `⏱ ${hours.toFixed(2)} ч`;
            hoursDisplay.style.color = 'var(--teal)';
            hoursInput.value = hours;
        } else {
            hoursDisplay.textContent = '⏱ 0 ч (некорректное время)';
            hoursDisplay.style.color = 'var(--red)';
        }
    } else {
        hoursDisplay.textContent = '⏱ укажите время';
        hoursDisplay.style.color = 'var(--mut)';
    }
}

function timeToMinutes(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':');
    return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}

async function saveEmployeeDay() {
    if (!editDayData) {
        showNotification('❌ Нет данных для сохранения', true);
        return;
    }

    const hoursInput = document.getElementById('editDayHours');
    const startInput = document.getElementById('editDayStart');
    const endInput = document.getElementById('editDayEnd');
    
    const hours = parseFloat(hoursInput.value) || 0;
    const start = startInput.value || '08:00';
    const end = endInput.value || '17:00';
    
    if (hours < 0 || hours > 24) {
        showNotification('❌ Часы должны быть от 0 до 24', true);
        return;
    }
    
    if (start >= end && hours > 0) {
        showNotification('❌ Время начала должно быть раньше окончания', true);
        return;
    }

    isSaving = true;
    const saveBtn = document.getElementById('editDaySaveBtn');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = '⏳ Сохранение...';
    }

    try {
        const { employeeId, weekKey, dayIndex, weekDocId, dateStr } = editDayData;
        
        let weekData = allWeeks[weekDocId];
        if (!weekData) {
            const defaultWorkDays = [false, false, false, false, false, false, false];
            const defaultHours = [0, 0, 0, 0, 0, 0, 0];
            const defaultStart = ['', '', '', '', '', '', ''];
            const defaultEnd = ['', '', '', '', '', '', ''];
            weekData = {
                workDays: defaultWorkDays,
                hours: defaultHours,
                workStart: defaultStart,
                workEnd: defaultEnd,
                isPaid: false,
                id: weekDocId
            };
        }
        
        const workDays = [...weekData.workDays];
        const hoursArr = [...weekData.hours];
        const workStart = [...weekData.workStart];
        const workEnd = [...weekData.workEnd];
        
        if (hours > 0) {
            workDays[dayIndex] = true;
            hoursArr[dayIndex] = Math.round(hours * 100) / 100;
            workStart[dayIndex] = start;
            workEnd[dayIndex] = end;
        } else {
            workDays[dayIndex] = false;
            hoursArr[dayIndex] = 0;
            workStart[dayIndex] = '';
            workEnd[dayIndex] = '';
        }
        
        const settings = getEmployeeSettings(employeeId);
        const updatedWeekData = {
            workDays: workDays,
            hours: hoursArr,
            workStart: workStart,
            workEnd: workEnd,
            isPaid: weekData.isPaid || false
        };
        const stats = calculateWeekPay(updatedWeekData, settings);
        
        const docRef = doc(db, 'salaryWeeks', weekDocId);
        await setDoc(docRef, {
            employeeId: employeeId,
            weekKey: weekKey,
            workDays: workDays,
            hours: hoursArr,
            workStart: workStart,
            workEnd: workEnd,
            isPaid: weekData.isPaid || false,
            calculatedPay: Math.round(stats.total * 100) / 100,
            calculatedDays: stats.days,
            calculatedHours: Math.round(stats.totalHours * 100) / 100,
            calculatedOt: Math.round(stats.ot * 100) / 100,
            calculatedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        }, { merge: true });
        
        if (allWeeks[weekDocId]) {
            allWeeks[weekDocId].workDays = workDays;
            allWeeks[weekDocId].hours = hoursArr;
            allWeeks[weekDocId].workStart = workStart;
            allWeeks[weekDocId].workEnd = workEnd;
            allWeeks[weekDocId].calculatedPay = stats.total;
            allWeeks[weekDocId].calculatedDays = stats.days;
            allWeeks[weekDocId].calculatedHours = stats.totalHours;
            allWeeks[weekDocId].calculatedOt = stats.ot;
        }
        
        document.getElementById('editDayModal').classList.remove('active');
        document.getElementById('editDayModal').style.display = 'none';
        
        showNotification(`✅ День обновлён: ${hours > 0 ? hours + 'ч' : 'нерабочий'}`);
        
        setTimeout(() => {
            renderAll();
        }, 300);
        
    } catch (error) {
        showNotification('❌ Ошибка сохранения: ' + error.message, true);
    } finally {
        isSaving = false;
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = '💾 Сохранить';
        }
    }
}

// ============================================
// ОБРАБОТЧИКИ МОДАЛКИ
// ============================================

document.getElementById('editDayCancelBtn')?.addEventListener('click', () => {
    document.getElementById('editDayModal').classList.remove('active');
    document.getElementById('editDayModal').style.display = 'none';
});

document.getElementById('editDayModal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('editDayModal')) {
        document.getElementById('editDayModal').classList.remove('active');
        document.getElementById('editDayModal').style.display = 'none';
    }
});

document.getElementById('editDaySaveBtn')?.addEventListener('click', saveEmployeeDay);

document.getElementById('editDayStart')?.addEventListener('change', updateHoursDisplay);
document.getElementById('editDayEnd')?.addEventListener('change', updateHoursDisplay);
document.getElementById('editDayStart')?.addEventListener('input', updateHoursDisplay);
document.getElementById('editDayEnd')?.addEventListener('input', updateHoursDisplay);

document.getElementById('editDayHours')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('editDayStart')?.focus();
    }
});

document.getElementById('editDayStart')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('editDayEnd')?.focus();
    }
});

document.getElementById('editDayEnd')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        saveEmployeeDay();
    }
});

// ============================================
// УДАЛЕНИЕ ДНЯ
// ============================================
window.deleteDayAttendance = async function(employeeId, date) {
    if (!confirm(`🗑️ Удалить все отметки для сотрудника за ${date}?`)) return;
    isSaving = true;
    try {
        const q = query(
            collection(db, 'attendance'),
            where('employeeId', '==', employeeId),
            where('date', '==', date)
        );
        const snapshot = await getDocs(q);
        let deleted = 0;
        for (const doc of snapshot.docs) {
            await deleteDoc(doc.ref);
            deleted++;
        }
        
        const dateObj = new Date(date + 'T00:00:00Z');
        const weekKey = getWeekKeyUTC(dateObj);
        const weekDocId = employeeId + '_' + weekKey;
        const weekRef = doc(db, 'salaryWeeks', weekDocId);
        const weekSnap = await getDoc(weekRef);
        
        if (weekSnap.exists()) {
            const weekData = weekSnap.data();
            const dayIndex = dateObj.getUTCDay() === 0 ? 6 : dateObj.getUTCDay() - 1;
            
            const workDays = [...weekData.workDays];
            const hours = [...weekData.hours];
            const workStart = [...weekData.workStart];
            const workEnd = [...weekData.workEnd];
            
            workDays[dayIndex] = false;
            hours[dayIndex] = 0;
            workStart[dayIndex] = '';
            workEnd[dayIndex] = '';
            
            const settings = getEmployeeSettings(employeeId);
            const updatedWeekData = {
                workDays: workDays,
                hours: hours,
                workStart: workStart,
                workEnd: workEnd,
                isPaid: weekData.isPaid || false
            };
            const stats = calculateWeekPay(updatedWeekData, settings);
            
            await updateDoc(weekRef, {
                workDays: workDays,
                hours: hours,
                workStart: workStart,
                workEnd: workEnd,
                calculatedPay: Math.round(stats.total * 100) / 100,
                calculatedDays: stats.days,
                calculatedHours: Math.round(stats.totalHours * 100) / 100,
                calculatedOt: Math.round(stats.ot * 100) / 100,
                calculatedAt: new Date().toISOString()
            });
            
            const cacheKey = employeeId + '_' + weekKey;
            if (allWeeks[cacheKey]) {
                allWeeks[cacheKey].workDays = workDays;
                allWeeks[cacheKey].hours = hours;
                allWeeks[cacheKey].workStart = workStart;
                allWeeks[cacheKey].workEnd = workEnd;
                allWeeks[cacheKey].calculatedPay = stats.total;
                allWeeks[cacheKey].calculatedDays = stats.days;
                allWeeks[cacheKey].calculatedHours = stats.totalHours;
                allWeeks[cacheKey].calculatedOt = stats.ot;
            }
        }
        
        showNotification(`🗑️ Удалено ${deleted} отметок за ${date}`);
        
        setTimeout(() => {
            renderAll();
        }, 300);
    } catch (error) {
        showNotification('❌ Ошибка: ' + error.message, true);
    } finally {
        isSaving = false;
    }
};

// ============================================
// РЕДАКТИРОВАНИЕ ОТМЕТКИ
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
    title.textContent = '✏️ Редактировать время';
    sub.textContent = 'Измените время отметки';
    body.innerHTML = `
        <div class="field"><label>Новое время (ЧЧ:ММ)</label><input type="time" id="editTimeInput" value="${currentTime}" step="60"></div>
        <div class="field"><label>Новая дата</label><input type="date" id="editDateInput" value="${date.toISOString().slice(0,10)}"></div>
    `;
    actions.innerHTML = `
        <button class="btn btn-amber" id="modalSaveBtn">💾 Сохранить</button>
        <button class="btn btn-ghost" id="modalCancelBtn">Отмена</button>
        <button class="btn btn-red" id="modalDeleteBtn">🗑️ Удалить</button>
    `;
    modal.classList.add('active');

    document.getElementById('modalSaveBtn').addEventListener('click', async () => {
        const newTime = document.getElementById('editTimeInput')?.value;
        const newDate = document.getElementById('editDateInput')?.value;
        if (!newTime || !newDate) { showNotification('❌ Заполните все поля', true); return; }
        const timeParts = newTime.split(':');
        if (timeParts.length !== 2 || parseInt(timeParts[0]) > 23 || parseInt(timeParts[1]) > 59) {
            showNotification('❌ Некорректное время', true);
            return;
        }
        const newTimestamp = new Date(newDate + 'T' + newTime + ':00').toISOString();
        try {
            await updateDoc(doc(db, 'attendance', attendanceId), { timestamp: newTimestamp, date: newDate });
            modal.classList.remove('active');
            showNotification('✅ Время обновлено');
        } catch (error) {
            showNotification('❌ Ошибка: ' + error.message, true);
        }
    });
    document.getElementById('modalDeleteBtn').addEventListener('click', async () => {
        if (!confirm('Удалить эту отметку?')) return;
        try {
            await deleteDoc(doc(db, 'attendance', attendanceId));
            modal.classList.remove('active');
            showNotification('🗑️ Отметка удалена');
        } catch (error) {
            showNotification('❌ Ошибка: ' + error.message, true);
        }
    });
    document.getElementById('modalCancelBtn').addEventListener('click', () => modal.classList.remove('active'));
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
            position: fixed; bottom: 30px; right: 30px;
            background: var(--teal); color: #0c1520;
            padding: 15px 25px; border-radius: 12px;
            font-weight: bold; opacity: 0;
            transition: opacity 0.4s; z-index: 9999;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            font-family: var(--mono); max-width: 90%;
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

// ============================================
// ОТЛАДКА
// ============================================
window.debugAttendance = function() {
    // ❌ ТОЛЬКО ОДИН ЛОГ В КОНСОЛЬ, БЕЗ ЦИКЛОВ
    console.log('🐞 Отладка посещаемости выполнена');
};

console.log('✅ Админ-панель загружена');