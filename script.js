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
			console.log(connection);
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
				break;

			case "ice":
				connection.addIceCandidate(msg.body);
				break;

			case "vibe check":
				console.log("catching the vibe");
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

	const video = document.getElementById("video");
	connection = new RTCPeerConnection({ iceServers: iceServer });

	const datachannel = getDataChannel(connection, "general", 0);
	const mousemoveDC = getDataChannel(connection, "mousemouse", 1);
	const wheelDC = getDataChannel(connection, "wheel", 2);

	datachannel.onopen = (e) => {
		console.log("datachannel is open");
	};
	mousemoveDC.onopen = (e) => {
		console.log("mouse datachannel is open");
	};
	wheelDC.onopen = (e) => {
		console.log("wheel datachannel is open");
	};

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

	connection.oniceconnectionstatechange = (e) => {
		console.log(connection.iceConnectionState);
	};

	connection.ontrack = (e) => {
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

				// benchmarking code
				//window.opener.postMessage(JSON.stringify({ sender: self, type: 'video' }));
			},
			false
		);
	};
}
