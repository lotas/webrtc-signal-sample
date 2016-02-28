# WebRTC sample One-on-one

Working example of signalling server that relays required information between two parties that try to establish WebRTC connection.

IceCandidates are being sent as soon as they are created. See Trickle ICE [1](https://tools.ietf.org/html/draft-ietf-mmusic-trickle-ice-02) [2](https://rtcweb-wg.github.io/jsep/) [3](https://webrtchacks.com/trickle-ice/).
This allows not to wait for all ICE candidates to be gathered before being sent to other party, but connection can be established immediately and candidates can be matched as soon as they arrive (one by one);



## Signalling server

Start server:

```
node index.js
```

This is a simple WebSocket server that relays messages between two parties.

Command names are very similar to the [Kurento Application Server](http://www.kurento.org/docs/6.1.1/tutorials/node/tutorial-4-one2one.html) but doesn't require Kurento Media Server.


##  Call order

1. Register with unique name
`window.rtc.register('user1')`
2. Asking for camera permission `getUserMedia()`
3. Creating connection: `pc = new RTCPeerConnection`
4. Adding local stream `pc.addStream()` obtained from `getUserMedia`
5. Creating local offer `pc.createOffer(constraints)`

_Having local stream ready before creating offer is critical, otherwise offer would be created without video stream and connection would happen without it._

6. Set local description `pc.setLocalDescription(offer)` with offer from 5.
7. Send to signalling server call request with offer
  `sendMessage({id: 'call', from: 'us', to: 'them', sdpOffer: offer})`

8. Have `pc.ontrack, pc.onaddstream` events ready for remote streams (or manually after 9a)

9. Whenever `callResponse` is being received with `{response: 'accepted'}` we can start communication with received answer offer.

10. set `pc.setRemoteDescription(new RTCSessionDescription(msg.sdpAnswer))`

11. after remote description is ready we can show remote stream `pc.getRemoteStreams()`

## Accept call order

1. Register with unique name `window.rtc.register('user2')`

2. Whenever `incomingCall` is being received with SDP offer:

3. Asking for camera permission `getUserMedia()`

4. Creating connection: `pc = new RTCPeerConnection`

5. Adding local stream `pc.addStream()` obtained from `getUserMedia`

6. Adding received offer as remote description `pc.setRemoteDescription(remoteOffer)`

7. Creating local answer `pc.createAnswer(constraints)`

8. Set local description `pc.setLocalDescription(answer)` with answer from 7.

9. Send message back to caller with our SDP answer 
`sendMessage({id: 'incomingCallResponse', .., sdpOffer: pc.localDescription})`

10. Whenever `startCommunication` is received update remote description
`pc.setRemoteDescription()` and show remote stream `pc.getRemoteStreams()`


### Useful links
* https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/WebRTC_basics
* http://w3c.github.io/webrtc-pc/
* http://www.html5rocks.com/en/tutorials/webrtc/basics/
* https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection

----

```
Copyright © 2016 Yaraslau Kurmyza <lotask gmail.com>
This work is free. You can redistribute it and/or modify it under the
terms of the Do What The Fuck You Want To Public License, Version 2,
as published by Sam Hocevar. See http://www.wtfpl.net/ for more details.
```
