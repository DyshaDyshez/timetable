// admin-dashboard.js
// Источник истины для рабочих дней.
//
// ЛОГИКА (совпадает с employee-view.js):
// - Для каждого дня отдельно:
//     • adminEditedDays[i] === true → данные админа (в т.ч. 0ч = отмена дня)
//     • иначе → данные из отметок
// - updatedBy: 'admin' ставится, если админ вообще трогал неделю.
//
// + КНОПКА ОТПРАВКИ В BITRIX24
// + ★ ВКЛАДКА РАСПИСАНИЕ
// + ★ КОЛОНКА СТАТУС (Ожидает / Оплачено)
// + ★ КОЛОНКА «−20%» и скрытое управление вычетом

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
import { calculateDayHoursFromLogs } from './modules/attendance.js';
import { DEDUCTION_EMPLOYEES, DEDUCTION_RATE, hasDeduction } from './modules/deductions.js';

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
let allRequests = {};
let allSchedules = {};
let currentSalaryWeek = 0;
let currentAttWeek = 0;
let currentScheduleWeek = 0;
let isRendering = false;
let renderTimeout = null;
let isSaving = false;
let scheduleTableReady = false;

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
        if (btn.dataset.tab === 'attendance') renderAttendance();
        if (btn.dataset.tab === 'schedule') {
            scheduleTableReady = true;
            renderSchedule();
        }
    });
});

// ============================================
// СЛУШАТЕЛИ
// ============================================
function startListening() {
    onSnapshot(collection(db, 'salaryEmployees'), (snapshot) => {
        allEmployees = [];
        snapshot.forEach(doc => allEmployees.push({ id: doc.id, ...doc.data() }));
        allEmployees.sort((a, b) => a.name?.localeCompare(b.name) || 0);
        window.__allEmployees = allEmployees;
        scheduleRender();
    }, () => showNotification('❌ Ошибка загрузки сотрудников', true));

    onSnapshot(collection(db, 'salaryWeeks'), (snapshot) => {
        allWeeks = {};
        snapshot.forEach(doc => {
            const data = doc.data();
            const key = data.employeeId + '_' + data.weekKey;
            allWeeks[key] = { id: doc.id, ...data };
        });
        window.__allWeeks = allWeeks;
        scheduleRender();
    }, () => showNotification('❌ Ошибка загрузки недель', true));

    onSnapshot(collection(db, 'attendance'), (snapshot) => {
        allAttendance = {};
        snapshot.forEach(doc => {
            const data = doc.data();
            const employeeId = data.employeeId || 'unknown';
            const date = data.date || 'unknown';
            const key = employeeId + '_' + date;
            if (!allAttendance[key]) allAttendance[key] = [];
            allAttendance[key].push({ id: doc.id, ...data });
        });
        window.__allAttendance = allAttendance;
        scheduleRender();
    }, () => showNotification('❌ Ошибка загрузки посещаемости', true));

    onSnapshot(collection(db, 'salarySettings'), (snapshot) => {
        allSettings = {};
        snapshot.forEach(doc => {
            allSettings[doc.id] = { id: doc.id, ...doc.data() };
        });
        window.__allSettings = allSettings;
        scheduleRender();
    }, () => showNotification('❌ Ошибка загрузки настроек', true));

    onSnapshot(collection(db, 'salaryRequests'), (snapshot) => {
        allRequests = {};
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.status === 'pending' || data.status === 'paid') {
                const key = data.employeeId + '_' + data.weekKey;
                allRequests[key] = { id: doc.id, ...data };
            }
        });
        window.__allRequests = allRequests;
        scheduleRender();
    }, () => showNotification('❌ Ошибка загрузки запросов', true));

    onSnapshot(collection(db, 'employeeSchedule'), (snapshot) => {
        allSchedules = {};
        snapshot.forEach(doc => {
            const data = doc.data();
            const key = data.employeeId + '_' + data.weekKey;
            allSchedules[key] = { id: doc.id, ...data };
        });
        window.__allSchedules = allSchedules;
        scheduleRender();
    }, () => showNotification('❌ Ошибка загрузки расписания', true));
}

function scheduleRender() {
    clearTimeout(renderTimeout);
    renderTimeout = setTimeout(() => {
        if (!isRendering && !isSaving) renderAll();
    }, 500);
}

function renderAll() {
    if (isRendering || isSaving) return;
    isRendering = true;
    try {
        if (allEmployees.length === 0) {
            const attContainer = document.getElementById('attendanceContent');
            if (attContainer) attContainer.innerHTML = `<div class="loading">⏳ Загрузка...</div>`;
            return;
        }
        renderSalary();
        renderRequestsBanner();
        if (Object.keys(allAttendance).length > 0) renderAttendance();
        if (scheduleTableReady) renderSchedule();
    } catch (e) {
        console.error(e);
    } finally {
        isRendering = false;
    }
}

// ============================================
// НАСТРОЙКИ
// ============================================
function getEmployeeSettings(employeeId) {
    const s = allSettings[employeeId];
    if (s) {
        return {
            rDay: s.rDay || 3000,
            rExtra: s.rExtra || 3500,
            rOt1: s.rOt1 || 400,
            rOt2: s.rOt2 || 800,
            otLimit: s.otLimit || 5,
            hpd: s.hpd || 8,
            sundayBonusEnabled: s.sundayBonusEnabled === true,
            sundayBonusAmount: s.sundayBonusAmount || 1000,
            deductionDisabled: s.deductionDisabled === true
        };
    }
    return { 
        rDay: 3000, rExtra: 3500, rOt1: 400, rOt2: 800, otLimit: 5, hpd: 8,
        sundayBonusEnabled: false,
        sundayBonusAmount: 1000,
        deductionDisabled: false
    };
}

// ============================================
// ДАТЫ (UTC)
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
    return { start: dates[0], end: dates[6], weekKey: getWeekKeyUTC(dates[0]), dates };
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
    return ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'][index] || '?';
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
    return dateStr === new Date().toISOString().slice(0, 10);
}
function isPastDate(dateStr) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const d = new Date(dateStr + 'T00:00:00Z');
    return d < today;
}
function getUTCDateStr(date) {
    return new Date(date).toISOString().slice(0, 10);
}
function timeToMinutes(t) {
    if (!t) return 0;
    const p = t.split(':');
    return parseInt(p[0]) * 60 + parseInt(p[1]);
}

