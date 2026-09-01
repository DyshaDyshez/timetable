// employee-view.js
// Скрипт страницы просмотра зарплаты для сотрудника (только чтение)
// АВТОМАТИЧЕСКОЕ СОЗДАНИЕ ДАННЫХ ИЗ ОТМЕТОК, ЕСЛИ НЕТ В salaryWeeks

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
                Ссылка должна быть: employee-view.html?id=ВАШ_ID
            </p>
        </div>
    `;
    throw new Error('No employee ID');
}

let currentWeekOffset = 0;
let currentData = null;
let employeeName = 'Сотрудник';
let employeeRoomId = null;
let allAttendance = {};
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
// ФУНКЦИИ РАБОТЫ С ДАТАМИ (ВСЕ В UTC - КАК В FIREBASE)
// ============================================

function getUTCDateStr(date) {
    const d = new Date(date);
    return d.toISOString().slice(0, 10);
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

function formatHours(hours) {
    return hours.toFixed(2).replace('.', ',');
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
// ФИНАНСОВЫЕ ФУНКЦИИ (ТОЛЬКО ПРОСМОТР)
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
        return advances.sort((a, b) => b.date.localeCompare(a.date));
    } catch (error) {
        console.error('Ошибка загрузки авансов:', error);
        return [];
    }
}

async function renderEmployeeFinance() {
    const container = document.getElementById('employeeFinanceContent');
    if (!container) return;
    
    try {
        const advances = await getEmployeeAdvances();
        const activeAdvances = advances.filter(a => a.status === 'active');
        const totalDebt = activeAdvances.reduce((sum, a) => sum + a.amount, 0);
        const totalRepaid = advances
            .filter(a => a.status === 'repaid')
            .reduce((sum, a) => sum + (a.repaidAmount || a.amount), 0);
        
        container.innerHTML = `
            <div class="debt-summary">
                <div class="debt-item">
                    <div class="label">Активных авансов</div>
                    <div class="value count">${activeAdvances.length}</div>
                </div>
                <div class="debt-item">
                    <div class="label">Общий долг</div>
                    <div class="value debt">${totalDebt.toLocaleString()} ₽</div>
                </div>
                <div class="debt-item">
                    <div class="label">Погашено</div>
                    <div class="value paid">${totalRepaid.toLocaleString()} ₽</div>
                </div>
            </div>
            
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <span style="font-weight:600; font-size:.85rem;">📋 История авансов</span>
                <span style="font-size:.7rem; color:var(--mut);">${advances.length} записей</span>
            </div>
            <div class="advance-list">
                ${advances.length === 0 ? `
                    <div class="no-advances">Нет авансов</div>
                ` : `
                    ${advances.slice(0, 10).map(a => `
                        <div class="advance-row">
                            <div class="info">
                                <div>
                                    ${a.type === 'advance' ? '📤' : '📥'} 
                                    ${a.status === 'active' ? 'Аванс' : 'Погашен'}
                                    ${a.status === 'active' ? ' <span style="color:var(--red);font-size:.6rem;">(активен)</span>' : ''}
                                </div>
                                <div class="comment">${a.comment || 'Без комментария'} · ${formatDateFull(new Date(a.date))}</div>
                            </div>
                            <div class="amount ${a.status === 'active' ? 'active' : 'repaid'}">
                                ${a.amount.toLocaleString()} ₽
                            </div>
                        </div>
                    `).join('')}
                    ${advances.length > 10 ? `<div style="text-align:center;font-size:.7rem;color:var(--mut);padding:4px;">... и ещё ${advances.length - 10} записей</div>` : ''}
                `}
            </div>
        `;
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
// ЗАГРУЗКА ДАННЫХ
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
        } else {
            console.log('⚙️ Настройки не найдены, используем дефолтные');
        }
    } catch (error) {
        console.warn('Не удалось загрузить настройки:', error);
    }
}

async function loadAttendance() {
    try {
        const attRef = collection(db, 'attendance');
        const q = query(attRef, where('employeeId', '==', EMPLOYEE_ID));
        const snapshot = await getDocs(q);
        allAttendance = {};
        snapshot.forEach((doc) => {
            const data = doc.data();
            const date = data.date || 'unknown';
            if (!allAttendance[date]) {
                allAttendance[date] = [];
            }
            allAttendance[date].push({ id: doc.id, ...data });
        });
        console.log('📋 Загружено отметок:', snapshot.size);
        console.log('📋 allAttendance keys:', Object.keys(allAttendance));
        return allAttendance;
    } catch (error) {
        console.error('Ошибка загрузки отметок:', error);
        return {};
    }
}

async function loadWeekData(weekKey) {
    try {
        const docRef = doc(db, 'salaryWeeks', `${EMPLOYEE_ID}_${weekKey}`);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            console.log('📅 Загружена неделя из salaryWeeks:', weekKey, data);
            return {
                workDays: data.workDays || [true, true, true, true, true, false, false],
                hours: data.hours || [NORMAL_HOURS_PER_DAY, NORMAL_HOURS_PER_DAY, NORMAL_HOURS_PER_DAY, NORMAL_HOURS_PER_DAY, NORMAL_HOURS_PER_DAY, 0, 0],
                isPaid: data.isPaid || false,
                workStart: data.workStart || [getDefaultStartTime(), getDefaultStartTime(), getDefaultStartTime(), getDefaultStartTime(), getDefaultStartTime(), '', ''],
                workEnd: data.workEnd || [getDefaultEndTime(), getDefaultEndTime(), getDefaultEndTime(), getDefaultEndTime(), getDefaultEndTime(), '', '']
            };
        } else {
            console.log('📅 Нет данных в salaryWeeks для недели:', weekKey);
            return null;
        }
    } catch (error) {
        console.error('Ошибка загрузки:', error);
        return null;
    }
}

// ============================================
// СОЗДАНИЕ ДАННЫХ ИЗ ОТМЕТОК
// ============================================

function buildDataFromAttendance(weekDates) {
    const workDays = [false, false, false, false, false, false, false];
    const hours = [0, 0, 0, 0, 0, 0, 0];
    const workStart = ['', '', '', '', '', '', ''];
    const workEnd = ['', '', '', '', '', '', ''];
    
    let hasAnyData = false;
    
    weekDates.forEach((dateObj, index) => {
        const dateStr = getUTCDateStr(dateObj);
        const logs = allAttendance[dateStr] || [];
        
        if (logs.length > 0) {
            hasAnyData = true;
            workDays[index] = true;
            
            const sorted = [...logs].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
            
            // Находим первый "in" и последний "out"
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
                // Если нет выхода — ставим текущее время
                const now = new Date();
                workEnd[index] = now.toTimeString().slice(0, 5);
            }
            
            // Рассчитываем часы
            if (workStart[index] && workEnd[index]) {
                hours[index] = calculateHoursFromTime(workStart[index], workEnd[index]);
            }
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

function getDayAttendance(dateStr) {
    const logs = allAttendance[dateStr] || [];
    if (logs.length === 0) return null;
    const sorted = [...logs].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return sorted;
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
            <input type="time" class="time-start" value="" disabled>
            <input type="time" class="time-end" value="" disabled>
            <span class="time-hours">⏱ <strong>0</strong> ч</span>
            <span class="time-from-attendance" style="font-size:.45rem;color:var(--teal);font-family:var(--mono);margin-top:1px;display:none;"></span>
        `;
        timeGroup.appendChild(div);
    });
}

