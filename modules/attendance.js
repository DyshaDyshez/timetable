// modules/attendance.js
// Единый модуль для работы с отметками и расчёта часов

/**
 * Рассчитывает общее время работы за день на основе логов отметок
 * @param {Array} logs - массив объектов { timestamp, type }
 * @returns {Object} - { totalMinutes, totalHours, totalHoursDecimal, segments, isOpen }
 */
export function calculateDayHoursFromLogs(logs) {
    if (!logs || logs.length === 0) {
        return { totalMinutes: 0, totalHours: '0ч 0м', totalHoursDecimal: 0, segments: [], isOpen: false };
    }
    
    // ===== 1. СОРТИРУЕМ ПО ВРЕМЕНИ =====
    const sorted = [...logs].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    
    // ===== 2. ФИЛЬТРУЕМ — УДАЛЯЕМ ДУБЛИРУЮЩИЕСЯ ПОДРЯД =====
    const filtered = [];
    let lastType = null;
    for (const log of sorted) {
        if (log.type !== lastType) {
            filtered.push(log);
            lastType = log.type;
        } else {
            console.log(`⏭️ Пропущен дубликат: ${log.type} ${log.timestamp}`);
        }
    }
    
    // ===== 3. ЕСЛИ НАЧИНАЕТСЯ С "out" — ПРОПУСКАЕМ ЕГО =====
    let startIndex = 0;
    if (filtered.length > 0 && filtered[0].type === 'out') {
        startIndex = 1;
        console.log(`⏭️ Пропущен начальный "out": ${filtered[0].timestamp}`);
    }
    
    // ===== 4. ЕСЛИ ЗАКАНЧИВАЕТСЯ НА "in" — СЧИТАЕМ ДО ТЕКУЩЕГО МОМЕНТА =====
    const segments = [];
    let totalMinutes = 0;
    const now = new Date();
    
    for (let i = startIndex; i < filtered.length; i++) {
        const current = filtered[i];
        
        if (current.type === 'out' && segments.length === 0) {
            console.log(`⏭️ Пропущен "out" без "in": ${current.timestamp}`);
            continue;
        }
        
        if (current.type === 'in') {
            const startTime = new Date(current.timestamp);
            let endTime;
            let isOpen = false;
            
            let nextOut = null;
            for (let j = i + 1; j < filtered.length; j++) {
                if (filtered[j].type === 'out') {
                    nextOut = filtered[j];
                    break;
                }
            }
            
            if (nextOut) {
                endTime = new Date(nextOut.timestamp);
                isOpen = false;
                i++; // перепрыгиваем через out
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
    const totalHoursDecimal = Math.round((totalMinutes / 60) * 100) / 100;
    
    return {
        totalMinutes,
        totalHours: `${hours}ч ${minutes}м`,
        totalHoursDecimal,
        segments,
        isOpen: segments.some(s => s.isOpen)
    };
}

/**
 * Строит данные недели из отметок для сотрудника
 * @param {string} employeeId - ID сотрудника
 * @param {Array} weekDates - массив объектов Date на неделю (7 дней)
 * @param {Object} allAttendance - объект { 'employeeId_date': [logs] }
 * @param {number} defaultHoursPerDay - часы по умолчанию (для пустых дней)
 * @returns {Object} - { workDays, hours, workStart, workEnd, fromAttendance }
 */
export function buildWeekDataFromAttendance(employeeId, weekDates, allAttendance, defaultHoursPerDay = 8) {
    const workDays = [false, false, false, false, false, false, false];
    const hours = [0, 0, 0, 0, 0, 0, 0];
    const workStart = ['', '', '', '', '', '', ''];
    const workEnd = ['', '', '', '', '', '', ''];
    let hasAnyData = false;
    
    weekDates.forEach((dateObj, index) => {
        const dateStr = dateObj.toISOString().slice(0, 10);
        const key = employeeId + '_' + dateStr;
        const logs = allAttendance[key] || [];
        
        if (logs.length > 0) {
            hasAnyData = true;
            workDays[index] = true;
            
            const dayInfo = calculateDayHoursFromLogs(logs);
            
            // Находим первый "in" и последний "out" для отображения времени
            const sorted = [...logs].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
            const firstIn = sorted.find(l => l.type === 'in');
            // Ищем последний "out" (который реально использовался)
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
            
            hours[index] = Math.round(dayInfo.totalHoursDecimal * 100) / 100;
        }
    });
    
    return {
        workDays,
        hours,
        workStart,
        workEnd,
        fromAttendance: hasAnyData
    };
}