// ============================================
// ★ ГЛАВНАЯ ФУНКЦИЯ: смешивание данных по дням
// ============================================
function getWeekDataForEmployee(employeeId, weekKey, weekDates) {
    const dbWeek = allWeeks[employeeId + '_' + weekKey];

    const adminEditedDays = dbWeek?.adminEditedDays || null;
    const adminHours = dbWeek?.hours || null;
    const adminWorkStart = dbWeek?.workStart || null;
    const adminWorkEnd = dbWeek?.workEnd || null;

    const workDays = [false, false, false, false, false, false, false];
    const hours = [0, 0, 0, 0, 0, 0, 0];
    const workStart = ['', '', '', '', '', '', ''];
    const workEnd = ['', '', '', '', '', '', ''];
    const daySource = ['empty', 'empty', 'empty', 'empty', 'empty', 'empty', 'empty'];

    let anyData = false;

    weekDates.forEach((dateObj, i) => {
        const dateStr = dateObj.toISOString().slice(0, 10);
        const key = employeeId + '_' + dateStr;
        const logs = allAttendance[key] || [];

        if (adminEditedDays && adminEditedDays[i] === true) {
            const h = Number(adminHours?.[i]) || 0;
            workDays[i] = h > 0 ? true : false;
            hours[i] = h;
            workStart[i] = adminWorkStart?.[i] || '';
            workEnd[i] = adminWorkEnd?.[i] || '';
            daySource[i] = 'admin';
            anyData = true;
            return;
        }

        if (logs.length > 0) {
            const dayInfo = calculateDayHoursFromLogs(logs);
            const h = dayInfo.totalHoursDecimal || 0;
            workDays[i] = h > 0;
            hours[i] = h;
            daySource[i] = 'attendance';
            anyData = true;

            const sorted = [...logs].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
            const firstIn = sorted.find(l => l.type === 'in');
            const lastOut = [...sorted].reverse().find(l => l.type === 'out');
            if (firstIn) workStart[i] = new Date(firstIn.timestamp).toTimeString().slice(0, 5);
            if (lastOut && firstIn && lastOut.timestamp > firstIn.timestamp) {
                workEnd[i] = new Date(lastOut.timestamp).toTimeString().slice(0, 5);
            } else if (firstIn) {
                workEnd[i] = new Date().toTimeString().slice(0, 5);
            }
        }
    });

    let source = 'empty';
    if (daySource.includes('admin')) source = 'mixed-or-admin';
    else if (daySource.includes('attendance')) source = 'attendance';

    return { workDays, hours, workStart, workEnd, daySource, source, anyData };
}

