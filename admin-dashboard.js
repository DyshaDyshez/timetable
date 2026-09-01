// admin-dashboard.js
// Полностью переписан с поддержкой всех отметок за день и расчётом часов
// + АВТОСОЗДАНИЕ ДАННЫХ ИЗ ОТМЕТОК (ЕСЛИ НЕТ В salaryWeeks)
// + ПРОСТАЯ ПЕРЕМЕННАЯ ДЛЯ ФИКСИРОВАННОЙ ЗП
// + КНОПКА ОТПРАВКИ В BITRIX24

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
// ПРОСТАЯ ПЕРЕМЕННАЯ ДЛЯ ФИКСИРОВАННОЙ ЗП
// ============================================
window.FIXED_SALARY = window.FIXED_SALARY || {};

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
// ЗАПУСК СЛУШАТЕЛЕЙ (onSnapshot)
// ============================================
function startListening() {
    console.log('🔄 Запуск прослушивания Firebase...');

    onSnapshot(collection(db, 'salaryEmployees'), (snapshot) => {
        allEmployees = [];
        snapshot.forEach(doc => allEmployees.push({ id: doc.id, ...doc.data() }));
        allEmployees.sort((a, b) => a.name?.localeCompare(b.name) || 0);
        console.log('👤 Сотрудники обновлены:', allEmployees.length);
        window.__allEmployees = allEmployees;
        renderAll();
    }, (error) => {
        console.error('Ошибка загрузки сотрудников:', error);
        showNotification('❌ Ошибка загрузки сотрудников: ' + error.message, true);
    });

    onSnapshot(collection(db, 'salaryWeeks'), (snapshot) => {
        allWeeks = {};
        snapshot.forEach(doc => {
            const data = doc.data();
            const key = data.employeeId + '_' + data.weekKey;
            allWeeks[key] = { id: doc.id, ...data };
        });
        console.log('📅 Недели обновлены:', Object.keys(allWeeks).length);
        window.__allWeeks = allWeeks;
        renderAll();
    }, (error) => {
        console.error('Ошибка загрузки недель:', error);
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
        console.log('📋 Посещаемость обновлена:', snapshot.size, 'записей');
        console.log('📋 allAttendance keys:', Object.keys(allAttendance));
        window.__allAttendance = allAttendance;
        renderAll();
    }, (error) => {
        console.error('Ошибка загрузки посещаемости:', error);
        showNotification('❌ Ошибка загрузки посещаемости: ' + error.message, true);
    });

    onSnapshot(collection(db, 'salarySettings'), (snapshot) => {
        allSettings = {};
        snapshot.forEach(doc => {
            allSettings[doc.id] = { id: doc.id, ...doc.data() };
        });
        console.log('⚙️ Настройки обновлены:', Object.keys(allSettings).length);
        window.__allSettings = allSettings;
        renderAll();
    }, (error) => {
        console.error('Ошибка загрузки настроек:', error);
    });
}

