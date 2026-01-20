// -------------------------------
// 🧩 استيراد الإضافات
// -------------------------------
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const cookieParser = require('cookie-parser');
const http = require('http');
const { Server } = require('socket.io');

// -------------------------------
// 🌐 إعدادات الإنتاج (التعديل هنا)
// -------------------------------
// ✅ هذا السطر يقرأ القيمة 'https://myweb-psi-pink.vercel.app' من لوحة الأسرار
const productionOrigin = process.env.PRODUCTION_ORIGIN; 
const corsOrigin = productionOrigin || true;
const isProduction = process.env.NODE_ENV === 'production';

// -------------------------------
// 🚀 إنشاء التطبيق
// -------------------------------
const app = express();
const httpServer = http.createServer(app);

// =======================================================
// 🏥 المسار الخاص بـ "الفحص الصحي" لـ Replit
// =======================================================
app.get('/', (req, res) => {
  res.status(200).send('OK'); 
});
// =======================================================

// -------------------------------
// 🔑 إعداد JWT
// -------------------------------
const JWT_SECRET = process.env.JWT_SECRET; 
if (!JWT_SECRET) {
    console.error('❌ خطأ حاسم: لم يتم تعيين JWT_SECRET في متغيرات البيئة.');
    process.exit(1); 
}

// -------------------------------
// ⚙️ إعداد Socket.IO
// -------------------------------
const io = new Server(httpServer, {
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST'],
    credentials: true 
  }
});

// -------------------------------
// 🧰 Middleware
// -------------------------------
app.use(express.static('public')); // يخدم ملفات الواجهة الأمامية من مجلد public

// تطبيق إعدادات الأمان (CORS)
app.use(cors({
  origin: corsOrigin,
  credentials: true 
}));

// باقي الإضافات
app.use(bodyParser.json());
app.use(cookieParser());

// -------------------------------
// 📦 النماذج (Schemas)
// -------------------------------
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
  receiver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

// -------------------------------
// 💬 إعداد Socket.IO للدردشة
// -------------------------------
io.on('connection', (socket) => {
  const cookies = socket.handshake.headers.cookie;
  const tokenCookie = cookies ? cookies.split('; ').find(row => row.startsWith('auth_token=')) : null;
  if (!tokenCookie) return socket.disconnect();

  const token = tokenCookie.split('=')[1];
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return socket.disconnect();

    const userId = user.userId;
    socket.join(userId);

    socket.on('sendMessage', async (data) => {
      const { receiverId, content } = data;
      if (userId === receiverId) return;

      const newMessage = new Message({
        sender: userId,
        receiver: receiverId,
        content
      });
      await newMessage.save();

      const messageData = {
        senderId: userId,
        content,
        timestamp: newMessage.timestamp
      };

      socket.to(receiverId).emit('receiveMessage', messageData);
      socket.emit('receiveMessage', messageData);
    });

    socket.on('disconnect', () => {
      console.log(`[Socket.IO]: المستخدم ${user.username} انفصل.`);
    });
  });
});

// -------------------------------
// 📍 المسارات (Routes)
// -------------------------------

const requireAuth = (req, res, next) => {
  const token = req.cookies.auth_token;
  if (!token) return res.status(401).json({ message: "أنت غير مصرح لك." });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: "التذكرة غير صالحة." });
    req.user = user;
    next();
  });
};

// 🔹 تسجيل مستخدم جديد
app.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ message: "يرجى إدخال جميع الحقول المطلوبة." });
    }

    const hashed = await bcrypt.hash(req.body.password, 10);
    const newUser = new User({
      username,
      email,
      password: hashed
    });
    await newUser.save();
    res.json({ message: `تم إنشاء حسابك بنجاح، ${newUser.username}!` });
  } catch (error) {
    if (error.code === 11000) {
      if (error.keyPattern.username)
        res.status(400).json({ message: "هذا الاسم مستخدم من قبل." });
      else if (error.keyPattern.email)
        res.status(400).json({ message: "هذا البريد الإلكتروني مستخدم من قبل." });
    } else {
      console.error('Registration Error:', error);
      res.status(500).json({ message: "حدث خطأ أثناء إنشاء الحساب." });
    }
  }
});

