// employee-view.js
// Просмотр зарплаты сотрудником (только чтение).
//
// ЛОГИКА (совпадает с admin-dashboard.js):
// - Для каждого дня отдельно:
//     • adminEditedDays[i] === true → данные админа (в т.ч. 0ч = отмена дня)
//     • иначе → данные из отметок
// - Ничего в БД НЕ записываем.

import { calculateWeekPay } from './modules/calculator.js';
import { calculateDayHoursFromLogs } from './modules/attendance.js';

const { db, doc, getDoc, collection, query, where, getDocs } = window;

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

// ============================================
// СОСТОЯНИЕ
// ============================================
let currentWeekOffset = 0;
let currentData = null;
let employeeName = 'Сотрудник';
let allAttendance = {};  // ключ 'YYYY-MM-DD' → [logs]
let settings = { rDay: 3000, rExtra: 3500, rOt1: 400, rOt2: 800, otLimit: 5, hpd: 8 };

const DAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

// ============================================
// УТИЛИТЫ
// ============================================
function getUTCDateStr(date) { return new Date(date).toISOString().slice(0, 10); }

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

function formatDateDisplay(d) {
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
}
function formatDateFull(d) {
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' });
}
function formatHours(h) {
    return Number(h).toFixed(2).replace('.', ',');
}

// ============================================
// ЗАГРУЗКА
// ============================================
async function loadEmployeeInfo() {
    try {
        const d = await getDoc(doc(db, 'salaryEmployees', EMPLOYEE_ID));
        if (d.exists()) {
            const data = d.data();
            employeeName = data.name || 'Сотрудник';
            const badge = document.getElementById('userBadge');
            const nameEl = document.getElementById('userName');
            const avatarEl = document.getElementById('userAvatar');
            const idLabelEl = document.getElementById('userIdLabel');
            if (badge) { badge.style.display = 'flex'; badge.title = `ID: ${EMPLOYEE_ID}`; }
            if (nameEl) nameEl.textContent = employeeName;
            if (avatarEl) avatarEl.textContent = employeeName.charAt(0).toUpperCase();
            if (idLabelEl) idLabelEl.textContent = `ID: ${EMPLOYEE_ID.substring(0, 8)}...`;
        }
    } catch (e) { console.warn(e); }
}

async function loadSettings() {
    try {
        const d = await getDoc(doc(db, 'salarySettings', EMPLOYEE_ID));
        if (d.exists()) {
            const data = d.data();
            settings = {
                rDay: data.rDay || 3000,
                rExtra: data.rExtra || 3500,
                rOt1: data.rOt1 || 400,
                rOt2: data.rOt2 || 800,
                otLimit: data.otLimit || 5,
                hpd: data.hpd || 8,
                // ★ НОВЫЕ ПОЛЯ
                sundayBonusEnabled: data.sundayBonusEnabled === true,
                sundayBonusAmount: data.sundayBonusAmount || 1000
            };
        }
        const ids = ['rDay','rExtra','rOt1','rOt2','otLimit'];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = settings[id];
        });
    } catch (e) { console.warn(e); }
}

async function loadAttendance() {
    try {
        const q = query(collection(db, 'attendance'), where('employeeId', '==', EMPLOYEE_ID));
        const snap = await getDocs(q);
        allAttendance = {};
        snap.forEach(d => {
            const data = d.data();
            const date = data.date || 'unknown';
            if (!allAttendance[date]) allAttendance[date] = [];
            allAttendance[date].push({ id: d.id, ...data });
        });
        console.log('📋 Загружено отметок:', snap.size);
    } catch (e) {
        console.error(e);
        allAttendance = {};
    }
}

async function loadWeekFromDB(weekKey) {
    try {
        const d = await getDoc(doc(db, 'salaryWeeks', `${EMPLOYEE_ID}_${weekKey}`));
        if (!d.exists()) return null;
        return { id: d.id, ...d.data() };
    } catch (e) { return null; }
}

