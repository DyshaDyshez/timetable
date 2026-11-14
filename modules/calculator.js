// modules/calculator.js
// Единый модуль для всех расчетов зарплаты

/**
 * Расчет зарплаты за неделю
 * @param {Object} weekData - данные недели { workDays, hours }
 * @param {Object} settings - настройки { rDay, rExtra, rOt1, rOt2, hpd, otLimit, sundayBonusEnabled, sundayBonusAmount }
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
    
    // ★ НАДБАВКА ЗА ВОСКРЕСЕНЬЕ
    const sundayBonusEnabled = settings.sundayBonusEnabled === true;
    const sundayBonusAmount = settings.sundayBonusAmount || 1000;

    // ═══════════════════════════════════════════════════════════
    // ★ ПОЧАСОВАЯ ОПЛАТА (если выбран этот тип — считаем только часы)
    // ═══════════════════════════════════════════════════════════
    if (settings.payType === 'hourly') {
        let daysCount = 0;
        let totalHours = 0;   // фактические часы
        let billedHours = 0;  // часы к оплате (с учетом минимального 1 часа)
        
        for (let i = 0; i < workDays.length; i++) {
            if (workDays[i] && hours[i] > 0) {
                daysCount++;
                const actualH = Number(hours[i]);
                totalHours += actualH;
                
                // ★ ПРАВИЛО: любая часть первого часа округляется до 1 полного часа
                const dayBilledHours = actualH < 1 ? 1 : actualH;
                billedHours += dayBilledHours;
            }
        }

        const hourlyRate = Number(settings.hourlyRate) || 0;
        const payBase = billedHours * hourlyRate;
        
        let sundayBonus = 0;
        let sundayBonusCount = 0;
        if (sundayBonusEnabled && workDays[6] && hours[6] > 0) {
            sundayBonus = sundayBonusAmount;
            sundayBonusCount = 1;
        }

        const total = payBase + sundayBonus;
        const norm = daysCount * hpd;

        return {
            days: daysCount,
            totalHours,
            billedHours, // ★ Возвращаем часы к оплате
            norm,
            ot: 0, ot1: 0, ot2: 0,
            payBase,
            payExtra: 0,
            payOt1: 0,
            payOt2: 0,
            total,
            sundayBonus,
            sundayBonusCount,
            workDays,
            hours
        };
    }
    // ═══════════════════════════════════════════════════════════
    
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
    
    // ★ НАДБАВКА ЗА ВОСКРЕСЕНЬЕ (индекс 6 = воскресенье)
    let sundayBonus = 0;
    let sundayBonusCount = 0;
    const SUNDAY_INDEX = 6;
    
    if (sundayBonusEnabled && workDays[SUNDAY_INDEX] && hours[SUNDAY_INDEX] > 0) {
        sundayBonus = sundayBonusAmount;
        sundayBonusCount = 1;
    }
    
    const total = payBase + payExtra + payOt1 + payOt2 + sundayBonus;
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
        // ★ НОВЫЕ ПОЛЯ
        sundayBonus,
        sundayBonusCount,
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
