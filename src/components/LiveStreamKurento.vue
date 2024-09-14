<template>
  <div>
    <!-- 내 화면 출력 (Broadcaster) -->
    <video id="myVideo" autoplay playsinline muted></video>
    <!-- 연결된 쪽 화면 출력 (Viewer) -->
    <video id="yourVideo" autoplay playsinline muted></video>
    <button @click="startStream" v-if="!isStreaming">Start Stream</button>
    <button @click="stopStream" v-if="isStreaming && isBroadcaster">Stop Stream</button>
    <button @click="joinStream" v-if="!isStreaming && !isBroadcaster">Join Stream</button>
  </div>
</template>

<script>
export default {
  data() {
    return {
      signalingSocket: null,
      isBroadcaster: false,
      isStreaming: false,
      peerConnection: null,
    };
  },
  methods: {
    async startStream() {
      this.isBroadcaster = true;
      this.isStreaming = true;

      // 1. WebSocket 연결 설정
      this.signalingSocket = new WebSocket('ws://localhost:8080/ws');

      this.signalingSocket.onopen = async () => {
        console.log('WebSocket 연결 완료');
        this.signalingSocket.send(JSON.stringify({ id: 'broadcaster' }));
        
        // 2. 로컬 미디어 스트림 가져오기
        const localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        document.getElementById('myVideo').srcObject = localStream;
        console.log("기기 권한 요청");

        // 3. RTCPeerConnection 생성 및 트랙 추가
        this.peerConnection = new RTCPeerConnection({
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' } // Google 공용 STUN 서버 추가
          ]
        });

        // 상태 변경 로그 추가
        this.peerConnection.oniceconnectionstatechange = () => {
            console.log('ICE Connection State:', this.peerConnection.iceConnectionState);
        };

        this.peerConnection.onconnectionstatechange = () => {
            console.log('Connection State:', this.peerConnection.connectionState);
        };

        localStream.getTracks().forEach(track => {
          this.peerConnection.addTrack(track, localStream);
          console.log("트랙 추가");
        });

        console.log('Connection State:', this.peerConnection.connectionState);
        console.log('ICE Connection State:', this.peerConnection.iceConnectionState);
        console.log('Signaling State:', this.peerConnection.signalingState);

        // 5. ICE 후보 이벤트 핸들러 설정
        this.peerConnection.onicecandidate = event => {
            console.log("onicecandidate 핸들러");
            if (event.candidate) {
                this.signalingSocket.send(JSON.stringify({
                    id: 'onIceCandidate',
                    candidate: event.candidate
                }));
            }
        };

        // 6. SDP Offer 생성 및 Kurento로 전송
        const offer = await this.peerConnection.createOffer(); // 생성 
        console.log("offer 생성: ", offer);

        await this.peerConnection.setLocalDescription(offer);
        this.signalingSocket.send(JSON.stringify({
          id: 'start',
          sdpOffer: this.peerConnection.localDescription.sdp
        })); // id start로 쿠렌토에 전송 
        console.log("offer를 kurento에 전송 완료");
      };

      // 7. Kurento로부터 SDP Answer 및 ICE 후보 수신
      this.signalingSocket.onmessage = async (message) => {
        const data = JSON.parse(message.data);
        console.log("받은 answer과 ice candidate : ", data);

        if (data.id === 'sdpAnswer') {
            console.log("answer을 받은 경우");

            // SDP Answer 설정
            await this.peerConnection.setRemoteDescription(new RTCSessionDescription({
                type: 'answer',
                sdp: data.sdpAnswer
            }));
        } else if (data.id === 'iceCandidate') {
            console.log("candidate를 받은 경우");

            // ICE 후보 추가
            await this.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
      };
    },

    async joinStream() {
        this.isBroadcaster = false;
        this.isStreaming = true;

        // 1. WebSocket 연결 설정
        this.signalingSocket = new WebSocket('ws://localhost:8080/ws');

        this.signalingSocket.onopen = () => {
            console.log('WebSocket 연결 완료');
            this.signalingSocket.send(JSON.stringify({ id: 'viewer' }));
        };

        // 2. Kurento로부터 SDP Offer 수신 및 처리
        this.signalingSocket.onmessage = async (message) => {
            console.log("onmessage 핸들러");

            try {
                const data = JSON.parse(message.data);
                console.log("kurento로부터 받은 data: ", data);

                if (data.id === 'sdpOffer') {
                    console.log("offer를 받은 경우");

                    // SDP Offer 설정 및 Answer 생성
                    // this.peerConnection = new RTCPeerConnection();
                    
                    this.peerConnection = new RTCPeerConnection({
                        iceServers: [
                            { urls: 'stun:stun.l.google.com:19302' } // 브로드캐스터와 동일한 STUN 서버
                        ]
                    });

                    // 여기에 추가합니다: ICE Connection 상태 변화를 감지
                    this.peerConnection.oniceconnectionstatechange = () => {
                        console.log('***ICE Connection State:', this.peerConnection.iceConnectionState);
                    };

                    // 상태 변경 로그 추가
                    this.peerConnection.onconnectionstatechange = () => {
                        console.log('***Connection State:', this.peerConnection.connectionState);
                };

                    // onicecandidate 핸들러를 설정
                    this.peerConnection.onicecandidate = event => {
                        console.log("onicecandidate 핸들러");
                        if (event.candidate) {
                            console.log("**ICE 후보 생성:", event.candidate);
                            this.signalingSocket.send(JSON.stringify({
                                id: 'onIceCandidate',
                                candidate: event.candidate
                            }));
                        }
                    };

                    // 트랙 수신 이벤트 핸들러를 이 시점에 추가합니다.
                    // this.peerConnection.ontrack = (event) => {
                    //     console.log("ontrack 핸들러");
                    
                    //     const remoteStream = event.streams[0];
                    //     console.log('Received remote stream tracks:', remoteStream.getTracks());
                    //     document.getElementById('yourVideo').srcObject = remoteStream;
                    // };
                    this.peerConnection.ontrack = (event) => {
                        console.log("ontrack 핸들러");

                        const remoteStream = event.streams[0];
                        console.log('* Received remote stream tracks:', remoteStream.getTracks());
                        const videoElement = document.getElementById('yourVideo');
                        console.log("원격 스트림을 비디오 요소에 할당: ", videoElement);

                        if (videoElement) {
                            videoElement.srcObject = remoteStream;
                        } else {
                            console.error('비디오 요소를 찾을 수 없음');
                        }
                    };

                    await this.peerConnection.setRemoteDescription(new RTCSessionDescription({
                        type: 'offer',
                        sdp: data.sdpOffer
                    }));

                    console.log('Connection State:', this.peerConnection.connectionState);
                    console.log('ICE Connection State:', this.peerConnection.iceConnectionState);
                    console.log('Signaling State:', this.peerConnection.signalingState);

                    const answer = await this.peerConnection.createAnswer();
                    console.log("answer 생성: ", answer);
                    await this.peerConnection.setLocalDescription(answer);

                    // SDP Answer를 Kurento로 전송
                    this.signalingSocket.send(JSON.stringify({
                        id: 'sdpAnswer',
                        sdpAnswer: this.peerConnection.localDescription.sdp
                    }));
                    console.log("kurento에 answer 전송 완료");

                } else if (data.id === 'iceCandidate') {
                    console.log("icecandidate인 경우");
                    // ICE 후보 추가
                    if (this.peerConnection) { // peerConnection이 null이 아닌 경우에만 실행
                        await this.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
                    }
                } else {
                    console.log("알 수 없는 메시지를 받은 경우: ", data);
                }
            } catch(error) {
                console.error("메시지 파싱 중 오류 발생: ", error);
            }
        };
    },

    stopStream() {
      if (this.peerConnection) {
        this.peerConnection.close();
        this.peerConnection = null;
      }
      this.isStreaming = false;
    }
  }
};

</script>