// ============================================
// ★ ГЛАВНАЯ: смешивание по дням
// ============================================
async function getWeekData(weekKey, weekDates) {
    const dbWeek = await loadWeekFromDB(weekKey);

    const adminEditedDays = dbWeek?.adminEditedDays || null;
    const adminHours = dbWeek?.hours || null;
    const adminWorkDays = dbWeek?.workDays || null;
    const adminWorkStart = dbWeek?.workStart || null;
    const adminWorkEnd = dbWeek?.workEnd || null;

    const workDays = [false, false, false, false, false, false, false];
    const hours = [0, 0, 0, 0, 0, 0, 0];
    const workStart = ['', '', '', '', '', '', ''];
    const workEnd = ['', '', '', '', '', '', ''];
    const daySource = ['empty', 'empty', 'empty', 'empty', 'empty', 'empty', 'empty'];

    let anyData = false;

    weekDates.forEach((dateObj, i) => {
        const dateStr = getUTCDateStr(dateObj);
        const logs = allAttendance[dateStr] || [];

        // 1. Админ правил этот день?
        if (adminEditedDays && adminEditedDays[i] === true) {
            const h = Number(adminHours?.[i]) || 0;
            workDays[i] = h > 0;
            hours[i] = h;
            workStart[i] = adminWorkStart?.[i] || '';
            workEnd[i] = adminWorkEnd?.[i] || '';
            daySource[i] = 'admin';
            anyData = true;
            return;
        }

        // 2. Из отметок
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
    if (daySource.includes('admin')) source = 'admin';
    else if (daySource.includes('attendance')) source = 'attendance';

    return { workDays, hours, workStart, workEnd, daySource, source, anyData };
}

// ============================================
// UI
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
        b.disabled = true;
        b.style.cursor = 'default';
        b.style.opacity = '0.6';
        daysBox.appendChild(b);
    });

    const timeGroup = document.getElementById('dayTimeGroup');
    timeGroup.innerHTML = '';
    DAY_NAMES.forEach((n, i) => {
        const div = document.createElement('div');
        div.className = 'day-time-item';
        div.innerHTML = `
            <span class="day-label">${n}</span>
            <input type="time" class="time-start" disabled>
            <input type="time" class="time-end" disabled>
            <span class="time-hours">⏱ <strong>0</strong> ч</span>
            <span class="time-from-attendance" style="font-size:.45rem;color:var(--teal);font-family:var(--mono);margin-top:1px;display:none;"></span>
        `;
        timeGroup.appendChild(div);
    });
}

function updateWeekLabel(dates) {
    const mon = dates[0], sun = dates[6];
    const weekKey = getWeekKeyUTC(mon);
    const todayWeek = getWeekKeyUTC(new Date());
    const isCurrent = weekKey === todayWeek;
    document.getElementById('weekRange').textContent = `${formatDateDisplay(mon)} – ${formatDateDisplay(sun)}`;
    document.getElementById('weekSub').textContent = isCurrent ? 'текущая неделя' : weekKey;
}

function updateTimeInputs() {
    if (!currentData) return;
    const { workDays, hours, workStart, workEnd, daySource } = currentData;
    const items = document.querySelectorAll('.day-time-item');
    const dates = getWeekDatesUTC(currentWeekOffset);

    items.forEach((item, i) => {
        const startInput = item.querySelector('.time-start');
        const endInput = item.querySelector('.time-end');
        const hoursDisplay = item.querySelector('.time-hours strong');
        const attDisplay = item.querySelector('.time-from-attendance');

        item.classList.remove('work-day', 'extra-day');
        attDisplay.style.display = 'none';
        attDisplay.textContent = '';

        const dateStr = getUTCDateStr(dates[i]);
        const attLogs = allAttendance[dateStr] || [];

        // Показываем отметки, если они есть — всегда
        if (attLogs.length > 0) {
            const sorted = [...attLogs].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
            const times = sorted.map(l => {
                const t = new Date(l.timestamp);
                const icon = l.type === 'in' ? '✅' : '🚪';
                const label = l.type === 'in' ? 'пришёл' : 'ушёл';
                return `${icon} ${t.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} (${label})`;
            });
            attDisplay.textContent = `📌 ${times.join(' → ')}`;
            attDisplay.style.display = 'block';
            attDisplay.style.color = 'var(--teal)';
        }

        const isWorkDay = workDays[i] === true;
        const plannedHrs = Number(hours[i]) || 0;

        if (isWorkDay && plannedHrs > 0) {
            startInput.value = workStart[i] || '';
            endInput.value = workEnd[i] || '';
            hoursDisplay.textContent = formatHours(plannedHrs);

            if (daySource[i] === 'admin' && !attDisplay.textContent) {
                attDisplay.textContent = '🔒 правка администратора';
                attDisplay.style.display = 'block';
                attDisplay.style.color = 'var(--amber)';
            } else if (daySource[i] === 'attendance' && !attDisplay.textContent) {
                attDisplay.textContent = '📊 из отметок';
                attDisplay.style.display = 'block';
                attDisplay.style.color = 'var(--teal)';
            }

            const dayIndex = workDays.slice(0, i).filter(Boolean).length;
            item.classList.add('work-day');
            if (dayIndex > 5) item.classList.add('extra-day');
        } else {
            startInput.value = '';
            endInput.value = '';
            hoursDisplay.textContent = '0';
            if (daySource[i] === 'admin') {
                attDisplay.textContent = '🔒 отменён админом';
                attDisplay.style.display = 'block';
                attDisplay.style.color = 'var(--amber)';
            } else if (!attDisplay.textContent) {
                attDisplay.textContent = '🚫 выходной';
                attDisplay.style.display = 'block';
                attDisplay.style.color = 'var(--mut)';
            }
        }
    });
}