// ============================================
// РЕНДЕР ЗАРПЛАТЫ (с колонкой Статус и −20%)
// ============================================
function renderSalary() {
    const wrap = document.getElementById('salaryTableWrap');
    const label = document.getElementById('salaryWeekLabel');
    if (!wrap) return;

    const { start, end, weekKey, dates } = getWeekRange(currentSalaryWeek);
    if (label) label.textContent = `${formatDateShort(start)} – ${formatDateShort(end)} (${weekKey})`;

    const rows = [];
    let totalPay = 0, totalCount = 0, totalNet = 0, totalDeduction = 0;

    for (const emp of allEmployees) {
        const requestKey = emp.id + '_' + weekKey;
        const requestData = allRequests[requestKey] || null; 
        const hasRequest = requestData !== null;

        const weekData = getWeekDataForEmployee(emp.id, weekKey, dates);

        if (!weekData.anyData && !hasRequest) {
            rows.push({ emp, weekData, hasRequest: false, requestData: null, noData: true });
            continue;
        }

        if (!weekData.anyData && hasRequest) {
            const settings0 = getEmployeeSettings(emp.id);
            const ded0 = hasDeduction(emp.id, settings0);
            const gross0 = requestData.finalPay || requestData.total || 0;
            const net0 = ded0 ? gross0 * (1 - DEDUCTION_RATE) : gross0;
            rows.push({
                emp, weekData, hasRequest: true, requestData,
                noData: false,
                stats: {
                    days: requestData.days || 0,
                    totalHours: requestData.totalHours || 0,
                    ot: 0,
                    total: gross0
                },
                hasDed: ded0,
                netValue: net0,
                sourceLabel: ''
            });
            totalCount++;
            totalPay += gross0;
            if (ded0) { totalDeduction += gross0 - net0; }
            totalNet += net0;
            continue;
        }

        const settings = getEmployeeSettings(emp.id);
        const stats = calculateWeekPay(weekData, settings);
        const hasDed = hasDeduction(emp.id, settings);
        const netValue = hasDed ? stats.total * (1 - DEDUCTION_RATE) : stats.total;

        totalPay += stats.total;
        totalNet += netValue;
        if (hasDed) totalDeduction += stats.total - netValue;
        totalCount++;

        const hasAdmin = weekData.daySource.includes('admin');
        const hasAtt = weekData.daySource.includes('attendance');
        let sourceLabel = '';
        if (hasAdmin && hasAtt) sourceLabel = ' 🔒📌';
        else if (hasAdmin) sourceLabel = ' 🔒';
        else if (hasAtt) sourceLabel = ' 📌';

        rows.push({
            emp, weekData, hasRequest, requestData,
            noData: false,
            stats, sourceLabel,
            hasDed,
            netValue
        });
    }

    // ===== Desktop: таблица =====
    let tableHTML = `<table style="table-layout:fixed;width:100%;">
        <colgroup>
            <col style="width:24%;">
            <col style="width:7%;">
            <col style="width:8%;">
            <col style="width:9%;">
            <col style="width:15%;">
            <col style="width:13%;">
            <col style="width:12%;">
            <col style="width:12%;">
        </colgroup>
        <thead><tr>
            <th>Сотрудник</th>
            <th style="text-align:center;">Дней</th>
            <th style="text-align:center;">Часов</th>
            <th style="text-align:center;">Перераб.</th>
            <th style="text-align:right;">Зарплата</th>
            <th style="text-align:right;">−20% (к выплате)</th>
            <th style="text-align:center;">Статус</th>
            <th style="text-align:center;">Действия</th>
        </tr></thead><tbody>`;

    for (const row of rows) {
        const { emp, hasRequest, requestData, noData, stats, sourceLabel, hasDed, netValue } = row;

        if (noData) {
            tableHTML += `<tr>
                <td class="col-employee" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${emp.name || 'Без имени'}</td>
                <td colspan="7" style="text-align:center;color:var(--mut);font-size:.8rem;">Нет данных</td>
            </tr>`;
            continue;
        }

        const isPaid = hasRequest && requestData.status === 'paid';
        const rowStyle = hasRequest 
            ? (isPaid ? 'background:rgba(255,255,255,.02);' : 'background:rgba(62,207,168,.08); border-left:4px solid var(--teal);')
            : '';
        
        const payStyle = isPaid 
            ? 'text-decoration:line-through; opacity:0.5;' 
            : 'color:var(--amber);';

        const netCell = hasDed
            ? `<span style="font-weight:700;color:var(--teal);white-space:nowrap; ${isPaid ? 'text-decoration:line-through; opacity:.5;' : ''}">${Math.round(netValue).toLocaleString()} ₽</span>`
            : `<span style="color:var(--mut);">—</span>`;

        let statusBadge = '<span style="color:var(--mut); font-size:.8rem;">—</span>';
        if (hasRequest) {
            if (isPaid) {
                statusBadge = `<span style="background:rgba(62,207,168,.15); color:var(--teal); padding:4px 10px; border-radius:99px; font-size:.75rem; font-weight:bold;">✅ Оплачено</span>`;
            } else {
                statusBadge = `<span style="background:rgba(255,181,46,.15); color:var(--amber2); padding:4px 10px; border-radius:99px; font-size:.75rem; font-weight:bold;">⏳ Ожидает</span>`;
            }
        }

        let actionButtons = '';
        if (hasRequest && !isPaid) {
            actionButtons = `
                <button class="btn-sm teal" onclick="window.showRequestDetails('${requestData.id}')" 
                        title="Показать запрос" 
                        style="padding:6px 12px; font-weight:bold; animation: requestPulse 1.5s infinite;">
                    💰 ЗАПРОС!
                </button>
            `;
        } else {
            actionButtons = `
                <button class="btn-sm ghost" onclick="window.showEmployeeSettings('${emp.id}')" title="Настройки">⚙️</button>
                <button class="btn-sm amber" onclick="window.viewWeekDetails('${emp.id}','${weekKey}')" title="Детали">👁️</button>
            `;
        }
        
        tableHTML += `<tr style="${rowStyle}">
            <td class="col-employee" title="${emp.name}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${hasRequest ? '💰 ' : ''}${emp.name}${sourceLabel}</td>
            <td style="text-align:center;">${stats.days}</td>
            <td style="text-align:center;">${stats.totalHours.toFixed(1)}</td>
            <td style="text-align:center;">${stats.ot > 0 ? stats.ot.toFixed(1) + 'ч' : '—'}</td>
            <td style="text-align:right;font-weight:700;font-size:1.05rem;white-space:nowrap; ${payStyle}">${stats.total.toLocaleString()} ₽</td>
            <td style="text-align:right;">${netCell}</td>
            <td style="text-align:center;">${statusBadge}</td>
            <td style="text-align:center;white-space:nowrap;">
                ${actionButtons}
            </td>
        </tr>`;
    }

    tableHTML += `<tr style="border-top:2px solid var(--amber);">
        <td><b style="color:var(--amber);">📊 ИТОГО</b></td>
        <td colspan="3" style="text-align:center;font-size:.8rem;color:var(--mut);">${totalCount} сотрудников</td>
        <td style="text-align:right;font-weight:700;color:var(--amber);font-size:1.1rem;white-space:nowrap;">${totalPay.toLocaleString()} ₽</td>
        <td style="text-align:right;font-weight:700;color:var(--teal);font-size:1.1rem;white-space:nowrap;">${Math.round(totalNet).toLocaleString()} ₽</td>
        <td colspan="2" style="text-align:right;font-size:.7rem;color:var(--mut);">вычет: −${Math.round(totalDeduction).toLocaleString()} ₽</td>
    </tr></tbody></table>`;

    // ===== Mobile: карточки =====
    let cardsHTML = '';
    for (const row of rows) {
        const { emp, hasRequest, requestData, noData, stats, sourceLabel, hasDed, netValue } = row;

        if (noData) {
            cardsHTML += `
                <div class="salary-card">
                    <div class="card-header">
                        <div class="card-name">${emp.name || 'Без имени'}</div>
                    </div>
                    <div class="card-no-data">Нет данных</div>
                    <div class="card-actions">
                        <button class="btn-settings" onclick="window.showEmployeeSettings('${emp.id}')">⚙️ Настройки</button>
                        <button class="btn-details" onclick="window.viewWeekDetails('${emp.id}','${weekKey}')">👁️ Детали</button>
                    </div>
                </div>
            `;
            continue;
        }

        const isPaid = hasRequest && requestData.status === 'paid';
        const cardClass = hasRequest 
            ? (isPaid ? 'salary-card' : 'salary-card has-request') 
            : 'salary-card';
        
        const payStyle = isPaid 
            ? 'text-decoration:line-through; opacity:0.5;' 
            : '';

        let statusBadge = '';
        if (hasRequest) {
            if (isPaid) {
                statusBadge = `<span style="background:rgba(62,207,168,.15); color:var(--teal); padding:3px 10px; border-radius:99px; font-size:.7rem; font-weight:bold;">✅ Оплачено</span>`;
            } else {
                statusBadge = `<span style="background:rgba(255,181,46,.15); color:var(--amber2); padding:3px 10px; border-radius:99px; font-size:.7rem; font-weight:bold;">⏳ Ожидает</span>`;
            }
        }

        const actions = (hasRequest && !isPaid)
            ? `<button class="btn-request-pulse" onclick="window.showRequestDetails('${requestData.id}')">
                   💰 ЗАПРОС!
               </button>`
            : `<button class="btn-settings" onclick="window.showEmployeeSettings('${emp.id}')">⚙️ Настройки</button>
               <button class="btn-details" onclick="window.viewWeekDetails('${emp.id}','${weekKey}')">👁️ Детали</button>`;

        const netLine = hasDed
            ? `<div style="margin-top:6px;font-size:.8rem;color:var(--teal);font-weight:600; ${isPaid ? 'opacity:.5;text-decoration:line-through;' : ''}">
                   💰 К выплате (−20%): ${Math.round(netValue).toLocaleString()} ₽
               </div>`
            : '';

        cardsHTML += `
            <div class="${cardClass}">
                <div class="card-header">
                    <div class="card-name">${emp.name}${sourceLabel}</div>
                    <div class="card-pay" style="${payStyle}">${stats.total.toLocaleString()} ₽</div>
                </div>
                ${netLine}
                ${statusBadge ? `<div style="margin-bottom:4px;">${statusBadge}</div>` : ''}
                <div class="card-stats">
                    <div class="stat-item">
                        <div class="stat-label">Дней</div>
                        <div class="stat-value">${stats.days}</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-label">Часов</div>
                        <div class="stat-value">${stats.totalHours.toFixed(1)}</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-label">Перераб.</div>
                        <div class="stat-value ${stats.ot > 0 ? 'amber' : 'mut'}">
                            ${stats.ot > 0 ? stats.ot.toFixed(1) + 'ч' : '—'}
                        </div>
                    </div>
                </div>
                <div class="card-actions">
                    ${actions}
                </div>
            </div>
        `;
    }

    cardsHTML += `
        <div class="salary-card" style="background:linear-gradient(135deg, rgba(255,181,46,.12), rgba(255,181,46,.02)); border-color:var(--amber);">
            <div class="card-header">
                <div class="card-name" style="color:var(--amber);">📊 ИТОГО</div>
                <div class="card-pay" style="font-size:1.2rem;">${totalPay.toLocaleString()} ₽</div>
            </div>
            <div style="font-size:.75rem; color:var(--teal); text-align:center; font-weight:600;">
                к выплате (−20%): ${Math.round(totalNet).toLocaleString()} ₽
            </div>
            <div style="font-size:.7rem; color:var(--mut); text-align:center; margin-top:4px;">
                ${totalCount} сотрудников · вычет −${Math.round(totalDeduction).toLocaleString()} ₽
            </div>
        </div>
    `;

    wrap.innerHTML = `
        ${tableHTML}
    `;
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
            const dayWeekKey = getWeekKeyUTC(dateObj);
            const weekData = allWeeks[emp.id + '_' + dayWeekKey];
            const dayIndex = dateObj.getUTCDay() === 0 ? 6 : dateObj.getUTCDay() - 1;
            
            let plannedHours = 0;
            let isWorkDay = false;
            const adminEdited = weekData?.adminEditedDays?.[dayIndex] === true;
            
            if (adminEdited) {
                plannedHours = weekData?.hours?.[dayIndex] || 0;
                isWorkDay = weekData?.workDays?.[dayIndex] || false;
            }
            
            const dayInfo = logs.length > 0 ? calculateDayHoursFromLogs(logs) : null;
            
            allDayData.push({
                employeeId: emp.id,
                employeeName: emp.name || 'Без имени',
                date: dateStr,
                logs, hasLogs: logs.length > 0,
                dayInfo, plannedHours, isWorkDay,
                weekKey: dayWeekKey, dayIndex, adminEdited
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
                if (filtered.length > 0 && filtered[0].type === 'out') filtered.shift();

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
                        const h = Math.floor(seg.minutes / 60);
                        const m = seg.minutes % 60;
                        return `<span class="segment">${startStr} → ${endStr} <span class="segment-time">${h}ч ${m}м</span></span>`;
                    }).join(' ');
                }
            }

            let totalDisplay = '';
            let totalClass = '';
            
            if (item.hasLogs && item.dayInfo) {
                totalDisplay = item.dayInfo.totalHours;
                totalClass = 'has-time';
            } else if (item.adminEdited && item.plannedHours > 0) {
                totalDisplay = `${Math.floor(item.plannedHours)}ч ${Math.round((item.plannedHours % 1) * 60)}м (админ)`;
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
// ★ РЕНДЕР РАСПИСАНИЯ
// ============================================
function renderSchedule() {
    const wrap = document.getElementById('scheduleTableWrap');
    const label = document.getElementById('schedWeekLabel');
    if (!wrap) return;

    const dates = getWeekDatesUTC(currentScheduleWeek);
    const weekKey = getWeekKeyUTC(dates[0]);
    if (label) {
        label.textContent = `${formatDateDisplay(dates[0])} – ${formatDateDisplay(dates[6])} (${weekKey})`;
    }

    const today = new Date();
    const todayWeekKey = getWeekKeyUTC(today);
    const todayStr = today.toISOString().slice(0, 10);

    let todayWorkCount = 0;
    let todayTotal = allEmployees.length;
    for (const emp of allEmployees) {
        const scheduleKey = emp.id + '_' + todayWeekKey;
        const schedule = allSchedules[scheduleKey];
        const todayDayIndex = (() => {
            const d = new Date(todayStr + 'T00:00:00Z');
            return d.getUTCDay() === 0 ? 6 : d.getUTCDay() - 1;
        })();
        if (schedule && schedule.days && schedule.days[todayDayIndex] === 'work') {
            todayWorkCount++;
        }
    }
    const summaryEl = document.getElementById('schedSummaryText');
    if (summaryEl) {
        if (currentScheduleWeek === 0) {
            summaryEl.textContent = `Сегодня: ${todayWorkCount} из ${todayTotal}`;
        } else {
            summaryEl.textContent = `Неделя ${weekKey}`;
        }
    }

    let html = `<table class="schedule-table">
        <thead>
            <tr>
                <th>Сотрудник</th>
                ${['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map((d, i) => {
                    const isWeekend = i >= 5;
                    const isTodayCol = isToday(getUTCDateStr(dates[i]));
                    return `<th class="${isWeekend ? 'weekend' : ''} ${isTodayCol ? 'today' : ''}">${d}</th>`;
                }).join('')}
            </tr>
        </thead>
        <tbody>`;

    for (const emp of allEmployees) {
        html += `<tr>`;
        html += `<td title="${emp.name || 'Без имени'}" onclick="window.openAsEmployee('${emp.id}')">👤 ${emp.name || 'Без имени'}</td>`;

        for (let i = 0; i < 7; i++) {
            const dateObj = dates[i];
            const dateStr = getUTCDateStr(dateObj);
            const dayIndex = i;
            const isPast = isPastDate(dateStr);
            const isTodayDay = dateStr === todayStr;

            let status = 'empty';
            let editable = false;

            if (isPast) {
                const attKey = emp.id + '_' + dateStr;
                const attLogs = allAttendance[attKey] || [];
                const hasAtt = attLogs.length > 0;
                status = hasAtt ? 'past-work' : 'past-off';
                editable = false;
            } else {
                const scheduleKey = emp.id + '_' + weekKey;
                const schedule = allSchedules[scheduleKey];
                if (schedule && schedule.days && schedule.days[dayIndex]) {
                    status = schedule.days[dayIndex];
                }
                editable = true;
            }

            let symbol = '⚪';
            if (status === 'work' || status === 'past-work') symbol = '🟢';
            else if (status === 'off' || status === 'past-off') symbol = '🔴';

            const cls = `${status} ${editable ? 'editable' : 'locked'}`;
            const onclick = editable
                ? `onclick="window.openAdminDayPicker(event, this)"`
                : '';

            html += `<td>
                <div class="schedule-day ${cls}" 
                     data-employee="${emp.id}" 
                     data-date="${dateStr}"
                     data-day="${dayIndex}"
                     data-week="${weekKey}"
                     data-editable="${editable}"
                     ${onclick}>
                    ${symbol}
                </div>
            </td>`;
        }

        html += `</tr>`;
    }

    html += `</tbody></table>`;
    wrap.innerHTML = html;
}

// ============================================
// ★ СОХРАНЕНИЕ СТАТУСА ДНЯ (для админа)
// ============================================
async function saveDayStatusAdmin(employeeId, weekKey, dayIndex, status) {
    try {
        const docId = `${employeeId}_${weekKey}`;
        const docRef = doc(db, 'employeeSchedule', docId);

        const existing = await getDoc(docRef);
        let days = existing.exists() ? (existing.data().days || {}) : {};

        if (status === 'empty') {
            days[dayIndex] = null;
        } else {
            days[dayIndex] = status;
        }

        await setDoc(docRef, {
            employeeId,
            employeeName: allEmployees.find(e => e.id === employeeId)?.name || '',
            weekKey,
            days,
            updatedAt: new Date().toISOString()
        }, { merge: true });

        console.log(`✅ Расписание сохранено: ${employeeId} ${weekKey} день ${dayIndex} = ${status}`);
    } catch (e) {
        console.error('Ошибка сохранения расписания:', e);
        showNotification('❌ Не удалось сохранить. Попробуйте снова.', true);
    }
}

// ============================================
// ★ МИНИ-МЕНЮ ВЫБОРА ДНЯ
// ============================================
let currentPicker = null;

window.openAdminDayPicker = function(event, el) {
    event.stopPropagation();

    if (currentPicker) {
        currentPicker.remove();
        currentPicker = null;
    }

    const employeeId = el.dataset.employee;
    const dayIndex = parseInt(el.dataset.day);
    const weekKey = el.dataset.week;

    const picker = document.createElement('div');
    picker.className = 'day-picker';
    picker.innerHTML = `
        <button class="work" data-status="work">🟢 Рабочий</button>
        <button class="off" data-status="off">🔴 Выходной</button>
        <button data-status="empty">⚪ Сбросить</button>
    `;
    document.body.appendChild(picker);

    const rect = el.getBoundingClientRect();
    const pickerRect = picker.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - pickerRect.width / 2;
    let top = rect.bottom + 8;

    if (left < 8) left = 8;
    if (left + pickerRect.width > window.innerWidth - 8) {
        left = window.innerWidth - pickerRect.width - 8;
    }
    if (top + pickerRect.height > window.innerHeight - 8) {
        top = rect.top - pickerRect.height - 8;
    }

    picker.style.left = left + 'px';
    picker.style.top = top + 'px';

    currentPicker = picker;

    picker.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', async () => {
            const newStatus = btn.dataset.status;
            await saveDayStatusAdmin(employeeId, weekKey, dayIndex, newStatus);
            picker.remove();
            currentPicker = null;
            renderSchedule();
        });
    });

    setTimeout(() => {
        document.addEventListener('click', function closePicker(e) {
            if (currentPicker && !currentPicker.contains(e.target)) {
                currentPicker.remove();
                currentPicker = null;
                document.removeEventListener('click', closePicker);
            }
        });
    }, 0);
};

