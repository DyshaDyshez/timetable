// stats-module.js
// Модуль статистики для админ-панели

export async function getEmployeeSettings(employeeId, db, doc, getDoc) {
    try {
        const docRef = doc(db, 'salarySettings', employeeId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            return {
                rDay: data.rDay || 3000,
                rExtra: data.rExtra || 3500,
                rOt1: data.rOt1 || 400,
                rOt2: data.rOt2 || 800,
                hpd: data.hpd || 8,
                otLimit: data.otLimit || 5
            };
        }
    } catch (error) {
        console.warn('Не удалось загрузить настройки:', error);
    }
    return {
        rDay: 3000,
        rExtra: 3500,
        rOt1: 400,
        rOt2: 800,
        hpd: 8,
        otLimit: 5
    };
}

export function calculateWeekStats(weekData, settings) {
    const workDays = weekData.workDays || [true, true, true, true, true, false, false];
    const hours = weekData.hours || [8, 8, 8, 8, 8, 0, 0];
    
    const rD = settings.rDay || 3000;
    const rE = settings.rExtra || 3500;
    const r1 = settings.rOt1 || 400;
    const r2 = settings.rOt2 || 800;
    const hpd = settings.hpd || 8;
    const lim = settings.otLimit || 5;
    
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
    
    return {
        days,
        totalHours,
        norm,
        baseDays,
        extraDays,
        ot,
        ot1,
        ot2,
        payBase,
        payExtra,
        payOt1,
        payOt2,
        total,
        workDays,
        hours
    };
}

export function getWeekNumber(weekKey) {
    const match = weekKey.match(/W(\d+)/);
    return match ? parseInt(match[1]) : weekKey;
}

export function getWeekDateRange(weekKey, year) {
    if (!year) {
        const yearMatch = weekKey.match(/^(\d+)-W/);
        year = yearMatch ? parseInt(yearMatch[1]) : new Date().getFullYear();
    }
    
    const weekNum = getWeekNumber(weekKey);
    const jan1 = new Date(year, 0, 1);
    const jan1Day = jan1.getDay();
    const daysToMonday = (jan1Day === 0) ? 6 : jan1Day - 1;
    const firstMonday = new Date(year, 0, 1 + daysToMonday);
    
    const startDate = new Date(firstMonday);
    startDate.setDate(firstMonday.getDate() + (weekNum - 1) * 7);
    
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 6);
    
    return { startDate, endDate };
}

export function formatDateRange(weekKey) {
    try {
        const yearMatch = weekKey.match(/^(\d+)-W/);
        const year = yearMatch ? parseInt(yearMatch[1]) : new Date().getFullYear();
        const { startDate, endDate } = getWeekDateRange(weekKey, year);
        
        const options = { day: '2-digit', month: 'short' };
        const start = startDate.toLocaleDateString('ru-RU', options);
        const end = endDate.toLocaleDateString('ru-RU', options);
        
        return `${start} – ${end}`;
    } catch (error) {
        console.warn('Ошибка форматирования даты для', weekKey, error);
        return weekKey;
    }
}

export async function updatePaidAmount(weekId, amount, db, doc, updateDoc) {
    try {
        await updateDoc(doc(db, 'salaryWeeks', weekId), {
            paidAmount: parseFloat(amount) || 0,
            paidAt: new Date().toISOString()
        });
        return true;
    } catch (error) {
        console.error('Ошибка сохранения выплаты:', error);
        return false;
    }
}

