<template>
  <div>
    <!-- 내 화면 출력 (Broadcaster) -->
    <video id="myVideo" autoplay playsinline></video>
    <!-- 연결된 쪽 화면 출력 (Viewer) -->
    <video id="yourVideo" autoplay playsinline></video>
    <button @click="startStream" v-if="!isStreaming">Start Stream</button>
    <button @click="stopStream" v-if="isStreaming && isBroadcaster">Stop Stream</button>
    <button @click="joinStream" v-if="!isStreaming && !isBroadcaster">Join Stream</button>
  </div>
</template>

<script>
export default {
  data() {
    return {
      localStream: null,  // 로컬 비디오 스트림 (방송사)
      peerConnection: null,  // RTCPeerConnection 객체
      signalingSocket: null,  // 웹소켓 연결 객체
      configuration: {
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]  // STUN 서버 설정
      },
      isBroadcaster: false,  // 방송자인지 여부
      isStreaming: false,  // 라이브 스트리밍 중인지 여부
      iceCandidatesQueue: []  // ICE 후보를 저장할 큐
    };
  },
  methods: {
    async startStream() {
      // 1. websocket 연결 
      // 방송사 -> 스트리밍 시작
      this.signalingSocket = new WebSocket('ws://localhost:8080/ws');
      this.isBroadcaster = true;
      this.isStreaming = true;

      // 2. RTCPeerConnection 연결 설정
      this.peerConnection = new RTCPeerConnection(this.configuration);
      console.log('RTCPeerConnection configuration:', this.configuration);

      this.signalingSocket.onopen = () => {
          console.log('WebSocket 연결');
      };

      // 3. 트랙 추가 
      // 로컬 비디오와 오디오 스트림 가져오기
      this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      document.getElementById('myVideo').srcObject = this.localStream;

      // 로컬 스트림의 모든 트랙을 RTCPeerConnection에 추가
      this.localStream.getTracks().forEach(track => {
        console.log('track 추가:', track);
        this.peerConnection.addTrack(track, this.localStream);
      });

      // 4. ICE 후보 이벤트 핸들러 설정
      this.peerConnection.onicecandidate = event => {
        console.log("방송자 ICE Candidate:", event.candidate);
        if (event.candidate) { // candidate 전송 
          this.signalingSocket.send(JSON.stringify({ candidate: event.candidate }));
        }
      };

      // 5. SDP 오퍼 생성
      const offer = await this.peerConnection.createOffer();
      console.log('offer 확인:', offer);
      // 로컬 SDP 오퍼를 설정하여 WebRTC 엔진이 "로컬 피어"의 연결 설정을 알 수 있도록 함
      await this.peerConnection.setLocalDescription(offer);
      // 생성된 SDP 오퍼를 시그널링 서버를 통해 "원격 피어"로 전송
      this.signalingSocket.send(JSON.stringify({ offer: this.peerConnection.localDescription }));
      console.log('방송사가 전송한 offer:', this.peerConnection.localDescription);

      // 웹소켓 메시지 수신 핸들러 설정
      this.signalingSocket.onmessage = async (message) => {
        console.log('WebSocket 메시지 수신:', message.data); // 출력됨 
        try {
          const data = JSON.parse(message.data);
          console.log('파싱한 데이터:', data); // 출력됨 

          if (data.answer !== undefined) {
              console.log('수신 받은 answer:', data.answer);
              if (this.peerConnection.signalingState === "have-local-offer") {
                  await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
                  console.log('Remote description set successfully');
                  this.processIceCandidates();
              }
          } else if (data.candidate) {
              console.log('수신 받은 ICE candidate:', data.candidate);
              if (this.peerConnection.remoteDescription) {
                await this.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
                console.log('ICE candidate added successfully');

              } else {
                console.warn('ICE candidate received before remote description was set, queuing candidate.');
                this.iceCandidatesQueue.push(data.candidate);
              }
          } else {
              console.log('Unknown message type:', data); 
          }

        } catch (error) {
          console.error('Error processing WebSocket message:', error);
        }
      };
    },
    async joinStream() {
      // 시청자 연결 설정 - RTCPeerConnection 설정
      this.peerConnection = new RTCPeerConnection(this.configuration);
      console.log('RTCPeerConnection configuration:', this.configuration);

      // ICE 후보 이벤트 핸들러 설정
      this.peerConnection.onicecandidate = event => {
        if (event.candidate) {
          console.log('수신자 ICE candidate:', event.candidate);
          this.signalingSocket.send(JSON.stringify({ candidate: event.candidate }));
        }
      };

      // 트랙 수신 이벤트 핸들러 설정
      this.peerConnection.ontrack = event => {
        if (event.streams[0]) {
          console.log("yourVideo에 들어옴");
          document.getElementById('yourVideo').srcObject = event.streams[0];
        } else {
          console.warn('No streams found in event [비디오 출력 실패]:', event);
        }
      };

      // 시청자로서 스트리밍 참여
      this.signalingSocket = new WebSocket('ws://localhost:8080/ws');
      this.isBroadcaster = false;
      this.isStreaming = true;

      this.signalingSocket.onopen = () => {
        console.log('WebSocket connection established'); // 출력됨 

        // 웹소켓 메시지 수신 핸들러 설정
        this.signalingSocket.onmessage = async (message) => {
          console.log('WebSocket 메시지 수신:', message.data);  // 출력됨 
          try {
            const data = JSON.parse(message.data);
            console.log('파싱된 데이터:', data); // 출력됨 

            if (data.offer) {
              console.log('방송자로부터 전송받은 offer:', data.offer);
              if (this.peerConnection.signalingState === "stable" || this.peerConnection.signalingState === "have-remote-offer") {
                  await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));

                  const answer = await this.peerConnection.createAnswer();
                  await this.peerConnection.setLocalDescription(answer);
                  
                  // offer 받음 -> 시청자는 answer로 응답 
                  this.signalingSocket.send(JSON.stringify({ answer: this.peerConnection.localDescription }));
                  console.log('Answer 보내기:', this.peerConnection.localDescription);

                  this.processIceCandidates();
              }
            } else if (data.candidate) {
                console.log('Received ICE candidate:', data.candidate);
                if (this.peerConnection.remoteDescription) {
                    await this.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
                    console.log('ICE candidate added successfully');

                } else {
                    console.warn('ICE candidate received before remote description was set, queuing candidate.');
                    this.iceCandidatesQueue.push(data.candidate);
                }
            } else {
                console.log('Unknown message type:', data);
            }
          } catch (error) {
              console.error('Error processing WebSocket message:', error);
          }
        };

      };
    },
    processIceCandidates() {
      // remote description이 설정된 후 큐에 저장된 ICE 후보를 처리
      this.iceCandidatesQueue.forEach(async candidate => {
        try {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.error('Error adding ICE candidate:', e);
        }
      });
      this.iceCandidatesQueue = [];  // 큐 초기화
    },
    stopStream() {
      if (this.localStream) {
        this.localStream.getTracks().forEach(track => track.stop());
      }
      if (this.peerConnection) {
        this.peerConnection.close();
      }
      this.localStream = null;
      this.peerConnection = null;

      document.getElementById('myVideo').srcObject = null;
      document.getElementById('yourVideo').srcObject = null;
      this.isStreaming = false;
    }
  }
};
</script>