// ============================================
// ★ ОТКРЫТЬ КАК СОТРУДНИК
// ============================================
window.openAsEmployee = function(employeeId) {
    if (!employeeId) return;
    const url = `employee-view.html?id=${encodeURIComponent(employeeId)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
};

// ============================================
// НАВИГАЦИЯ
// ============================================
document.getElementById('salaryWeekPrev')?.addEventListener('click', () => { currentSalaryWeek--; renderSalary(); });
document.getElementById('salaryWeekNext')?.addEventListener('click', () => { currentSalaryWeek++; renderSalary(); });
document.getElementById('refreshSalaryBtn')?.addEventListener('click', renderSalary);

document.getElementById('attWeekPrev')?.addEventListener('click', () => { currentAttWeek--; renderAttendance(); });
document.getElementById('attWeekNext')?.addEventListener('click', () => { currentAttWeek++; renderAttendance(); });
document.getElementById('attWeekToday')?.addEventListener('click', () => { currentAttWeek = 0; renderAttendance(); });
document.getElementById('refreshAttBtn')?.addEventListener('click', renderAttendance);

document.getElementById('schedWeekPrev')?.addEventListener('click', () => { currentScheduleWeek--; renderSchedule(); });
document.getElementById('schedWeekNext')?.addEventListener('click', () => { currentScheduleWeek++; renderSchedule(); });
document.getElementById('schedWeekToday')?.addEventListener('click', () => { currentScheduleWeek = 0; renderSchedule(); });

// ============================================
// НАСТРОЙКИ СОТРУДНИКА (модалка)
// — с СКРЫТЫМ управлением вычетом (details, свёрнуто)
// ============================================
window.showEmployeeSettings = function(employeeId) {
    const emp = allEmployees.find(e => e.id === employeeId);
    if (!emp) return;
    const settings = getEmployeeSettings(employeeId);
    const isDeductionListed = DEDUCTION_EMPLOYEES.includes(employeeId);
    const deductionActive = hasDeduction(employeeId, settings);

    const modal = document.getElementById('modalOverlay');
    const body = document.getElementById('modalBody');
    const title = document.getElementById('modalTitle');
    const sub = document.getElementById('modalSub');
    const actions = document.getElementById('modalActions');
    if (!modal || !body) return;

    title.textContent = `⚙️ Настройки ${emp.name}`;
    sub.textContent = 'Ставки и параметры расчёта';

    // Скрытый блок управления вычетом — только для сотрудников из списка,
    // и только чтобы «убрать вычет» (без афиширования процента)
    const deductionBlock = isDeductionListed
        ? `
        <details style="margin-top:12px; border-top:1px solid var(--line); padding-top:12px;">
            <summary style="cursor:pointer; font-size:.75rem; color:var(--mut); font-weight:600; text-transform:uppercase; letter-spacing:.05em; user-select:none;">
                Дополнительно
            </summary>
            <div style="margin-top:10px; padding:10px 12px; background:rgba(62,207,168,.06); border:1px dashed var(--line); border-radius:8px;">
                <div style="font-size:.72rem; color:var(--mut); margin-bottom:8px;">
                    Управление удержанием для этого сотрудника.
                </div>
                <label style="display:flex; align-items:center; gap:10px; cursor:pointer; font-size:.85rem;">
                    <input type="checkbox" id="set_deductionDisabled" ${settings.deductionDisabled ? 'checked' : ''}
                           style="width:auto; cursor:pointer; transform:scale(1.3);">
                    <span>Убрать вычет 20% (выплачивать полную сумму)</span>
                </label>
                <div style="font-size:.65rem; color:var(--mut); margin-top:6px;">
                    Если отмечено — удержание к этому сотруднику не применяется,
                    пока галочка стоит. Влияет и на сотрудника, и на дашборд.
                </div>
            </div>
        </details>
        `
        : '';

    body.innerHTML = `
        <div class="field"><label>Базовая ставка (день 1–5), ₽</label><input type="number" id="set_rDay" value="${settings.rDay}" step="100" min="0"></div>
        <div class="field"><label>Повышенная ставка (день 6–7), ₽</label><input type="number" id="set_rExtra" value="${settings.rExtra}" step="100" min="0"></div>
        <div class="field"><label>Переработка (до лимита), ₽/ч</label><input type="number" id="set_rOt1" value="${settings.rOt1}" step="50" min="0"></div>
        <div class="field"><label>Переработка (сверх лимита), ₽/ч</label><input type="number" id="set_rOt2" value="${settings.rOt2}" step="50" min="0"></div>
        <div class="field"><label>Лимит дешёвой переработки, ч</label><input type="number" id="set_otLimit" value="${settings.otLimit}" step="0.5" min="0" max="24"></div>
        
        <div style="border-top:1px solid var(--line); margin-top:12px; padding-top:12px;">
            <div style="font-size:.75rem; color:var(--mut); font-weight:600; margin-bottom:8px; text-transform:uppercase; letter-spacing:.05em;">
                🌟 Надбавка за работу в воскресенье
            </div>
            <div class="field" style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
                <input type="checkbox" id="set_sundayBonusEnabled" ${settings.sundayBonusEnabled ? 'checked' : ''} 
                       style="width:auto; cursor:pointer; transform:scale(1.3);">
                <label for="set_sundayBonusEnabled" style="cursor:pointer; font-size:.9rem; color:var(--txt); margin:0;">
                    Включить надбавку за воскресенье
                </label>
            </div>
            <div class="field">
                <label>Сумма надбавки, ₽</label>
                <input type="number" id="set_sundayBonusAmount" value="${settings.sundayBonusAmount}" step="100" min="0">
            </div>
            <div style="font-size:.7rem; color:var(--mut); margin-top:4px;">
                💡 Если сотрудник работает в воскресенье — к его ЗП прибавится эта сумма
            </div>
        </div>
        
        <div class="field" style="margin-top:12px; border-top:1px solid var(--line); padding-top:12px;">
            <label>PIN-код сотрудника</label>
            <input type="text" id="set_pin" value="${emp.pin || ''}" maxlength="6" inputmode="numeric">
        </div>

        ${deductionBlock}
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
            sundayBonusEnabled: document.getElementById('set_sundayBonusEnabled')?.checked || false,
            sundayBonusAmount: parseFloat(document.getElementById('set_sundayBonusAmount')?.value) || 1000,
            pin: document.getElementById('set_pin')?.value.trim() || '',
            deductionDisabled: isDeductionListed
                ? (document.getElementById('set_deductionDisabled')?.checked || false)
                : undefined
        };
        try {
            const payload = {
                rDay: data.rDay, rExtra: data.rExtra, rOt1: data.rOt1, rOt2: data.rOt2,
                otLimit: data.otLimit,
                sundayBonusEnabled: data.sundayBonusEnabled,
                sundayBonusAmount: data.sundayBonusAmount,
                updatedAt: new Date().toISOString()
            };
            if (isDeductionListed && data.deductionDisabled !== undefined) {
                payload.deductionDisabled = data.deductionDisabled;
            }
            await setDoc(doc(db, 'salarySettings', employeeId), payload, { merge: true });
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
    const emp = allEmployees.find(e => e.id === employeeId);
    if (!emp) return;

    const dates = getWeekDatesUTC(currentSalaryWeek);
    const weekData = getWeekDataForEmployee(employeeId, weekKey, dates);
    const settings = getEmployeeSettings(employeeId);
    const stats = calculateWeekPay(weekData, settings);
    const hasDed = hasDeduction(employeeId, settings);
    const netValue = hasDed ? stats.total * (1 - DEDUCTION_RATE) : stats.total;

    const modal = document.getElementById('modalOverlay');
    const body = document.getElementById('modalBody');
    const actions = document.getElementById('modalActions');
    const title = document.getElementById('modalTitle');
    const sub = document.getElementById('modalSub');
    if (!modal || !body) return;

    title.textContent = `📊 ${emp.name}`;
    sub.textContent = `Неделя ${weekKey}`;

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
                <div style="color:var(--mut);font-size:.7rem;">Итого (до вычета)</div>
                <div style="font-size:1.6rem;font-weight:bold;color:var(--amber);">${stats.total.toLocaleString()} ₽</div>
            </div>
        </div>

        ${hasDed ? `
            <div style="background:rgba(62,207,168,.12); padding:12px 14px; border-radius:8px; margin-bottom:12px; border:1px dashed var(--teal); display:flex; justify-content:space-between; align-items:center;">
                <span style="color:var(--teal); font-size:.8rem; font-weight:600;">💰 −20% к выплате</span>
                <span style="color:var(--teal); font-weight:bold; font-size:1.2rem;">${Math.round(netValue).toLocaleString()} ₽</span>
            </div>
        ` : ''}
        
        ${stats.sundayBonus > 0 ? `
            <div style="background:rgba(255,181,46,.15); padding:10px 14px; border-radius:8px; margin-bottom:12px; border:1px dashed var(--amber); display:flex; justify-content:space-between; align-items:center;">
                <span style="color:var(--mut); font-size:.8rem;">🌟 Надбавка за воскресенье</span>
                <span style="color:var(--amber); font-weight:bold; font-size:1.1rem;">+${stats.sundayBonus.toLocaleString()} ₽</span>
            </div>
        ` : ''}
        
        <div style="border-top:1px solid var(--line); padding-top:12px;">
            <div style="color:var(--mut); font-size:.7rem; margin-bottom:8px;">По дням:</div>
            <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;">
                ${['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map((d, i) => {
                    const src = weekData.daySource[i];
                    const color = src === 'admin' ? 'var(--amber)' : src === 'attendance' ? 'var(--teal)' : 'var(--line)';
                    const bg = src === 'admin' ? 'rgba(255,181,46,.15)' : src === 'attendance' ? 'rgba(62,207,168,.15)' : 'rgba(255,255,255,.05)';
                    const icon = src === 'admin' ? '🔒' : src === 'attendance' ? '📌' : '';
                    const isSunday = i === 6 && weekData.workDays[i];
                    return `
                        <div style="text-align:center;padding:6px 2px;border-radius:6px;
                            background:${isSunday ? 'rgba(255,181,46,.2)' : bg};
                            border:1px solid ${isSunday ? 'var(--amber)' : color};">
                            <div style="font-size:.55rem;color:var(--mut);">${d} ${icon}${isSunday ? ' 🌟' : ''}</div>
                            <div style="font-weight:bold;font-size:.85rem;">${weekData.hours[i]}ч</div>
                        </div>
                    `;
                }).join('')}
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
        employeeId, employeeName: emp.name, dateStr, weekKey, dayIndex,
        weekDocId: employeeId + '_' + weekKey,
        currentHours, currentStart, currentEnd, currentIsWorkDay, dateObj
    };

    const modal = document.getElementById('editDayModal');
    const title = document.getElementById('editDayTitle');
    const sub = document.getElementById('editDaySub');
    const dateInput = document.getElementById('editDayDate');
    const hoursInput = document.getElementById('editDayHours');
    const startInput = document.getElementById('editDayStart');
    const endInput = document.getElementById('editDayEnd');

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
        if (endMin <= startMin) endMin += 24 * 60;
        const diff = endMin - startMin;
        const hours = Math.round((diff / 60) * 100) / 100;
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
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '⏳ Сохранение...'; }

    try {
        const { employeeId, weekKey, dayIndex, weekDocId, dateStr } = editDayData;
        
        let weekData = allWeeks[weekDocId] || {
            workDays: [false, false, false, false, false, false, false],
            hours: [0, 0, 0, 0, 0, 0, 0],
            workStart: ['', '', '', '', '', '', ''],
            workEnd: ['', '', '', '', '', '', ''],
            adminEditedDays: [false, false, false, false, false, false, false],
            isPaid: false
        };
        
        const workDays = [...(weekData.workDays || [false, false, false, false, false, false, false])];
        const hoursArr = [...(weekData.hours || [0, 0, 0, 0, 0, 0, 0])];
        const workStart = [...(weekData.workStart || ['', '', '', '', '', '', ''])];
        const workEnd = [...(weekData.workEnd || ['', '', '', '', '', '', ''])];
        const adminEditedDays = [...(weekData.adminEditedDays || [false, false, false, false, false, false, false])];
        
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
        
        adminEditedDays[dayIndex] = true;
        
        const docRef = doc(db, 'salaryWeeks', weekDocId);
        await setDoc(docRef, {
            employeeId,
            weekKey,
            workDays,
            hours: hoursArr,
            workStart,
            workEnd,
            adminEditedDays,
            updatedBy: 'admin',
            updatedAt: new Date().toISOString(),
            isPaid: weekData.isPaid || false
        }, { merge: true });
        
        const oldQ = query(
            collection(db, 'attendance'),
            where('employeeId', '==', employeeId),
            where('date', '==', dateStr)
        );
        const oldSnap = await getDocs(oldQ);
        for (const d of oldSnap.docs) {
            await deleteDoc(d.ref);
        }
        
        if (hours > 0) {
            const inTimestamp = new Date(dateStr + 'T' + start + ':00').toISOString();
            const outTimestamp = new Date(dateStr + 'T' + end + ':00').toISOString();
            
            await addDoc(collection(db, 'attendance'), {
                employeeId: employeeId,
                timestamp: inTimestamp,
                type: 'in',
                date: dateStr,
                weekKey: weekKey,
                source: 'admin'
            });
            
            await addDoc(collection(db, 'attendance'), {
                employeeId: employeeId,
                timestamp: outTimestamp,
                type: 'out',
                date: dateStr,
                weekKey: weekKey,
                source: 'admin'
            });
        }
        
        document.getElementById('editDayModal').classList.remove('active');
        document.getElementById('editDayModal').style.display = 'none';
        
        showNotification(`✅ День обновлён: ${hours > 0 ? hours + 'ч' : 'нерабочий'}`);
    } catch (error) {
        showNotification('❌ Ошибка сохранения: ' + error.message, true);
    } finally {
        isSaving = false;
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '💾 Сохранить'; }
    }
}

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
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('editDayStart')?.focus(); }
});
document.getElementById('editDayStart')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('editDayEnd')?.focus(); }
});
document.getElementById('editDayEnd')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveEmployeeDay(); }
});