// ============================================
// ОБЩИЙ РЕНДЕР
// ============================================
function renderAll() {
    if (allEmployees.length === 0) {
        const attContainer = document.getElementById('attendanceContent');
        if (attContainer) {
            attContainer.innerHTML = `<div class="loading">⏳ Ожидание данных о сотрудниках...</div>`;
        }
        return;
    }
    renderSalary();
    if (Object.keys(allAttendance).length > 0) {
        renderAttendance();
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
// РАСЧЁТ НЕДЕЛИ
// ============================================
function getWeekKey(date) {
    const d = new Date(date);
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const y = d.getUTCFullYear();
    const week = Math.ceil(((d - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7);
    return `${y}-W${String(week).padStart(2, '0')}`;
}

function getWeekDates(offset) {
    const today = new Date();
    const dayOfWeek = today.getDay();
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
// РАСЧЁТ ОТРАБОТАННЫХ ЧАСОВ ИЗ ОТМЕТОК (ИСПРАВЛЕННЫЙ!)
// ============================================

function calculateDayHoursFromLogs(logs) {
    if (!logs || logs.length === 0) return { totalMinutes: 0, totalHours: '0ч 0м', totalHoursDecimal: 0, segments: [] };
    
    const sorted = [...logs].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const segments = [];
    let totalMinutes = 0;
    const now = new Date();
    
    for (let i = 0; i < sorted.length; i++) {
        const current = sorted[i];
        
        if (current.type === 'in') {
            const startTime = new Date(current.timestamp);
            let endTime;
            let isOpen = false;
            
            let nextOut = null;
            for (let j = i + 1; j < sorted.length; j++) {
                if (sorted[j].type === 'out') {
                    nextOut = sorted[j];
                    break;
                }
            }
            
            if (nextOut) {
                endTime = new Date(nextOut.timestamp);
                isOpen = false;
            } else {
                endTime = now;
                isOpen = true;
            }
            
            const diffMs = endTime - startTime;
            const diffMinutes = Math.floor(diffMs / (1000 * 60));
            
            if (diffMinutes > 0) {
                segments.push({
                    start: startTime,
                    end: endTime,
                    minutes: diffMinutes,
                    isOpen: isOpen
                });
                totalMinutes += diffMinutes;
            }
        }
    }
    
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    
    return {
        totalMinutes: totalMinutes,
        totalHours: `${hours}ч ${minutes}м`,
        totalHoursDecimal: Math.round((totalMinutes / 60) * 100) / 100,
        segments: segments
    };
}

// ============================================
// СОЗДАНИЕ ДАННЫХ ИЗ ОТМЕТОК
// ============================================

function buildDataFromAttendanceForAdmin(employeeId) {
    const dates = getWeekDates(currentSalaryWeek);
    const workDays = [false, false, false, false, false, false, false];
    const hours = [0, 0, 0, 0, 0, 0, 0];
    const workStart = ['', '', '', '', '', '', ''];
    const workEnd = ['', '', '', '', '', '', ''];
    let hasAnyData = false;
    
    dates.forEach((dateObj, index) => {
        const dateStr = dateObj.toISOString().slice(0, 10);
        const key = employeeId + '_' + dateStr;
        const logs = allAttendance[key] || [];
        
        if (logs.length > 0) {
            hasAnyData = true;
            workDays[index] = true;
            
            const dayInfo = calculateDayHoursFromLogs(logs);
            
            const sorted = [...logs].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
            const firstIn = sorted.find(l => l.type === 'in');
            const lastOut = [...sorted].reverse().find(l => l.type === 'out');
            
            if (firstIn) {
                const time = new Date(firstIn.timestamp);
                workStart[index] = time.toTimeString().slice(0, 5);
            }
            if (lastOut && lastOut.timestamp > firstIn?.timestamp) {
                const time = new Date(lastOut.timestamp);
                workEnd[index] = time.toTimeString().slice(0, 5);
            } else if (firstIn) {
                const now = new Date();
                workEnd[index] = now.toTimeString().slice(0, 5);
            }
            
            hours[index] = dayInfo.totalHoursDecimal;
        }
    });
    
    return {
        workDays: workDays,
        hours: hours,
        workStart: workStart,
        workEnd: workEnd,
        isPaid: false,
        fromAttendance: true
    };
}

// ============================================
// ФОРМАТИРОВАНИЕ ВРЕМЕНИ
// ============================================
function formatTime(date) {
    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function getDayName(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('ru-RU', { weekday: 'short' });
}

function getDayMonth(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
}

function isToday(dateStr) {
    const today = new Date().toISOString().slice(0, 10);
    return dateStr === today;
}

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

// ============================================
// РЕНДЕР ЗАРПЛАТЫ (С ПРОСТОЙ ПЕРЕМЕННОЙ ДЛЯ ЗП)
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
            const attData = buildDataFromAttendanceForAdmin(emp.id);
            const hasAttendance = attData.workDays.some(d => d === true);
            if (hasAttendance) {
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
        const stats = calculateWeekPay(weekData, settings);
        const isPaid = weekData.isPaid || false;
        
        // ===== ОСНОВНАЯ ЛОГИКА ЗП =====
        // 1. Берём рассчитанную ЗП
        let displaySalary = stats.total;
        let displayHours = stats.totalHours;
        let displayDays = stats.days;
        let displayOt = stats.ot;
        
        // 2. Если есть фиксированная ЗП — используем её
        const fixedKey = emp.id + '_' + weekKey;
        if (window.FIXED_SALARY && window.FIXED_SALARY[fixedKey] !== undefined) {
            displaySalary = window.FIXED_SALARY[fixedKey];
            fromAttendance = true;
            
            // Дополнительные параметры (если зафиксированы)
            if (window.FIXED_SALARY[fixedKey + '_hours'] !== undefined) {
                displayHours = window.FIXED_SALARY[fixedKey + '_hours'];
            }
            if (window.FIXED_SALARY[fixedKey + '_days'] !== undefined) {
                displayDays = window.FIXED_SALARY[fixedKey + '_days'];
            }
            if (window.FIXED_SALARY[fixedKey + '_ot'] !== undefined) {
                displayOt = window.FIXED_SALARY[fixedKey + '_ot'];
            }
        }
        
        totalPay += displaySalary;
        totalCount++;
        if (isPaid) paidCount++;

        const sourceIndicator = fromAttendance ? ' 📌' : '';

        html += `<tr>
            <td class="col-employee">${emp.name}${sourceIndicator}</td>
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
    console.log('📅 Рендер посещаемости, неделя:', weekDates);
    console.log('👤 Сотрудников:', allEmployees.length);
    console.log('📋 allAttendance keys:', Object.keys(allAttendance));

    const dayData = [];

    for (const emp of allEmployees) {
        for (const dateStr of weekDates) {
            const key = emp.id + '_' + dateStr;
            const logs = allAttendance[key] || [];
            if (logs.length > 0) {
                const dayInfo = calculateDayHoursFromLogs(logs);
                dayData.push({
                    employeeId: emp.id,
                    employeeName: emp.name || 'Без имени',
                    date: dateStr,
                    logs: logs,
                    totalMinutes: dayInfo.totalMinutes,
                    totalHours: dayInfo.totalHours,
                    totalHoursDecimal: dayInfo.totalHoursDecimal,
                    segments: dayInfo.segments
                });
                console.log(`✅ ${emp.name} (${dateStr}): ${logs.length} отметок, часов: ${dayInfo.totalHours}`);
            }
        }
    }

    dayData.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return a.employeeName.localeCompare(b.employeeName);
    });

    console.log('📋 Всего записей для отображения:', dayData.length);

    if (dayData.length === 0) {
        let debugInfo = '';
        for (const key of Object.keys(allAttendance)) {
            const [empId, date] = key.split('_');
            const emp = allEmployees.find(e => e.id === empId);
            const empName = emp ? emp.name : '❌ НЕИЗВЕСТНЫЙ';
            debugInfo += `<div>📌 ${key} → ${empName}</div>`;
        }
        
        container.innerHTML = `
            <div class="no-data">
                <div style="font-size:3rem;margin-bottom:12px;">📭</div>
                <div>Нет отметок за эту неделю</div>
                <div style="font-size:.7rem;color:var(--mut);margin-top:6px;">
                    Неделя: ${weekDates[0]} — ${weekDates[6]}
                </div>
                <div style="font-size:.7rem;color:var(--mut);margin-top:4px;">
                    Всего сотрудников: ${allEmployees.length}
                </div>
                <div style="font-size:.7rem;color:var(--mut);margin-top:4px;">
                    Всего отметок в БД: ${Object.keys(allAttendance).length} уникальных дат
                </div>
                ${debugInfo ? `<div style="font-size:.7rem;color:var(--mut);margin-top:8px;border-top:1px solid var(--line);padding-top:8px;text-align:left;">
                    <b>Отладочная информация:</b><br>${debugInfo}
                </div>` : ''}
                <button onclick="window.debugAttendance()" style="margin-top:12px; background:var(--amber); color:#241d10; border:none; padding:8px 20px; border-radius:8px; cursor:pointer; font-weight:bold;">
                    🐞 Отладка в консоли
                </button>
                <button onclick="location.reload()" style="margin-top:8px; background:var(--teal); color:#0c1520; border:none; padding:8px 20px; border-radius:8px; cursor:pointer; font-weight:bold; margin-left:8px;">
                    🔄 Перезагрузить
                </button>
            </div>
        `;
        return;
    }

    const grouped = {};
    for (const data of dayData) {
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
            for (const log of item.logs) {
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

            let segmentsHtml = '';
            if (item.segments && item.segments.length > 0) {
                segmentsHtml = item.segments.map((seg) => {
                    const startStr = formatTime(seg.start);
                    const endStr = seg.isOpen ? '... (сейчас)' : formatTime(seg.end);
                    const hours = Math.floor(seg.minutes / 60);
                    const mins = seg.minutes % 60;
                    return `<span class="segment">${startStr} → ${endStr} <span class="segment-time">${hours}ч ${mins}м</span></span>`;
                }).join(' ');
            }

            const totalHours = item.totalHours;
            const totalMinutes = item.totalMinutes;

            html += `
                <div class="attendance-row">
                    <span class="emp-name">${item.employeeName}</span>
                    <div class="time-group">
                        ${logsHtml}
                    </div>
                    <div class="day-total">
                        <span class="total-badge ${totalMinutes > 0 ? 'has-time' : ''}">
                            📊 ${totalHours}
                            ${totalMinutes > 0 ? `<span class="total-decimal">(${item.totalHoursDecimal.toFixed(2)} ч)</span>` : ''}
                        </span>
                    </div>
                    ${totalMinutes > 0 && segmentsHtml ? `
                        <div class="segments-info">
                            ${segmentsHtml}
                        </div>
                    ` : ''}
                    <div class="actions">
                        <button class="btn-sm red" onclick="window.deleteDayAttendance('${item.employeeId}', '${item.date}')" title="Удалить все отметки за день">🗑️ День</button>
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
            showNotification('❌ Ошибка: ' + error.message, true);
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
    const stats = calculateWeekPay(weekData, settings);
    const modal = document.getElementById('modalOverlay');
    const body = document.getElementById('modalBody');
    const actions = document.getElementById('modalActions');
    const title = document.getElementById('modalTitle');
    const sub = document.getElementById('modalSub');
    if (!modal || !body) return;
    title.textContent = `📊 ${emp?.name || 'Сотрудник'}`;
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
                <div style="color:var(--mut);font-size:.7rem;">Итого</div>
                <div style="font-size:1.6rem;font-weight:bold;color:var(--amber);">${stats.total.toLocaleString()} ₽</div>
            </div>
        </div>
        <div style="font-size:.75rem;color:var(--mut);border-top:1px solid var(--line);padding-top:12px;">
            Базовая: ${stats.payBase.toLocaleString()} ₽ · Повышенная: ${stats.payExtra.toLocaleString()} ₽ · Переработка: ${(stats.payOt1 + stats.payOt2).toLocaleString()} ₽
        </div>
    `;
    actions.innerHTML = `<button class="btn btn-ghost" id="modalCancelBtn">Закрыть</button>`;
    modal.classList.add('active');
    document.getElementById('modalCancelBtn').addEventListener('click', () => modal.classList.remove('active'));
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
// УДАЛЕНИЕ ВСЕХ ОТМЕТОК ЗА ДЕНЬ
// ============================================
window.deleteDayAttendance = async function(employeeId, date) {
    if (!confirm(`🗑️ Удалить все отметки для сотрудника за ${date}?`)) return;
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
        showNotification(`🗑️ Удалено ${deleted} отметок за ${date}`);
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
// ОТЛАДКА В КОНСОЛИ
// ============================================
window.debugAttendance = function() {
    console.log('=== ОТЛАДКА ПОСЕЩАЕМОСТИ ===');
    console.log('allEmployees:', allEmployees.map(e => ({ id: e.id, name: e.name })));
    console.log('allAttendance keys:', Object.keys(allAttendance));
    console.log('Текущая неделя (offset', currentAttWeek, '):', getWeekDates(currentAttWeek).map(d => d.toISOString().slice(0, 10)));
    console.log('Проверка совпадений:');
    const weekDates = getWeekDates(currentAttWeek).map(d => d.toISOString().slice(0, 10));
    for (const emp of allEmployees) {
        for (const date of weekDates) {
            const key = emp.id + '_' + date;
            const logs = allAttendance[key] || [];
            if (logs.length > 0) {
                console.log(`✅ ${emp.name} (${date}): ${logs.length} отметок`);
                logs.forEach(l => console.log(`   ${l.type} ${l.timestamp}`));
            }
        }
    }
    console.log('=== КОНЕЦ ОТЛАДКИ ===');
};

// ============================================
// ===== КНОПКА ОТПРАВКИ В BITRIX24 =====
// ============================================

document.getElementById('sendBitrixBtn')?.addEventListener('click', async function() {
    const btn = this;
    const { start, end, weekKey } = getWeekRange(currentSalaryWeek);
    const dateRange = `${formatDateShort(start)} – ${formatDateShort(end)}`;
    
    if (!confirm(`📤 Отправить отчёт за неделю ${dateRange} в Битрикс24?`)) return;
    
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = '⏳ Отправка...';
    btn.style.opacity = '0.6';
    btn.style.cursor = 'not-allowed';
    
    try {
        const docRef = doc(db, 'settings', 'bitrix24');
        const docSnap = await getDoc(docRef);
        
        if (!docSnap.exists()) {
            showNotification('❌ Настройки Битрикс24 не найдены! Сохраните вебхук в Firebase.', true);
            return;
        }
        
        const webhookData = docSnap.data();
        const webhook = webhookData.webhook;
        const chatId = webhookData.chatId || 'chat1104';
        
        if (!webhook) {
            showNotification('❌ Вебхук не указан в настройках!', true);
            return;
        }
        
        console.log('📤 Отправка в Битрикс24...');
        console.log('📌 Чат:', chatId);
        
        const reportData = [];
        let totalSalary = 0;
        let totalDebt = 0;
        let totalEmployees = 0;
        
        for (const emp of allEmployees) {
            let weekData = allWeeks[emp.id + '_' + weekKey];
            let fromAttendance = false;
            
            if (!weekData) {
                const attData = buildDataFromAttendanceForAdmin(emp.id);
                const hasAttendance = attData.workDays.some(d => d === true);
                if (hasAttendance) {
                    weekData = attData;
                    fromAttendance = true;
                }
            }
            
            if (!weekData) continue;
            
            const settings = getEmployeeSettings(emp.id);
            const stats = calculateWeekPay(weekData, settings);
            
            let displaySalary = stats.total;
            let displayHours = stats.totalHours;
            let displayDays = stats.days;
            let displayOt = stats.ot;
            
            const fixedKey = emp.id + '_' + weekKey;
            if (window.FIXED_SALARY && window.FIXED_SALARY[fixedKey] !== undefined) {
                displaySalary = window.FIXED_SALARY[fixedKey];
                fromAttendance = true;
                if (window.FIXED_SALARY[fixedKey + '_hours'] !== undefined) {
                    displayHours = window.FIXED_SALARY[fixedKey + '_hours'];
                }
                if (window.FIXED_SALARY[fixedKey + '_days'] !== undefined) {
                    displayDays = window.FIXED_SALARY[fixedKey + '_days'];
                }
                if (window.FIXED_SALARY[fixedKey + '_ot'] !== undefined) {
                    displayOt = window.FIXED_SALARY[fixedKey + '_ot'];
                }
            }
            
            const advancesRef = collection(db, 'salaryAdvances');
            const q = query(advancesRef, where('employeeId', '==', emp.id));
            const snapshot = await getDocs(q);
            const advances = [];
            snapshot.forEach((doc) => advances.push(doc.data()));
            const activeAdvances = advances.filter(a => a.status === 'active');
            const totalDebtEmp = activeAdvances.reduce((sum, a) => sum + a.amount, 0);
            
            reportData.push({
                name: emp.name || 'Без имени',
                weekRange: dateRange,
                days: displayDays,
                totalHours: displayHours,
                overtime: displayOt,
                salary: displaySalary,
                debt: totalDebtEmp,
                fromAttendance: fromAttendance
            });
            
            totalSalary += displaySalary;
            totalDebt += totalDebtEmp;
            totalEmployees++;
        }
        
        if (reportData.length === 0) {
            showNotification('❌ Нет данных для отправки', true);
            return;
        }
        
        let message = `📊 **ОТЧЁТ ЗА НЕДЕЛЮ**\n`;
        message += `📅 ${dateRange}\n`;
        message += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
        
        reportData.forEach((emp, index) => {
            const sourceLabel = emp.fromAttendance ? ' (из отметок)' : '';
            message += `👤 **${emp.name}**${sourceLabel}\n`;
            message += `• Дней: ${emp.days}\n`;
            message += `• Часов: ${emp.totalHours.toFixed(2)} ч\n`;
            if (emp.overtime > 0) {
                message += `• Переработка: ${emp.overtime.toFixed(2)} ч\n`;
            }
            message += `• Зарплата: ${emp.salary.toLocaleString()} ₽\n`;
            if (emp.debt > 0) {
                message += `• Долг: ${emp.debt.toLocaleString()} ₽\n`;
            }
            if (index < reportData.length - 1) {
                message += `\n`;
            }
        });
        
        message += `\n━━━━━━━━━━━━━━━━━━━━━\n`;
        message += `📊 **ИТОГО:**\n`;
        message += `• Сотрудников: ${totalEmployees}\n`;
        message += `• Общая зарплата: ${totalSalary.toLocaleString()} ₽\n`;
        if (totalDebt > 0) {
            message += `• Общий долг: ${totalDebt.toLocaleString()} ₽\n`;
        }
        message += `\n🔗 Отчёт сгенерирован автоматически`;
        
        const url = webhook + 'im.message.add';
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
        console.log('✅ Отправлено в Битрикс24:', result);
        
        showNotification(`✅ Отчёт за ${dateRange} отправлен в Битрикс24! (${reportData.length} сотрудников)`);
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
        showNotification('❌ Ошибка отправки: ' + error.message, true);
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
    }
});

// ============================================
// ПОДСКАЗКА ПО ИСПОЛЬЗОВАНИЮ FIXED_SALARY
// ============================================
console.log('✅ Админ-панель с дневным табелем и автосозданием из отметок загружена');
console.log('📌 Для фиксации ЗП используйте:');
console.log('  window.FIXED_SALARY["ID_сотрудника_неделя"] = СУММА;');
console.log('  window.FIXED_SALARY["ID_сотрудника_неделя_hours"] = ЧАСЫ;');
console.log('  window.FIXED_SALARY["ID_сотрудника_неделя_days"] = ДНИ;');
console.log('  window.FIXED_SALARY["ID_сотрудника_неделя_ot"] = ПЕРЕРАБОТКА;');
console.log('  renderSalary();');
console.log('📌 Пример для Андрея:');
console.log('  window.FIXED_SALARY["nbBjsOTTSRIO6aBsslAN_2026-W36"] = 4372;');
console.log('  window.FIXED_SALARY["nbBjsOTTSRIO6aBsslAN_2026-W36_hours"] = 11.43;');
console.log('  window.FIXED_SALARY["nbBjsOTTSRIO6aBsslAN_2026-W36_days"] = 1;');
console.log('  window.FIXED_SALARY["nbBjsOTTSRIO6aBsslAN_2026-W36_ot"] = 3.43;');
console.log('  renderSalary();');