function update() {
    if (!currentData) return;
    const dates = getWeekDatesUTC(currentWeekOffset);
    const weekKey = getWeekKeyUTC(dates[0]);

    console.log('════════ ОТЛАДКА update() ════════');
    console.log('weekKey:', weekKey);
    console.log('source:', currentData.source);
    console.log('workDays:', JSON.stringify(currentData.workDays));
    console.log('hours:', JSON.stringify(currentData.hours));
    console.log('daySource:', JSON.stringify(currentData.daySource));
    console.log('settings:', JSON.stringify(settings));

    const stats = calculateWeekPay(currentData, settings);
    console.log('stats:', JSON.stringify(stats));
    console.log('══════════════════════════════════');

    const { days, totalHours, norm, ot, ot1, ot2, payBase, payExtra, payOt1, payOt2, total } = stats;

    document.querySelectorAll('#days .day').forEach((b, i) => {
        const on = currentData.workDays[i];
        b.classList.toggle('on', on);
        const dayIndex = currentData.workDays.slice(0, i).filter(Boolean).length;
        const isExtra = on && dayIndex > 5;
        b.classList.toggle('extra', isExtra);
        const rate = isExtra ? settings.rExtra : settings.rDay;
        b.querySelector('i').textContent = rate.toLocaleString() + ' ₽';
    });

    updateTimeInputs();

    document.getElementById('dOut').textContent = days;
    document.getElementById('normOut').textContent =
        `норма: ${norm.toFixed(1).replace('.', ',')} ч (${days} дн × ${settings.hpd} ч)`;

    const otB = document.getElementById('otBadge');
    const uwB = document.getElementById('uwBadge');
    if (ot > 0) {
        otB.hidden = false;
        otB.textContent = `переработка +${formatHours(ot)} ч`;
        otB.className = 'badge ' + (ot2 > 0 ? 'hot' : 'ot');
    } else otB.hidden = true;
    if (days > 0 && totalHours < norm) {
        uwB.hidden = false;
        uwB.textContent = `меньше нормы на ${formatHours(norm - totalHours)} ч`;
    } else uwB.hidden = true;

    document.getElementById('qBase').textContent =
        `${days} дн × ${settings.rDay.toLocaleString()} ₽ (пропорционально)`;
    document.getElementById('vBase').textContent = payBase.toLocaleString() + ' ₽';

    const rowExtra = document.getElementById('rowExtra');
    const extraDaysCount = Math.max(0, Math.min(2, days - 5));
    if (extraDaysCount === 0) rowExtra.classList.add('gone');
    else {
        rowExtra.classList.remove('gone');
        document.getElementById('qExtra').textContent =
            `${extraDaysCount} дн × ${settings.rExtra.toLocaleString()} ₽`;
        document.getElementById('vExtra').textContent = payExtra.toLocaleString() + ' ₽';
    }

    const rowOt1 = document.getElementById('rowOt1');
    if (ot1 === 0) rowOt1.classList.add('gone');
    else {
        rowOt1.classList.remove('gone');
        document.getElementById('qOt1').textContent =
            `${formatHours(ot1)} ч × ${settings.rOt1.toLocaleString()} ₽`;
        document.getElementById('vOt1').textContent = payOt1.toLocaleString() + ' ₽';
    }

    const rowOt2 = document.getElementById('rowOt2');
    if (ot2 === 0) rowOt2.classList.add('gone');
    else {
        rowOt2.classList.remove('gone');
        document.getElementById('qOt2').textContent =
            `${formatHours(ot2)} ч × ${settings.rOt2.toLocaleString()} ₽`;
        document.getElementById('vOt2').textContent = payOt2.toLocaleString() + ' ₽';
    }

    const scale = Math.max(totalHours, norm, 1);
    document.getElementById('bNorm').style.width = (Math.min(totalHours, norm) / scale * 100) + '%';
    document.getElementById('bOt1').style.width = (ot1 / scale * 100) + '%';
    document.getElementById('bOt2').style.width = (ot2 / scale * 100) + '%';
    document.getElementById('lNorm').textContent = formatHours(Math.min(totalHours, norm)) + ' ч';
    document.getElementById('lOt1').textContent = formatHours(ot1) + ' ч';
    document.getElementById('lOt2').textContent = formatHours(ot2) + ' ч';

    document.getElementById('totalOut').textContent = total.toLocaleString();
    const stamp = document.getElementById('stamp');
    stamp.classList.remove('pop');
    void stamp.offsetWidth;
    stamp.classList.add('pop');

    const parts = [];
    if (payBase > 0) parts.push(`<b class="f-n">${days}×${settings.rDay.toLocaleString()}</b>`);
    if (payExtra > 0) parts.push(`<b class="f-n">${extraDaysCount}×${settings.rExtra.toLocaleString()}</b>`);
    if (ot1 > 0) parts.push(`<b class="f-1">${formatHours(ot1)}×${settings.rOt1.toLocaleString()}</b>`);
    if (ot2 > 0) parts.push(`<b class="f-2">${formatHours(ot2)}×${settings.rOt2.toLocaleString()}</b>`);
    document.getElementById('formula').innerHTML = parts.length
        ? parts.join(' + ') + ` = ${total.toLocaleString()} ₽`
        : '—';

    document.getElementById('metaLine').textContent =
        `отработано ${formatHours(totalHours)} ч · норма ${formatHours(norm)} ч`;

    document.getElementById('chip1').textContent = `1–5 день · ${settings.rDay.toLocaleString()} ₽`;
    document.getElementById('chip2').textContent = `6–7 день · ${settings.rExtra.toLocaleString()} ₽`;
    document.getElementById('chip3').textContent =
        `переработка · ${settings.rOt1.toLocaleString()} / ${settings.rOt2.toLocaleString()} ₽/ч`;

    const weekLabel = `неделя №${weekKey.replace('W', '')} · ${formatDateDisplay(dates[0])} – ${formatDateDisplay(dates[6])}`;
    document.getElementById('eyebrow').textContent = `Табель · ${weekLabel}`;
    document.getElementById('wk').textContent = weekLabel;

    // Подпись источника
    const subEl = document.querySelector('.sub');
    if (subEl) {
        const hasAdmin = currentData.daySource.includes('admin');
        const hasAtt = currentData.daySource.includes('attendance');
        let text = '';
        if (hasAdmin && hasAtt) text = '📊 Смешанные данные: правки администратора + отметки.';
        else if (hasAdmin) text = '📋 Данные правлены администратором.';
        else if (hasAtt) text = '📊 Данные построены из отметок. ✅ Актуально';
        else text = '📋 Отметок за эту неделю нет. Обратитесь к руководителю.';
        subEl.innerHTML = `${text} <span class="view-only-badge">🔒 Только просмотр</span>`;
    }
}