// ============================================
// УДАЛЕНИЕ ОТМЕТОК ЗА ДЕНЬ
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
        for (const d of snapshot.docs) {
            await deleteDoc(d.ref);
            deleted++;
        }
        showNotification(`🗑️ Удалено ${deleted} отметок за ${date}`);
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
        const newWeekKey = getWeekKeyUTC(new Date(newTimestamp));
        try {
            await updateDoc(doc(db, 'attendance', attendanceId), {
                timestamp: newTimestamp,
                date: newDate,
                weekKey: newWeekKey
            });
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
    if (isError) { el.style.background = 'var(--red)'; el.style.color = '#fff'; }
    else { el.style.background = 'var(--teal)'; el.style.color = '#0c1520'; }
    clearTimeout(el._timer);
    el._timer = setTimeout(() => { el.classList.remove('show'); el.style.opacity = '0'; }, 3000);
}

// ============================================
// ★ БАННЕР ВСЕХ АКТИВНЫХ ЗАПРОСОВ
// ============================================
function renderRequestsBanner() {
    const banner = document.getElementById('requestsBanner');
    const text = document.getElementById('requestsBannerText');
    const sub = document.getElementById('requestsBannerSub');
    const btn = document.getElementById('requestsBannerBtn');
    if (!banner) return;

    const requests = Object.values(allRequests).filter(r => r.status === 'pending');

    if (requests.length === 0) {
        banner.classList.remove('active');
        return;
    }

    banner.classList.add('active');

    // К выплате: netPay (после вычета), если есть, иначе finalPay
    const total = requests.reduce((sum, r) => {
        const amount = (typeof r.netPay === 'number') ? r.netPay : (r.finalPay || 0);
        return sum + amount;
    }, 0);

    text.innerHTML = `💰 ${requests.length} ${pluralizeRequests(requests.length)} на ЗП
        <small>Общая сумма к выплате: ${Math.round(total).toLocaleString()} ₽</small>`;
    sub.textContent = requests.map(r => `${r.employeeName} (${r.weekRange})`).join(' · ');

    btn.onclick = () => {
        if (requests.length === 1) {
            window.showRequestDetails(requests[0].id);
        } else {
            showRequestsList(requests);
        }
    };
}

