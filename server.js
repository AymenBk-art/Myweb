// استيراد الإضافات التي ثبتناها
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken'); 
const bcrypt = require('bcrypt'); 
const cookieParser = require('cookie-parser'); 
const http = require('http'); 
const { Server } = require("socket.io"); 

// 💥💥 رابط الإنتاج الفعلي - تم تعيينه للنشر 💥💥
const productionOrigin = 'https://codelabx.onrender.com'; // استخدم الرابط الذي ستوفره Render/Railway لاحقًا

// إنشاء التطبيق
const app = express();
// 💥💥 (معدّل) استخدام البورت المعرف في بيئة التشغيل أو 3000 كاحتياطي 💥💥
const port = process.env.PORT || 3000; 

// ربط Express بخادم HTTP عادي وإعداد Socket.IO
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: productionOrigin, 
        methods: ["GET", "POST"],
        credentials: true
    }
});


// 1. إعدادات السيرفر
app.use(cors({
    origin: productionOrigin, 
    credentials: true 
}));
app.use(bodyParser.json());
app.use(express.static(__dirname)); 
app.use(cookieParser()); 

// --- 2. الاتصال بقاعدة البيانات ---
// المبدأ: MONGODB_URI سيتم جلب قيمته من متغيرات البيئة في Railway/Render
const MONGODB_URI = "mongodb+srv://haymenba76_db_user:Ayman1910@cluster0.mm1do93.mongodb.net/?appName=Cluster0";

mongoose.connect(MONGODB_URI)
  .then(() => {
      console.log('تم الاتصال بقاعدة بيانات MongoDB بنجاح!');
  })
  .catch((error) => {
      console.error('فشل الاتصال بقاعدة البيانات:', error);
  });

// --- 3. تعريف النماذج (Schemas) ---
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true }
});
const User = mongoose.model('User', userSchema);

const taskSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    description: { type: String, required: true },
    completed: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
});
const Task = mongoose.model('Task', taskSchema);

const messageSchema = new mongoose.Schema({
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    receiver: { type: mongoose.Types.ObjectId, ref: 'User', required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);


// --- 4. المفتاح السري لـ JWT ---
const JWT_SECRET = "MySuperSecretKey12345!@#";

// --- 5. معالج Socket.IO للدردشة ---
io.on('connection', (socket) => {
    
    // 1. تحديد هوية المستخدم المتصل باستخدام الكوكي
    const cookies = socket.handshake.headers.cookie;
    const tokenCookie = cookies ? cookies.split('; ').find(row => row.startsWith('auth_token=')) : null;
    
    if (!tokenCookie) { return socket.disconnect(); }
    
    const token = tokenCookie.split('=')[1];
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) { return socket.disconnect(); }

        const userId = user.userId;
        console.log(`[Socket.IO]: المستخدم ${user.username} (ID: ${userId}) متصل.`);
        
        // الانضمام لغرفته الخاصة
        socket.join(userId);

        // معالجة إرسال رسالة جديدة
        socket.on('sendMessage', async (data) => {
            const { receiverId, content } = data;
            
            if (userId === receiverId) return; 

            // حفظ الرسالة في قاعدة البيانات
            const newMessage = new Message({
                sender: userId,
                receiver: receiverId,
                content: content
            });
            await newMessage.save();

            const messageData = {
                senderId: userId,
                content: content,
                timestamp: newMessage.timestamp
            };
            
            // إرسال الرسالة للمستلم والراسل فوراً
            socket.to(receiverId).emit('receiveMessage', messageData);
            socket.emit('receiveMessage', messageData);
        });

        socket.on('disconnect', () => {
            console.log(`[Socket.IO]: المستخدم ${user.username} انفصل.`);
        });
    });
});


// ------------------------------------------
// --- 6. تعريف "الراوت" (Routes) ---