function updateWeekLabel(dates) {
    const mon = dates[0];
    const sun = dates[6];
    const weekKey = getWeekKeyUTC(mon);
    const today = new Date();
    const todayWeek = getWeekKeyUTC(today);
    const isCurrent = weekKey === todayWeek;
    document.getElementById('weekRange').textContent = `${formatDateDisplay(mon)} – ${formatDateDisplay(sun)}`;
    document.getElementById('weekSub').textContent = isCurrent ? 'текущая неделя' : weekKey;
}

// ============================================
// ОБНОВЛЕНИЕ ВРЕМЕНИ
// ============================================

function updateTimeInputs() {
    if (!currentData) return;
    const { workDays, workStart, workEnd } = currentData;
    const items = document.querySelectorAll('.day-time-item');
    const dates = getWeekDatesUTC(currentWeekOffset);
    
    items.forEach((item, i) => {
        const startInput = item.querySelector('.time-start');
        const endInput = item.querySelector('.time-end');
        const hoursDisplay = item.querySelector('.time-hours strong');
        const attendanceDisplay = item.querySelector('.time-from-attendance');
        
        item.classList.remove('work-day', 'extra-day');
        
        const dateObj = dates[i];
        const dateStr = getUTCDateStr(dateObj);
        const attLogs = getDayAttendance(dateStr);
        
        if (attLogs && attLogs.length > 0) {
            const times = attLogs.map(l => {
                const t = new Date(l.timestamp);
                return t.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
            });
            attendanceDisplay.textContent = `📌 ${times.join(' → ')}`;
            attendanceDisplay.style.display = 'block';
            attendanceDisplay.style.color = 'var(--teal)';
        }
        
        if (workDays[i]) {
            startInput.value = workStart[i] || getDefaultStartTime();
            endInput.value = workEnd[i] || getDefaultEndTime();
            
            // Если есть отметки, показываем часы из них, иначе из плана
            if (attLogs && attLogs.length > 0) {
                const firstIn = attLogs.find(l => l.type === 'in');
                const lastOut = [...attLogs].reverse().find(l => l.type === 'out');
                if (firstIn && lastOut && firstIn.timestamp < lastOut.timestamp) {
                    const h = calculateHoursFromTime(
                        new Date(firstIn.timestamp).toTimeString().slice(0, 5),
                        new Date(lastOut.timestamp).toTimeString().slice(0, 5)
                    );
                    hoursDisplay.textContent = formatHours(h);
                } else if (firstIn) {
                    const now = new Date();
                    const diffMs = now - new Date(firstIn.timestamp);
                    const diffMinutes = Math.floor(diffMs / (1000 * 60));
                    const h = Math.round(diffMinutes / 60 * 100) / 100;
                    hoursDisplay.textContent = formatHours(h) + ' (в процессе)';
                }
            } else {
                const h = calculateHoursFromTime(startInput.value, endInput.value);
                hoursDisplay.textContent = formatHours(h);
                if (!currentData.fromAttendance) {
                    attendanceDisplay.textContent = '⏳ план';
                    attendanceDisplay.style.display = 'block';
                    attendanceDisplay.style.color = 'var(--mut)';
                }
            }
            
            const dayIndex = workDays.slice(0, i).filter(Boolean).length;
            const isExtra = dayIndex >= 5;
            item.classList.add('work-day');
            if (isExtra) {
                item.classList.add('extra-day');
            }
        } else {
            startInput.value = '';
            endInput.value = '';
            hoursDisplay.textContent = '0';
            if (!attLogs || attLogs.length === 0) {
                attendanceDisplay.textContent = '';
                attendanceDisplay.style.display = 'none';
            }
        }
    });
}

