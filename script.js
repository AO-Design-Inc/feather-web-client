/****************** WEBRTC SETUP *********************/
const configuration = {
  iceServers: JSON.parse(new URL(document.location).searchParams.get('iceServers')),
};

const signalingServerUrl = 'https://simplesignal.api.feather.systems';
const send = signalingServerUrl + '/sendToPeer';

/**
 * returns a negotiated, unordered datachannel
 * for the connection with specified name and id
 * @param {RTCPeerConnection} connection
 * @param {string} name
 * @param {integer} id
 * @returns {RTCDataChannel} datachannel
 */
const getDataChannel = (connection, name, id) => {
  return connection.createDataChannel(name, {
    ordered: false,
    negotiated: true,
    id,
  });
};

const video = document.getElementById('video');
const connection = new RTCPeerConnection(configuration);
const datachannel = getDataChannel(connection, 'general', 0);
const mousemoveDC = getDataChannel(connection, 'mousemouse', 1);
const wheelDC = getDataChannel(connection, 'wheel', 2);

const action = {
  MOUSEMOVE: 0, // no longer in use
  MOUSEDOWN: 1,
  MOUSEUP: 2,
  KEYDOWN: 3,
  KEYUP: 4,
  WHEEL: 5,
  FOCUS: 6,
  BLUR: 7,
  BITRATE: 8,
  ENCODE: 9,
  SHORTCUT: 10,
};

let statsOpen = false;

const stats = document.getElementById('stats');
// prevents propogation of the key events
// in stats box to the remote end
stats.addEventListener('keydown', (e) => e.stopImmediatePropagation());
stats.addEventListener('keyup', (e) => e.stopImmediatePropagation());
stats.addEventListener('mousedown', (e) => {
  e.stopImmediatePropagation();
  if (statsOpen) {
    stats.classList.replace('open', 'closed');
  } else {
    stats.classList.replace('closed', 'open');
  }
  statsOpen = !statsOpen;
});

const encodeStat = document.getElementById('encode-stat');
const decodeStat = document.getElementById('decode-stat');
const fpsStat = document.getElementById('fps-stat');
const bitrateStat = document.getElementById('bitrate-stat');
const rttStat = document.getElementById('rtt-stat');
const dcRttStat = document.getElementById('dc-stat');

encodeStat.textContent = 0;
decodeStat.textContent = 0;
fpsStat.textContent = 0;
bitrateStat.textContent = 0;
rttStat.textContent = 0;
dcRttStat.textContent = 0;

let lastReceived;
let perfGen = 0;

setInterval(() => {
  if (datachannel && datachannel.readyState === 'open') {
    perfGen = performance.now();
    datachannel.send('');
  }
  connection.getStats().then((results) => {
    results.forEach((report) => {
      if (report.type == 'candidate-pair') {
        rttStat.textContent = report.currentRoundTripTime * 1000;
      }
      if (report.type === 'inbound-rtp') {
        fpsStat.textContent = report.framesPerSecond;

        const { bytesReceived, framesDecoded, timestamp, totalDecodeTime } = report;

        if (lastReceived) {
          const bitrate =
            (8 * (bytesReceived - lastReceived.bytesReceived)) /
            (1000 * (timestamp - lastReceived.timestamp));
          bitrateStat.textContent = bitrate.toFixed(2);

          const decode =
            (1000 * (totalDecodeTime - lastReceived.totalDecodeTime)) /
            (framesDecoded - lastReceived.framesDecoded);
          decodeStat.textContent = decode.toFixed(2);
        }

        lastReceived = report;
      }
    });
  });
}, 1000);

const mediaConstraints = {
  offerToReceiveAudio: true,
  offerToReceiveVideo: true,
};

const sendOffer = () => {
  connection.createOffer(mediaConstraints).then((offer) => {
    connection.setLocalDescription(offer);
    //window.opener.postMessage(JSON.stringify(offer), '*');
  });
};

