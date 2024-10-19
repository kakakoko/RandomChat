import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';
import axios from 'axios';
import './App.css';

const socket = io('http://localhost:5001');

function App() {
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [registerUsername, setRegisterUsername] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [loggedIn, setLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState('');
  const [messages, setMessages] = useState([]);
  const [privateMessages, setPrivateMessages] = useState({});
  const [inputValue, setInputValue] = useState('');
  const [friendName, setFriendName] = useState('');
  const [friends, setFriends] = useState([]);
  const [groupName, setGroupName] = useState('');
  const [groups, setGroups] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [matchedUser, setMatchedUser] = useState(null);
  const [commonFriends, setCommonFriends] = useState([]);

  const fetchUsers = async () => {
    try {
      const response = await axios.get('http://localhost:5001/users');
      console.log('Users:', response.data);
      // 可以将用户列表保存到状态中，然后在UI中显示
    } catch (error) {
      console.error('获取用户列表失败:', error);
    }
  };

  useEffect(() => {
    socket.on('login_success', (username) => {
      setLoggedIn(true);
      setCurrentUser(username);
    });

    socket.on('friend_added', (friendName) => {
      setFriends(prevFriends => [...prevFriends, friendName]);
    });

    socket.on('friend_not_found', (friendName) => {
      alert(`用户 ${friendName} 未找到`);
    });

    socket.on('group_created', (groupName, members) => {
      setGroups(prevGroups => [...prevGroups, { name: groupName, members }]);
    });

    socket.on('group_message', (groupName, from, message) => {
      setMessages(prevMessages => [...prevMessages, { type: 'group', group: groupName, from, message }]);
    });

    socket.on('matched', (matchedUsername, commonFriends) => {
      setMatchedUser(matchedUsername);
      setCommonFriends(commonFriends);
    });

    socket.on('private_message', (from, message, isSelf = false) => {
      setPrivateMessages(prevMessages => ({
        ...prevMessages,
        [from]: [...(prevMessages[from] || []), { from, message, isSelf }]
      }));
    });

    return () => {
      socket.off('login_success');
      socket.off('friend_added');
      socket.off('friend_not_found');
      socket.off('group_created');
      socket.off('group_message');
      socket.off('matched');
      socket.off('private_message');
    };
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const response = await axios.post('http://localhost:5001/login', { username: loginUsername, password: loginPassword });
      localStorage.setItem('token', response.data.token);
      setLoggedIn(true);
      setCurrentUser(loginUsername);
      socket.emit('login', loginUsername);
    } catch (error) {
      alert('登录失败: ' + (error.response?.data?.message || error.message));
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    try {
      await axios.post('http://localhost:5001/register', { username: registerUsername, password: registerPassword });
      alert('注册成功，请登录');
      setRegisterUsername('');
      setRegisterPassword('');
    } catch (error) {
      alert('注册失败: ' + (error.response?.data?.message || error.message));
    }
  };

  const handleAddFriend = (e) => {
    e.preventDefault();
    socket.emit('add_friend', friendName);
    setFriendName('');
  };

  const handleCreateGroup = (e) => {
    e.preventDefault();
    socket.emit('create_group', groupName, friends);
    setGroupName('');
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (inputValue) {
      if (selectedGroup) {
        socket.emit('group_message', selectedGroup, inputValue);
      } else if (matchedUser) {
        socket.emit('private_message', matchedUser, inputValue);
      }
      setInputValue('');
    }
  };

  const handleRandomMatch = () => {
    if (selectedGroup) {
      socket.emit('random_match', selectedGroup);
    }
  };

  if (!loggedIn) {
    return (
      <div className="App">
        <form onSubmit={handleLogin}>
          <input
            type="text"
            value={loginUsername}
            onChange={(e) => setLoginUsername(e.target.value)}
            placeholder="登录用户名"
          />
          <input
            type="password"
            value={loginPassword}
            onChange={(e) => setLoginPassword(e.target.value)}
            placeholder="登录密码"
          />
          <button type="submit">登录</button>
        </form>
        <form onSubmit={handleRegister}>
          <input
            type="text"
            value={registerUsername}
            onChange={(e) => setRegisterUsername(e.target.value)}
            placeholder="注册用户名"
          />
          <input
            type="password"
            value={registerPassword}
            onChange={(e) => setRegisterPassword(e.target.value)}
            placeholder="注册密码"
          />
          <button type="submit">注册</button>
        </form>
      </div>
    );
  }

  return (
    <div className="App">
      <h1>欢迎, {currentUser}!</h1>
      <div className="friends-section">
        <h2>好友列表</h2>
        <ul>
          {friends.map((friend, index) => (
            <li key={index}>{friend}</li>
          ))}
        </ul>
        <form onSubmit={handleAddFriend}>
          <input
            type="text"
            value={friendName}
            onChange={(e) => setFriendName(e.target.value)}
            placeholder="好友用户名"
          />
          <button type="submit">添加好友</button>
        </form>
      </div>
      <div className="groups-section">
        <h2>群聊列表</h2>
        <ul>
          {groups.map((group, index) => (
            <li key={index} onClick={() => setSelectedGroup(group.name)}>
              {group.name} ({group.members.join(', ')})
            </li>
          ))}
        </ul>
        <form onSubmit={handleCreateGroup}>
          <input
            type="text"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="群聊名称"
          />
          <button type="submit">创建群聊</button>
        </form>
      </div>
      <div className="chat-section">
        <h2>{selectedGroup ? `群聊: ${selectedGroup}` : matchedUser ? `与 ${matchedUser} 私聊` : '聊天'}</h2>
        <ul>
          {selectedGroup
            ? messages.filter(msg => msg.type === 'group' && msg.group === selectedGroup)
                .map((msg, index) => (
                  <li key={index}>{msg.from}: {msg.message}</li>
                ))
            : matchedUser && privateMessages[matchedUser]
                ? privateMessages[matchedUser].map((msg, index) => (
                    <li key={index} className={msg.isSelf ? 'self-message' : 'other-message'}>
                      {msg.from}: {msg.message}
                    </li>
                  ))
                : null
          }
        </ul>
        <form onSubmit={handleSendMessage}>
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="输入消息..."
          />
          <button type="submit">发送</button>
        </form>
        {selectedGroup && (
          <button onClick={handleRandomMatch}>随机匹配</button>
        )}
      </div>
      {matchedUser && (
        <div className="matched-section">
          <h3>与 {matchedUser} 匹配成功</h3>
          <h4>共同好友：</h4>
          <ul>
            {commonFriends.map((friend, index) => (
              <li key={index}>{friend}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default App;
