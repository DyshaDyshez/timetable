// employee-view.js
// Просмотр зарплаты сотрудником (только чтение).
//
// ЛОГИКА (совпадает с admin-dashboard.js):
// - Для каждого дня отдельно:
//     • adminEditedDays[i] === true → данные админа (в т.ч. 0ч = отмена дня)
//     • иначе → данные из отметок
// - Ничего в БД НЕ записываем.
//
// ★ ДОБАВЛЕНО: Календарь-расписание сотрудников
// ★ ДОБАВЛЕНО: Красивая модалка «Запросить ЗП»
// ★ ДОБАВЛЕНО: Отправка уведомления в Битрикс24

import { calculateWeekPay } from './modules/calculator.js';
import { calculateDayHoursFromLogs } from './modules/attendance.js';

const { db, doc, getDoc, setDoc, collection, query, where, getDocs } = window;

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
let allAttendance = {};
let settings = { 
    rDay: 3000, rExtra: 3500, rOt1: 400, rOt2: 800, otLimit: 5, hpd: 8,
    sundayBonusEnabled: false, sundayBonusAmount: 1000
};

// ★ СПИСОК СОТРУДНИКОВ С ВЫЧЕТОМ 20%
const DEDUCTION_EMPLOYEES = [
    'UD6ZrvVxPkm4CmKGWDiX', '69bXsB9wPyUjffVUuLFN', 'Ko5LMP5SQKGfFoB4yIx7', 'U4x9Kr0bpfdx7naoulpM', 'nbBjsOTTSRIO6aBsslAN', 'ZflATZ6egxRkx5fhpJ5o' // Андрей
    // сюда добавляй новые ID через запятую:
    // 'Es8V40MRBaxZpFCSmK0j',
];

// Для календаря
let scheduleWeekOffset = 0;
let allEmployees = [];
let scheduleData = {};
let employeesAttendance = {};
let attendanceCacheLoaded = false;

const DAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const FULL_DAY_NAMES = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

// ============================================
// УТИЛИТЫ
// ============================================
function getUTCDateStr(date) { 
    return new Date(date).toISOString().slice(0, 10); 
}

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