// ============================================
// ФИНАНСЫ
// ============================================
async function getEmployeeAdvances() {
    try {
        const q = query(collection(db, 'salaryAdvances'), where('employeeId', '==', EMPLOYEE_ID));
        const snap = await getDocs(q);
        const arr = [];
        snap.forEach(d => arr.push({ id: d.id, ...d.data() }));
        return arr.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    } catch (e) { return []; }
}

async function renderEmployeeFinance() {
    const container = document.getElementById('employeeFinanceContent');
    if (!container) return;
    try {
        const advances = await getEmployeeAdvances();
        const active = advances.filter(a => a.status === 'active');
        const totalDebt = active.reduce((s, a) => s + (a.amount || 0), 0);
        const totalRepaid = advances.filter(a => a.status === 'repaid')
            .reduce((s, a) => s + (a.repaidAmount || a.amount || 0), 0);

        container.innerHTML = `
            <div class="debt-summary">
                <div class="debt-item"><div class="label">Активных авансов</div><div class="value count">${active.length}</div></div>
                <div class="debt-item"><div class="label">Общий долг</div><div class="value debt">${totalDebt.toLocaleString()} ₽</div></div>
                <div class="debt-item"><div class="label">Погашено</div><div class="value paid">${totalRepaid.toLocaleString()} ₽</div></div>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <span style="font-weight:600; font-size:.85rem;">📋 История авансов</span>
                <span style="font-size:.7rem; color:var(--mut);">${advances.length} записей</span>
            </div>
            <div class="advance-list">
                ${advances.length === 0 ? '<div class="no-advances">Нет авансов</div>' :
                advances.slice(0, 10).map(a => `
                    <div class="advance-row">
                        <div class="info">
                            <div>${a.type === 'advance' ? '📤' : '📥'} ${a.status === 'active' ? 'Аванс' : 'Погашен'}</div>
                            <div class="comment">${a.comment || 'Без комментария'} · ${a.date ? formatDateFull(new Date(a.date)) : ''}</div>
                        </div>
                        <div class="amount ${a.status === 'active' ? 'active' : 'repaid'}">${(a.amount || 0).toLocaleString()} ₽</div>
                    </div>
                `).join('')}
            </div>
        `;
    } catch (e) {
        container.innerHTML = `<div style="text-align:center;padding:20px;color:var(--red);">❌ Ошибка загрузки финансов</div>`;
    }
}