function pluralizeRequests(n) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'активный запрос';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'активных запроса';
    return 'активных запросов';
}

function showRequestsList(requests) {
    const modal = document.getElementById('modalOverlay');
    const body = document.getElementById('modalBody');
    const actions = document.getElementById('modalActions');
    const title = document.getElementById('modalTitle');
    const sub = document.getElementById('modalSub');
    if (!modal || !body) return;

    title.textContent = '💰 Активные запросы';
    sub.textContent = `Всего: ${requests.length}`;

    body.innerHTML = requests.map(r => {
        const amount = (typeof r.netPay === 'number') ? r.netPay : (r.finalPay || 0);
        const dedBadge = r.deductionApplied
            ? `<div style="font-size:.65rem; color:var(--teal); margin-top:2px;">после вычета −20%</div>`
            : '';
        return `
        <div style="background:rgba(62,207,168,.08); border:1px solid var(--teal); 
                    border-radius:10px; padding:12px; margin-bottom:10px;
                    display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;">
            <div style="flex:1; min-width:0;">
                <div style="font-weight:bold;">${r.employeeName}</div>
                <div style="font-size:.75rem; color:var(--mut);">${r.weekRange} · ${r.days} дн. / ${r.totalHours?.toFixed(1) || '?'} ч</div>
                ${dedBadge}
            </div>
            <div style="text-align:right;">
                <div style="font-weight:bold; color:var(--teal); font-size:1.1rem; font-family:var(--mono);">
                    ${Math.round(amount).toLocaleString()} ₽
                </div>
                <button class="btn-sm teal" style="margin-top:6px; padding:8px 16px; min-height:36px;"
                        onclick="document.getElementById('modalOverlay').classList.remove('active'); 
                                 window.showRequestDetails('${r.id}')">
                    Открыть →
                </button>
            </div>
        </div>
    `;
    }).join('');

    actions.innerHTML = `<button class="btn btn-ghost" id="closeListBtn">Закрыть</button>`;
    modal.classList.add('active');
    document.getElementById('closeListBtn').addEventListener('click', () => modal.classList.remove('active'));
}