// 1. تسجيل مستخدم جديد (/register)
app.post('/register', (req, res) => {
    const plainPassword = req.body.password; 
    
    bcrypt.hash(plainPassword, 10)
        .then(hashedPassword => {
            
            const newUser = new User({
                username: req.body.username,
                email: req.body.email,
                password: hashedPassword
            });

            newUser.save()
                .then(user => {
                    res.json({ message: `تم إنشاء حسابك بنجاح، ${user.username}!` });
                })
                .catch(error => {
                    if (error.code === 11000) {
                        if (error.keyPattern.username) {
                            res.status(400).json({ message: "هذا الاسم مستخدم من قبل." });
                        } else if (error.keyPattern.email) {
                            res.status(400).json({ message: "هذا البريد الإلكتروني مستخدم من قبل." });
                        }
                    } else {
                        res.status(500).json({ message: "حدث خطأ أثناء إنشاء الحساب." });
                    }
                });
        });
});

// 2. تسجيل الدخول (/login) - ميزة تذكرني
app.post('/login', (req, res) => {
    const username = req.body.username;
    const password = req.body.password; 

    User.findOne({ username: username })
        .then(user => {
            if (!user) { return res.status(404).json({ message: "اسم المستخدم غير موجود." }); }

            bcrypt.compare(password, user.password)
                .then(isMatch => {
                    if (!isMatch) { return res.status(401).json({ message: "كلمة المرور غير صحيحة." }); }

                    const token = jwt.sign(
                        { userId: user._id, username: user.username },
                        JWT_SECRET,
                        { expiresIn: '7d' } 
                    );
                    
                    const rememberMe = req.body.rememberMe;
                    const oneHour = 3600000;
                    const sevenDays = 604800000;
                    const maxAge = rememberMe ? sevenDays : oneHour; 

                    res.cookie('auth_token', token, { 
                        httpOnly: true, 
                        secure: true, 
                        sameSite: 'None',
                        maxAge: maxAge 
                    });

                    res.json({ message: `مرحباً بعودتك، ${user.username}!` });
                });
        })
        .catch(error => { res.status(500).json({ message: "حدث خطأ في السيرفر." }); });
});


// 3. مسار تسجيل الخروج (/logout)
app.post('/logout', (req, res) => {
    res.clearCookie('auth_token');
    res.json({ message: "تم تسجيل خروجك بأمان." });
});


// 4. البوابة الآمنة (/api/profile)
app.get('/api/profile', (req, res) => {
    
    const token = req.cookies.auth_token; 

    if (token == null) { return res.status(401).json({ message: "أنت غير مصرح لك." }); }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) { return res.status(403).json({ message: "التذكرة غير صالحة." }); }
        res.json({ username: user.username, userId: user.userId });
    });
});

// 5. جلب جميع المستخدمين (GET /api/users) 
app.get('/api/users', (req, res) => {
    
    const token = req.cookies.auth_token; 

    if (token == null) { return res.status(401).json({ message: "أنت غير مصرح لك." }); }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) { return res.status(403).json({ message: "التذكرة غير صالحة." }); }

        User.find({ _id: { $ne: user.userId } })
            .select('username _id') 
            .then(users => {
                res.json({ users: users });
            })
            .catch(error => {
                res.status(500).json({ message: "فشل جلب قائمة المستخدمين." });
            });
    });
});


// 6. مسار جلب سجل الرسائل القديمة (GET /api/messages/:receiverId)
app.get('/api/messages/:receiverId', (req, res) => {
    
    const token = req.cookies.auth_token; 

    if (token == null) { return res.status(401).json({ message: "أنت غير مصرح لك." }); }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) { return res.status(403).json({ message: "التذكرة غير صالحة." }); }
        
        const senderId = user.userId;
        const receiverId = req.params.receiverId;

        Message.find({
            $or: [
                { sender: senderId, receiver: receiverId },
                { sender: receiverId, receiver: senderId }
            ]
        })
        .sort({ timestamp: 1 }) 
        .select('sender receiver content timestamp')
        .then(messages => {
            res.json({ messages: messages });
        })
        .catch(error => {
            res.status(500).json({ message: "فشل جلب سجل الرسائل.", error: error });
        });
    });
});


// 7. حفظ مهمة جديدة (POST /api/tasks) 
app.post('/api/tasks', (req, res) => {
    
    const token = req.cookies.auth_token; 

    if (token == null) { return res.status(401).json({ message: "أنت غير مصرح لك." }); }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) { return res.status(403).json({ message: "التذكرة غير صالحة." }); }
        
        const newTask = new Task({
            userId: user.userId, 
            description: req.body.description
        });

        newTask.save()
            .then(task => {
                res.status(201).json({ message: "تم حفظ المهمة بنجاح.", task: task });
            })
            .catch(error => {
                res.status(500).json({ message: "فشل حفظ المهمة.", error: error });
            });
    });
});

