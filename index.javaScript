// Firebase SDKのインポート
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, doc, addDoc, onSnapshot, updateDoc, deleteDoc, setDoc, getDoc, query } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getDatabase, ref, set, onValue, remove } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";

// アプリIDとFirebase設定のグローバル変数（Canvas環境から提供される）
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-checklist-app';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;


// Firebaseの初期化
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const rtdb = getDatabase(app);

// DOM要素の取得
const taskInput = document.getElementById('taskInput');
const addTaskBtn = document.getElementById('addTaskBtn');
const taskList = document.getElementById('taskList');
const authStatus = document.getElementById('auth-status');
const loader = document.getElementById('loader');
const emptyState = document.getElementById('empty-state');
const userRegistration = document.getElementById('userRegistration');
const nameInput = document.getElementById('nameInput');
const registerNameBtn = document.getElementById('registerNameBtn');
const userList = document.getElementById('userList');

let currentUser = null;
let currentUserName = localStorage.getItem(`userName_${appId}`) || "ゲスト";

// 認証状態の監視
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        authStatus.textContent = `接続済み: ${truncateUserId(user.uid)}`;
        
        // ユーザー名をチェック
        const userDocRef = doc(db, `/artifacts/${appId}/public/data/users`, user.uid);
        const userDoc = await getDoc(userDocRef);

        if (userDoc.exists() && userDoc.data().name) {
            currentUserName = userDoc.data().name;
            localStorage.setItem(`userName_${appId}`, currentUserName);
            userRegistration.classList.add('hidden');
            initApp();
        } else {
            userRegistration.classList.remove('hidden');
        }

    } else {
        authStatus.textContent = '未接続';
        // 匿名認証またはカスタムトークンでの認証
        try {
             if (initialAuthToken) {
                await signInWithCustomToken(auth, initialAuthToken);
            } else {
                await signInAnonymously(auth);
            }
        } catch (error) {
            console.error("Authentication failed: ", error);
            authStatus.textContent = '認証エラー';
        }
    }
});

// ユーザー名登録
registerNameBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (name && currentUser) {
        currentUserName = name;
        localStorage.setItem(`userName_${appId}`, name);
        const userDocRef = doc(db, `/artifacts/${appId}/public/data/users`, currentUser.uid);
        await setDoc(userDocRef, { name: name }, { merge: true });
        userRegistration.classList.add('hidden');
        initApp();
    }
});


function initApp() {
    // タスクのリアルタイム監視
    const tasksCollection = collection(db, `/artifacts/${appId}/public/data/tasks`);
    const q = query(tasksCollection);
    onSnapshot(q, (snapshot) => {
        loader.style.display = 'none';
        taskList.innerHTML = '';
        if (snapshot.empty) {
            emptyState.classList.remove('hidden');
        } else {
            emptyState.classList.add('hidden');
            const tasks = [];
            snapshot.forEach(doc => tasks.push({ id: doc.id, ...doc.data() }));
            // 作成日時でソート (古いものが上)
            tasks.sort((a, b) => a.createdAt?.toMillis() - b.createdAt?.toMillis());
            tasks.forEach(renderTask);
        }
    });

    // 参加者のリアルタイム監視
    const usersCollection = collection(db, `/artifacts/${appId}/public/data/users`);
    onSnapshot(usersCollection, (snapshot) => {
        userList.innerHTML = '';
        if (snapshot.empty) {
             userList.innerHTML = `<span class="text-sm text-gray-500">まだ誰も参加していません。</span>`;
        } else {
            snapshot.forEach(doc => {
                const user = doc.data();
                const userElement = document.createElement('span');
                userElement.className = 'bg-teal-100 text-teal-800 text-xs font-medium px-2.5 py-1 rounded-full';
                userElement.textContent = user.name || '名無しさん';
                userList.appendChild(userElement);
            });
        }
    });
}

// タスクをレンダリングする関数
function renderTask(task) {
    const li = document.createElement('li');
    li.className = 'task-item flex items-center justify-between bg-white/60 p-3 rounded-lg shadow-sm border border-gray-200';
    li.dataset.id = task.id;

    const checkedByUsers = task.checkedByUsers || {};
    const isCheckedByCurrentUser = currentUser && checkedByUsers[currentUser.uid];
    const checkCount = Object.keys(checkedByUsers).length;

    const checked = isCheckedByCurrentUser ? 'checked' : '';
    const textDecoration = checkCount > 0 ? 'line-through text-gray-500' : 'text-gray-800';

    const checkedByNames = Object.values(checkedByUsers).join(', ');

    li.innerHTML = `
        <div class="flex items-center flex-grow">
            <input type="checkbox" ${checked} class="h-5 w-5 rounded border-gray-300 text-teal-600 focus:ring-teal-500 cursor-pointer">
            <div class="ml-3 flex flex-col flex-grow">
                <span class="font-medium ${textDecoration}">${task.text}</span>
                <div class="text-xs text-gray-500">
                    追加: ${task.addedBy || '不明'}
                </div>
            </div>
        </div>
        <div class="flex items-center space-x-4">
            <div class="text-right">
                <div class="font-semibold text-teal-600">${checkCount} 人がチェック</div>
                <div class="text-xs text-gray-400 truncate max-w-[100px]" title="${checkedByNames}">${checkedByNames || '---'}</div>
            </div>
            <button class="delete-btn text-gray-400 hover:text-red-500 font-bold text-xl px-2">&times;</button>
        </div>
    `;
    
    taskList.appendChild(li);

    // チェックボックスのイベントリスナー
    li.querySelector('input[type="checkbox"]').addEventListener('change', (e) => {
        if (!currentUser) return;
        const docRef = doc(db, `/artifacts/${appId}/public/data/tasks`, task.id);
        const newCheckedByUsers = { ...(task.checkedByUsers || {}) };

        if (e.target.checked) {
            newCheckedByUsers[currentUser.uid] = currentUserName;
        } else {
            delete newCheckedByUsers[currentUser.uid];
        }

        updateDoc(docRef, {
            checkedByUsers: newCheckedByUsers
        });
    });

    // 削除ボタンのイベントリスナー
    li.querySelector('.delete-btn').addEventListener('click', () => {
        const docRef = doc(db, `/artifacts/${appId}/public/data/tasks`, task.id);
        deleteDoc(docRef);
    });
}

// タスク追加関数
async function addTask() {
    const text = taskInput.value.trim();
    if (text !== '' && currentUser) {
        try {
            const tasksCollection = collection(db, `/artifacts/${appId}/public/data/tasks`);
            await addDoc(tasksCollection, {
                text: text,
                addedBy: currentUserName,
                createdAt: new Date(),
                checkedByUsers: {}
            });
            taskInput.value = '';
        } catch (error) {
            console.error("Error adding document: ", error);
        }
    }
}

// イベントリスナーの設定
addTaskBtn.addEventListener('click', addTask);
taskInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        addTask();
    }
});

function truncateUserId(uid) {
    return uid.substring(0, 8) + '...';
}
