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
            { urls: 'stun:stun.l.google.com:19302' }, // Google 공용 STUN 서버 추가
            { urls: 'stun:stun2.l.google.com:19302' }
          ]
        });

        // ICE 연결 상태 핸들러 추가
        this.peerConnection.oniceconnectionstatechange = () => {
          console.log('ICE 연결 상태:', this.peerConnection.iceConnectionState);
        };

        localStream.getTracks().forEach(track => {
          this.peerConnection.addTrack(track, localStream);
          console.log("트랙 추가됨 : ", track);
        });

        // 4. ICE 후보 수집 시작
        this.peerConnection.onicecandidate = event => {
            console.log("onicecandidate 핸들러");
            if (event.candidate) {
                this.signalingSocket.send(JSON.stringify({
                    id: 'onIceCandidate',
                    candidate: event.candidate
                }));
            }
        };

        // 5. SDP Offer 생성 및 Kurento 서버로 전송
        const offer = await this.peerConnection.createOffer(); // 생성 
        console.log("offer 생성: ", offer);
        console.log('SDP Offer:', offer.sdp); // 브로드캐스터 측에서

        await this.peerConnection.setLocalDescription(offer);
        this.signalingSocket.send(JSON.stringify({
          id: 'start',
          sdpOffer: this.peerConnection.localDescription.sdp
        })); // id start로 쿠렌토에 전송 
        console.log("offer를 kurento에 전송 완료");
      };

      // 6. SDP Answer 및 ICE 후보 수신
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
                    
                    this.peerConnection = new RTCPeerConnection({
                        iceServers: [
                            { urls: 'stun:stun.l.google.com:19302' }, // 브로드캐스터와 동일한 STUN 서버
                            { urls: 'stun:stun2.l.google.com:19302' }
                        ]
                    });

                    // ICE 연결 상태 핸들러 추가
                    this.peerConnection.oniceconnectionstatechange = () => {
                      console.log('ICE 연결 상태:', this.peerConnection.iceConnectionState);
                    };

                    // Signaling 상태 변화를 감지
                    this.peerConnection.onsignalingstatechange = () => {
                        console.log('***Signaling State:', this.peerConnection.signalingState);
                    };

                    // 3. ICE 후보 처리
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

                    // 4. 원격 SDP Offer 설정
                    await this.peerConnection.setRemoteDescription(new RTCSessionDescription({
                      type: 'offer',
                      sdp: data.sdpOffer
                    }));

                    // 5. SDP Answer 생성 및 방송자에게 전송
                    const answer = await this.peerConnection.createAnswer();
                    console.log("생성한 answer: ", answer);
                    console.log('SDP Answer:', answer.sdp); // 시청자 측에서
                    await this.peerConnection.setLocalDescription(answer);
                    this.signalingSocket.send(JSON.stringify({
                      id: 'sdpAnswer',
                      sdpAnswer: this.peerConnection.localDescription.sdp
                    }));

                    // 6. 원격 비디오 스트림 처리
                    this.peerConnection.ontrack = (event) => {
                      console.log("ontrack 이벤트 발생, 원격 스트림을 수신했습니다.");
                      const remoteStream = event.streams[0];
                      console.log('* Received remote stream tracks:', remoteStream.getTracks());
                      document.getElementById('yourVideo').srcObject = remoteStream;
                    };

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