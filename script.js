// server endpoints
const signalingServerUrl =
  "https://experimental.simplesignal.api.feather.systems";
const send = signalingServerUrl + "/sendToPeerFromAnonymous";
const getMailbox = signalingServerUrl + "/getAnonymousMailbox";

// param values
let thisPeer;
let senderid;
let server;
let iceServer;
let max_X;
let max_Y;

let mailbox;
let connection;
let videoConnection;
let datachannel;
let mousemoveDC;
let wheelDC;

let myStatus = "Connected";

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

/****** HELPER FUNCTIONS **********/
// wrapper function for sending messages to server
const sendMessage = async (peerId, jsonMessage) => {
  fetch(`${send}?peer=${peerId}&senderid=${senderid}`, {
    method: "POST",
    body: JSON.stringify(jsonMessage),
  });
};

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

const sendAnswer = (offer, server) => {
  connection
    .setRemoteDescription(offer)
    .then(() => connection.createAnswer())
    .then((answer) => {
      connection.setLocalDescription(answer);
      sendMessage(server, {
        sender: thisPeer,
        type: "answer",
        body: answer,
      });
    });
};

/***************** MAILBOX STUFF *********************/
// create mailbox
const createMailbox = (anonid) => {
  console.log(`creating mailbox for: ${anonid}`);
  mailbox = new EventSource(`${getMailbox}?id=${anonid}`);

  mailbox.addEventListener("signal", (e) => {
    const msg = JSON.parse(e.data);
    switch (msg.type) {
      case "offer":
        sendAnswer(msg.body, msg.sender);
        videoConnection
          .setRemoteDescription(msg.videoOffer)
          .then(() => videoConnection.createAnswer())
          .then((answer) => {
            videoConnection.setLocalDescription(answer);
            sendMessage(server, {
              sender: thisPeer,
              server,
              type: "video answer",
              answer,
            });
          });
        break;

      case "ice":
        connection.addIceCandidate(msg.body);
        break;

      case "forced disconnect":
        connection.close();
        myStatus = "Unavailable";
        alert("You have been forcibly disconnected by the server");
        break;

      case "vibe check":
        console.log("catching the vibe");
        sendMessage(server, {
          sender: thisPeer,
          type: "vibe check",
          status: myStatus,
          ip: "",
        });
        break;

      default:
        console.log("message not recognized");
    }
    console.log(`received ${msg.type}`);
  });
};

/***************** HANDLE SEARCH PARAMS *********************/

const params = new Proxy(new URLSearchParams(window.location.search), {
  get: (searchParams, prop) => searchParams.get(prop),
});

