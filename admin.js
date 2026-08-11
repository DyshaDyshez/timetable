// admin.js
// Скрипт админ-панели

const { db, collection, doc, getDocs, addDoc, updateDoc, deleteDoc, query, where, onSnapshot, auth, signInWithEmailAndPassword, onAuthStateChanged, signOut } = window;

// Константы для расчета
const SETTINGS = {
    rDay: 3000,
    rExtra: 3500,
    rOt1: 400,
    rOt2: 800,
    hpd: 8,
    otLimit: 5
};

// ============================================
// АВТОРИЗАЦИЯ
// ============================================

// Проверяем статус авторизации
onAuthStateChanged(auth, (user) => {
    if (user) {
        document.getElementById('authScreen').classList.remove('active');
        document.getElementById('authScreen').style.display = 'none';
        document.getElementById('adminContent').style.display = 'block';
        loadEmployees();
    } else {
        document.getElementById('authScreen').classList.add('active');
        document.getElementById('authScreen').style.display = 'block';
        document.getElementById('adminContent').style.display = 'none';
    }
});

// Вход
document.getElementById('loginBtn').addEventListener('click', async () => {
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const errorEl = document.getElementById('loginError');
    
    try {
        await signInWithEmailAndPassword(auth, email, password);
        errorEl.textContent = '';
    } catch (error) {
        errorEl.textContent = '❌ ' + error.message;
    }
});

// Выход
document.getElementById('logoutBtn').addEventListener('click', () => {
    signOut(auth);
});

// ============================================
// УПРАВЛЕНИЕ СОТРУДНИКАМИ
// ============================================

function loadEmployees() {
    const employeesRef = collection(db, 'employees');
    
    onSnapshot(employeesRef, (snapshot) => {
        const container = document.getElementById('employeeList');
        container.innerHTML = '';
        
        if (snapshot.empty) {
            container.innerHTML = '<div class="loading">Нет сотрудников. Добавьте первого!</div>';
            return;
        }

        snapshot.forEach((doc) => {
            const emp = { id: doc.id, ...doc.data() };
            const card = document.createElement('div');
            card.className = 'employee-card';
            card.innerHTML = `
                <h3>${emp.name}</h3>
                <div class="tab">Таб. №: ${emp.tabNumber}</div>
                <div class="actions">
                    <a href="/employee.html?id=${emp.id}" class="btn-link" target="_blank">📊 Калькулятор</a>
                    <button class="btn-stats" onclick="window.showStats('${emp.id}', '${emp.name}')">📈 Статистика</button>
                    <button class="btn-delete" onclick="window.deleteEmployee('${emp.id}')">🗑️</button>
                </div>
            `;
            container.appendChild(card);
        });
    });
}

// Добавление сотрудника
document.getElementById('addEmployeeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('empName').value.trim();
    const tabNumber = document.getElementById('empTab').value.trim();
    
    if (!name || !tabNumber) {
        alert('Заполните все поля');
        return;
    }

    try {
        await addDoc(collection(db, 'employees'), {
            name: name,
            tabNumber: tabNumber,
            createdAt: new Date().toISOString()
        });
        
        document.getElementById('empName').value = '';
        document.getElementById('empTab').value = '';
    } catch (error) {
        alert('Ошибка при добавлении: ' + error.message);
    }
});

// Удаление сотрудника
window.deleteEmployee = async (id) => {
    if (!confirm('Удалить этого сотрудника и все его данные?')) return;
    
    try {
        const weeksRef = collection(db, 'weeks');
        const q = query(weeksRef, where('employeeId', '==', id));
        const snapshot = await getDocs(q);
        
        const deletePromises = [];
        snapshot.forEach((doc) => {
            deletePromises.push(deleteDoc(doc.ref));
        });
        await Promise.all(deletePromises);
        
        await deleteDoc(doc(db, 'employees', id));
        alert('Сотрудник удален');
    } catch (error) {
        alert('Ошибка при удалении: ' + error.message);
    }
};

// ============================================
// СТАТИСТИКА
// ============================================

window.showStats = async (employeeId, employeeName) => {
    document.getElementById('statsName').textContent = `📊 ${employeeName}`;
    document.getElementById('statsModal').classList.add('active');
    
    const tbody = document.getElementById('statsBody');
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--mut);">Загрузка...</td></tr>';
    
    try {
        const weeksRef = collection(db, 'weeks');
        const q = query(weeksRef, where('employeeId', '==', employeeId));
        const snapshot = await getDocs(q);
        
        if (snapshot.empty) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--mut);">Нет данных</td></tr>';
            return;
        }

        const weeks = [];
        snapshot.forEach((doc) => {
            weeks.push({ id: doc.id, ...doc.data() });
        });
        
        weeks.sort((a, b) => b.weekKey.localeCompare(a.weekKey));
        
        tbody.innerHTML = '';
        
        weeks.forEach((week) => {
            const workDays = week.workDays || [true, true, true, true, true, false, false];
            const hours = week.hours || [8, 8, 8, 8, 8, 0, 0];
            
            const days = workDays.filter(Boolean).length;
            const totalHours = hours.reduce((a, b) => a + b, 0);
            const norm = days * SETTINGS.hpd;
            const baseDays = Math.min(days, 5);
            const extraDays = Math.max(0, days - 5);
            const ot = Math.max(0, totalHours - norm);
            const ot1 = Math.min(ot, SETTINGS.otLimit);
            const ot2 = Math.max(0, ot - SETTINGS.otLimit);
            const pay = baseDays * SETTINGS.rDay + extraDays * SETTINGS.rExtra + ot1 * SETTINGS.rOt1 + ot2 * SETTINGS.rOt2;
            
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><b>${week.weekKey}</b></td>
                <td>${days}</td>
                <td>${totalHours} ч</td>
                <td>${ot > 0 ? ot + ' ч' : '—'}</td>
                <td><b>${pay.toLocaleString()} ₽</b></td>
                <td class="${week.isPaid ? 'paid' : 'unpaid'}">${week.isPaid ? '✅ Выплачено' : '⏳ Не выплачено'}</td>
                <td>
                    <button onclick="window.togglePay('${week.id}', ${week.isPaid})" 
                            style="background:${week.isPaid ? 'var(--red)' : 'var(--teal)'}; border:none; padding:4px 12px; border-radius:6px; color:#fff; cursor:pointer;">
                        ${week.isPaid ? 'Отменить' : 'Оплатить'}
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--red);">Ошибка: ${error.message}</td></tr>`;
    }
};

// Закрытие модалки
document.getElementById('closeModal').addEventListener('click', () => {
    document.getElementById('statsModal').classList.remove('active');
});
window.addEventListener('click', (e) => {
    if (e.target === document.getElementById('statsModal')) {
        document.getElementById('statsModal').classList.remove('active');
    }
});

// Переключение статуса оплаты
window.togglePay = async (weekId, currentStatus) => {
    try {
        await updateDoc(doc(db, 'weeks', weekId), {
            isPaid: !currentStatus
        });
    } catch (error) {
        alert('Ошибка: ' + error.message);
    }
};