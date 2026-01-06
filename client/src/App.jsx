import { useEffect, useRef, useState } from "react";
import io from "socket.io-client";

const socket = io("http://localhost:5000");

const ICE_CONFIG = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

function App() {
  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);

  const peersRef = useRef({});
  const remoteStreamsRef = useRef({});

  const [remoteUsers, setRemoteUsers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");

  /* =   INIT = */

  useEffect(() => {
    initMedia();

    socket.on("all-users", (users) => {
      users.forEach((id) => createPeer(id, true));
    });

    socket.on("user-joined", (id) => {
      createPeer(id, false);
    });

    socket.on("signal", handleSignal);

    socket.on("user-left", (id) => {
      peersRef.current[id]?.close();
      delete peersRef.current[id];
      delete remoteStreamsRef.current[id];
      setRemoteUsers((prev) => prev.filter((u) => u !== id));
    });

    socket.on("receive-message", (msg) => {
      setMessages((prev) => [...prev, msg]);
    });

    return () => {
      socket.off("all-users");
      socket.off("user-joined");
      socket.off("signal");
      socket.off("user-left");
      socket.off("receive-message");
    };
  }, []);

  /* = MEDIA  = */

  const initMedia = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640 },
        height: { ideal: 360 },
        frameRate: { ideal: 20, max: 24 },
      },
      audio: true,
    });

    localStreamRef.current = stream;
    localVideoRef.current.srcObject = stream;

    socket.emit("join-room", "room-1");
  };

  /* = WEBRTC =*/

  const createPeer = async (userId, isCaller) => {
    if (peersRef.current[userId]) return;

    const peer = new RTCPeerConnection(ICE_CONFIG);

    localStreamRef.current.getTracks().forEach((track) =>
      peer.addTrack(track, localStreamRef.current)
    );

    // 🔥 Bitrate limit (performance fix)
    peer.getSenders().forEach((sender) => {
      if (sender.track?.kind === "video") {
        const params = sender.getParameters();
        if (!params.encodings) params.encodings = [{}];
        params.encodings[0].maxBitrate = 800_000;
        params.encodings[0].maxFramerate = 24;
        sender.setParameters(params);
      }
    });

    peer.ontrack = (e) => {
      remoteStreamsRef.current[userId] = e.streams[0];
      setRemoteUsers((prev) => [...new Set([...prev, userId])]);
    };

    peer.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit("signal", {
          to: userId,
          signal: { candidate: e.candidate },
        });
      }
    };

    if (isCaller) {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);

      socket.emit("signal", {
        to: userId,
        signal: { sdp: offer },
      });
    }

    peersRef.current[userId] = peer;
  };

  const handleSignal = async ({ from, signal }) => {
    let peer = peersRef.current[from];

    if (!peer) {
      await createPeer(from, false);
      peer = peersRef.current[from];
    }

    if (signal.sdp) {
      await peer.setRemoteDescription(signal.sdp);

      if (signal.sdp.type === "offer") {
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);

        socket.emit("signal", {
          to: from,
          signal: { sdp: answer },
        });
      }
    }

    if (signal.candidate) {
      await peer.addIceCandidate(signal.candidate);
    }
  };

  /* = CONTROLS = */

  const toggleMute = () => {
    const track = localStreamRef.current.getAudioTracks()[0];
    track.enabled = !track.enabled;
  };

  const toggleCamera = () => {
    const track = localStreamRef.current.getVideoTracks()[0];
    track.enabled = !track.enabled;
  };

  const shareScreen = async () => {
    const screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 15 },
    });

    const screenTrack = screenStream.getVideoTracks()[0];

    Object.values(peersRef.current).forEach((peer) => {
      const sender = peer.getSenders().find(
        (s) => s.track && s.track.kind === "video"
      );
      sender.replaceTrack(screenTrack);
    });

    localVideoRef.current.srcObject = screenStream;

    screenTrack.onended = () => {
      const camTrack = localStreamRef.current.getVideoTracks()[0];
      Object.values(peersRef.current).forEach((peer) => {
        const sender = peer.getSenders().find(
          (s) => s.track && s.track.kind === "video"
        );
        sender.replaceTrack(camTrack);
      });
      localVideoRef.current.srcObject = localStreamRef.current;
    };
  };

  const endCall = () => window.location.reload();

  /* = CHAT = */
  const sendMessage = () => {
    if (!chatInput.trim()) return;

    socket.emit("send-message", {
      roomId: "room-1",
      message: chatInput,
    });

    setChatInput("");
  };

  /* = UI = */

  return (
    <div className="h-screen bg-slate-900 text-white flex flex-col">
      <header className="h-14 px-6 flex items-center border-b border-slate-800">
        <h1 className="text-lg font-medium"> Video Meeting</h1>
      </header>

      <main className="flex-1 flex">
        <div
          className="flex-1 grid gap-4 p-4"
          style={{
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          }}
        >
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            className="bg-black rounded-lg object-contain aspect-video"
          />

          {remoteUsers.map((id) => (
            <RemoteVideo
              key={id}
              stream={remoteStreamsRef.current[id]}
            />
          ))}
        </div>

        {/* CHAT */}
        <div className="w-[320px] bg-slate-800 border-l border-slate-700 flex flex-col">
          <div className="p-4 border-b border-slate-700">Chat</div>

          <div className="flex-1 p-4 space-y-2 overflow-y-auto text-sm">
            {messages.map((m, i) => (
              <div key={i}>
                <strong>{m.user.slice(0, 5)}:</strong> {m.text}
                <div className="text-xs text-slate-400">{m.time}</div>
              </div>
            ))}
          </div>

          <div className="p-3 flex gap-2">
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              className="flex-1 px-3 py-2 bg-slate-700 rounded"
              placeholder="Message"
            />
            <button
              onClick={sendMessage}
              className="px-4 py-2 bg-blue-600 rounded"
            >
              Send
            </button>
          </div>
        </div>
      </main>

      <footer className="min-h-[72px] px-4 bg-slate-950 border-t border-slate-800 flex justify-center gap-4 items-center">
        <button onClick={toggleMute} className="px-5 py-2 bg-slate-800 rounded">
          Mute
        </button>
        <button onClick={toggleCamera} className="px-5 py-2 bg-slate-800 rounded">
          Camera
        </button>
        <button onClick={shareScreen} className="px-5 py-2 bg-slate-800 rounded">
          Share Screen
        </button>
        <button onClick={endCall} className="px-5 py-2 bg-red-600 rounded">
          End Call
        </button>
      </footer>
    </div>
  );
}

function RemoteVideo({ stream }) {
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current && stream) {
      ref.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      className="bg-black rounded-lg object-contain aspect-video"
    />
  );
}

export default App;
