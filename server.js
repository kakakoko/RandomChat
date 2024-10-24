require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

console.log('开始初始化服务器...');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGODB_URI, { 
  useNewUrlParser: true, 
  useUnifiedTopology: true,
  useFindAndModify: false,
  useCreateIndex: true 
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  friends: [{ type: String }]
});

const User = mongoose.model('User', UserSchema);

app.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, password: hashedPassword });
    await user.save();
    res.status(201).json({ message: '用户注册成功' });
  } catch (error) {
    console.error('注册错误:', error);
    res.status(500).json({ message: '注册失败', error: error.message });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({ message: '用户不存在' });
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: '密码错误' });
    }
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.json({ token, username });
  } catch (error) {
    res.status(500).json({ message: '登录失败', error: error.message });
  }
});

app.get('/users', async (req, res) => {
  try {
    const users = await User.find({}, 'username'); // 只返回用户名，不返回密码
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: '获取用户列表失败', error: error.message });
  }
});

app.get('/user/:username', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username }, 'username');
    if (user) {
      res.json(user);
    } else {
      res.status(404).json({ message: '用户未找到' });
    }
  } catch (error) {
    res.status(500).json({ message: '查询用户失败', error: error.message });
  }
});

// 修改获取好友列表路由
app.get('/friends/:username', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username });
    if (!user) {
      return res.status(404).json({ message: '用户不存在' });
    }
    res.status(200).json({ friends: user.friends });
  } catch (error) {
    res.status(500).json({ message: '获取好友列表失败', error: error.message });
  }
});

// 确保这个路由存在
app.post('/add-friend', async (req, res) => {
  console.log('Received add friend request:', req.body);
  try {
    const { username, friendName } = req.body;
    const user = await User.findOne({ username });
    const friend = await User.findOne({ username: friendName });

    console.log('User found:', user);
    console.log('Friend found:', friend);

    if (!user || !friend) {
      console.log('User or friend not found');
      return res.status(404).json({ message: '用户或好友不存在' });
    }

    if (user.friends.includes(friendName)) {
      console.log('Already friends');
      return res.status(400).json({ message: '已经是好友了' });
    }

    user.friends.push(friendName);
    friend.friends.push(username);

    console.log('User before save:', user);
    console.log('Friend before save:', friend);

    await user.save();
    await friend.save();

    console.log('User after save:', user);
    console.log('Friend after save:', friend);

    console.log('Friend added successfully');
    res.status(200).json({ message: '添加好友成功' });
  } catch (error) {
    console.error('Error adding friend:', error);
    res.status(500).json({ message: '添加好友失败', error: error.message });
  }
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

const PORT = process.env.PORT || 5001;

// 用户数据存储
const users = new Map();
const groups = new Map();

console.log('设置 Socket.IO 事件处理程序...');

io.on('connection', (socket) => {
  console.log('新用户连接');

  // 用户登录
  socket.on('login', (username) => {
    users.set(socket.id, { username, friends: new Set(), groups: new Set() });
    socket.emit('login_success', username);
    console.log(`用户 ${username} 登录`);
  });

  // 添加好友
  socket.on('add_friend', async ({ username, friendName }) => {
    try {
      const user = await User.findOne({ username });
      const friend = await User.findOne({ username: friendName });

      if (!user || !friend) {
        socket.emit('add_friend_error', '用户或好友不存在');
        return;
      }

      if (user.friends.includes(friendName)) {
        socket.emit('add_friend_error', '已经是好友了');
        return;
      }

      user.friends.push(friendName);
      friend.friends.push(username);

      await user.save();
      await friend.save();

      socket.emit('friend_added', friendName);
      io.to(friend.socketId).emit('friend_added', username);
    } catch (error) {
      socket.emit('add_friend_error', '添加好友失败');
    }
  });

  // 创建群聊
  socket.on('create_group', (groupName, members) => {
    const user = users.get(socket.id);
    const group = { name: groupName, members: new Set([user.username, ...members]) };
    groups.set(groupName, group);
    group.members.forEach(member => {
      users.get(getSocketIdByUsername(member)).groups.add(groupName);
      io.to(getSocketIdByUsername(member)).emit('group_created', groupName, Array.from(group.members));
    });
    console.log(`群聊 ${groupName} 创建成功`);
  });

  // 群聊消息
  socket.on('group_message', (groupName, message) => {
    const user = users.get(socket.id);
    const group = groups.get(groupName);
    if (group && group.members.has(user.username)) {
      group.members.forEach(member => {
        io.to(getSocketIdByUsername(member)).emit('group_message', groupName, user.username, message);
      });
      console.log(`${user.username} 在群 ${groupName} 中发送消息: ${message}`);
    }
  });

  // 随机匹配
  socket.on('random_match', (groupName) => {
    const group = groups.get(groupName);
    if (group) {
      const members = Array.from(group.members);
      const pairs = randomPair(members);
      pairs.forEach(pair => {
        const commonFriends = getCommonFriends(pair[0], pair[1]);
        io.to(getSocketIdByUsername(pair[0])).emit('matched', pair[1], commonFriends);
        io.to(getSocketIdByUsername(pair[1])).emit('matched', pair[0], commonFriends);
      });
      console.log(`群 ${groupName} 进行了随机匹配`);
    }
  });

  // 私聊消息
  socket.on('private_message', (to, message) => {
    const user = users.get(socket.id);
    io.to(getSocketIdByUsername(to)).emit('private_message', user.username, message);
    // 发送消息给自己，以便在自己的聊天框中显示
    socket.emit('private_message', user.username, message, true);
    console.log(`${user.username} 向 ${to} 发送私聊消息: ${message}`);
  });

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      console.log(`用户 ${user.username} 断开连接`);
      users.delete(socket.id);
    }
  });
});

function getSocketIdByUsername(username) {
  for (const [socketId, user] of users.entries()) {
    if (user.username === username) {
      return socketId;
    }
  }
}

function getCommonFriends(user1, user2) {
  const friends1 = users.get(getSocketIdByUsername(user1)).friends;
  const friends2 = users.get(getSocketIdByUsername(user2)).friends;
  return Array.from(friends1).filter(friend => friends2.has(friend));
}

function randomPair(arr) {
  const result = [];
  const shuffled = arr.sort(() => 0.5 - Math.random());
  for (let i = 0; i < shuffled.length - 1; i += 2) {
    result.push([shuffled[i], shuffled[i + 1]]);
  }
  if (shuffled.length % 2 !== 0) {
    result[result.length - 1].push(shuffled[shuffled.length - 1]);
  }
  return result;
}

console.log('准备启务器...');

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

console.log('服务器启动过程完成');
