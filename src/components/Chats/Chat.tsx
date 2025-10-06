import { useState, useEffect, useRef } from 'react';
import { Search, Send, Phone, Video, Smile, ArrowLeft, Mic, Square, Play, Pause } from 'lucide-react';
import { messagesAPI, usersAPI, callAPI } from '../../services/api';
import { useAuth } from '../../hooks/useAuth';
import VideoCall from '../VideoCall/VideoCall';
import CallModal from '../VideoCall/CallModal';
import socket from '../../services/socket';
import messageSound from '../../assets/sounds/messageSound.mp3';
import ringing from '../../assets/sounds/Ringing.mp3';
import { requestNotificationPermission, showMessageNotification } from '../../utils/notifications';

interface ChatUser {
  id: string;
  name: string;
  avatar: string;
  lastMessage: string;
  timestamp: string;
  unread: number;
  online: boolean;
}

interface Message {
  id: string;
  text: string;
  timestamp: string;
  sender: 'me' | 'other';
  type?: 'text' | 'voice';
  audioUrl?: string;
  duration?: number;
}

// Utility function to generate consistent chat ID
const generateChatId = (userId1: string, userId2: string): string => {
  return [userId1, userId2].sort().join('_');
};

function Chat() {
  const { user } = useAuth();
  const [followedUsers, setFollowedUsers] = useState<ChatUser[]>([]);
  const [selectedChat, setSelectedChat] = useState<ChatUser | null>(null);
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [usersLoading, setUsersLoading] = useState(true);
  const [showCall, setShowCall] = useState(false);
  const [showCallModal, setShowCallModal] = useState(false);
  const [callType, setCallType] = useState<'video' | 'audio'>('video');
  const [callModalType, setCallModalType] = useState<'incoming' | 'outgoing'>('outgoing');
  const [currentAudio, setCurrentAudio] = useState<HTMLAudioElement | null>(null);
  const [showSidebar, setShowSidebar] = useState(true);
  const [unreadCounts, setUnreadCounts] = useState<{[key: string]: number}>({});
  const [lastMessages, setLastMessages] = useState<{[key: string]: string}>({});
  const [incomingCallData, setIncomingCallData] = useState<any>(null);
  const [showStickers, setShowStickers] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const [typingTimeout, setTypingTimeout] = useState<NodeJS.Timeout | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [audioChunks, setAudioChunks] = useState<Blob[]>([]);
  const [playingAudio, setPlayingAudio] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const stickers = [
    '😀', '😂', '🥰', '😍', '🤔', '😎', '🥳', '😴',
    '👍', '👎', '👏', '🙌', '💪', '🤝', '🙏', '✌️',
    '❤️', '💕', '💯', '🔥', '⭐', '🎉', '🎊', '🌟',
    '🐶', '🐱', '🦄', '🐸', '🦋', '🌸', '🌈', '☀️'
  ];

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isTyping]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [message]);

  useEffect(() => {
    fetchFollowedUsers();
    requestNotificationPermission();
  }, []);

  useEffect(() => {
    // When user connects, emit userOnline
    if (user) {
      socket.emit('userOnline', user.id);
    }
    
    if (selectedChat && user) {
      // Create consistent chat ID for both users
      const chatId = generateChatId(user.id, selectedChat.id);
      fetchMessages(chatId);
      socket.emit('joinChat', chatId);
      
      // Clear unread count for selected chat
      setUnreadCounts(prev => ({
        ...prev,
        [selectedChat.id]: 0
      }));
    }

    socket.on('receiveMessage', (newMessage) => {
      
      // Only add messages from other users to prevent duplicates
      if (newMessage.userId !== user?.id) {
        setMessages(prev => {
          const messageExists = prev.some(msg => msg.id === newMessage._id);
          if (!messageExists) {
            const formattedMessage: Message = {
              id: newMessage._id || Date.now().toString(),
              text: newMessage.text,
              timestamp: new Date(newMessage.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              sender: 'other',
              type: 'text' as const
            };
            
            // Update unread count if not in current chat
            if (!selectedChat || selectedChat.id !== newMessage.userId) {
              setUnreadCounts(prev => ({
                ...prev,
                [newMessage.userId]: (prev[newMessage.userId] || 0) + 1
              }));
            }
            
            // Update last message for this user
            setLastMessages(prev => ({
              ...prev,
              [newMessage.userId]: newMessage.text
            }));
            
            return [...prev, formattedMessage];
          }
          return prev;
        });
      }
      
      // Play message sound and show notification for received messages (only from others)
      if (newMessage.userId !== user?.id) {
        const audio = new Audio(messageSound);
        const playPromise = audio.play();
        if (playPromise !== undefined) {
          playPromise.catch((error) => {
            if (error.name !== 'AbortError') {
              console.error('Message sound failed:', error);
            }
          });
        }
        
        // Show browser notification
        const senderName = followedUsers.find(u => u.id === newMessage.userId)?.name || 'Someone';
        showMessageNotification(senderName, newMessage.text);
      }
    });

    socket.on('callUser', (data) => {
      const { callType } = data;
      setIncomingCallData(data); // Store caller data
      setCallType(callType);
      setCallModalType('incoming');
      setShowCallModal(true);
      
      // Play ringing sound for incoming calls
      const audio = new Audio(ringing);
      audio.loop = true;
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch((error) => {
          if (error.name !== 'AbortError') {
            console.error('Ringing sound failed:', error);
          }
        });
      }
      setCurrentAudio(audio);
    });

    socket.on('callAccepted', () => {
      if (currentAudio) {
        try {
          currentAudio.pause();
          currentAudio.currentTime = 0;
        } catch (error) {
          // Ignore errors when stopping audio
        }
        setCurrentAudio(null);
      }
      setShowCallModal(false);
      setShowCall(true);
    });

    socket.on('callRejected', () => {
      if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
        setCurrentAudio(null);
      }
      setShowCallModal(false);
    });

    socket.on('callEnded', () => {
      setShowCall(false);
    });

    socket.on('callFailed', ({ message }) => {
      setShowCallModal(false);
      alert(`Call failed: ${message}`);
    });

    socket.on('userTyping', ({ userId, username }) => {
      if (userId !== user?.id) {
        setTypingUser(username);
        setIsTyping(true);
      }
    });

    socket.on('userStoppedTyping', ({ userId }) => {
      if (userId !== user?.id) {
        setIsTyping(false);
        setTypingUser(null);
      }
    });

    return () => {
      socket.off('receiveMessage');
      socket.off('callUser');
      socket.off('callAccepted');
      socket.off('callRejected');
      socket.off('callEnded');
      socket.off('callFailed');
      socket.off('userTyping');
      socket.off('userStoppedTyping');
    };
  }, [selectedChat, user]);

  const fetchFollowedUsers = async () => {
    try {
      const response = await usersAPI.getFollowing();
      const chatUsers = response.data.map((u: any) => ({
        id: u._id,
        name: u.username,
        avatar: u.username.substring(0, 2).toUpperCase(),
        lastMessage: lastMessages[u._id] || 'Start a conversation',
        timestamp: u.isActive ? 'Online' : 'Offline',
        unread: unreadCounts[u._id] || 0,
        online: u.isActive || false
      }));
      setFollowedUsers(chatUsers);
      if (chatUsers.length > 0 && !selectedChat) {
        setSelectedChat(chatUsers[0]);
      }
    } catch (error) {
      console.error('Failed to fetch followed users:', error);
    } finally {
      setUsersLoading(false);
    }
  };

  const fetchMessages = async (chatId: string) => {
    setLoading(true);
    try {
      // Try new format first
      let response = await messagesAPI.getMessages(chatId);
      // If no messages found with new format, try old formats (individual user IDs)
      if (response.data.length === 0 && selectedChat && user) {
        try {
          const response1 = await messagesAPI.getMessages(user.id);
          const response2 = await messagesAPI.getMessages(selectedChat.id);
          // Get all messages where either user is involved
          const allMessages = [...response1.data, ...response2.data];
          
          const combinedMessages = allMessages
            .filter((msg: any, index: number, array: any[]) => {
              // Remove duplicates based on _id
              const firstIndex = array.findIndex(m => m._id === msg._id);
              if (firstIndex !== index) return false;
              
              // Include messages between these two users
              const isConversationMessage = 
                (msg.userId === user.id && msg.chatId === selectedChat.id) ||
                (msg.userId === selectedChat.id && msg.chatId === user.id) ||
                (msg.chatId === user.id && msg.userId === selectedChat.id) ||
                (msg.chatId === selectedChat.id && msg.userId === user.id);
              
              return isConversationMessage;
            })
            .sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
          response = { 
            data: combinedMessages,
            status: 200,
            statusText: 'OK',
            headers: {},
            config: {} as any
          } as any;
          console.log('Found messages with old format:', combinedMessages);
        } catch (oldFormatError) {
          console.log('Old format also failed:', oldFormatError);
        }
      }
      
      const formattedMessages: Message[] = response.data.map((msg: any) => ({
        id: msg._id,
        text: msg.text,
        timestamp: new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        sender: msg.userId === user?.id ? 'me' as const : 'other' as const,
        type: 'text' as const
      }));
      setMessages(formattedMessages);
    } catch (error) {
      console.error('Failed to fetch messages:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSendSticker = async (sticker: string) => {
    if (!selectedChat || !user) return;
    
    try {
      const chatId = generateChatId(user.id, selectedChat.id);
      const response = await messagesAPI.createMessage(chatId, sticker);
      
      const newMessage = {
        id: response.data._id,
        text: sticker,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        sender: 'me' as const,
        type: 'text' as const
      };
      
      setMessages(prev => [...prev, newMessage]);
      setLastMessages(prev => ({ ...prev, [selectedChat.id]: sticker }));
      setShowStickers(false);
      
      socket.emit('sendMessage', {
        chatId: chatId,
        userId: user.id,
        text: sticker,
        timestamp: new Date()
      });
    } catch (error) {
      console.error('Failed to send sticker:', error);
    }
  };

  const startRecording = async (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (isRecording) return;
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          setAudioChunks(prev => [...prev, event.data]);
        }
      };
      
      recorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop());
        // Send voice note after recording stops
        setTimeout(() => {
          sendVoiceNote();
          // Reset mediaRecorder after sending
          setMediaRecorder(null);
        }, 100);
      };
      
      setMediaRecorder(recorder);
      setAudioChunks([]);
      setIsRecording(true);
      setRecordingTime(0);
      
      recorder.start();
      
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } catch (error) {
      console.error('Failed to start recording:', error);
      alert('Unable to access microphone. Please check permissions.');
    }
  };
  
  const stopRecording = (e?: React.MouseEvent | React.TouchEvent) => {
    if (e) e.preventDefault();
    if (!mediaRecorder || !isRecording) return;
    
    mediaRecorder.stop();
    setIsRecording(false);
    
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  };
  
  const sendVoiceNote = async () => {
    if (!selectedChat || !user || audioChunks.length === 0 || recordingTime < 1) {
      // Don't send if recording is too short
      setAudioChunks([]);
      setRecordingTime(0);
      return;
    }
    
    try {
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      const audioUrl = URL.createObjectURL(audioBlob);
      
      const chatId = generateChatId(user.id, selectedChat.id);
      
      // For now, send as text message indicating voice note
      // In production, you'd upload the audio file to a server
      const response = await messagesAPI.createMessage(chatId, `🎤 Voice message (${recordingTime}s)`);
      
      const newMessage: Message = {
        id: response.data._id,
        text: `🎤 Voice message (${recordingTime}s)`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        sender: 'me',
        type: 'voice',
        audioUrl: audioUrl,
        duration: recordingTime
      };
      
      setMessages(prev => [...prev, newMessage]);
      setLastMessages(prev => ({ ...prev, [selectedChat.id]: '🎤 Voice message' }));
      
      socket.emit('sendMessage', {
        chatId: chatId,
        userId: user.id,
        text: `🎤 Voice message (${recordingTime}s)`,
        timestamp: new Date()
      });
      
      console.log('Voice note sent successfully');
    } catch (error) {
      console.error('Failed to send voice note:', error);
    } finally {
      // Reset all recording states
      setAudioChunks([]);
      setRecordingTime(0);
      setMediaRecorder(null);
    }
  };
  
  const playAudio = (audioUrl: string, messageId: string) => {
    if (playingAudio === messageId) {
      // Stop current audio
      const audioElements = document.querySelectorAll('audio');
      audioElements.forEach(audio => {
        audio.pause();
        audio.currentTime = 0;
      });
      setPlayingAudio(null);
    } else {
      // Play new audio
      const audio = new Audio(audioUrl);
      audio.onended = () => setPlayingAudio(null);
      audio.play();
      setPlayingAudio(messageId);
    }
  };
  
  const formatRecordingTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleSendMessage = async () => {
    if (!message.trim() || !selectedChat || !user || isSending) return;
    
    setIsSending(true);
    
    try {
      // Create the message via API with consistent chat ID
      const chatId = generateChatId(user.id, selectedChat.id);
      const response = await messagesAPI.createMessage(chatId, message);
      
      // Add the message to the UI immediately from the API response
      const newMessage = {
        id: response.data._id,
        text: message,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        sender: 'me' as const,
        type: 'text' as const
      };
      
      setMessages(prev => [...prev, newMessage]);
      
      // Update last message for this chat
      setLastMessages(prev => ({
        ...prev,
        [selectedChat.id]: message
      }));
      
      setMessage('');
      
      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
      
      // Stop typing indicator
      socket.emit('stopTyping', {
        chatId,
        userId: user.id
      });
      
      // Emit the socket event for other users
      socket.emit('sendMessage', {
        chatId: chatId,
        userId: user.id,
        text: message,
        timestamp: new Date()
      });
      console.log('Sending message to chat:', chatId);
    } catch (error) {
      console.error('Failed to send message:', error);
      alert('Failed to send message. Please try again.');
    } finally {
      setIsSending(false);
    }
  };

  const initiateCall = async (type: 'video' | 'audio') => {
    if (!selectedChat || !user) return;
    
    try {
      await callAPI.initiateCall(selectedChat.id, type);
      setCallType(type);
      setCallModalType('outgoing');
      setShowCallModal(true);
      
      socket.emit('callUser', {
        userToCall: selectedChat.id,
        signalData: null,
        from: user.id,
        name: user.username,
        callType: type
      });
      console.log('Emitting callUser event:', {
        userToCall: selectedChat.id,
        from: user.id,
        name: user.username,
        callType: type
      });
    } catch (error) {
      console.error('Failed to initiate call:', error);
    }
  };


  const handleSelectChat = (chat: ChatUser) => {
    setSelectedChat(chat);
    setShowSidebar(false); // Always hide sidebar when selecting chat on mobile
  };

  const handleBackToChats = () => {
    setSelectedChat(null);
    setShowSidebar(true); // Always show sidebar when going back
  };

  const handleTyping = () => {
    if (!selectedChat || !user) return;
    
    const chatId = generateChatId(user.id, selectedChat.id);
    socket.emit('typing', {
      chatId,
      userId: user.id,
      username: user.username
    });
    
    if (typingTimeout) {
      clearTimeout(typingTimeout);
    }
    
    const timeout = setTimeout(() => {
      socket.emit('stopTyping', {
        chatId,
        userId: user.id
      });
    }, 1000);
    
    setTypingTimeout(timeout);
  };

  const filteredUsers = followedUsers.filter(chat => 
    chat.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    chat.lastMessage.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex h-screen bg-gray-50 relative overflow-hidden" style={{ height: '100dvh' }}>
      {/* Chat Sidebar */}
      <div 
        className={`bg-white border-r border-gray-200 flex-col transition-all duration-300 ease-in-out h-full z-30 absolute md:relative
          ${showSidebar ? 'flex w-full md:w-80' : 'hidden md:flex md:w-80'}`}
      >
        {/* Search Header */}
        <div className="p-4 md:p-5 border-b border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl md:text-2xl font-semibold text-gray-800">Messages</h2>
          </div>
          <div className="relative">
            <Search size={20} className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search conversations..."
              className="w-full py-2 md:py-3 pl-12 pr-4 border border-gray-200 rounded-full text-sm outline-none focus:border-blue-500 transition-colors"
            />
          </div>
        </div>

        {/* Chat List */}
        <div className="flex-1 overflow-y-auto">
          {usersLoading ? (
            <div className="flex justify-center items-center h-32">
              <div className="text-gray-600">Loading chats...</div>
            </div>
          ) : filteredUsers.length > 0 ? (
            filteredUsers.map((chat) => (
            <div
              key={chat.id}
              onClick={() => handleSelectChat(chat)}
              className={`p-3 md:p-4 border-b border-gray-100 cursor-pointer ${selectedChat?.id === chat.id ? 'bg-gray-50' : 'bg-white hover:bg-gray-50'} flex items-center gap-3 transition-colors`}
            >
              <div className="relative">
                <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white font-semibold text-sm md:text-base">
                  {chat.avatar}
                </div>
                {chat.online && (
                  <div className="absolute bottom-0 right-0 w-2 h-2 md:w-3 md:h-3 bg-blue-500 rounded-full border-2 border-white" />
                )}
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-center mb-1">
                  <h4 className="text-sm md:text-base font-semibold text-gray-800 truncate">{chat.name}</h4>
                  <span className="text-xs text-gray-500">{chat.timestamp}</span>
                </div>
                
                <div className="flex justify-between items-center">
                  <p className="text-xs md:text-sm text-gray-600 truncate flex-1">{chat.lastMessage}</p>
                  
                  {chat.unread > 0 && (
                    <div className="bg-blue-500 text-white rounded-full w-4 h-4 md:w-5 md:h-5 flex items-center justify-center text-xs font-semibold ml-2">
                      {chat.unread}
                    </div>
                  )}
                </div>
              </div>
            </div>
            ))
          ) : (
            <div className="text-center py-8 md:py-12 px-4">
              <p className="text-gray-600 mb-2 md:mb-4">No conversations yet</p>
              <p className="text-xs md:text-sm text-gray-500">Follow people to start chatting with them</p>
            </div>
          )}
        </div>
      </div>

      {/* Chat Area */}
      <div className={`flex-1 flex-col bg-white ${selectedChat ? 'flex' : 'hidden md:flex'} ${showSidebar ? 'hidden md:flex' : ''}`}>
        {selectedChat ? (
          <>
            {/* Chat Header */}
            <div className="p-3 md:p-5 border-b border-gray-200 flex items-center justify-between">
              <div className="flex items-center">
                <button 
                  onClick={handleBackToChats}
                  className="md:hidden p-2 hover:bg-gray-100 rounded-full mr-2"
                >
                  <ArrowLeft size={20} />
                </button>
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="w-10 h-10 md:w-11 md:h-11 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white font-semibold text-sm md:text-base">
                      {selectedChat.avatar}
                    </div>
                    {selectedChat.online && (
                      <div className="absolute bottom-0 right-0 w-2 h-2 md:w-3 md:h-3 bg-blue-500 rounded-full border-2 border-white" />
                    )}
                  </div>
                  
                  <div>
                    <h3 className="text-base md:text-lg font-semibold text-gray-800">{selectedChat.name}</h3>
                    <p className={`text-xs md:text-sm ${selectedChat.online ? 'text-blue-500' : 'text-gray-500'}`}>
                      {selectedChat.online ? 'Online' : 'Offline'}
                    </p>
                  </div>
                </div>
              </div>
              
              <div className="flex gap-1 md:gap-2">
                <button 
                  onClick={() => initiateCall('audio')}
                  className="p-1.5 md:p-2 rounded-full hover:bg-gray-100 text-gray-600 transition-colors"
                >
                  <Phone size={18} className="md:w-5 md:h-5" />
                </button>
                <button 
                  onClick={() => initiateCall('video')}
                  className="p-1.5 md:p-2 rounded-full hover:bg-gray-100 text-gray-600 transition-colors"
                >
                  <Video size={18} className="md:w-5 md:h-5" />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 p-3 md:p-5 overflow-y-auto bg-gray-50">
              {loading ? (
                <div className="flex justify-center items-center h-full">
                  <div className="text-gray-600">Loading messages...</div>
                </div>
              ) : messages.length > 0 ? (
                <>
                  {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.sender === 'me' ? 'justify-end' : 'justify-start'} mb-3 md:mb-4`}
                  >
                    <div className={`max-w-xs md:max-w-xl px-3 py-2 md:px-4 md:py-3 rounded-2xl shadow-sm ${
                      msg.sender === 'me' 
                        ? 'bg-blue-500 text-white' 
                        : 'bg-white text-gray-800'
                    }`}>
                      {msg.type === 'voice' ? (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => playAudio(msg.audioUrl!, msg.id)}
                            className={`w-8 h-8 rounded-full flex items-center justify-center ${
                              msg.sender === 'me' ? 'bg-blue-400 hover:bg-blue-300' : 'bg-gray-200 hover:bg-gray-300'
                            } transition-colors`}
                          >
                            {playingAudio === msg.id ? (
                              <Pause size={14} className={msg.sender === 'me' ? 'text-white' : 'text-gray-600'} />
                            ) : (
                              <Play size={14} className={msg.sender === 'me' ? 'text-white' : 'text-gray-600'} />
                            )}
                          </button>
                          <div className="flex-1">
                            <div className={`h-1 rounded-full ${
                              msg.sender === 'me' ? 'bg-blue-300' : 'bg-gray-300'
                            }`}>
                              <div className={`h-full w-1/3 rounded-full ${
                                msg.sender === 'me' ? 'bg-white' : 'bg-blue-500'
                              }`}></div>
                            </div>
                          </div>
                          <span className={`text-xs ${
                            msg.sender === 'me' ? 'text-blue-100' : 'text-gray-500'
                          }`}>
                            {msg.duration}s
                          </span>
                        </div>
                      ) : (
                        <p className="text-sm leading-relaxed mb-1 whitespace-pre-wrap break-words">{msg.text}</p>
                      )}
                      <span className={`text-xs ${msg.sender === 'me' ? 'text-blue-100' : 'text-gray-500'}`}>
                        {msg.timestamp}
                      </span>
                    </div>
                  </div>
                  ))}
                  <div ref={messagesEndRef} />
                  
                  {/* Typing Indicator */}
                  {isTyping && typingUser && (
                    <div className="flex justify-start mb-3">
                      <div className="bg-gray-200 px-4 py-2 rounded-2xl">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-gray-600">{typingUser} is typing</span>
                          <div className="flex gap-1">
                            <div className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce"></div>
                            <div className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                            <div className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center text-gray-500 p-4">
                    <div className="text-4xl md:text-6xl mb-2 md:mb-4">💬</div>
                    <p className="text-sm md:text-base font-medium mb-1 md:mb-2">No messages yet</p>
                    <p className="text-xs md:text-sm">Start a conversation with {selectedChat.name}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Message Input */}
            <div className="p-3 md:p-5 pb-20 md:pb-5 border-t border-gray-200 bg-white">
              {/* Sticker Picker */}
              {showStickers && (
                <div className="mb-3 p-3 bg-gray-50 rounded-2xl">
                  <div className="grid grid-cols-8 gap-2">
                    {stickers.map((sticker, index) => (
                      <button
                        key={index}
                        onClick={() => handleSendSticker(sticker)}
                        className="text-2xl p-2 hover:bg-gray-200 rounded-lg transition-colors"
                      >
                        {sticker}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              
              <div className="flex items-end gap-2 md:gap-3 bg-gray-50 rounded-2xl px-3 md:px-4 py-2">
                <button 
                  onClick={() => setShowStickers(!showStickers)}
                  className={`p-1 transition-colors mb-1 ${
                    showStickers ? 'text-blue-500' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <Smile size={18} className="md:w-5 md:h-5" />
                </button>
                
                {!isRecording ? (
                  <>
                    <textarea
                      ref={textareaRef}
                      value={message}
                      onChange={(e) => {
                        setMessage(e.target.value);
                        handleTyping();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSendMessage();
                        }
                      }}
                      onTouchStart={(e) => e.stopPropagation()}
                      onFocus={(e) => {
                        e.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }}
                      placeholder="Type a message... (Shift+Enter for new line)"
                      rows={1}
                      className="flex-1 bg-transparent border-none outline-none text-sm py-1 md:py-2 min-w-0 resize-none max-h-32 overflow-y-auto"
                      style={{ minHeight: '24px' }}
                    />
                    
                    {message.trim() ? (
                      <button
                        onClick={handleSendMessage}
                        disabled={isSending}
                        className={`w-8 h-8 md:w-10 md:h-10 rounded-full flex items-center justify-center bg-blue-500 text-white hover:bg-blue-600 transition-colors mb-1 ${
                          isSending ? 'opacity-50 cursor-not-allowed' : ''
                        }`}
                      >
                        {isSending ? (
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        ) : (
                          <Send size={16} className="md:w-[18px] md:h-[18px]" />
                        )}
                      </button>
                    ) : (
                      <button
                        onMouseDown={startRecording}
                        onMouseUp={stopRecording}
                        onMouseLeave={stopRecording}
                        onTouchStart={startRecording}
                        onTouchEnd={stopRecording}
                        className="w-8 h-8 md:w-10 md:h-10 rounded-full flex items-center justify-center bg-blue-500 text-white hover:bg-blue-600 transition-colors select-none mb-1"
                      >
                        <Mic size={16} className="md:w-[18px] md:h-[18px]" />
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <div className="flex-1 flex items-center gap-2">
                      <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                      <span className="text-sm text-gray-600">Recording... {formatRecordingTime(recordingTime)}</span>
                      <div className="flex-1 h-1 bg-gray-200 rounded-full overflow-hidden">
                        <div className="h-full bg-red-500 rounded-full animate-pulse" style={{ width: '30%' }}></div>
                      </div>
                    </div>
                    
                    <button
                      onClick={stopRecording}
                      className="w-8 h-8 md:w-10 md:h-10 rounded-full flex items-center justify-center bg-red-500 text-white hover:bg-red-600 transition-colors mb-1"
                    >
                      <Square size={16} className="md:w-[18px] md:h-[18px]" />
                    </button>
                  </>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500 p-4">
            <div className="text-center">
              <div className="text-4xl md:text-6xl mb-2 md:mb-4">💬</div>
              <p className="text-sm md:text-lg font-medium mb-1 md:mb-2">Welcome to Messages</p>
              <p className="text-xs md:text-sm">Select a conversation to start messaging</p>
            </div>
          </div>
        )}
      </div>
      
      {/* Call Modal */}
      {showCallModal && selectedChat && (
        <CallModal
          type={callModalType}
          isVideoCall={callType === 'video'}
          recipientName={selectedChat.name}
          onAccept={() => {
            if (currentAudio) {
              currentAudio.pause();
              currentAudio.currentTime = 0;
              setCurrentAudio(null);
            }
            // Use the caller's ID from incoming call data
            const callerId = incomingCallData?.from || selectedChat.id;
            socket.emit('answerCall', { signal: null, to: callerId });
            console.log('Emitting answerCall event to user ID:', callerId);
            console.log('My socket ID:', socket.id);
            setShowCallModal(false);
            setShowCall(true);
          }}
          onDecline={() => {
            if (currentAudio) {
              currentAudio.pause();
              currentAudio.currentTime = 0;
              setCurrentAudio(null);
            }
            // Use the caller's ID from incoming call data
            const callerId = incomingCallData?.from || selectedChat.id;
            socket.emit('rejectCall', { to: callerId });
            console.log('Rejecting call from:', callerId);
            setShowCallModal(false);
          }}
        />
      )}
      
      {/* Video/Audio Call */}
      {showCall && selectedChat && (
        <VideoCall
          isVideoCall={callType === 'video'}
          recipientName={selectedChat.name}
          recipientId={incomingCallData?.from || selectedChat.id}
          onEndCall={() => {
            // Emit endCall event to the other user
            const otherUserId = incomingCallData?.from || selectedChat.id;
            socket.emit('endCall', { to: otherUserId });
            console.log('Ending call with user:', otherUserId);
            setShowCall(false);
          }}
        />
      )}
    </div>
  );
}

export default Chat;