function isPastDate(dateStr) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const d = new Date(dateStr + 'T00:00:00Z');
    return d < today;
}
function isTodayDate(dateStr) {
    return dateStr === new Date().toISOString().slice(0, 10);
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

        item.classList.remove('work-day', 'extra-day', 'sunday-bonus-day');
        attDisplay.style.display = 'none';
        attDisplay.textContent = '';

        const dateStr = getUTCDateStr(dates[i]);
        const attLogs = allAttendance[dateStr] || [];

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

            if (i === 6 && settings.sundayBonusEnabled) {
                item.classList.add('sunday-bonus-day');
            }
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

    const stats = calculateWeekPay(currentData, settings);
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

    const rowSundayBonus = document.getElementById('rowSundayBonus');
    if (rowSundayBonus) {
        if (stats.sundayBonus > 0) {
            rowSundayBonus.classList.remove('gone');
            document.getElementById('qSundayBonus').textContent = 'работа в воскресенье';
            document.getElementById('vSundayBonus').textContent = '+' + stats.sundayBonus.toLocaleString() + ' ₽';
        } else {
            rowSundayBonus.classList.add('gone');
        }
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

       // ★ ДОБАВЛЕНО: Вычет 20% (по списку ID)
    const totalRow = document.querySelector('.total-row');
    if (totalRow) {
        let netSalaryBlock = document.getElementById('netSalaryBlock');
        if (DEDUCTION_EMPLOYEES.includes(EMPLOYEE_ID)) {
            if (!netSalaryBlock) {
                netSalaryBlock = document.createElement('div');
                netSalaryBlock.id = 'netSalaryBlock';
                netSalaryBlock.style.cssText = `
                    background: rgba(255, 181, 46, 0.12);
                    border: 1px dashed var(--amber);
                    border-radius: 8px;
                    padding: 12px 16px;
                    margin-top: 12px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    font-family: var(--mono);
                `;
                totalRow.parentNode.insertBefore(netSalaryBlock, totalRow.nextSibling);
            }
            const netTotal = total * 0.8;
            netSalaryBlock.innerHTML = `
                <span style="font-size: 0.85rem; font-weight: 600; color: var(--amber2);">💰 ЗП - 20% (на руки)</span>
                <span style="font-size: 1.2rem; font-weight: bold; color: var(--amber);">${Math.round(netTotal).toLocaleString()} ₽</span>
            `;
        } else if (netSalaryBlock) {
            netSalaryBlock.remove();
        }
    }

    const parts = [];
    if (payBase > 0) parts.push(`<b class="f-n">${days}×${settings.rDay.toLocaleString()}</b>`);
    if (payExtra > 0) parts.push(`<b class="f-n">${extraDaysCount}×${settings.rExtra.toLocaleString()}</b>`);
    if (ot1 > 0) parts.push(`<b class="f-1">${formatHours(ot1)}×${settings.rOt1.toLocaleString()}</b>`);
    if (ot2 > 0) parts.push(`<b class="f-2">${formatHours(ot2)}×${settings.rOt2.toLocaleString()}</b>`);
    if (stats.sundayBonus > 0) {
        parts.push(`<b style="color:var(--amber);">${stats.sundayBonus.toLocaleString()}₽ (Вс)</b>`);
    }
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
// ★ КАЛЕНДАРЬ-РАСПИСАНИЕ
// ============================================

async function loadAllEmployees() {
    try {
        const snap = await getDocs(collection(db, 'salaryEmployees'));
        allEmployees = [];
        snap.forEach(d => {
            allEmployees.push({ id: d.id, ...d.data() });
        });
        allEmployees.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } catch (e) {
        console.error('Ошибка загрузки сотрудников:', e);
        allEmployees = [];
    }
}

async function loadScheduleData(weekKey) {
    try {
        const q = query(
            collection(db, 'employeeSchedule'),
            where('weekKey', '==', weekKey)
        );
        const snap = await getDocs(q);
        scheduleData = {};
        snap.forEach(d => {
            const data = d.data();
            const key = data.employeeId + '_' + data.weekKey;
            scheduleData[key] = { id: d.id, ...data };
        });
    } catch (e) {
        console.error('Ошибка загрузки расписания:', e);
        scheduleData = {};
    }
}

async function loadAllAttendanceForWeeks() {
    if (attendanceCacheLoaded) return;
    
    try {
        console.log('📋 Загружаем attendance всех сотрудников...');
        const snap = await getDocs(collection(db, 'attendance'));
        employeesAttendance = {};
        snap.forEach(d => {
            const data = d.data();
            const key = data.employeeId + '_' + data.date;
            if (!employeesAttendance[key]) employeesAttendance[key] = 0;
            employeesAttendance[key] += 1;
        });
        attendanceCacheLoaded = true;
        console.log('📋 Загружено attendance записей:', snap.size);
    } catch (e) {
        console.error('Ошибка загрузки attendance:', e);
        employeesAttendance = {};
    }
}

async function renderSchedule() {
    const wrap = document.getElementById('scheduleTableWrap');
    const label = document.getElementById('scheduleWeekLabel');
    if (!wrap) return;
    
    const dates = getWeekDatesUTC(scheduleWeekOffset);
    const weekKey = getWeekKeyUTC(dates[0]);
    
    if (label) {
        label.textContent = `${formatDateDisplay(dates[0])} – ${formatDateDisplay(dates[6])} (${weekKey})`;
    }
    
    await loadScheduleData(weekKey);
    await loadAllAttendanceForWeeks();
    
    const today = new Date();
    const todayWeekKey = getWeekKeyUTC(today);
    const isCurrentWeek = weekKey === todayWeekKey;
    const isFutureWeek = weekKey > todayWeekKey;
    const isEditableWeek = isCurrentWeek || isFutureWeek;
    
    let html = `<table class="schedule-table">
        <thead>
            <tr>
                <th>Сотрудник</th>
                ${DAY_NAMES.map((d, i) => {
                    const isWeekend = i >= 5;
                    const isTodayCol = isTodayDate(getUTCDateStr(dates[i]));
                    return `<th class="${isWeekend ? 'weekend' : ''} ${isTodayCol ? 'today' : ''}">${d}</th>`;
                }).join('')}
            </tr>
        </thead>
        <tbody>`;
    
    for (const emp of allEmployees) {
        const isSelf = emp.id === EMPLOYEE_ID;
        html += `<tr class="${isSelf ? 'self-row' : ''}">`;
        html += `<td>${isSelf ? '👤 ' : ''}${emp.name || 'Без имени'}</td>`;
        
        for (let i = 0; i < 7; i++) {
            const dateObj = dates[i];
            const dateStr = getUTCDateStr(dateObj);
            const dayIndex = i;
            
            const isPast = isPastDate(dateStr);
            
            let status = 'empty';
            let editable = false;
            
            if (isPast) {
                const attKey = emp.id + '_' + dateStr;
                const hasAtt = employeesAttendance[attKey] > 0;
                status = hasAtt ? 'past-work' : 'past-off';
                editable = false;
            } else {
                const scheduleKey = emp.id + '_' + weekKey;
                const schedule = scheduleData[scheduleKey];
                if (schedule && schedule.days && schedule.days[dayIndex]) {
                    status = schedule.days[dayIndex];
                }
                editable = isSelf && isEditableWeek;
            }
            
            let symbol = '⚪';
            if (status === 'work' || status === 'past-work') symbol = '🟢';
            else if (status === 'off' || status === 'past-off') symbol = '🔴';
            
            const cls = `${status} ${editable ? 'editable' : ''}`;
            
            html += `<td>
                <div class="schedule-day ${cls}" 
                     data-employee="${emp.id}" 
                     data-date="${dateStr}"
                     data-day="${dayIndex}"
                     data-week="${weekKey}"
                     data-editable="${editable}"
                     ${editable ? `onclick="window.openDayPicker(event, this)"` : ''}>
                    ${symbol}
                </div>
            </td>`;
        }
        
        html += `</tr>`;
    }
    
    html += `</tbody></table>`;
    wrap.innerHTML = html;
    
    const hintEl = document.getElementById('scheduleHint');
    if (hintEl) {
        if (!isEditableWeek) {
            hintEl.textContent = '🔒 Прошлые недели только для чтения';
            hintEl.style.color = 'var(--mut)';
        } else {
            hintEl.textContent = '💡 Нажмите на свой день (в своей строке) — 🟢 работает / 🔴 выходной';
            hintEl.style.color = 'var(--amber2)';
        }
    }
}

function initMinimap() {
    const btn = document.getElementById('minimapBtn');
    const modal = document.getElementById('scheduleModal');
    const closeBtn = document.getElementById('scheduleClose');
    const prevBtn = document.getElementById('scheduleWeekPrev');
    const nextBtn = document.getElementById('scheduleWeekNext');
    const todayBtn = document.getElementById('scheduleWeekToday');
    
    if (!btn || !modal) return;
    
    btn.addEventListener('click', async () => {
        modal.classList.add('active');
        document.body.classList.add('schedule-open'); // для fixed-кнопки закрытия
        if (allEmployees.length === 0) {
            await loadAllEmployees();
        }
        await renderSchedule();
    });
    
    const closeSchedule = () => {
        modal.classList.remove('active');
        document.body.classList.remove('schedule-open');
    };
    
    closeBtn?.addEventListener('click', closeSchedule);
    
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeSchedule();
        }
    });
    
    // Закрытие по Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('active')) {
            closeSchedule();
        }
    });
    
    prevBtn?.addEventListener('click', async () => {
        if (scheduleWeekOffset <= 0) return;
        scheduleWeekOffset--;
        await renderSchedule();
    });
    
    nextBtn?.addEventListener('click', async () => {
        if (scheduleWeekOffset >= 2) return;
        scheduleWeekOffset++;
        await renderSchedule();
    });
    
    todayBtn?.addEventListener('click', async () => {
        scheduleWeekOffset = 0;
        await renderSchedule();
    });
}

