// employee.js
// Скрипт страницы сотрудника

const { db, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs } = window;

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
    otLimit: 5
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

function timeToHours(timeStr) {
    return timeToMinutes(timeStr) / 60;
}

function minutesToTime(minutes) {
    const h = Math.floor(minutes / 60);
    const m = Math.floor(minutes % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
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
                otLimit: data.otLimit || 5
            };
            console.log('⚙️ Настройки загружены:', settings);
            document.getElementById('rDay').value = settings.rDay;
            document.getElementById('rExtra').value = settings.rExtra;
            document.getElementById('rOt1').value = settings.rOt1;
            document.getElementById('rOt2').value = settings.rOt2;
            document.getElementById('otLimit').value = settings.otLimit;
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

function formatDate(d) {
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }).replace('.', '');
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

function update() {
    if (!currentData) return;
    const { workDays, hours, workStart, workEnd } = currentData;
    const dates = getWeekDates(currentWeekOffset);
    const weekKey = getWeekKey(dates[0]);
    const isFuture = isFutureWeek(weekKey);
    const rD = settings.rDay;
    const rE = settings.rExtra;
    const r1 = settings.rOt1;
    const r2 = settings.rOt2;
    const lim = settings.otLimit;
    
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
    
    // Обновляем дни
    document.querySelectorAll('#days .day').forEach((b, i) => {
        const on = workDays[i];
        b.classList.toggle('on', on);
        const dayIndex = workDays.slice(0, i).filter(Boolean).length;
        const isExtra = on && dayIndex >= 5;
        b.classList.toggle('extra', isExtra);
        const rate = isExtra ? rE : rD;
        b.querySelector('i').textContent = rate.toLocaleString() + ' ₽';
    });
    
    // Обновляем время
    updateTimeInputs();
    
    document.getElementById('dOut').textContent = days;
    document.getElementById('normOut').textContent = `норма: ${norm.toFixed(1).replace('.', ',')} ч (${days} дн × 8 ч)`;
    
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
    
    document.getElementById('qBase').textContent = `${workDays.slice(0, 5).filter(Boolean).length} дн × ${rD.toLocaleString()} ₽ (пропорционально)`;
    document.getElementById('vBase').textContent = payBase.toLocaleString() + ' ₽';
    
    const rowExtra = document.getElementById('rowExtra');
    const extraDaysCount = workDays.slice(5, 7).filter(Boolean).length;
    if (extraDaysCount === 0) {
        rowExtra.classList.add('gone');
    } else {
        rowExtra.classList.remove('gone');
        document.getElementById('qExtra').textContent = `${extraDaysCount} дн × ${rE.toLocaleString()} ₽ (пропорционально)`;
        document.getElementById('vExtra').textContent = payExtra.toLocaleString() + ' ₽';
    }
    
    const rowOt1 = document.getElementById('rowOt1');
    if (ot1 === 0) {
        rowOt1.classList.add('gone');
    } else {
        rowOt1.classList.remove('gone');
        document.getElementById('qOt1').textContent = `${formatHours(ot1)} ч × ${r1.toLocaleString()} ₽`;
        document.getElementById('vOt1').textContent = payOt1.toLocaleString() + ' ₽';
    }
    
    const rowOt2 = document.getElementById('rowOt2');
    if (ot2 === 0) {
        rowOt2.classList.add('gone');
    } else {
        rowOt2.classList.remove('gone');
        document.getElementById('qOt2').textContent = `${formatHours(ot2)} ч × ${r2.toLocaleString()} ₽`;
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
    if (payBase > 0) parts.push(`<b class="f-n">${(payBase / (rD || 1)).toFixed(2)}×${rD.toLocaleString()}</b>`);
    if (payExtra > 0) parts.push(`<b class="f-n">${(payExtra / (rE || 1)).toFixed(2)}×${rE.toLocaleString()}</b>`);
    if (ot1 > 0) parts.push(`<b class="f-1">${formatHours(ot1)}×${r1.toLocaleString()}</b>`);
    if (ot2 > 0) parts.push(`<b class="f-2">${formatHours(ot2)}×${r2.toLocaleString()}</b>`);
    document.getElementById('formula').innerHTML = parts.length ? parts.join(' + ') + ` = ${total.toLocaleString()} ₽` : '—';
    
    document.getElementById('metaLine').textContent =
        `отработано ${formatHours(totalHours)} ч · норма ${formatHours(norm)} ч`;
    
    document.getElementById('chip1').textContent = `1–5 день · ${rD.toLocaleString()} ₽`;
    document.getElementById('chip2').textContent = `6–7 день · ${rE.toLocaleString()} ₽`;
    document.getElementById('chip3').textContent = `переработка · ${r1.toLocaleString()} / ${r2.toLocaleString()} ₽/ч`;
    
    const mon = dates[0];
    const sun = dates[6];
    const weekLabel = `неделя №${weekKey.replace('W', '')} · ${formatDate(mon)} – ${formatDate(sun)}`;
    document.getElementById('eyebrow').textContent = `Табель · ${weekLabel}`;
    document.getElementById('wk').textContent = weekLabel;
    
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

function buildUI() {
    // Дни
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
    
    // Время по дням
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
    document.getElementById('weekRange').textContent = `${formatDate(mon)} – ${formatDate(sun)}`;
    document.getElementById('weekSub').textContent = isCurrent ? 'текущая неделя' : weekKey;
}

// ============================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================

async function init() {
    await loadSettings();
    await loadEmployeeInfo();
    buildUI();
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
        const text = `Зарплата за неделю ${formatDate(mon)}–${formatDate(sun)}: ${total} ₽`;
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