// ============================================
// ★ КНОПКА ОТПРАВКИ В BITRIX24
// ============================================
async function sendBitrixReport() {
    const btn = document.getElementById('sendBitrixBtn');
    if (!btn) return;

    const { start, end, weekKey, dates } = getWeekRange(currentSalaryWeek);
    const dateRange = `${formatDateShort(start)} – ${formatDateShort(end)}`;

    if (!confirm(`📤 Отправить отчёт за неделю ${dateRange} в Битрикс24?`)) return;

    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = '⏳ Отправка...';
    btn.style.opacity = '0.6';

    try {
        const docRef = doc(db, 'settings', 'bitrix24');
        const docSnap = await getDoc(docRef);

        if (!docSnap.exists()) {
            showNotification('❌ Настройки Битрикс24 не найдены в Firebase!', true);
            return;
        }

        const webhookData = docSnap.data();
        const webhook = webhookData.webhook;
        const chatId = webhookData.chatId || 'chat1104';

        if (!webhook) {
            showNotification('❌ Вебхук не указан в настройках!', true);
            return;
        }

        const reportData = [];
        let totalSalary = 0;
        let totalEmployees = 0;

        for (const emp of allEmployees) {
            const weekData = getWeekDataForEmployee(emp.id, weekKey, dates);
            if (!weekData.anyData) continue;

            const settings = getEmployeeSettings(emp.id);
            const stats = calculateWeekPay(weekData, settings);
            const hasDed = hasDeduction(emp.id, settings);
            const netValue = hasDed ? stats.total * (1 - DEDUCTION_RATE) : stats.total;

            reportData.push({
                name: emp.name || 'Без имени',
                days: stats.days,
                totalHours: stats.totalHours,
                salary: stats.total,
                net: netValue,
                hasDed
            });

            totalSalary += netValue;
            totalEmployees++;
        }

        if (reportData.length === 0) {
            showNotification('❌ Нет данных для отправки', true);
            return;
        }

        let message = `📊 **ОТЧЁТ ЗА НЕДЕЛЮ ${dateRange}**\n`;
        message += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

        reportData.forEach((emp) => {
            const dedMark = emp.hasDed ? ' (−20%)' : '';
            message += `👤 **${emp.name}**, ${emp.days} дн. / ${emp.totalHours.toFixed(2)} ч, **${Math.round(emp.net).toLocaleString()} ₽**${dedMark}\n`;
        });

        message += `\n━━━━━━━━━━━━━━━━━━━━━\n`;
        message += `📊 **ИТОГО:** ${totalEmployees} сотр. · ${Math.round(totalSalary).toLocaleString()} ₽ (к выплате)`;

        const url = webhook + 'im.message.add.json';
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                DIALOG_ID: chatId,
                MESSAGE: message
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();

        if (result.error) {
            throw new Error(result.error_description || result.error);
        }

        console.log('✅ Отправлено в Битрикс24:', result);
        showNotification(`✅ Отчёт за ${dateRange} отправлен в Битрикс24!`);

    } catch (error) {
        console.error('❌ Ошибка:', error);
        showNotification('❌ Ошибка отправки: ' + error.message, true);
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
        btn.style.opacity = '1';
    }
}

document.getElementById('sendBitrixBtn')?.addEventListener('click', sendBitrixReport);