const sendAnswer = (program, offer, server) => {
  connection
    .setRemoteDescription(offer)
    .then(() => connection.createAnswer())
    .then((answer) => {
      connection.setLocalDescription(answer);
      /*window.opener.postMessage(
        JSON.stringify({ sender: self, type: 'answer', program, body: answer, server })
      );*/
    });
};

// handle ice candidates
connection.onicecandidate = (e) => !e.candidate || console.log(e.candidate);
/*window.opener.postMessage(
    JSON.stringify({ sender: self, type: 'ice', program, body: e.candidate, server })
  );*/

connection.onicegatheringstatechange = () => console.log(connection.iceGatheringState);

// display the video when received
connection.ontrack = (e) => {
  /* resize remote screen such that it fits on client */
  const getVideoSize = () => {
    const server_aspect_ratio = max_X / max_Y;
    const clientWindowWidth = window.innerWidth;
    const clientWindowHeight = window.innerHeight;

    const client_aspect_ratio = clientWindowWidth / clientWindowHeight;

    return client_aspect_ratio > server_aspect_ratio
      ? { width: clientWindowHeight * server_aspect_ratio, height: clientWindowHeight }
      : { width: clientWindowWidth, height: clientWindowWidth / server_aspect_ratio };
  };
  const setVideoSize = () => {
    const videoSize = getVideoSize();
    video.style.width = String(videoSize.width) + 'px';
    video.style.height = String(videoSize.height) + 'px';
  };

  //set video size initially
  setVideoSize();

  video.srcObject = e.streams[0];

  video.addEventListener(
    'loadedmetadata',
    () => {
      setVideoSize();
      // set window size to initial video size
      const videoSize = getVideoSize();
      window.resizeTo(videoSize.width, videoSize.height);

      window.onresize = () => {
        setVideoSize();
      };

      // benchmarking code
      //window.opener.postMessage(JSON.stringify({ sender: self, type: 'video' }));
    },
    false
  );
};

/****************** MESSAGE HANDLING *********************/
let program = null;
let server = '';
let self = '';
let max_X, max_Y;

window.addEventListener('message', (e) => {
  // the excessive try-catch statements are bug traps
  // I've set out to catch a sneaky heisenbug
  switch (e.data.type) {
    case 'program':
      ({ program, server, self, offsetX, offsetY, max_X, max_Y } = e.data);
      break;

    case 'offer':
      try {
        sendAnswer(e.data.program, e.data.body, server);
      } catch (err) {
        console.error(err);
        window.opener.postMessage(JSON.stringify({ type: 'conerror', body: err }));
      }
      break;

    case 'answer':
      try {
        server = e.data.from;
        connection.setRemoteDescription(e.data);
      } catch (err) {
        console.error(err);
        window.opener.postMessage(JSON.stringify({ type: 'conerror', body: err }));
      }
      break;

    case 'ice':
      try {
        connection.addIceCandidate(e.data.body);
      } catch (err) {
        console.error(err);
        window.opener.postMessage(JSON.stringify({ type: 'conerror', body: err }));
      }
      break;

    case 'shortcut':
      datachannel.send(JSON.stringify({ type: action.SHORTCUT, body: e.data.body }));
      break;

    default:
      console.log('no case');
  }

  console.log(`${e.data.type} received`);
});

/****************** WINDOW MANAGEMENT *********************/
window.onfocus = () => {
  if (datachannel.readyState == 'open')
    datachannel.send(
      JSON.stringify({
        sender: self,
        type: action.FOCUS,
        program,
      })
    );

  window.opener.postMessage(JSON.stringify({ sender: self, server, type: 'focus', program }));
};

window.addEventListener('blur', (e) => {
  window.opener.postMessage(JSON.stringify({ type: 'blur', program, server }));
});

window.addEventListener('beforeunload', () => {
  connection.close();
  window.opener.postMessage(JSON.stringify({ sender: self, type: 'closed', program, server }));
});

/****************** KEYBOARD AND MOUSE SHIT *************************/