let currentPicker = null;

window.openDayPicker = function(event, el) {
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
            await saveDayStatus(employeeId, weekKey, dayIndex, newStatus);
            picker.remove();
            currentPicker = null;
            await renderSchedule();
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

async function saveDayStatus(employeeId, weekKey, dayIndex, status) {
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
        
        console.log(`✅ Сохранено: ${employeeId} ${weekKey} день ${dayIndex} = ${status}`);
    } catch (e) {
        console.error('Ошибка сохранения:', e);
        alert('❌ Не удалось сохранить. Попробуйте снова.');
    }
}

// ============================================
// НАВИГАЦИЯ
// ============================================
async function refreshWeek() {
    const dates = getWeekDatesUTC(currentWeekOffset);
    const weekKey = getWeekKeyUTC(dates[0]);
    updateWeekLabel(dates);
    currentData = await getWeekData(weekKey, dates);
    update();
    await checkExistingRequest();
}

async function init() {
    console.log('🚀 employee-view init. EMPLOYEE_ID:', EMPLOYEE_ID);
    await loadEmployeeInfo();
    await loadSettings();
    await loadAttendance();
    buildUI();
    initMinimap();
    initSalaryModal();
    await refreshWeek();

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

// ============================================
// ★ ЗАПРОС ЗАРПЛАТЫ (с отправкой в Битрикс)
// ============================================

function initSalaryModal() {
    const btn = document.getElementById('requestSalaryBtn');
    if (!btn) return;
    
    btn.addEventListener('click', openSalaryModal);
    
    // Кнопки модалки
    document.getElementById('salaryModalCancel')?.addEventListener('click', closeSalaryModal);
    document.getElementById('salaryModalConfirm')?.addEventListener('click', confirmSalaryRequest);
    
    // Закрытие по клику на фон
    document.getElementById('salaryModalOverlay')?.addEventListener('click', (e) => {
        if (e.target.id === 'salaryModalOverlay') closeSalaryModal();
    });
    
    // ESC
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeSalaryModal();
    });
}

