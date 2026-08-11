// admin.js
const { 
    db, collection, doc, getDocs, addDoc, updateDoc, deleteDoc, 
    query, where, onSnapshot, getDoc, auth, 
    signInWithEmailAndPassword, onAuthStateChanged, signOut 
} = window;

console.log('✅ admin.js загружен');

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

onAuthStateChanged(auth, (user) => {
    console.log('👤 Auth state:', user ? user.email : 'No user');
    
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
        console.error('❌ Ошибка входа:', error);
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
    console.log('📋 Загрузка сотрудников...');
    const employeesRef = collection(db, 'salaryEmployees');
    
    onSnapshot(employeesRef, (snapshot) => {
        console.log('📋 Получено документов:', snapshot.size);
        const container = document.getElementById('employeeList');
        container.innerHTML = '';
        
        if (snapshot.empty) {
            container.innerHTML = '<div class="loading">Нет сотрудников. Добавьте первого!</div>';
            return;
        }

        snapshot.forEach((doc) => {
            const emp = { id: doc.id, ...doc.data() };
            console.log('👤 Сотрудник:', emp);
            
            const card = document.createElement('div');
            card.className = 'employee-card';
            card.innerHTML = `
                <h3>${emp.name || 'Без имени'}</h3>
                <div class="tab">📱 ${emp.phone || 'Нет телефона'} · ID: ${emp.id}</div>
                <div class="actions">
                    <a href="/employee.html?id=${emp.id}" class="btn-link" target="_blank">📊 Калькулятор</a>
                    <button class="btn-stats" onclick="window.showStats('${emp.id}', '${emp.name}')">📈 Статистика</button>
                    <button class="btn-delete" onclick="window.deleteEmployee('${emp.id}')">🗑️</button>
                </div>
            `;
            container.appendChild(card);
        });
    }, (error) => {
        console.error('❌ Ошибка загрузки:', error);
        document.getElementById('employeeList').innerHTML = 
            `<div class="loading" style="color:var(--red);">Ошибка: ${error.message}</div>`;
    });
}

// ============================================
// ДОБАВЛЕНИЕ СОТРУДНИКА (исправленное)
// ============================================

document.getElementById('addEmployeeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    console.log('📝 Попытка добавить сотрудника...');
    
    const name = document.getElementById('empName').value.trim();
    const phone = document.getElementById('empTab').value.trim(); // Теперь это телефон
    
    console.log('📝 Имя:', name);
    console.log('📝 Телефон:', phone);
    
    if (!name || !phone) {
        alert('❌ Заполните все поля!');
        return;
    }

    // Валидация телефона (простая)
    if (phone.length < 5) {
        alert('❌ Введите корректный номер телефона (минимум 5 символов)');
        return;
    }

    try {
        // Проверяем авторизацию
        if (!auth.currentUser) {
            alert('❌ Вы не авторизованы!');
            return;
        }
        
        console.log('👤 Текущий пользователь:', auth.currentUser.email);
        
        // Данные для сохранения
        const employeeData = {
            name: name,
            phone: phone,
            createdAt: new Date().toISOString(),
            adminId: auth.currentUser.uid,
            adminEmail: auth.currentUser.email
        };
        
        console.log('📤 Отправка данных:', employeeData);
        
        // Добавляем в Firestore
        const docRef = await addDoc(collection(db, 'salaryEmployees'), employeeData);
        
        console.log('✅ Сотрудник добавлен! ID:', docRef.id);
        
        // Очищаем поля
        document.getElementById('empName').value = '';
        document.getElementById('empTab').value = '';
        
        // Показываем уведомление
        showNotification('✅ Сотрудник добавлен! ID: ' + docRef.id);
        
        // Данные обновятся автоматически через onSnapshot
        
    } catch (error) {
        console.error('❌ Ошибка при добавлении:', error);
        console.error('📝 Код ошибки:', error.code);
        console.error('📝 Сообщение:', error.message);
        
        let errorMessage = 'Ошибка при добавлении: ';
        
        if (error.code === 'permission-denied') {
            errorMessage += 'Нет прав на запись. Проверьте Security Rules в Firebase.';
        } else if (error.code === 'unavailable') {
            errorMessage += 'Сервер недоступен. Проверьте интернет.';
        } else {
            errorMessage += error.message;
        }
        
        alert('❌ ' + errorMessage);
        
        // Дополнительная информация в консоль
        console.log('🔍 Для проверки:');
        console.log('1. Зайдите в Firebase Console → Firestore');
        console.log('2. Проверьте коллекцию salaryEmployees');
        console.log('3. Проверьте Security Rules');
    }
});

// ============================================
// УДАЛЕНИЕ СОТРУДНИКА
// ============================================

window.deleteEmployee = async (id) => {
    if (!confirm('🗑️ Удалить этого сотрудника и все его данные?')) return;
    
    try {
        console.log('🗑️ Удаление сотрудника:', id);
        
        // Удаляем все недели сотрудника
        const weeksRef = collection(db, 'salaryWeeks');
        const q = query(weeksRef, where('employeeId', '==', id));
        const snapshot = await getDocs(q);
        
        const deletePromises = [];
        snapshot.forEach((doc) => {
            deletePromises.push(deleteDoc(doc.ref));
        });
        await Promise.all(deletePromises);
        console.log(`🗑️ Удалено ${deletePromises.length} недель`);
        
        // Удаляем сотрудника
        await deleteDoc(doc(db, 'salaryEmployees', id));
        
        showNotification('🗑️ Сотрудник удален');
        
    } catch (error) {
        console.error('❌ Ошибка при удалении:', error);
        alert('❌ Ошибка: ' + error.message);
    }
};

// ============================================
// СТАТИСТИКА
// ============================================

window.showStats = async (employeeId, employeeName) => {
    console.log('📈 Загрузка статистики для:', employeeName);
    document.getElementById('statsName').textContent = `📊 ${employeeName}`;
    document.getElementById('statsModal').classList.add('active');
    
    const tbody = document.getElementById('statsBody');
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--mut);">Загрузка...</td></tr>';
    
    try {
        const weeksRef = collection(db, 'salaryWeeks');
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
        console.error('❌ Ошибка загрузки статистики:', error);
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
        await updateDoc(doc(db, 'salaryWeeks', weekId), {
            isPaid: !currentStatus
        });
        showNotification('✅ Статус обновлен');
    } catch (error) {
        console.error('❌ Ошибка:', error);
        alert('❌ Ошибка: ' + error.message);
    }
};

// ============================================
// УВЕДОМЛЕНИЯ
// ============================================

function showNotification(message) {
    let el = document.getElementById('notification');
    if (!el) {
        el = document.createElement('div');
        el.id = 'notification';
        el.style.cssText = `
            position: fixed;
            bottom: 30px;
            right: 30px;
            background: var(--teal);
            color: #0c1520;
            padding: 15px 25px;
            border-radius: 12px;
            font-weight: bold;
            opacity: 0;
            transition: opacity 0.4s;
            z-index: 9999;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            font-family: var(--mono);
        `;
        document.body.appendChild(el);
    }
    el.textContent = message;
    el.style.opacity = '1';
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.style.opacity = '0', 2500);
}

console.log('✅ admin.js готов');