// 8. جلب جميع المهام للمستخدم (GET /api/tasks) 
app.get('/api/tasks', (req, res) => {
    
    const token = req.cookies.auth_token; 

    if (token == null) { return res.status(401).json({ message: "أنت غير مصرح لك." }); }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) { return res.status(403).json({ message: "التذكرة غير صالحة." }); }
        
        Task.find({ userId: user.userId })
            .sort({ createdAt: -1 })
            .then(tasks => {
                res.json({ tasks: tasks });
            })
            .catch(error => {
                res.status(500).json({ message: "فشل جلب المهام.", error: error });
            });
    });
});

// 9. مسار تحديث مهمة (PUT /api/tasks/:id) 
app.put('/api/tasks/:id', (req, res) => {
    
    const token = req.cookies.auth_token; 

    if (token == null) { return res.status(401).json({ message: "أنت غير مصرح لك." }); }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) { return res.status(403).json({ message: "التذكرة غير صالحة." }); }
        
        Task.findOneAndUpdate(
            { _id: req.params.id, userId: user.userId },
            { $set: { completed: req.body.completed } }, 
            { new: true }
        )
        .then(task => {
            if (!task) {
                return res.status(404).json({ message: "المهمة غير موجودة أو لا تملك صلاحية تعديلها." });
            }
            res.json({ message: "تم تحديث المهمة بنجاح.", task: task });
        })
        .catch(error => {
            res.status(500).json({ message: "فشل تحديث المهمة.", error: error });
        });
    });
});

// 10. مسار حذف مهمة (DELETE /api/tasks/:id) 
app.delete('/api/tasks/:id', (req, res) => {
    
    const token = req.cookies.auth_token; 

    if (token == null) { return res.status(401).json({ message: "أنت غير مصرح لك." }); }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) { return res.status(403).json({ message: "التذكرة غير صالحة." }); }
        
        Task.findOneAndDelete({ _id: req.params.id, userId: user.userId })
        .then(task => {
            if (!task) {
                return res.status(404).json({ message: "المهمة غير موجودة أو لا تملك صلاحية حذفها." });
            }
            res.json({ message: "تم حذف المهمة بنجاح." });
        })
        .catch(error => {
            res.status(500).json({ message: "فشل حذف المهمة.", error: error });
        });
    });
});

// 11. مسار الإعجاب/إلغاء الإعجاب (PUT /api/tasks/:id/like)
app.put('/api/tasks/:id/like', (req, res) => {
    
    const token = req.cookies.auth_token; 

    if (token == null) { return res.status(401).json({ message: "أنت غير مصرح لك." }); }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) { return res.status(403).json({ message: "التذكرة غير صالحة." }); }
        
        const userId = user.userId;
        const taskId = req.params.id;

        Task.findById(taskId)
            .then(task => {
                if (!task) { return res.status(404).json({ message: "المهمة غير موجودة." }); }

                const isLiked = task.likes.includes(userId);
                
                let updateOperation;
                if (isLiked) { updateOperation = { $pull: { likes: userId } }; } 
                else { updateOperation = { $push: { likes: userId } }; }

                Task.findOneAndUpdate({ _id: taskId }, updateOperation, { new: true })
                    .then(updatedTask => {
                        res.json({ 
                            message: isLiked ? "تم إلغاء الإعجاب بنجاح." : "تم الإعجاب بنجاح.",
                            likesCount: updatedTask.likes.length
                        });
                    });
            })
            .catch(error => { res.status(500).json({ message: "فشل معالجة الإعجاب.", error: error }); });
    });
});


// 12. مسار Fallback لتقديم index.html
app.get('/', (req, res) => { res.sendFile(__dirname + '/index.html'); });
app.get('/index.html', (req, res) => { res.sendFile(__dirname + '/index.html'); });
app.get('/dashboard.html', (req, res) => { res.sendFile(__dirname + '/dashboard.html'); });


// --- 13. تشغيل السيرفر (باستخدام httpServer) ---
httpServer.listen(port, () => {
    console.log(`السيرفر يعمل الآن على http://localhost:${port}`);
});