function updateStatsLink() {
    const el = document.getElementById('statsLink');
    if (el && EMPLOYEE_ID) el.href = `employee-stats.html?id=${EMPLOYEE_ID}`;
}

// ============================================
// НАВИГАЦИЯ
// ============================================
async function refreshWeek() {
    const dates = getWeekDatesUTC(currentWeekOffset);
    const weekKey = getWeekKeyUTC(dates[0]);
    updateWeekLabel(dates);
    currentData = await getWeekData(weekKey, dates);
    console.log('🔄 Неделя', weekKey, 'источник:', currentData.source);
    update();
}

async function init() {
    console.log('🚀 employee-view init. EMPLOYEE_ID:', EMPLOYEE_ID);
    await loadEmployeeInfo();
    await loadSettings();
    await loadAttendance();
    buildUI();
    updateStatsLink();
    await refreshWeek();
    await renderEmployeeFinance();

    document.getElementById('weekPrev').addEventListener('click', async () => { currentWeekOffset--; await refreshWeek(); });
    document.getElementById('weekNext').addEventListener('click', async () => { currentWeekOffset++; await refreshWeek(); });
    document.getElementById('weekToday').addEventListener('click', async () => { currentWeekOffset = 0; await refreshWeek(); });

    document.getElementById('copyBtn').addEventListener('click', async () => {
        const total = document.getElementById('totalOut').textContent;
        const dates = getWeekDatesUTC(currentWeekOffset);
        const text = `Зарплата за неделю ${formatDateDisplay(dates[0])}–${formatDateDisplay(dates[6])}: ${total} ₽`;
        try { await navigator.clipboard.writeText(text); } catch (e) {}
    });
    console.log('✅ employee-view готов');
}

const style = document.createElement('style');
style.textContent = `
    .day-time-item .time-from-attendance { font-size: .45rem; font-family: var(--mono); margin-top: 1px; }
    .day-time-item.work-day { border-color: rgba(62,207,168,.3); background: rgba(62,207,168,.05); }
    .day-time-item.extra-day { border-color: var(--amber); background: rgba(255,181,46,.08); }
    .day-time-item.work-day .day-label { color: var(--teal); }
    .day-time-item.extra-day .day-label { color: var(--amber); }
`;
document.head.appendChild(style);

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();