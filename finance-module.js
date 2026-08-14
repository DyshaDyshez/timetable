// finance-module.js
// Модуль для работы с финансами (авансы, долги, баланс)

// ============================================
// РАБОТА С АВАНСАМИ
// ============================================

export async function getActiveAdvances(employeeId, db, collection, query, where, getDocs) {
    try {
        const advancesRef = collection(db, 'salaryAdvances');
        const q = query(
            advancesRef,
            where('employeeId', '==', employeeId),
            where('status', '==', 'active')
        );
        const snapshot = await getDocs(q);
        const advances = [];
        snapshot.forEach((doc) => {
            advances.push({ id: doc.id, ...doc.data() });
        });
        return advances;
    } catch (error) {
        console.error('Ошибка загрузки авансов:', error);
        return [];
    }
}

export async function getAllAdvances(employeeId, db, collection, query, where, getDocs) {
    try {
        const advancesRef = collection(db, 'salaryAdvances');
        const q = query(advancesRef, where('employeeId', '==', employeeId));
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

export async function addAdvance(employeeId, amount, comment, type, db, addDoc, collection) {
    try {
        const docRef = await addDoc(collection(db, 'salaryAdvances'), {
            employeeId: employeeId,
            amount: parseFloat(amount) || 0,
            type: type || 'advance',
            status: 'active',
            date: new Date().toISOString(),
            comment: comment || '',
            repaidAt: null,
            repaidFromWeek: null,
            repaidAmount: null
        });
        return { success: true, id: docRef.id };
    } catch (error) {
        console.error('Ошибка добавления аванса:', error);
        return { success: false, error: error.message };
    }
}

export async function repayAdvance(advanceId, amount, weekId, db, doc, updateDoc) {
    try {
        const advanceRef = doc(db, 'salaryAdvances', advanceId);
        await updateDoc(advanceRef, {
            status: 'repaid',
            repaidAt: new Date().toISOString(),
            repaidFromWeek: weekId || null,
            repaidAmount: parseFloat(amount) || 0
        });
        return { success: true };
    } catch (error) {
        console.error('Ошибка погашения аванса:', error);
        return { success: false, error: error.message };
    }
}

export async function deleteAdvance(advanceId, db, doc, deleteDoc) {
    try {
        await deleteDoc(doc(db, 'salaryAdvances', advanceId));
        return { success: true };
    } catch (error) {
        console.error('Ошибка удаления аванса:', error);
        return { success: false, error: error.message };
    }
}

// ============================================
// РАСЧЁТ БАЛАНСА
// ============================================

export async function getEmployeeBalance(employeeId, db, collection, query, where, getDocs) {
    try {
        const activeAdvances = await getActiveAdvances(employeeId, db, collection, query, where, getDocs);
        const totalDebt = activeAdvances.reduce((sum, a) => sum + a.amount, 0);
        
        const weeksRef = collection(db, 'salaryWeeks');
        const q = query(weeksRef, where('employeeId', '==', employeeId));
        const snapshot = await getDocs(q);
        let totalPaid = 0;
        let totalCalculated = 0;
        snapshot.forEach((doc) => {
            const week = doc.data();
            if (week.isPaid) {
                totalPaid += week.paidAmount || 0;
            }
            totalCalculated += week.calculatedPay || 0;
        });
        
        const allAdvances = await getAllAdvances(employeeId, db, collection, query, where, getDocs);
        const totalAdvances = allAdvances.reduce((sum, a) => sum + a.amount, 0);
        const totalRepaid = allAdvances
            .filter(a => a.status === 'repaid')
            .reduce((sum, a) => sum + (a.repaidAmount || a.amount), 0);
        
        return {
            totalDebt,
            totalAdvances,
            totalRepaid,
            totalPaid,
            totalCalculated,
            activeAdvancesCount: activeAdvances.length,
            activeAdvances: activeAdvances
        };
    } catch (error) {
        console.error('Ошибка расчёта баланса:', error);
        return {
            totalDebt: 0,
            totalAdvances: 0,
            totalRepaid: 0,
            totalPaid: 0,
            totalCalculated: 0,
            activeAdvancesCount: 0,
            activeAdvances: []
        };
    }
}

export async function processSalaryWithDebt(employeeId, weekId, weekPay, db, collection, doc, query, where, getDocs, addDoc, updateDoc) {
    try {
        const activeAdvances = await getActiveAdvances(employeeId, db, collection, query, where, getDocs);
        const totalDebt = activeAdvances.reduce((sum, a) => sum + a.amount, 0);
        
        let remainingPay = weekPay;
        let repaidAdvances = [];
        
        if (totalDebt > 0 && weekPay > 0) {
            const sortedAdvances = [...activeAdvances].sort((a, b) => a.date.localeCompare(b.date));
            
            for (const advance of sortedAdvances) {
                if (remainingPay <= 0) break;
                const repayAmount = Math.min(advance.amount, remainingPay);
                await repayAdvance(advance.id, repayAmount, weekId, db, doc, updateDoc);
                remainingPay -= repayAmount;
                repaidAdvances.push({
                    id: advance.id,
                    amount: repayAmount,
                    comment: advance.comment
                });
            }
        }
        
        const finalPay = remainingPay;
        await updateDoc(doc(db, 'salaryWeeks', weekId), {
            isPaid: true,
            paidAmount: weekPay,
            paidAt: new Date().toISOString(),
            debtRepaid: repaidAdvances.length > 0,
            repaidAmount: weekPay - finalPay
        });
        
        return {
            success: true,
            weekPay: weekPay,
            finalPay: finalPay,
            repaidFromDebt: weekPay - finalPay,
            repaidAdvances: repaidAdvances
        };
    } catch (error) {
        console.error('Ошибка обработки зарплаты:', error);
        return { success: false, error: error.message };
    }
}

// ============================================
// ФОРМАТИРОВАНИЕ
// ============================================

export function formatDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}