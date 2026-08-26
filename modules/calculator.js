// modules/calculator.js
// Единый модуль для всех расчетов зарплаты

/**
 * Расчет зарплаты за неделю
 * @param {Object} weekData - данные недели { workDays, hours }
 * @param {Object} settings - настройки { rDay, rExtra, rOt1, rOt2, hpd, otLimit }
 * @returns {Object} - детальный расчет
 */
export function calculateWeekPay(weekData, settings = {}) {
    const workDays = weekData.workDays || [true, true, true, true, true, false, false];
    const hours = weekData.hours || [8, 8, 8, 8, 8, 0, 0];
    
    const rD = settings.rDay || 3000;
    const rE = settings.rExtra || 3500;
    const r1 = settings.rOt1 || 400;
    const r2 = settings.rOt2 || 800;
    const hpd = settings.hpd || 8;
    const lim = settings.otLimit || 5;
    
    // Собираем рабочие дни (только где часы > 0)
    const workingDays = [];
    for (let i = 0; i < workDays.length; i++) {
        if (workDays[i] && hours[i] > 0) {
            workingDays.push({ index: i, hours: hours[i] });
        }
    }
    
    const daysCount = workingDays.length;
    let totalHours = 0;
    let payBase = 0;      // оплата за первые 5 дней (пропорционально)
    let payExtra = 0;     // оплата за 6-й и 7-й дни (пропорционально)
    let otHours = 0;      // сумма переработки (часы сверх 8)
    
    for (let i = 0; i < workingDays.length; i++) {
        const day = workingDays[i];
        const dayHours = day.hours;
        totalHours += dayHours;
        
        // Определяем ставку для этого дня (первый параметр - номер дня по порядку)
        const dayIndex = i; // 0-based
        const isExtraDay = dayIndex >= 5;
        const dayRate = isExtraDay ? rE : rD;
        
        if (dayHours <= hpd) {
            // Оплата пропорционально отработанным часам
            const pay = (dayHours / hpd) * dayRate;
            if (isExtraDay) {
                payExtra += pay;
            } else {
                payBase += pay;
            }
        } else {
            // Оплата: полная ставка + переработка
            const basePay = dayRate;
            const otThisDay = dayHours - hpd;
            otHours += otThisDay;
            if (isExtraDay) {
                payExtra += basePay;
            } else {
                payBase += basePay;
            }
        }
    }
    
    // Разбиваем переработку на ot1 и ot2
    const ot1 = Math.min(otHours, lim);
    const ot2 = Math.max(0, otHours - lim);
    const payOt1 = ot1 * r1;
    const payOt2 = ot2 * r2;
    
    const total = payBase + payExtra + payOt1 + payOt2;
    const norm = daysCount * hpd;
    const ot = otHours;
    
    return {
        days: daysCount,
        totalHours,
        norm,
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

/**
 * Получить сумму к выплате с учётом погашенных авансов
 * @param {Object} weekData - данные недели (с полем repaidAmount)
 * @param {Object} settings - настройки
 * @returns {Object} - результат с полем finalPay
 */
export function getFinalPay(weekData, settings = {}) {
    const stats = calculateWeekPay(weekData, settings);
    const repaidAmount = weekData.repaidAmount || 0;
    return {
        ...stats,
        repaidAmount,
        finalPay: stats.total - repaidAmount
    };
}