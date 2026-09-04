// modules/audit.js
import { getFirestore, collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

let db = null;

export function initAudit(firebaseApp) {
    db = getFirestore(firebaseApp);
}

export async function logAction(action, data = {}, userId = null) {
    if (!db) {
        console.warn('Audit module not initialized');
        return;
    }
    try {
        const auth = getAuth();
        const user = auth.currentUser;
        const uid = userId || (user ? user.uid : 'anonymous');
        const email = user ? user.email : null;
        await addDoc(collection(db, 'auditLog'), {
            action: action,
            data: data,
            userId: uid,
            userEmail: email,
            timestamp: serverTimestamp(),
            userAgent: navigator.userAgent
        });
        console.log('📝 Audit log:', action, data);
    } catch (error) {
        console.error('Audit log error:', error);
    }
}