// Состояние модалки
let _modalData = null;

async function openSalaryModal() {
    const btn = document.getElementById('requestSalaryBtn');
    if (!btn || btn.disabled) return;
    
    // Считаем данные
    if (!currentData) {
        showToast('❌ Данные ещё не загружены');
        return;
    }
    
    const dates = getWeekDatesUTC(currentWeekOffset);
    const weekKey = getWeekKeyUTC(dates[0]);
    const weekRange = `${formatDateDisplay(dates[0])} – ${formatDateDisplay(dates[6])}`;
    
    const stats = calculateWeekPay(currentData, settings);
    
    if (stats.days === 0 || stats.total === 0) {
        showToast('❌ Нет данных для запроса. Обратитесь к руководителю.');
        return;
    }
    
    // Проверяем активные запросы
    try {
        const q = query(
            collection(db, 'salaryRequests'),
            where('employeeId', '==', EMPLOYEE_ID),
            where('weekKey', '==', weekKey),
            where('status', '==', 'pending')
        );
        const snap = await getDocs(q);
        if (!snap.empty) {
            showToast('⏳ ЗП уже запрошена за эту неделю');
            btn.textContent = '⏳ ЗП запрошена';
            btn.style.background = 'var(--amber)';
            btn.disabled = true;
            return;
        }
    } catch (e) {
        console.warn(e);
    }
    
    // Получаем активные авансы
    let totalAdvances = 0;
    try {
        const advQ = query(
            collection(db, 'salaryAdvances'),
            where('employeeId', '==', EMPLOYEE_ID),
            where('status', '==', 'active')
        );
        const advSnap = await getDocs(advQ);
        advSnap.forEach(d => {
            totalAdvances += d.data().amount || 0;
        });
    } catch (e) {
        console.warn('Ошибка загрузки авансов:', e);
    }
    
    const finalPay = Math.max(0, stats.total - totalAdvances);
    
    // Запоминаем
    _modalData = {
        weekKey,
        weekRange,
        stats,
        totalAdvances,
        finalPay
    };
    
    // Заполняем модалку
    document.getElementById('salaryModalPeriod').textContent = weekRange;
    document.getElementById('salaryModalDays').textContent = stats.days;
    document.getElementById('salaryModalHours').textContent = stats.totalHours.toFixed(2).replace('.', ',');
    document.getElementById('salaryModalFinal').textContent = finalPay.toLocaleString();
    
    // Надбавка
    const bonusRow = document.getElementById('salaryModalBonusRow');
    if (stats.sundayBonus > 0) {
        bonusRow.style.display = 'flex';
        document.getElementById('salaryModalBonus').textContent = '+' + stats.sundayBonus.toLocaleString() + ' ₽';
    } else {
        bonusRow.style.display = 'none';
    }
    
    // Авансы
    const advanceRow = document.getElementById('salaryModalAdvanceRow');
    if (totalAdvances > 0) {
        advanceRow.style.display = 'flex';
        document.getElementById('salaryModalAdvance').textContent = '−' + totalAdvances.toLocaleString() + ' ₽';
    } else {
        advanceRow.style.display = 'none';
    }
    
    // По дням
    const daysGrid = document.getElementById('salaryModalDaysGrid');
    daysGrid.innerHTML = DAY_NAMES.map((d, i) => {
        const isWork = currentData.workDays[i] && currentData.hours[i] > 0;
        const isSunday = i === 6 && isWork;
        const cls = isWork ? (isSunday ? 'day-cell work sunday' : 'day-cell work') : 'day-cell';
        const hours = currentData.hours[i] || 0;
        return `
            <div class="${cls}">
                <div class="day-name">${d}</div>
                <div class="day-hours">${isWork ? hours.toFixed(1) : '—'}</div>
            </div>
        `;
    }).join('');
    
    // Открываем
    const overlay = document.getElementById('salaryModalOverlay');
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeSalaryModal() {
    const overlay = document.getElementById('salaryModalOverlay');
    if (!overlay || !overlay.classList.contains('active')) return;
    overlay.classList.add('closing');
    document.body.style.overflow = '';
    setTimeout(() => {
        overlay.classList.remove('active', 'closing');
    }, 250);
}

async function confirmSalaryRequest() {
    const confirmBtn = document.getElementById('salaryModalConfirm');
    const cancelBtn = document.getElementById('salaryModalCancel');
    if (!_modalData || !confirmBtn) return;
    
    const { weekKey, weekRange, stats, totalAdvances, finalPay } = _modalData;
    
    // Блокируем кнопки
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    confirmBtn.textContent = '⏳ Отправка...';
    
    try {
        // 1. Сохраняем в Firebase
        await setDoc(doc(collection(db, 'salaryRequests')), {
            employeeId: EMPLOYEE_ID,
            employeeName: employeeName,
            weekKey: weekKey,
            weekRange: weekRange,
            days: stats.days,
            totalHours: stats.totalHours,
            total: stats.total,
            sundayBonus: stats.sundayBonus || 0,
            advances: totalAdvances,
            finalPay: finalPay,
            status: 'pending',
            createdAt: new Date().toISOString(),
            paidAt: null
        });
        
        console.log('✅ Запрос на ЗП отправлен');
        
        // 2. Отправляем в Битрикс
        try {
            await sendBitrixSalaryRequestNotification({
                employeeName,
                finalPay,
                weekRange
            });
        } catch (bitrixError) {
            console.warn('⚠️ Не удалось отправить в Битрикс:', bitrixError);
            // Не прерываем процесс, т.к. запись в БД уже создана
        }
        
        // 3. Обновляем кнопку на странице
        const mainBtn = document.getElementById('requestSalaryBtn');
        if (mainBtn) {
            mainBtn.textContent = '⏳ ЗП запрошена';
            mainBtn.style.background = 'var(--amber)';
            mainBtn.disabled = true;
            mainBtn.style.cursor = 'not-allowed';
        }
        
        closeSalaryModal();
        setTimeout(() => showToast('✅ Запрос на зарплату отправлен!'), 250);
        
    } catch (error) {
        console.error('Ошибка:', error);
        confirmBtn.disabled = false;
        cancelBtn.disabled = false;
        confirmBtn.textContent = '💰 Запросить';
        showToast('❌ Ошибка: ' + error.message);
    }
}

// ============================================
// ★ ОТПРАВКА УВЕДОМЛЕНИЯ В БИТРИКС24
// ============================================
async function sendBitrixSalaryRequestNotification({ employeeName, finalPay, weekRange }) {
    try {
        // Получаем настройки Битрикса
        const bitrixRef = doc(db, 'settings', 'bitrix24');
        const bitrixSnap = await getDoc(bitrixRef);

        if (!bitrixSnap.exists()) {
            console.warn('❌ Настройки Битрикс24 не найдены');
            return;
        }

        const bitrixData = bitrixSnap.data();
        const webhook = bitrixData.webhook;
        const chatId = bitrixData.chatId || 'chat1104';

        if (!webhook) {
            console.warn('❌ Вебхук Битрикс24 не указан');
            return;
        }

               // Формируем ссылки
        const baseUrl = window.location.origin + window.location.pathname.replace(/\/[^\/]*$/, '/');
        const dashboardUrl = `${baseUrl}admin-dashboard.html`;
        const employeeUrl = `${baseUrl}employee-view.html?id=${EMPLOYEE_ID}`;

        // Формируем сообщение (BB-код для Битрикс24)
        // Обрати внимание: весь текст внутри обратных кавычек ` `
        const message = `[URL=${dashboardUrl}]ЗАПРОС ЗП[/URL]\n` +
            `👤 [URL=${employeeUrl}]${employeeName}[/URL]\n` +
            `📅 ${weekRange}\n` +
            `💵 ${finalPay.toLocaleString()} ₽`;

        // Отправляем
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

        console.log('✅ Уведомление о ЗП отправлено в Битрикс');
    } catch (error) {
        console.error('❌ Ошибка отправки в Битрикс:', error);
        throw error;
    }
}

async function checkExistingRequest() {
    try {
        const btn = document.getElementById('requestSalaryBtn');
        if (!btn) return;
        
        const dates = getWeekDatesUTC(currentWeekOffset);
        const weekKey = getWeekKeyUTC(dates[0]);
        
        const q = query(
            collection(db, 'salaryRequests'),
            where('employeeId', '==', EMPLOYEE_ID),
            where('weekKey', '==', weekKey),
            where('status', '==', 'pending')
        );
        const snap = await getDocs(q);
        
        if (!snap.empty) {
            btn.textContent = '⏳ ЗП запрошена';
            btn.style.background = 'var(--amber)';
            btn.disabled = true;
            btn.style.opacity = '0.7';
            btn.style.cursor = 'not-allowed';
        } else {
            btn.textContent = '💰 Запросить ЗП';
            btn.style.background = 'var(--teal)';
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
        }
    } catch (e) {
        console.warn('Не удалось проверить запрос:', e);
    }
}

// Всплывающее уведомление (улучшенное)
function showToast(message) {
    let el = document.getElementById('toast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'toast';
        el.style.cssText = `
            position: fixed;
            bottom: max(24px, env(safe-area-inset-bottom));
            left: 50%;
            transform: translateX(-50%) translateY(20px);
            background: var(--teal);
            color: #0c1520;
            padding: 14px 24px;
            border-radius: 14px;
            font-weight: bold;
            font-size: .95rem;
            opacity: 0;
            transition: opacity 0.35s, transform 0.35s;
            z-index: 99999;
            box-shadow: 0 16px 40px rgba(0,0,0,.5), 0 0 0 1px rgba(62,207,168,.3);
            font-family: var(--body);
            pointer-events: none;
            max-width: calc(100vw - 32px);
            text-align: center;
            line-height: 1.4;
        `;
        document.body.appendChild(el);
    }
    el.textContent = message;
    el.style.opacity = '1';
    el.style.transform = 'translateX(-50%) translateY(0)';
    clearTimeout(el._timer);
    el._timer = setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateX(-50%) translateY(20px)';
    }, 3200);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