datachannel.onopen = (e) => {
  let clientWidth = video.clientWidth;
  let clientHeight = video.clientHeight;

  datachannel.send(
    JSON.stringify({
      sender: self,
      type: action.FOCUS,
      program,
    })
  );

  datachannel.onmessage = (e) => {
    if (e.data === '') {
      dcRttStat.textContent = (performance.now() - perfGen).toFixed(2);
      return;
    }

    const userAction = JSON.parse(e.data);
    switch (userAction.type) {
      case action.ENCODE:
        encodeStat.textContent = userAction.body;
        break;
      default:
        console.error('Unrecognized message type');
    }
  };

  const pressedMouseButtons = [];
  video.addEventListener('mousedown', (e) => {
    clientWidth = video.clientWidth;
    clientHeight = video.clientHeight;

    const curMouseButton = {
      type: action.MOUSEDOWN,
      x: (e.clientX / clientWidth) * max_X,
      y: (e.clientY / clientHeight) * max_Y,
      button: e.button,
    };
    datachannel.send(JSON.stringify(curMouseButton));
    pressedMouseButtons.push(curMouseButton);
  });

  video.addEventListener('mouseup', (e) => {
    clientWidth = video.clientWidth;
    clientHeight = video.clientHeight;

    const whichPressedButton = pressedMouseButtons.findIndex((key) => key.button === e.button);
    if (whichPressedButton >= 0) {
      pressedMouseButtons.splice(whichPressedButton, 1);
      datachannel.send(
        JSON.stringify({
          type: action.MOUSEUP,
          x: (e.clientX / clientWidth) * max_X,
          y: (e.clientY / clientHeight) * max_Y,
          button: e.button,
        })
      );
    } else console.error(`${e.button} button event received without corresponding mousedown!`);
  });

  const pressedKeys = [];
  window.addEventListener('keydown', (e) => {
    const curKey = {
      type: action.KEYDOWN,
      key: e.key,
      code: e.code,
      altKey: e.altKey,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      shiftKey: e.shiftKey,
      location: e.location,
    };

    datachannel.send(JSON.stringify(curKey));
    pressedKeys.push(curKey);
  });

  //Alt, AltGr, Control, Shift must
  //be accounted for, and keyupd by
  //hand when focus is lost

  const unPressAndUnClickAll = () => {
    while (pressedKeys.length > 0) {
      const keyToUnpress = pressedKeys.pop();
      keyToUnpress.type = action.KEYUP;
      datachannel.send(JSON.stringify(keyToUnpress));
    }

    while (pressedMouseButtons.length > 0) {
      const mouseButtonToUnpress = pressedMouseButtons.pop();
      mouseButtonToUnpress.type = action.MOUSEUP;
      datachannel.send(JSON.stringify(mouseButtonToUnpress));
    }
  };

  window.addEventListener('blur', unPressAndUnClickAll);
  window.addEventListener('beforeunload', unPressAndUnClickAll);

  window.addEventListener('keyup', (e) => {
    const whichPressedKey = pressedKeys.findIndex((key) => key.code === e.code);
    if (whichPressedKey >= 0) {
      pressedKeys.splice(whichPressedKey, 1);
      datachannel.send(
        JSON.stringify({
          type: action.KEYUP,
          key: e.key,
          code: e.code,
          altKey: e.altKey,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          shiftKey: e.shiftKey,
          location: e.location,
        })
      );
    } else console.error(`${e.key} keyUp event received without corresponding keydown!`);
  });
}; //end of datachannel onopen event

mousemoveDC.onopen = (e) => {
  video.addEventListener('mousemove', (e) => {
    //CURWORK
    //this call to document.body needs to be debounced
    clientWidth = video.clientWidth;
    clientHeight = video.clientHeight;

    mousemoveDC.send([
      (e.offsetX / clientWidth) * max_X,
      (e.offsetY / clientHeight) * max_Y,
      e.button,
    ]);
  });
};

wheelDC.onopen = (e) => {
  // passes -1 or 1 to robot, depending on the sign of delta value
  window.addEventListener('wheel', (e) => {
    wheelDC.send([-1 * e.deltaX, -1 * e.deltaY]);
  });
};
