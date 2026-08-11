// employee.js
// Скрипт страницы сотрудника

const { db, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs } = window;

// Получаем ID сотрудника из URL
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

// Глобальные переменные
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
    hpd: 8,
    otLimit: 5
};

// Константы
const DAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

// ============================================
// ЗАГРУЗКА ИНФОРМАЦИИ О СОТРУДНИКЕ
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
            console.log('🏠 Комната:', employeeRoomId);
            
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

// ============================================
// ЗАГРУЗКА НАСТРОЕК ИЗ БАЗЫ
// ============================================

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
                hpd: data.hpd || 8,
                otLimit: data.otLimit || 5
            };
            console.log('⚙️ Настройки загружены:', settings);
            
            document.getElementById('rDay').value = settings.rDay;
            document.getElementById('rExtra').value = settings.rExtra;
            document.getElementById('rOt1').value = settings.rOt1;
            document.getElementById('rOt2').value = settings.rOt2;
            document.getElementById('hpd').value = settings.hpd;
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
            hpd: settings.hpd,
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

// Проверяем, является ли неделя будущей (начинается после сегодня)
function isFutureWeek(weekKey) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const todayMonday = getMonday(today);
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
// РАБОТА С БАЗОЙ ДАННЫХ (НЕДЕЛИ)
// ============================================

async function loadWeekData(weekKey) {
    try {
        const docRef = doc(db, 'salaryWeeks', `${EMPLOYEE_ID}_${weekKey}`);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            const data = docSnap.data();
            return {
                workDays: data.workDays || [true, true, true, true, true, false, false],
                hours: data.hours || [8, 8, 8, 8, 8, 0, 0],
                isPaid: data.isPaid || false
            };
        } else {
            return {
                workDays: [true, true, true, true, true, false, false],
                hours: [8, 8, 8, 8, 8, 0, 0],
                isPaid: false
            };
        }
    } catch (error) {
        console.error('Ошибка загрузки:', error);
        return {
            workDays: [true, true, true, true, true, false, false],
            hours: [8, 8, 8, 8, 8, 0, 0],
            isPaid: false
        };
    }
}