if (params.server) {
  server = params.server;
  iceServer = JSON.parse(decodeURIComponent(params.ice));
  senderid = decodeURIComponent(params.serverid);
  thisPeer = decodeURIComponent(params.client);
  max_X = params.x;
  max_Y = params.y;

  createMailbox(thisPeer);

  sendMessage(server, { sender: thisPeer, type: "link opened" });
  myStatus = "Connected";

  const video = document.getElementById("video");
  connection = new RTCPeerConnection({ iceServers: iceServer });
  videoConnection = new RTCPeerConnection({ iceServers: iceServer });

  datachannel = getDataChannel(connection, "general", 0);
  mousemoveDC = getDataChannel(connection, "mousemouse", 1);
  wheelDC = getDataChannel(connection, "wheel", 2);

  // handle ice candidates
  connection.onicecandidate = (e) => {
    !e.candidate ||
      sendMessage(server, {
        sender: thisPeer,
        type: "ice",
        body: e.candidate,
        server,
      });
  };

  videoConnection.onicecandidate = (e) =>
    !e.candidate ||
    sendMessage(server, {
      sender: thisPeer,
      type: "video ice",
      body: e.candidate,
      server,
    });

  connection.oniceconnectionstatechange = (e) => {
    console.log(connection.iceConnectionState);
  };

  videoConnection.oniceconnectionstatechange = () =>
    console.log(videoConnection.iceConnectionState);

  // TODO: move stats interval to videoConnection
  connection.onclose = () => {
    clearInterval(statsInterval);
  };

  videoConnection.ontrack = (e) => {
    console.log("track detected");
    const getVideoSize = () => {
      const server_aspect_ratio = max_X / max_Y;
      const clientWindowWidth = window.innerWidth;
      const clientWindowHeight = window.innerHeight;

      const client_aspect_ratio = clientWindowWidth / clientWindowHeight;

      return client_aspect_ratio > server_aspect_ratio
        ? {
            width: clientWindowHeight * server_aspect_ratio,
            height: clientWindowHeight,
          }
        : {
            width: clientWindowWidth,
            height: clientWindowWidth / server_aspect_ratio,
          };
    };
    const setVideoSize = () => {
      const videoSize = getVideoSize();
      video.style.width = String(videoSize.width) + "px";
      video.style.height = String(videoSize.height) + "px";
    };

    //set video size initially
    setVideoSize();

    video.srcObject = e.streams[0];

    video.addEventListener(
      "loadedmetadata",
      () => {
        setVideoSize();
        // set window size to initial video size
        const videoSize = getVideoSize();
        window.resizeTo(videoSize.width, videoSize.height);

        window.onresize = () => {
          setVideoSize();
        };
      },
      false
    );
  };

  /********* user action stuff **************/
  datachannel.onopen = (e) => {
    console.log("datachannel is open");
    let clientWidth = video.clientWidth;
    let clientHeight = video.clientHeight;

    /*datachannel.send(
      JSON.stringify({
        sender: self,
        type: action.FOCUS,
        program: "LINK",
      })
    );*/

    datachannel.onmessage = (e) => {
      if (e.data === "") {
        dcRttStat.textContent = (performance.now() - perfGen).toFixed(2);
        return;
      }

      const userAction = JSON.parse(e.data);
      switch (userAction.type) {
        case action.ENCODE:
          encodeStat.textContent = userAction.body;
          break;
        default:
          console.error("Unrecognized message type");
      }
    };

    const pressedMouseButtons = [];
    video.addEventListener("mousedown", (e) => {
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

    video.addEventListener("mouseup", (e) => {
      clientWidth = video.clientWidth;
      clientHeight = video.clientHeight;

      const whichPressedButton = pressedMouseButtons.findIndex(
        (key) => key.button === e.button
      );
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
      } else
        console.error(
          `${e.button} button event received without corresponding mousedown!`
        );
    });

    const pressedKeys = [];
    window.addEventListener("keydown", (e) => {
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

    window.addEventListener("blur", unPressAndUnClickAll);
    window.addEventListener("beforeunload", unPressAndUnClickAll);

    window.addEventListener("keyup", (e) => {
      const whichPressedKey = pressedKeys.findIndex(
        (key) => key.code === e.code
      );
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
      } else
        console.error(
          `${e.key} keyUp event received without corresponding keydown!`
        );
    });
  };
  mousemoveDC.onopen = (e) => {
    console.log("mouse datachannel is open");
    video.addEventListener("mousemove", (e) => {
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
    console.log("wheel datachannel is open");
    // passes -1 or 1 to robot, depending on the sign of delta value
    window.addEventListener("wheel", (e) => {
      wheelDC.send([-1 * e.deltaX, -1 * e.deltaY]);
    });
  };
}

/************* STATS STUFF  *****************/
let statsOpen = false;

const stats = document.getElementById("stats");
// prevents propogation of the key events
// in stats box to the remote end
stats.addEventListener("keydown", (e) => e.stopImmediatePropagation());
stats.addEventListener("keyup", (e) => e.stopImmediatePropagation());
stats.addEventListener("mousedown", (e) => {
  e.stopImmediatePropagation();
  if (statsOpen) {
    stats.classList.replace("open", "closed");
  } else {
    stats.classList.replace("closed", "open");
  }
  statsOpen = !statsOpen;
});

const encodeStat = document.getElementById("encode-stat");
const decodeStat = document.getElementById("decode-stat");
const fpsStat = document.getElementById("fps-stat");
const bitrateStat = document.getElementById("bitrate-stat");
const rttStat = document.getElementById("rtt-stat");
const dcRttStat = document.getElementById("dc-stat");

encodeStat.textContent = 0;
decodeStat.textContent = 0;
fpsStat.textContent = 0;
bitrateStat.textContent = 0;
rttStat.textContent = 0;
dcRttStat.textContent = 0;

let lastReceived;
let perfGen = 0;

// using var here because it gets hoisted lol
// this entire file needs to be reorganized
var statsInterval = setInterval(() => {
  if (datachannel && datachannel.readyState === "open") {
    perfGen = performance.now();
    //console.log(datachannel);
    //datachannel.send("");
  }
  connection.getStats().then((results) => {
    results.forEach((report) => {
      if (report.type == "candidate-pair") {
        rttStat.textContent = report.currentRoundTripTime * 1000;
      }
      if (report.type === "inbound-rtp") {
        fpsStat.textContent = report.framesPerSecond;

        const { bytesReceived, framesDecoded, timestamp, totalDecodeTime } =
          report;

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
