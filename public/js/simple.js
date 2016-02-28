(function(win) {
    win.rtc = {
        register: register,
        call: call,
        stop: stopCommunication,
        list: list
    };

    var ua = navigator ? navigator.userAgent : 'Version/1';
    var isFirefox = !!ua.match(/firefox/i);
    var browserVersion = ua.match(/(Chrome|Firefox|Version)\/(\d+)\b/).pop();

    var createOfferConstraints = isFirefox && browserVersion > 34 ? {
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
    } : {
        mandatory: {
            OfferToReceiveAudio: true,
            OfferToReceiveVideo: true
        },
        optional: [{
            DtlsSrtpKeyAgreement: true
        }]
    };

    var userMediaOptions = {
        audio: true,
        video: {
            width: 640,
            framerate: 15
        }
    };

    var videoInput, videoOutput;
    win.onload = function() {
        videoInput = document.getElementById('videoInput');
        videoOutput = document.getElementById('videoOutput');
    };

    const STATE = {
        INITIAL: 0,
        WAITING: 1,
        PROCESSING: 2,
        IN_CALL: 3
    };
    var callState;
    setState(STATE.INITIAL, 'initial');

    var host = win.location.hostname;
    var port = win.location.port;

    const WS_URL = 'ws://' + host + (port !== 80 ? (':' + port) : '') + '/call';
    var ws = new WebSocket(WS_URL);
    ws.onmessage = handleMessage;
    ws.onopen = function() {
        setTimeout(idle, 30000);
    };

    var configuration = {
        iceServers: [{
            urls: "stun:stun.l.google.com:19302"
        }, {
            urls: "stun:stun1.l.google.com:19302"
        }, {
            urls: "stun:stun.services.mozilla.com"
        }]
    };

    var pc;
    var addIceBuffered;

    /** signaling communication */
    function handleMessage(msg) {
        msg = JSON.parse(msg.data);
        console.debug('ws:in: ', msg);

        switch (msg.id) {
            case 'registerResponse':
                if (msg.response === 'accepted') {
                    setState(STATE.WAITING, 'registered');
                }
                break;
            case 'incomingCall':
                incomingCall(msg);
                break;
            case 'incomingMsg':
                break;
            case 'startCommunication':
                setState(STATE.IN_CALL, 'in call');
                startCommunication(msg);
                break;
            case 'stopCommunication':
                setState(STATE.WAITING, 'stopped');
                stopCommunication();
            case 'callResponse':
                if (msg.response === 'rejected') {
                    setState(STATE.WAITING, msg.message);
                } else {
                    setState(STATE.IN_CALL, 'call response');
                    startCommunication(msg);
                }
                break;
            case 'iceCandidate':
                remoteIceCandidate(msg.candidate);
                break;
        }
    }

    function sendMessage(msg) {
        console.debug('ws:out:', msg);
        ws.send(JSON.stringify(msg));
    }

    function register(name) {
        sendMessage({
            id: 'register',
            name: name
        });
    }

    function list() {
        sendMessage({
            id: 'list'
        });
    }

    function remoteIceCandidate(candidate) {
        console.debug('pc:addIceCandidate:', candidate);
        if (candidate) {
            addIceBuffered(new RTCIceCandidate(candidate), onError('addIce'));
            // pc.addIceCandidate(new RTCIceCandidate(candidate));
            // pc.addIceCandidate(new RTCIceCandidate({
            //     sdpMLineIndex: candidate.sdpMLineIndex,
            //     candidate: candidate.candidate
            // }));
        }
    }

    function localIceCandidate(e) {
        // no more candidates
        if (!e.candidate) return false;

        console.debug('pc:onicecandidate', e.candidate);
        sendMessage({
            id: 'onIceCandidate',
            candidate: e.candidate
        });
    }

    function incomingCall(msg) {
        if (callState !== STATE.WAITING) {
            return sendMessage({
                id: 'incomingCallResponse',
                from: msg.from,
                callResponse: 'reject',
                message
            });
        }

        setState(STATE.PROCESSING, 'incoming call');

        pc = new RTCPeerConnection(configuration);
        addIceBuffered = bufferizeCandidates(pc);
        // send ice candidates to the other peer
        pc.onicecandidate = localIceCandidate;
        // let the "negotiationneeded" event trigger offer generation
        pc.onnegotiationneeded = function() {
            pc.createOffer()
                .then(function(offer) {
                    console.debug('pc:createOffer:', offer);
                    return pc.setLocalDescription(offer);
                })
                .then(function() {
                    sendMessage({
                        id: 'incomingCallResponse',
                        from: msg.from,
                        callResponse: 'accept',
                        sdpOffer: pc.localDescription
                    })
                })
                .catch(onError('pc:createOffer'));
        }

        // when the remote track arrives
        pc.ontrack = pc.onaddstream = function(evt) {
            console.debug('pc:ontrack', evt);
            if (evt.track.kind === 'video') {
                showRemoteVideo(evt.stream || evt.streams[0]);
            }
        }

        navigator.getUserMedia(userMediaOptions, function(stream) {
            showLocalVideo(stream);

            pc.addStream(stream);
        }, onError('nav:getUserMedia'));

        // pc = new RTCPeerConnection(configuration);
        // pc.onicecandidate = localIceCandidate;

        // var offer = new RTCSessionDescription({
        //     type: 'offer',
        //     sdp: msg.offer
        // });
        // pc.setRemoteDescription(offer);

        // pc.createAnswer(function(answer) {
        //     console.debug('pc:createAnswer: ', answer);
        //     pc.setLocalDescription(answer, function(){
        //         sendMessage({
        //             id: 'incomingCallResponse',
        //             from: msg.from,
        //             callResponse: 'accept',
        //             sdpOffer: answer.sdp
        //         });
        //     });
        // });
        // pc.createOffer(
        //     function(offer) {
        //         console.debug('pc:onOffer:', offer);
        //         pc.setLocalDescription(offer, function() {
        //             console.debug('pc:setLocalDescription', offer.sdp);

        //             sendMessage({
        //                 id: 'incomingCallResponse',
        //                 from: msg.from,
        //                 callResponse: 'accept',
        //                 sdpOffer: offer.sdp
        //             });
        //         }, onError('pc:setLocalDescription'));
        //     },
        //     onError('pc:createOffer'),
        //     createOfferConstraints
        // );
    }

    function stopCommunication() {
        videoInput.pause();
        videoOutput.pause();

        if (pc && pc.signalingState !== 'closed') {
            pc.getLocalStreams().forEach(function(stream) {
                stream.getTracks().forEach(function(track) {
                    track.stop && track.stop();
                });
            });
        }
        sendMessage({
            id: 'stop'
        });

        videoInput.src = '';
        videoOutput.src = '';
    }

    function startCommunication(msg) {
        console.log('start communication', msg);
        if (msg.sdpAnswer && msg.sdpAnswer.type === 'offer') {
            pc.setRemoteDescription(new RTCSessionDescription({
                    type: 'offer',
                    sdp: msg.sdpAnswer.sdp
                }))
                .then(function() {
                    return pc.createAnswer();
                })
                .then(function(answer) {
                    return pc.setLocalDescription(answer);
                })
                .then(function() {
                    sendMessage({
                        id: 'answer',
                        sdpAnswer: pc.localDescription
                    });
                })
                .catch(onError('startCommunication'))
        } else if (msg.sdpAnswer && msg.sdpAnswer.type === 'answer') {
            pc.setRemoteDescription(msg.sdpAnswer)
                .catch(onError('setRemoteDescription'));
        }

        // var answer = new RTCSessionDescription({
        //     type: 'answer',
        //     sdp: msg.sdpAnswer
        // });
        // console.debug('startCommunication:sdp answer', answer);
        // pc.setRemoteDescription(answer, function() {
        //     showRemoteVideo(pc.getRemoteStreams()[0]);
        // });
    }

    function call(callee, caller) {
        setState(STATE.PROCESSING, 'calling');

        pc = new RTCPeerConnection(configuration);
        addIceBuffered = bufferizeCandidates(pc);

        // send ice candidates to the other peer
        pc.onicecandidate = localIceCandidate;

        // let the "negotiationneeded" event trigger offer generation
        pc.onnegotiationneeded = function() {
            pc.createOffer()
                .then(function(offer) {
                    console.debug('pc:createOffer:', offer);
                    return pc.setLocalDescription(offer);
                })
                .then(function() {
                    sendMessage({
                        id: 'call',
                        from: caller,
                        to: callee,
                        sdpOffer: pc.localDescription
                    })
                })
                .catch(onError('pc:createOffer'));
        }

        // when the remote track arrives
        pc.ontrack = function(evt) {
            console.debug('pc:ontrack', evt);
            if (evt.track.kind === 'video') {
                showRemoteVideo(evt.streams[0]);
            }
        }

        navigator.getUserMedia(userMediaOptions, function(stream) {
            showLocalVideo(stream);

            pc.addStream(stream);
        }, onError('nav:getUserMedia'));

        // pc.createOffer(
        //     function(offer) {
        //         console.debug('pc:onOffer:', offer);
        //         pc.setLocalDescription(offer, function() {
        //             console.debug('pc:setLocalDescription', pc.localDescription);

        //             sendMessage({
        //                 id: 'call',
        //                 from: caller,
        //                 to: callee,
        //                 sdpOffer: offer.sdp
        //             });
        //         }, onError('pc:setLocalDescription'));
        //     },
        //     onError('pc:createOffer'),
        //     createOfferConstraints
        // );
    }

    function bufferizeCandidates(pc, onerror) {
        var candidatesQueue = [];
        pc.addEventListener('signalingstatechange', function() {
            if (this.signalingState === 'stable') {
                while (candidatesQueue.length) {
                    var entry = candidatesQueue.shift();
                    this.addIceCandidate(candidate);
                }
            }
        });
        return function(candidate, callback) {
            callback = callback || onerror;
            switch (pc.signalingState) {
                case 'closed':
                    callback(new Error('PeerConnection object is closed'));
                    break;
                case 'stable':
                    if (pc.remoteDescription) {
                        pc.addIceCandidate(candidate, callback, callback);
                        break;
                    }
                default:
                    candidatesQueue.push(candidate);
            }
        };
    }

    function onError(what) {
        return function(err) {
            console.warn('err:' + what, err);
        };
    }

    function showLocalVideo(stream) {
        videoInput.src = URL.createObjectURL(stream);
        videoInput.muted = true;
    }

    function showRemoteVideo(stream) {
        var url = stream ? URL.createObjectURL(stream) : '';
        videoOutput.pause();
        videoOutput.src = url;
        videoOutput.load();
        console.debug('Remote URL: ', url);
    }

    function setState(state, msg) {
        console.debug('call:state: ', state);
        callState = state;

        var elm = document.getElementById('call-state');
        if (elm) {
            elm.innerHTML = msg;
        }
    }

    function idle() {
        ws.send(JSON.stringify({
            id: 'ping'
        }));
        setTimeout(idle, 30000);
    }
})(window);