// 🔹 تسجيل الدخول
app.post('/login', async (req, res) => {
  const user = await User.findOne({ username: req.body.username });
  if (!user) return res.status(404).json({ message: "اسم المستخدم غير موجود." });

  const valid = await bcrypt.compare(req.body.password, user.password);
  if (!valid) return res.status(401).json({ message: "كلمة المرور غير صحيحة." });

  const token = jwt.sign({ userId: user._id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
  
  res.cookie('auth_token', token, {
    httpOnly: true,
    secure: isProduction, 
    sameSite: isProduction ? 'None' : 'Lax', 
    maxAge: 604800000 
  });

  res.json({ message: `مرحباً بعودتك، ${user.username}!` });
});

// 🔹 تسجيل الخروج
app.post('/logout', (req, res) => {
  res.clearCookie('auth_token', { sameSite: isProduction ? 'None' : 'Lax', secure: isProduction }); 
  res.json({ message: "تم تسجيل خروجك بنجاح." });
});

// 🔹 البروفايل
app.get('/api/profile', requireAuth, (req, res) => {
  res.json({ username: req.user.username, userId: req.user.userId });
});

// 🔹 قائمة المستخدمين
app.get('/api/users', requireAuth, async (req, res) => {
  try {
    const users = await User.find({ _id: { $ne: req.user.userId } }).select('username');
    res.json({ users });
  } catch (error) {
    console.error('Users Error:', error);
    res.status(500).json({ message: "فشل جلب المستخدمين." });
  }
});

// 🔹 المهام
app.get('/api/tasks', requireAuth, async (req, res) => {
  try {
    const tasks = await Task.find({ userId: req.user.userId }).sort({ createdAt: -1 });
    res.json({ tasks });
  } catch (error) {
    console.error('Fetch Tasks Error:', error);
    res.status(500).json({ message: "فشل جلب المهام." });
  }
});

app.post('/api/tasks', requireAuth, async (req, res) => {
  try {
    const description = req.body.description?.trim();
    if (!description) {
      return res.status(400).json({ message: "يرجى إدخال وصف المهمة." });
    }
    const task = await Task.create({ userId: req.user.userId, description });
    res.json({ task });
  } catch (error) {
    console.error('Create Task Error:', error);
    res.status(500).json({ message: "فشل إنشاء المهمة." });
  }
});

app.put('/api/tasks/:id', requireAuth, async (req, res) => {
  try {
    const task = await Task.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.userId },
      { completed: Boolean(req.body.completed) },
      { new: true }
    );
    if (!task) return res.status(404).json({ message: "المهمة غير موجودة." });
    res.json({ task });
  } catch (error) {
    console.error('Update Task Error:', error);
    res.status(500).json({ message: "فشل تحديث المهمة." });
  }
});

app.delete('/api/tasks/:id', requireAuth, async (req, res) => {
  try {
    const task = await Task.findOneAndDelete({ _id: req.params.id, userId: req.user.userId });
    if (!task) return res.status(404).json({ message: "المهمة غير موجودة." });
    res.json({ message: "تم حذف المهمة بنجاح." });
  } catch (error) {
    console.error('Delete Task Error:', error);
    res.status(500).json({ message: "فشل حذف المهمة." });
  }
});

app.put('/api/tasks/:id/like', requireAuth, async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ message: "المهمة غير موجودة." });

    const userId = req.user.userId;
    const hasLiked = task.likes.some((likeId) => likeId.equals(userId));
    if (hasLiked) {
      task.likes.pull(userId);
      await task.save();
      return res.json({ message: "تم إزالة الإعجاب.", likes: task.likes.length });
    }

    task.likes.push(userId);
    await task.save();
    res.json({ message: "تم تسجيل الإعجاب بنجاح.", likes: task.likes.length });
  } catch (error) {
    console.error('Like Task Error:', error);
    res.status(500).json({ message: "فشل تسجيل الإعجاب." });
  }
});

// 🔹 الرسائل
app.get('/api/messages/:userId', requireAuth, async (req, res) => {
  try {
    const otherUserId = req.params.userId;
    if (otherUserId === req.user.userId) {
      return res.json({ messages: [] });
    }
    const messages = await Message.find({
      $or: [
        { sender: req.user.userId, receiver: otherUserId },
        { sender: otherUserId, receiver: req.user.userId }
      ]
    }).sort({ timestamp: 1 });
    res.json({ messages });
  } catch (error) {
    console.error('Messages Error:', error);
    res.status(500).json({ message: "فشل جلب الرسائل." });
  }
});

// -------------------------------
// 🧹 إغلاق نظيف عند SIGTERM / SIGINT
// -------------------------------
let server; 

const shutdown = async () => {
  console.log('\n🛑 تلقّيت إشارة إنهاء. بدء الإغلاق النظيف...');
  if (server) {
      server.close(() => {
        console.log('✅ تم إغلاق خادم HTTP.');
        mongoose.connection.close(false)
          .then(() => {
            console.log('✅ تم قطع الاتصال بقاعدة البيانات.');
            process.exit(0);
          })
          .catch((err) => {
            console.error('❌ خطأ أثناء إغلاق قاعدة البيانات:', err);
            process.exit(1);
          });
      });
  } else {
      process.exit(0);
  }
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);


// -------------------------------
// 🗄️ الاتصال بقاعدة البيانات وتشغيل الخادم (ترتيب جديد)
// -------------------------------
const MONGODB_URI = process.env.MONGODB_URI;
const PORT = process.env.PORT || 8080;

if (!MONGODB_URI) {
    console.error('❌ خطأ حاسم: لم يتم تعيين MONGODB_URI في متغيرات البيئة.');
    process.exit(1); 
}

// 1. ابدأ الخادم فوراً (لنجاح الفحص الصحي)
server = httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ السيرفر يعمل الآن على المنفذ: ${PORT} (في انتظار قاعدة البيانات)`);
    
    // 2. الآن، بعد أن نجح الفحص الصحي، حاول الاتصال بقاعدة البيانات
    mongoose.connect(MONGODB_URI, {
        serverSelectionTimeoutMS: 5000 
    })
    .then(() => {
        console.log('✅ تم الاتصال بقاعدة بيانات MongoDB بنجاح!');
    })
    .catch((err) => {
        // لا توقف الخادم، فقط سجل الخطأ
        console.error('❌ فشل الاتصال بقاعدة البيانات:', err);
    });
});