// ============================================
// ★ ДЕТАЛИ ЗАПРОСА НА ЗП
// ============================================
window.showRequestDetails = function(requestId) {
    const request = Object.values(allRequests).find(r => r.id === requestId);
    if (!request) {
        showNotification('❌ Запрос не найден', true);
        return;
    }
    
    const emp = allEmployees.find(e => e.id === request.employeeId);
    const dates = getWeekDatesUTC(currentSalaryWeek);
    const weekData = getWeekDataForEmployee(request.employeeId, request.weekKey, dates);
    const settings = getEmployeeSettings(request.employeeId);
    const stats = calculateWeekPay(weekData, settings);
    
    const modal = document.getElementById('modalOverlay');
    const body = document.getElementById('modalBody');
    const actions = document.getElementById('modalActions');
    const title = document.getElementById('modalTitle');
    const sub = document.getElementById('modalSub');
    if (!modal || !body) return;
    
    title.textContent = `💰 Запрос на ЗП`;
    sub.textContent = `${request.employeeName} · ${request.weekRange}`;
    
    const grossAfterAdv = Math.max(0, stats.total - (request.advances || 0));
    const hasDed = hasDeduction(request.employeeId, settings);
    const netPay = hasDed ? grossAfterAdv * (1 - DEDUCTION_RATE) : grossAfterAdv;
    
    body.innerHTML = `
        <div style="background:rgba(62,207,168,.1); padding:14px; border-radius:10px; margin-bottom:16px; border:1px solid var(--teal);">
            <div style="color:var(--teal); font-size:.75rem; font-weight:bold; margin-bottom:8px;">
                💰 СОТРУДНИК ЗАПРАШИВАЕТ ЗАРПЛАТУ
            </div>
            <div style="font-size:.7rem; color:var(--mut);">
                Запрос создан: ${new Date(request.createdAt).toLocaleString('ru-RU')}
            </div>
        </div>
        
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:16px;">
            <div style="background:rgba(255,255,255,.05); padding:12px; border-radius:8px; text-align:center;">
                <div style="color:var(--mut); font-size:.7rem;">Дней</div>
                <div style="font-size:1.4rem; font-weight:bold; color:var(--amber2);">${stats.days}</div>
            </div>
            <div style="background:rgba(255,255,255,.05); padding:12px; border-radius:8px; text-align:center;">
                <div style="color:var(--mut); font-size:.7rem;">Часов</div>
                <div style="font-size:1.4rem; font-weight:bold; color:var(--amber2);">${stats.totalHours.toFixed(1)}</div>
            </div>
            <div style="background:rgba(255,255,255,.05); padding:12px; border-radius:8px; text-align:center;">
                <div style="color:var(--mut); font-size:.7rem;">Переработка</div>
                <div style="font-size:1.4rem; font-weight:bold; color:${stats.ot > 0 ? 'var(--amber)' : 'var(--mut)'};">${stats.ot > 0 ? stats.ot.toFixed(1) + 'ч' : '—'}</div>
            </div>
            <div style="background:rgba(255,181,46,.1); padding:12px; border-radius:8px; text-align:center; border:1px solid var(--amber);">
                <div style="color:var(--mut); font-size:.7rem;">ЗП (до вычета)</div>
                <div style="font-size:1.6rem; font-weight:bold; color:var(--amber);">${stats.total.toLocaleString()} ₽</div>
            </div>
        </div>
        
        ${stats.sundayBonus > 0 ? `
            <div style="background:rgba(255,181,46,.15); padding:10px; border-radius:8px; margin-bottom:12px; border:1px dashed var(--amber); text-align:center;">
                <span style="color:var(--mut); font-size:.75rem;">🌟 Надбавка за воскресенье:</span>
                <span style="color:var(--amber); font-weight:bold; margin-left:8px;">+${stats.sundayBonus.toLocaleString()} ₽</span>
            </div>
        ` : ''}
        
        ${request.advances > 0 ? `
            <div style="background:rgba(229,72,77,.1); padding:10px; border-radius:8px; margin-bottom:12px; border:1px solid var(--red); text-align:center;">
                <span style="color:var(--mut); font-size:.75rem;">💳 Активных авансов:</span>
                <span style="color:var(--red); font-weight:bold; margin-left:8px;">−${request.advances.toLocaleString()} ₽</span>
                <div style="font-size:.65rem; color:var(--mut); margin-top:4px;">(вычитается из суммы к выплате)</div>
            </div>
        ` : ''}

        ${hasDed ? `
            <div style="background:rgba(62,207,168,.12); padding:10px; border-radius:8px; margin-bottom:12px; border:1px dashed var(--teal); text-align:center;">
                <span style="color:var(--teal); font-size:.75rem; font-weight:600;">💰 Вычет −20% применён</span>
            </div>
        ` : ''}
        
        <div style="background:rgba(62,207,168,.15); padding:14px; border-radius:10px; border:2px solid var(--teal); text-align:center;">
            <div style="color:var(--mut); font-size:.75rem; margin-bottom:4px;">К ВЫПЛАТЕ</div>
            <div style="font-size:2rem; font-weight:bold; color:var(--teal);">${Math.round(netPay).toLocaleString()} ₽</div>
        </div>
        
        <div style="border-top:1px solid var(--line); padding-top:12px; margin-top:16px;">
            <div style="color:var(--mut); font-size:.7rem; margin-bottom:8px;">По дням:</div>
            <div style="display:grid; grid-template-columns:repeat(7,1fr); gap:4px;">
                ${['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map((d, i) => {
                    const src = weekData.daySource[i];
                    const color = src === 'admin' ? 'var(--amber)' : src === 'attendance' ? 'var(--teal)' : 'var(--line)';
                    const bg = src === 'admin' ? 'rgba(255,181,46,.15)' : src === 'attendance' ? 'rgba(62,207,168,.15)' : 'rgba(255,255,255,.05)';
                    const icon = src === 'admin' ? '🔒' : src === 'attendance' ? '📌' : '';
                    return `
                        <div style="text-align:center; padding:6px 2px; border-radius:6px; background:${bg}; border:1px solid ${color};">
                            <div style="font-size:.55rem; color:var(--mut);">${d} ${icon}</div>
                            <div style="font-weight:bold; font-size:.85rem;">${weekData.hours[i]}ч</div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
    
    actions.innerHTML = `
        <button class="btn btn-amber" id="markPaidBtn" style="background:var(--teal); color:#0c1520; font-weight:bold;">
            ✅ Оплачено
        </button>
        <button class="btn btn-ghost" id="closeRequestBtn">Закрыть</button>
    `;
    
    modal.classList.add('active');
    
    document.getElementById('markPaidBtn').addEventListener('click', async () => {
        if (!confirm(`✅ Подтвердить выплату ${Math.round(netPay).toLocaleString()} ₽ сотруднику ${request.employeeName}?`)) return;
        
        try {
            await updateDoc(doc(db, 'salaryRequests', requestId), {
                status: 'paid',
                paidAt: new Date().toISOString(),
                paidBy: currentUser?.email || 'admin',
                paidAmount: Math.round(netPay)
            });
            
            modal.classList.remove('active');
            showNotification(`✅ Выплата ${request.employeeName} подтверждена!`);
            
            if (typeof renderSalary === 'function') renderSalary();
            if (typeof renderRequestsBanner === 'function') renderRequestsBanner();
        } catch (error) {
            showNotification('❌ Ошибка: ' + error.message, true);
        }
    });
    
    document.getElementById('closeRequestBtn').addEventListener('click', () => modal.classList.remove('active'));
};

console.log('✅ Админ-панель загружена');
