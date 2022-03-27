// server endpoints
const signalingServerUrl =
	"https://experimental.simplesignal.api.feather.systems";
const send = signalingServerUrl + "/sendToPeerFromAnonymous";

const self = "TEMP";

// param values
let senderid;
let server;
let offer;
let iceServer;
let max_X;
let max_Y;

// wrapper function for sending messages to server
const sendMessage = async (peerId, jsonMessage) => {
	fetch(`${send}?peer=${peerId}&senderid=${senderid}`, {
		method: "POST",
		body: JSON.stringify(jsonMessage),
	});
};

/***************** HANDLE SEARCH PARAMS *********************/

const params = new Proxy(new URLSearchParams(window.location.search), {
	get: (searchParams, prop) => searchParams.get(prop),
});

if (params.server) {
	server = params.server;
	offer = JSON.parse(decodeURIComponent(params.offer));
	iceServer = JSON.parse(decodeURIComponent(params.ice));
	senderid = decodeURIComponent(params.serverid);
	max_X = params.x;
	max_Y = params.y;

	const video = document.getElementById("video");
	const connection = new RTCPeerConnection({ iceServers: iceServer });

	// handle ice candidates
	connection.onicecandidate = (e) => {
		!e.candidate ||
			sendMessage(server, {
				sender: self,
				type: "ice",
				body: e.candidate,
				server,
			});
	};

	connection.oniceconnectionstatechange = (e) => {
		console.log(connection.iceConnectionState);
	};

	const sendAnswer = (offer, server) => {
		connection
			.setRemoteDescription(offer)
			.then(() => connection.createAnswer())
			.then((answer) => {
				connection.setLocalDescription(answer);
				console.log(connection);
				sendMessage(server, {
					sender: self,
					type: "answer",
					body: answer,
				});
			});
	};

	sendAnswer(offer, server);

	connection.ontrack = (e) => {
		console.log("track detected");
		console.log(e);
		video.srcObject = e.streams[0];
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

		//video.srcObject = e.streams[0];

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