// ============================================
// ОСНОВНАЯ ФУНКЦИЯ ОБНОВЛЕНИЯ UI
// ============================================

function update() {
    if (!currentData) {
        console.warn('⚠️ currentData is null, пропускаем update');
        return;
    }
    
    const { workDays, hours, workStart, workEnd } = currentData;
    const dates = getWeekDatesUTC(currentWeekOffset);
    const weekKey = getWeekKeyUTC(dates[0]);
    
    console.log('🔄 update() вызван, weekKey:', weekKey);
    console.log('📊 currentData:', currentData);
    
    const stats = calculateWeekPay(currentData, settings);
    console.log('📊 stats:', stats);
    
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
    
    updateTimeInputs();
    
    document.getElementById('dOut').textContent = days;
    document.getElementById('normOut').textContent = `норма: ${norm.toFixed(1).replace('.', ',')} ч (${days} дн × ${settings.hpd} ч)`;
    
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
    
    // СТРОКИ РАСЧЕТА
    document.getElementById('qBase').textContent = `${days} дн × ${settings.rDay.toLocaleString()} ₽ (пропорционально)`;
    document.getElementById('vBase').textContent = payBase.toLocaleString() + ' ₽';
    
    const rowExtra = document.getElementById('rowExtra');
    const extraDaysCount = Math.max(0, Math.min(2, days - 5));
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
    document.getElementById('formula').innerHTML = parts.length ? parts.join(' + ') + ` = ${total.toLocaleString()} ₽` : '—';
    
    document.getElementById('metaLine').textContent =
        `отработано ${formatHours(totalHours)} ч · норма ${formatHours(norm)} ч`;
    
    document.getElementById('chip1').textContent = `1–5 день · ${settings.rDay.toLocaleString()} ₽`;
    document.getElementById('chip2').textContent = `6–7 день · ${settings.rExtra.toLocaleString()} ₽`;
    document.getElementById('chip3').textContent = `переработка · ${settings.rOt1.toLocaleString()} / ${settings.rOt2.toLocaleString()} ₽/ч`;
    
    const mon = dates[0];
    const sun = dates[6];
    const weekLabel = `неделя №${weekKey.replace('W', '')} · ${formatDateDisplay(mon)} – ${formatDateDisplay(sun)}`;
    document.getElementById('eyebrow').textContent = `Табель · ${weekLabel}`;
    document.getElementById('wk').textContent = weekLabel;
}

// ============================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================