async function saveWeekData(weekKey, workDays, hours) {
    if (isSaving) return;
    isSaving = true;
    
    try {
        const docRef = doc(db, 'salaryWeeks', `${EMPLOYEE_ID}_${weekKey}`);
        const data = {
            employeeId: EMPLOYEE_ID,
            weekKey: weekKey,
            workDays: workDays,
            hours: hours,
            isPaid: currentData?.isPaid || false,
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

// ============================================
// ОЧИСТКА БУДУЩИХ НЕДЕЛЬ (УЛУЧШЕННАЯ)
// ============================================
async function clearFutureWeeks() {
    const dates = getWeekDates(0);
    const currentWeekKey = getWeekKey(dates[0]);
    
    // Проверяем, есть ли будущие недели
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
    
    // Показываем список недель, которые будут удалены
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
            const docRef = doc(db, 'salaryWeeks', week.id);
            await deleteDoc(docRef);
            deletedCount++;
            console.log(`🗑️ Удалена неделя: ${week.weekKey}`);
        } catch (error) {
            console.error('Ошибка удаления недели:', week.weekKey, error);
        }
    }
    
    showSaveIndicator(`✅ Очищено ${deletedCount} будущих недель`);
    
    // 👇 ВАЖНО: Возвращаемся на текущую неделю и перезагружаем данные
    currentWeekOffset = 0;
    const newDates = getWeekDates(0);
    const newWeekKey = getWeekKey(newDates[0]);
    updateWeekLabel(newDates);
    currentData = await loadWeekData(newWeekKey);
    if (!currentData) {
        currentData = {
            workDays: [true, true, true, true, true, false, false],
            hours: [settings.hpd, settings.hpd, settings.hpd, settings.hpd, settings.hpd, 0, 0],
            isPaid: false
        };
    }
    update();
    
    // 👇 ВАЖНО: Обновляем статистику у админа (если она открыта)
    // Отправляем событие, чтобы админская статистика обновилась
    try {
        // Попытка обновить статистику через глобальную функцию
        if (window.updateStatsAfterClear) {
            await window.updateStatsAfterClear(EMPLOYEE_ID);
        }
    } catch (e) {
        console.log('Статистика не обновлена (возможно, не открыта)');
    }
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

function update() {
    if (!currentData) return;
    
    const { workDays, hours } = currentData;
    const dates = getWeekDates(currentWeekOffset);
    const weekKey = getWeekKey(dates[0]);
    
    const isFuture = isFutureWeek(weekKey);
    
    const rD = settings.rDay;
    const rE = settings.rExtra;
    const r1 = settings.rOt1;
    const r2 = settings.rOt2;
    const hpd = settings.hpd;
    const lim = settings.otLimit;
    
    const days = workDays.filter(Boolean).length;
    const totalHours = hours.reduce((a, b) => a + b, 0);
    const norm = days * hpd;
    const baseDays = Math.min(days, 5);
    const extraDays = Math.max(0, days - 5);
    const ot = Math.max(0, totalHours - norm);
    const ot1 = Math.min(ot, lim);
    const ot2 = Math.max(0, ot - lim);
    
    const payBase = baseDays * rD;
    const payExtra = extraDays * rE;
    const payOt1 = ot1 * r1;
    const payOt2 = ot2 * r2;
    const total = payBase + payExtra + payOt1 + payOt2;
    
    document.querySelectorAll('#days .day').forEach((b, i) => {
        const on = workDays[i];
        b.classList.toggle('on', on);
        const dayIndex = workDays.slice(0, i).filter(Boolean).length;
        const isExtra = on && dayIndex >= 5;
        b.classList.toggle('extra', isExtra);
        const rate = isExtra ? rE : rD;
        b.querySelector('i').textContent = rate.toLocaleString() + ' ₽';
    });
    
    document.querySelectorAll('#dayHours .dh-item input').forEach((inp, i) => {
        inp.disabled = !workDays[i];
        if (!workDays[i]) {
            inp.value = 0;
        } else if (parseFloat(inp.value) !== hours[i]) {
            inp.value = hours[i];
        }
    });
    
    document.getElementById('dOut').textContent = days;
    document.getElementById('normOut').textContent = `норма: ${norm} ч (${days} дн × ${hpd} ч)`;
    
    const otB = document.getElementById('otBadge');
    const uwB = document.getElementById('uwBadge');
    
    if (ot > 0) {
        otB.hidden = false;
        otB.textContent = `переработка +${ot} ч`;
        otB.className = 'badge ' + (ot2 > 0 ? 'hot' : 'ot');
    } else {
        otB.hidden = true;
    }
    
    if (days > 0 && totalHours < norm) {
        uwB.hidden = false;
        uwB.textContent = `меньше нормы на ${norm - totalHours} ч — переработки нет`;
    } else {
        uwB.hidden = true;
    }
    
    document.getElementById('qBase').textContent = `${baseDays} × ${rD.toLocaleString()} ₽`;
    document.getElementById('vBase').textContent = payBase.toLocaleString() + ' ₽';
    
    const rowExtra = document.getElementById('rowExtra');
    if (extraDays === 0) {
        rowExtra.classList.add('gone');
    } else {
        rowExtra.classList.remove('gone');
        document.getElementById('qExtra').textContent = `${extraDays} × ${rE.toLocaleString()} ₽`;
        document.getElementById('vExtra').textContent = payExtra.toLocaleString() + ' ₽';
    }
    
    const rowOt1 = document.getElementById('rowOt1');
    if (ot1 === 0) {
        rowOt1.classList.add('gone');
    } else {
        rowOt1.classList.remove('gone');
        document.getElementById('qOt1').textContent = `${ot1} ч × ${r1.toLocaleString()} ₽`;
        document.getElementById('vOt1').textContent = payOt1.toLocaleString() + ' ₽';
    }
    
    const rowOt2 = document.getElementById('rowOt2');
    if (ot2 === 0) {
        rowOt2.classList.add('gone');
    } else {
        rowOt2.classList.remove('gone');
        document.getElementById('qOt2').textContent = `${ot2} ч × ${r2.toLocaleString()} ₽`;
        document.getElementById('vOt2').textContent = payOt2.toLocaleString() + ' ₽';
    }
    
    const scale = Math.max(totalHours, norm, 1);
    document.getElementById('bNorm').style.width = (Math.min(totalHours, norm) / scale * 100) + '%';
    document.getElementById('bOt1').style.width = (ot1 / scale * 100) + '%';
    document.getElementById('bOt2').style.width = (ot2 / scale * 100) + '%';
    document.getElementById('lNorm').textContent = Math.min(totalHours, norm) + ' ч';
    document.getElementById('lOt1').textContent = ot1 + ' ч';
    document.getElementById('lOt2').textContent = ot2 + ' ч';
    
    document.getElementById('totalOut').textContent = total.toLocaleString();
    
    const stamp = document.getElementById('stamp');
    stamp.classList.remove('pop');
    void stamp.offsetWidth;
    stamp.classList.add('pop');
    
    const parts = [];
    if (baseDays) parts.push(`<b class="f-n">${baseDays}×${rD.toLocaleString()}</b>`);
    if (extraDays) parts.push(`<b class="f-n">${extraDays}×${rE.toLocaleString()}</b>`);
    if (ot1) parts.push(`<b class="f-1">${ot1}×${r1.toLocaleString()}</b>`);
    if (ot2) parts.push(`<b class="f-2">${ot2}×${r2.toLocaleString()}</b>`);
    document.getElementById('formula').innerHTML = parts.length ? parts.join(' + ') + ` = ${total.toLocaleString()} ₽` : '—';
    
    document.getElementById('metaLine').textContent =
        `отработано ${totalHours} ч · норма ${norm} ч` +
        (totalHours > 0 && total > 0 ? ` · ≈ ${Math.round(total/totalHours)} ₽/час` : '');
    
    document.getElementById('chip1').textContent = `1–5 день · ${rD.toLocaleString()} ₽`;
    document.getElementById('chip2').textContent = `6–7 день · ${rE.toLocaleString()} ₽`;
    document.getElementById('chip3').textContent = `переработка · ${r1.toLocaleString()} / ${r2.toLocaleString()} ₽/ч`;
    
    const mon = dates[0];
    const sun = dates[6];
    const weekLabel = `неделя №${weekKey.replace('W', '')} · ${formatDate(mon)} – ${formatDate(sun)}`;
    document.getElementById('eyebrow').textContent = `Табель · ${weekLabel}`;
    document.getElementById('wk').textContent = weekLabel;
    
    // Показываем предупреждение, если неделя будущая
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
    const daysBox = document.getElementById('days');
    const dhBox = document.getElementById('dayHours');
    
    daysBox.innerHTML = '';
    dhBox.innerHTML = '';
    
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
                currentData.hours[i] = settings.hpd;
            } else {
                currentData.hours[i] = 0;
            }
            update();
            const dates = getWeekDates(currentWeekOffset);
            const weekKey = getWeekKey(dates[0]);
            await saveWeekData(weekKey, currentData.workDays, currentData.hours);
        });
        daysBox.appendChild(b);
        
        const div = document.createElement('div');
        div.className = 'dh-item';
        div.dataset.i = i;
        div.innerHTML = `
            <label>${n}</label>
            <input type="number" min="0" max="24" step="1" value="0">
        `;
        const inp = div.querySelector('input');
        inp.addEventListener('input', async (e) => {
            if (!currentData) return;
            const v = parseFloat(e.target.value);
            if (!isNaN(v) && v >= 0 && v <= 24) {
                currentData.hours[i] = v;
                update();
                const dates = getWeekDates(currentWeekOffset);
                const weekKey = getWeekKey(dates[0]);
                await saveWeekData(weekKey, currentData.workDays, currentData.hours);
            }
        });
        inp.addEventListener('blur', (e) => {
            let v = parseFloat(e.target.value);
            if (isNaN(v) || v < 0) v = 0;
            if (v > 24) v = 24;
            e.target.value = v;
            if (currentData) {
                currentData.hours[i] = v;
                update();
            }
        });
        dhBox.appendChild(div);
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
            hours: [settings.hpd, settings.hpd, settings.hpd, settings.hpd, settings.hpd, 0, 0],
            isPaid: false
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
                hours: [settings.hpd, settings.hpd, settings.hpd, settings.hpd, settings.hpd, 0, 0],
                isPaid: false
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
                hours: [settings.hpd, settings.hpd, settings.hpd, settings.hpd, settings.hpd, 0, 0],
                isPaid: false
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
                hours: [settings.hpd, settings.hpd, settings.hpd, settings.hpd, settings.hpd, 0, 0],
                isPaid: false
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
            update();
            const dates = getWeekDates(currentWeekOffset);
            const weekKey = getWeekKey(dates[0]);
            await saveWeekData(weekKey, currentData.workDays, currentData.hours);
        }
    });
    
    document.getElementById('dPlus').addEventListener('click', async () => {
        if (!currentData) return;
        const idx = currentData.workDays.indexOf(false);
        if (idx !== -1) {
            currentData.workDays[idx] = true;
            currentData.hours[idx] = settings.hpd;
            update();
            const dates = getWeekDates(currentWeekOffset);
            const weekKey = getWeekKey(dates[0]);
            await saveWeekData(weekKey, currentData.workDays, currentData.hours);
        }
    });
    
    // ===== ОБРАБОТЧИКИ ДЛЯ СТАВОК =====
    const settingsFields = ['rDay', 'rExtra', 'rOt1', 'rOt2', 'hpd', 'otLimit'];
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
    
    // ===== КНОПКА ОЧИСТКИ БУДУЩИХ НЕДЕЛЬ =====
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
            hours: [settings.hpd, settings.hpd, settings.hpd, settings.hpd, settings.hpd, 0, 0],
            isPaid: false
        };
        update();
        await saveWeekData(weekKey, currentData.workDays, currentData.hours);
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

// ============================================
// ДОБАВЛЯЕМ СТИЛИ
// ============================================

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

// ============================================
// ЗАПУСК
// ============================================

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}