export function renderWeekDetailsModal(weekData, settings, employeeName, weekKey, weekId, db, doc, updateDoc, showNotification) {
    const oldModal = document.getElementById('weekDetailsModal');
    if (oldModal) oldModal.remove();
    
    const stats = calculateWeekStats(weekData, settings);
    const weekNum = getWeekNumber(weekKey);
    const dateRange = formatDateRange(weekKey);
    const paidAmount = weekData.paidAmount || 0;
    const isPaid = weekData.isPaid || false;
    
    const modal = document.createElement('div');
    modal.id = 'weekDetailsModal';
    modal.className = 'modal active';
    modal.style.display = 'block';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 600px;">
            <button class="modal-close" id="closeWeekDetails">&times;</button>
            <h2 style="font-family: var(--display); color: var(--amber); margin-bottom: 8px;">
                📊 ${employeeName}
            </h2>
            <div style="color: var(--mut); font-size: .85rem; margin-bottom: 16px;">
                Неделя ${weekNum} · ${dateRange}
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px;">
                <div style="background: rgba(255,255,255,.05); padding: 12px; border-radius: 8px; text-align: center;">
                    <div style="color: var(--mut); font-size: .7rem;">Рабочих дней</div>
                    <div style="font-size: 2rem; font-weight: bold; color: var(--amber2);">${stats.days}</div>
                </div>
                <div style="background: rgba(255,255,255,.05); padding: 12px; border-radius: 8px; text-align: center;">
                    <div style="color: var(--mut); font-size: .7rem;">Часов</div>
                    <div style="font-size: 2rem; font-weight: bold; color: var(--amber2);">${stats.totalHours}</div>
                </div>
                <div style="background: rgba(255,255,255,.05); padding: 12px; border-radius: 8px; text-align: center;">
                    <div style="color: var(--mut); font-size: .7rem;">Норма</div>
                    <div style="font-size: 1.2rem; font-weight: bold; color: var(--teal);">${stats.norm} ч</div>
                </div>
                <div style="background: rgba(255,255,255,.05); padding: 12px; border-radius: 8px; text-align: center;">
                    <div style="color: var(--mut); font-size: .7rem;">Переработка</div>
                    <div style="font-size: 1.2rem; font-weight: bold; color: ${stats.ot > 0 ? 'var(--amber)' : 'var(--mut)'};">${stats.ot > 0 ? stats.ot + ' ч' : '—'}</div>
                </div>
            </div>
            
            <div style="background: rgba(255,181,46,.08); padding: 16px; border-radius: 8px; margin-bottom: 16px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="color: var(--mut); font-size: .8rem;">Расчётная сумма</span>
                    <span style="font-size: 2rem; font-weight: bold; color: var(--amber);">${stats.total.toLocaleString()} ₽</span>
                </div>
            </div>
            
            <div style="background: rgba(62,207,168,.08); padding: 16px; border-radius: 8px; margin-bottom: 16px; border: 1px solid var(--teal);">
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
                    <span style="color: var(--mut); font-size: .8rem;">💰 Фактически выплачено</span>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <input type="number" id="paidInput" value="${paidAmount}" 
                               style="width: 140px; padding: 8px 12px; border-radius: 8px; 
                                      border: 1px solid var(--line); background: var(--bg2); color: var(--txt); 
                                      font-size: 1.1rem; text-align: right;">
                        <span style="font-weight: bold; font-size: 1.1rem;">₽</span>
                        <button id="savePaidBtn" 
                                style="background: var(--teal); color: #0c1520; border: none; 
                                       padding: 8px 16px; border-radius: 8px; cursor: pointer; font-weight: bold;">
                            Сохранить
                        </button>
                    </div>
                </div>
                <div style="margin-top: 8px; font-size: .7rem; color: var(--mut);">
                    ${isPaid ? '✅ Отмечено как выплачено' : '⏳ Ожидает выплаты'}
                </div>
            </div>
            
            <div style="border-top: 1px solid var(--line); padding-top: 16px; margin-bottom: 16px;">
                <div style="color: var(--mut); font-size: .7rem; margin-bottom: 10px;">Расписание по дням:</div>
                <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px;">
                    ${['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map((day, i) => `
                        <div style="text-align: center; padding: 6px 2px; border-radius: 6px; 
                            background: ${stats.workDays[i] ? 'rgba(62,207,168,.2)' : 'rgba(255,255,255,.05)'};
                            border: 1px solid ${stats.workDays[i] ? 'var(--teal)' : 'var(--line)'};
                            color: ${stats.workDays[i] ? 'var(--txt)' : 'var(--mut)'};">
                            <div style="font-size: .55rem; color: var(--mut);">${day}</div>
                            <div style="font-weight: bold; font-size: .9rem;">${stats.hours[i]}ч</div>
                        </div>
                    `).join('')}
                </div>
            </div>
            
            <div style="font-size: .7rem; color: var(--mut); border-top: 1px solid var(--line); padding-top: 12px;">
                ${stats.baseDays > 0 ? `${stats.baseDays}×${settings.rDay.toLocaleString()} ₽` : ''}
                ${stats.extraDays > 0 ? ` + ${stats.extraDays}×${settings.rExtra.toLocaleString()} ₽` : ''}
                ${stats.ot1 > 0 ? ` + ${stats.ot1}×${settings.rOt1.toLocaleString()} ₽` : ''}
                ${stats.ot2 > 0 ? ` + ${stats.ot2}×${settings.rOt2.toLocaleString()} ₽` : ''}
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    const savePaidBtn = modal.querySelector('#savePaidBtn');
    const paidInput = modal.querySelector('#paidInput');
    
    savePaidBtn.addEventListener('click', async () => {
        const amount = parseFloat(paidInput.value) || 0;
        const success = await updatePaidAmount(weekId, amount, db, doc, updateDoc);
        if (success) {
            showNotification('✅ Сумма выплаты сохранена!');
            const statsData = window._statsData;
            if (statsData) {
                const weekIndex = statsData.weeks.findIndex(w => w.id === weekId);
                if (weekIndex !== -1) {
                    statsData.weeks[weekIndex].paidAmount = amount;
                    statsData.weeks[weekIndex].isPaid = true;
                    renderStats(
                        statsData.employeeId,
                        statsData.employeeName,
                        db, collection, doc, query, where, getDocs, getDoc,
                        showNotification
                    );
                }
            }
            modal.remove();
        } else {
            showNotification('❌ Ошибка сохранения', true);
        }
    });
    
    modal.querySelector('#closeWeekDetails').addEventListener('click', () => {
        modal.remove();
    });
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
}

export async function renderStats(employeeId, employeeName, db, collection, doc, query, where, getDocs, getDoc, showNotification) {
    const oldModal = document.getElementById('statsModal');
    if (oldModal) oldModal.remove();
    
    const settings = await getEmployeeSettings(employeeId, db, doc, getDoc);
    
    const weeksRef = collection(db, 'salaryWeeks');
    const q = query(weeksRef, where('employeeId', '==', employeeId));
    const snapshot = await getDocs(q);
    
    const weeks = [];
    snapshot.forEach((doc) => {
        weeks.push({ id: doc.id, ...doc.data() });
    });
    
    // ===== СОРТИРОВКА: СТАРЫЕ → НОВЫЕ (по возрастанию) =====
    weeks.sort((a, b) => a.weekKey.localeCompare(b.weekKey));
    
    window._statsData = { weeks, settings, employeeName, employeeId };
    
    let showArchived = false;
    
    const modal = document.createElement('div');
    modal.id = 'statsModal';
    modal.className = 'modal active';
    modal.style.display = 'block';
    
    let bodyHTML = `
        <div class="modal-content" style="max-width: 1000px;">
            <button class="modal-close" id="closeStatsModal">&times;</button>
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 8px;">
                <h2 style="font-family: var(--display); color: var(--amber); margin: 0;">
                    📊 ${employeeName}
                </h2>
                <button id="toggleArchiveBtn" 
                        style="background: rgba(255,255,255,.1); border: 1px solid var(--line); 
                               color: var(--txt); padding: 6px 16px; border-radius: 8px; cursor: pointer; 
                               font-size: .8rem; transition: .2s;">
                    📂 Показать архив
                </button>
            </div>
            <div style="color: var(--mut); font-size: .85rem; margin-bottom: 20px;">
                Всего недель: ${weeks.length}
                <span style="margin-left: 16px;">⚙️ Ставка: ${settings.rDay.toLocaleString()}₽ / ${settings.rExtra.toLocaleString()}₽</span>
            </div>
    `;
    
    if (weeks.length === 0) {
        bodyHTML += `
            <div style="text-align:center; padding: 40px; color: var(--mut);">
                Нет данных. Сотрудник ещё не заполнял расписание.
            </div>
        `;
    } else {
        bodyHTML += `
            <div style="overflow-x:auto;">
                <table class="stats-table" id="statsTable">
                    <thead>
                        <tr>
                            <th>Неделя</th>
                            <th style="min-width: 120px;">Период</th>
                            <th>Дней</th>
                            <th>Часов</th>
                            <th>Переработка</th>
                            <th style="text-align:right;">Расчёт</th>
                            <th style="text-align:right;">Выплачено</th>
                            <th style="text-align:center;">Детали</th>
                        </tr>
                    </thead>
                    <tbody id="statsBody">
        `;
        
        let totalDays = 0;
        let totalHours = 0;
        let totalPay = 0;
        let totalPaid = 0;
        let visibleCount = 0;
        
        weeks.forEach((week, index) => {
            const stats = calculateWeekStats(week, settings);
            const weekNum = getWeekNumber(week.weekKey);
            const dateRange = formatDateRange(week.weekKey);
            const paidAmount = week.paidAmount || 0;
            const isArchived = week.isArchived || false;
            
            if (!isArchived) {
                totalDays += stats.days;
                totalHours += stats.totalHours;
                totalPay += stats.total;
                totalPaid += paidAmount;
                visibleCount++;
            }
            
            const rowClass = isArchived ? 'archived-row' : '';
            const displayStyle = isArchived ? 'style="display: none;"' : '';
            
            bodyHTML += `
                <tr class="${rowClass}" data-archived="${isArchived}" ${displayStyle}>
                    <td><b>${weekNum}</b></td>
                    <td style="font-size: .8rem; color: var(--mut);">${dateRange}</td>
                    <td>${stats.days}</td>
                    <td>${stats.totalHours} ч</td>
                    <td>${stats.ot > 0 ? stats.ot + ' ч' : '—'}</td>
                    <td style="text-align:right;"><b>${stats.total.toLocaleString()} ₽</b></td>
                    <td style="text-align:right; color: ${paidAmount > 0 ? 'var(--teal)' : 'var(--mut)'};">
                        ${paidAmount > 0 ? paidAmount.toLocaleString() + ' ₽' : '—'}
                    </td>
                    <td style="text-align:center;">
                        <button onclick="window.showWeekDetails('${week.id}')" 
                                style="background: rgba(255,181,46,.15); border: 1px solid var(--amber); 
                                       color: var(--amber2); padding: 4px 10px; border-radius: 6px; 
                                       cursor: pointer; font-size: .7rem; margin: 2px;">
                            👁️
                        </button>
                        <button onclick="window.toggleArchive('${week.id}', ${isArchived})" 
                                style="background: ${isArchived ? 'rgba(62,207,168,.15)' : 'rgba(255,255,255,.05)'}; 
                                       border: 1px solid ${isArchived ? 'var(--teal)' : 'var(--line)'}; 
                                       color: ${isArchived ? 'var(--teal)' : 'var(--mut)'}; 
                                       padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: .7rem; margin: 2px;">
                            ${isArchived ? '📤' : '📥'}
                        </button>
                    </td>
                </tr>
            `;
        });
        
        bodyHTML += `
                    <tr style="border-top: 2px solid var(--amber);">
                        <td><b style="color: var(--amber);">📊 ИТОГО</b></td>
                        <td style="font-size: .7rem; color: var(--mut);">${visibleCount} недель</td>
                        <td><b>${totalDays}</b></td>
                        <td><b>${totalHours} ч</b></td>
                        <td>—</td>
                        <td style="text-align:right;"><b style="color: var(--amber); font-size: 1.1rem;">${totalPay.toLocaleString()} ₽</b></td>
                        <td style="text-align:right;"><b style="color: var(--teal); font-size: 1.1rem;">${totalPaid.toLocaleString()} ₽</b></td>
                        <td></td>
                    </tr>
        `;
        
        bodyHTML += `
                    </tbody>
                </table>
            </div>
            <div style="margin-top: 8px; font-size: .7rem; color: var(--mut);">
                💡 Кнопка ${'📥'} — архив (скрыть неделю) · ${'📤'} — восстановить из архива
            </div>
        `;
    }
    
    bodyHTML += `
            <div style="margin-top: 16px; font-size: .7rem; color: var(--mut); border-top: 1px solid var(--line); padding-top: 12px;">
                ⚙️ Ставки: ${settings.rDay.toLocaleString()}₽ / ${settings.rExtra.toLocaleString()}₽ · 
                переработка ${settings.rOt1.toLocaleString()}₽ / ${settings.rOt2.toLocaleString()}₽ · 
                норма ${settings.hpd}ч · лимит переработки ${settings.otLimit}ч
            </div>
        </div>
    `;
    
    modal.innerHTML = bodyHTML;
    document.body.appendChild(modal);
    
    const toggleBtn = modal.querySelector('#toggleArchiveBtn');
    let archiveVisible = false;
    
    toggleBtn.addEventListener('click', () => {
        archiveVisible = !archiveVisible;
        const rows = modal.querySelectorAll('.archived-row');
        rows.forEach(row => {
            row.style.display = archiveVisible ? '' : 'none';
        });
        toggleBtn.textContent = archiveVisible ? '📂 Скрыть архив' : '📂 Показать архив';
        toggleBtn.style.borderColor = archiveVisible ? 'var(--amber)' : 'var(--line)';
    });
    
    modal.querySelector('#closeStatsModal').addEventListener('click', () => {
        modal.remove();
    });
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
}

window.toggleArchive = async function(weekId, currentStatus) {
    try {
        const { db, doc, updateDoc } = window;
        await updateDoc(doc(db, 'salaryWeeks', weekId), {
            isArchived: !currentStatus
        });
        
        const statsData = window._statsData;
        if (statsData) {
            const weekIndex = statsData.weeks.findIndex(w => w.id === weekId);
            if (weekIndex !== -1) {
                statsData.weeks[weekIndex].isArchived = !currentStatus;
            }
            renderStats(
                statsData.employeeId,
                statsData.employeeName,
                db, collection, doc, query, where, getDocs, getDoc,
                window.showNotification || console.log
            );
        }
    } catch (error) {
        console.error('Ошибка переключения архива:', error);
        alert('❌ Ошибка: ' + error.message);
    }
};

window.showWeekDetails = function(weekId) {
    const data = window._statsData;
    if (!data) return;
    const week = data.weeks.find(w => w.id === weekId);
    if (!week) return;
    renderWeekDetailsModal(
        week, 
        data.settings, 
        data.employeeName, 
        week.weekKey, 
        weekId,
        window.db,
        window.doc,
        window.updateDoc,
        window.showNotification || console.log
    );
};