async function init() {
    console.log('🚀 Запуск employee-view (только просмотр)...');
    console.log('📌 EMPLOYEE_ID:', EMPLOYEE_ID);
    
    await loadSettings();
    await loadEmployeeInfo();
    await loadAttendance();
    buildUI();
    
    updateStatsLink();
    
    const dates = getWeekDatesUTC(0);
    const weekKey = getWeekKeyUTC(dates[0]);
    console.log('📅 Текущая неделя (UTC):', weekKey);
    console.log('📅 Даты недели:', dates.map(d => getUTCDateStr(d)));
    
    // Пытаемся загрузить данные из salaryWeeks
    let weekData = await loadWeekData(weekKey);
    
    if (!weekData) {
        console.log('⚠️ Данных в salaryWeeks нет, создаём из отметок');
        weekData = buildDataFromAttendance(dates);
        weekData.fromAttendance = true;
        
        if (weekData.workDays.some(d => d === true)) {
            console.log('✅ Созданы данные из отметок:', weekData);
            document.querySelector('.sub').innerHTML = `
                📋 Данные автоматически построены из отметок.
                <span style="color:var(--amber);">Для точного расчёта обратитесь к администратору.</span>
                <span class="view-only-badge">🔒 Только просмотр</span>
            `;
        } else {
            console.log('⚠️ Нет отметок за эту неделю');
            document.querySelector('.sub').innerHTML = `
                📋 Нет данных за эту неделю.
                <span style="color:var(--amber);">Обратитесь к руководителю.</span>
                <span class="view-only-badge">🔒 Только просмотр</span>
            `;
        }
    } else {
        weekData.fromAttendance = false;
        console.log('✅ Загружены данные из salaryWeeks');
    }
    
    currentData = weekData;
    updateWeekLabel(dates);
    update();
    
    await renderEmployeeFinance();
    
    // Обработчики навигации
    document.getElementById('weekPrev').addEventListener('click', async () => {
        console.log('◀️ Предыдущая неделя');
        currentWeekOffset--;
        const dates = getWeekDatesUTC(currentWeekOffset);
        const weekKey = getWeekKeyUTC(dates[0]);
        updateWeekLabel(dates);
        let weekData = await loadWeekData(weekKey);
        if (!weekData) {
            weekData = buildDataFromAttendance(dates);
            weekData.fromAttendance = true;
        } else {
            weekData.fromAttendance = false;
        }
        currentData = weekData;
        update();
    });
    document.getElementById('weekNext').addEventListener('click', async () => {
        console.log('▶️ Следующая неделя');
        currentWeekOffset++;
        const dates = getWeekDatesUTC(currentWeekOffset);
        const weekKey = getWeekKeyUTC(dates[0]);
        updateWeekLabel(dates);
        let weekData = await loadWeekData(weekKey);
        if (!weekData) {
            weekData = buildDataFromAttendance(dates);
            weekData.fromAttendance = true;
        } else {
            weekData.fromAttendance = false;
        }
        currentData = weekData;
        update();
    });
    document.getElementById('weekToday').addEventListener('click', async () => {
        console.log('📅 Сегодня');
        currentWeekOffset = 0;
        const dates = getWeekDatesUTC(0);
        const weekKey = getWeekKeyUTC(dates[0]);
        updateWeekLabel(dates);
        let weekData = await loadWeekData(weekKey);
        if (!weekData) {
            weekData = buildDataFromAttendance(dates);
            weekData.fromAttendance = true;
        } else {
            weekData.fromAttendance = false;
        }
        currentData = weekData;
        update();
    });
    
    document.getElementById('copyBtn').addEventListener('click', async () => {
        const total = document.getElementById('totalOut').textContent;
        const dates = getWeekDatesUTC(currentWeekOffset);
        const mon = dates[0];
        const sun = dates[6];
        const text = `Зарплата за неделю ${formatDateDisplay(mon)}–${formatDateDisplay(sun)}: ${total} ₽`;
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
    
    console.log('✅ employee-view инициализирован (только просмотр)');
}

const style = document.createElement('style');
style.textContent = `
    .day-time-item .time-from-attendance {
        font-size: .45rem;
        color: var(--teal);
        font-family: var(--mono);
        margin-top: 1px;
    }
    .day-time-item.work-day {
        border-color: rgba(62,207,168,.3);
        background: rgba(62,207,168,.05);
    }
    .day-time-item.extra-day {
        border-color: var(--amber);
        background: rgba(255,181,46,.08);
    }
    .day-time-item.work-day .day-label {
        color: var(--teal);
    }
    .day-time-item.extra-day .day-label {
        color: var(--amber);
    }
`;
document.head.appendChild(style);

if (document.readyState === 'loading') {
    document.addEventListener('documentLoaded', init);
} else {
    init();
}