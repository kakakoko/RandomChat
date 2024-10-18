const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

console.log('开始初始化服务器...');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  }
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
  socket.on('add_friend', (friendName) => {
    const user = users.get(socket.id);
    const friend = Array.from(users.values()).find(u => u.username === friendName);
    if (friend) {
      user.friends.add(friendName);
      friend.friends.add(user.username);
      socket.emit('friend_added', friendName);
      io.to(getSocketIdByUsername(friendName)).emit('friend_added', user.username);
      console.log(`${user.username} 和 ${friendName} 成为好友`);
    } else {
      socket.emit('friend_not_found', friendName);
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

console.log('准备启动服务器...');

server.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
});

console.log('服务器启动过程完成');
