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
// 🌐 إعدادات الإنتاج
// !! تأكد أن هذا الرابط هو الرابط الصحيح الذي أعطاه لك Railway !!
// -------------------------------
const productionOrigin = 'https://myweb-production-e788.up.railway.app'; 

// -------------------------------
// 🚀 إنشاء التطبيق
// -------------------------------
const app = express();
const httpServer = http.createServer(app);

// =======================================================
// 🏥 المسار الخاص بـ "الفحص الصحي" لـ Railway (الحل الأسرع)
// يجب أن يكون هذا قبل أي middleware (مثل cors)
// =======================================================
app.get('/', (req, res) => {
  res.status(200).send('OK'); // أرسل "OK" فوراً
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
    origin: productionOrigin,
    methods: ['GET', 'POST'],
    credentials: true 
  }
});

// -------------------------------
// 🧰 Middleware
// -------------------------------
app.use(express.static(__dirname));
app.use(cors({
  origin: productionOrigin,
  credentials: true 
}));
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

// 🔹 تسجيل مستخدم جديد
app.post('/register', async (req, res) => {
  try {
    const hashed = await bcrypt.hash(req.body.password, 10);
    const newUser = new User({
      username: req.body.username,
      email: req.body.email,
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
    secure: true, 
    sameSite: 'None', 
    maxAge: 604800000 
  });

  res.json({ message: `مرحباً بعودتك، ${user.username}!` });
});

// 🔹 تسجيل الخروج
app.post('/logout', (req, res) => {
  res.clearCookie('auth_token', { sameSite: 'None', secure: true }); 
  res.json({ message: "تم تسجيل خروجك بنجاح." });
});

// 🔹 البروفايل
app.get('/api/profile', (req, res) => {
  const token = req.cookies.auth_token;
  if (!token) return res.status(401).json({ message: "أنت غير مصرح لك." });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: "التذكرة غير صالحة." });
    res.json({ username: user.username, userId: user.userId });
  });
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


// =======================================================
// 🗄️ الاتصال بقاعدة البيانات وتشغيل الخادم (ترتيب جديد)
// =======================================================
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