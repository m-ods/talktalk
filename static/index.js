document.addEventListener('DOMContentLoaded', () => {
  const errorDiv = document.getElementById('error');
  const askDiv = document.getElementById('ask');
  const channelDiv = document.getElementById('channel');
  const nameInput = document.getElementById('name');
  const messageInput = document.getElementById('message');
  const messagesContainer = document.querySelector('#msgs ul');
  let messageMap = {};  // To track message IDs and their corresponding elements

  if (!window.WebSocket) {
    errorDiv.style.display = 'block';
    return;
  }

  askDiv.style.display = 'block';

  document.querySelector('.join').addEventListener('click', (event) => {
    event.preventDefault();
    const name = nameInput.value.trim();
    if (name) {
      askDiv.style.display = 'none';
      channelDiv.style.display = 'block';
      startChat(name);
    }
  });

  function startChat(name) {
    const ws = new WebSocket(`${wsUrl}?name=${name}`);

    ws.onopen = () => {
      console.log(`Connected as ${name}`);
      startMicrophone(ws);
    };

    ws.onmessage = (evt) => {
      const obj = JSON.parse(evt.data);
      handleMessage(obj);
    };

    ws.onclose = () => {
      console.log('WebSocket connection closed');
    };

    document.querySelector('#input form').addEventListener('submit', (event) => {
      event.preventDefault();
      const msg = messageInput.value.trim();
      if (msg) {
        ws.send(JSON.stringify({ action: 'message', user: name, message: msg }));
        messageInput.value = '';
      }
    });
  }

  async function startMicrophone(ws) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioContext = new AudioContext({
        sampleRate: 16000,
        latencyHint: 'balanced'
      });

      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);

      source.connect(processor);
      processor.connect(audioContext.destination);

      processor.onaudioprocess = function(event) {
        const inputBuffer = event.inputBuffer;
        const outputBuffer = new Float32Array(inputBuffer.length);
        inputBuffer.copyFromChannel(outputBuffer, 0);
        
        const pcmData = convertFloat32ToPCM(outputBuffer);
        ws.send(pcmData);
      };
    } catch (err) {
      console.error("Error accessing microphone:", err);
    }
  }

  function convertFloat32ToPCM(float32Array) {
    const pcm16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      pcm16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return pcm16Array.buffer;
  }

  function handleMessage(obj) {
    const { user, message, message_id, final } = obj;
    let msgItem;

    if (message_id && messageMap[message_id]) {
      // Update existing message
      msgItem = messageMap[message_id];
      msgItem.querySelector('.message').textContent = `: ${message}`;
    } else {
      // Create new message
      msgItem = document.createElement('li');
      msgItem.classList.add('message');
      msgItem.setAttribute('data-message-id', message_id);

      const userSpan = document.createElement('span');
      userSpan.classList.add('user');
      if (user === name) {
        userSpan.classList.add('self');
      }
      userSpan.textContent = user;

      const messageSpan = document.createElement('span');
      messageSpan.classList.add('message');
      messageSpan.textContent = `: ${message}`;

      const timeSpan = document.createElement('span');
      timeSpan.classList.add('time');
      timeSpan.textContent = new Date().toLocaleTimeString();

      msgItem.appendChild(userSpan);
      msgItem.appendChild(messageSpan);
      msgItem.appendChild(timeSpan);

      messagesContainer.appendChild(msgItem);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;

      if (!final) {
        messageMap[message_id] = msgItem;
      }
    }

    if (final) {
      delete messageMap[message_id];
    }
  }
});
